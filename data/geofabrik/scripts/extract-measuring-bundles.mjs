/* global console, process, fetch */

import { execFileSync, execSync } from "node:child_process";
import {
    createReadStream,
    existsSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import YAML from "yaml";
import { union, intersection } from "polyclip-ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const geofabrikDir = resolve(scriptDir, "..");
const configPath = resolve(geofabrikDir, "config.yaml");
const root = resolve(geofabrikDir, "..", "..");

// ─── Config ────────────────────────────────────────────────────────────────────

/** Full config, read once at module load. */
const _cfg = YAML.parse(readFileSync(configPath, "utf8"));
const _m = _cfg.measuring ?? {};

// ─── Category definitions ────────────────────────────────────────────────────

const CATEGORIES = (_m.categories ?? []).map((c) => ({
    ...c,
    postFilter: c.postFilter ?? null,
    simplifyTolerance: c.simplifyTolerance ?? 0.0001,
    minFeatureLengthM: c.minFeatureLengthM ?? 100,
}));

// ─── Per-category lookup tables ──────────────────────────────────────────────

/** Simplify tolerances in degrees, keyed by category key. */
const SIMPLIFY_TOLERANCES = Object.fromEntries(
    CATEGORIES.map((c) => [c.key, c.simplifyTolerance]),
);

/** Minimum feature length in meters, keyed by category key. */
const MIN_FEATURE_LENGTH_M = Object.fromEntries(
    CATEGORIES.map((c) => [c.key, c.minFeatureLengthM]),
);

// ─── Algorithm tuning constants ──────────────────────────────────────────────

/** Simplify tolerance for waterway centerlines (degrees, ≈ 111 m). */
const WATERWAY_LINE_SIMPLIFY = _m.waterwayLineSimplify ?? 0.001;

// -- Polygon dissolve --

const DISSOLVE_TILE_DEG = _m.dissolve?.tileDeg ?? 0.25;
const DISSOLVE_TILE_OVERLAP_DEG = _m.dissolve?.overlapDeg ?? 0.01;

// -- Segment stitching --

const NODE_PRECISION = _m.stitching?.nodePrecision ?? 7;
const STITCH_MAX_TURN_COS = _m.stitching?.maxTurnCos ?? -0.5;

// -- Parallel track de-duplication --

const PARALLEL_MAX_LATERAL_M = _m.parallelDedup?.maxLateralM ?? 30;
const PARALLEL_MIN_COSINE = _m.parallelDedup?.minCosine ?? 0.966;
/** Sample at most this many points along a track for the hug test. */
const PARALLEL_HUG_SAMPLES = _m.parallelDedup?.hugSamples ?? 80;

// -- Collinear gap bridging --

const BRIDGE_MAX_GAP_M = _m.bridge?.maxGapM ?? 1500;
const BRIDGE_MIN_FACING_COS = _m.bridge?.minFacingCos ?? 0.95;

// -- HSR post-processing --

const HSR_MIN_ASSEMBLED_M = _m.hsr?.minAssembledM ?? 1000;

// -- Waterway centerline post-processing --

const WATERWAY_MIN_LENGTH = _m.waterway?.minLength ?? {
    river: 100,
    canal: 100,
    stream: 500,
};

// -- Continuity validation defaults --

const CONTINUITY_DEFAULTS = _m.continuity ?? {
    maxComponents: 40,
    maxHoles: 8,
    minFeatureLenM: 1000,
    holeMinM: 40,
    holeMaxM: 2500,
    joinTolM: 25,
    edgeMarginDeg: 0.02,
};

// ─── Coordinate cleaning ────────────────────────────────────────────────────────

/**
 * Strips consecutive duplicate coordinates from an array. Zero-length segments
 * cause a division-by-zero inside @turf/nearest-point-on-line's
 * nearestPointOnSegment → NaN → point([NaN, NaN]) throws.
 */
function cleanCoordsInline(coords) {
    if (coords.length < 2) return coords;
    const out = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        if (prev[0] !== curr[0] || prev[1] !== curr[1]) out.push(curr);
    }
    return out;
}

/** Counts consecutive duplicate coordinate pairs across all features. */
function countDupPairs(features) {
    let count = 0;
    const check = (coords) => {
        for (let i = 0; i < coords.length - 1; i++) {
            if (
                coords[i][0] === coords[i + 1][0] &&
                coords[i][1] === coords[i + 1][1]
            ) {
                count++;
            }
        }
    };
    for (const f of features) {
        const g = f.geometry;
        if (g.type === "LineString") {
            check(g.coordinates);
        } else if (g.type === "MultiLineString") {
            for (const seg of g.coordinates) check(seg);
        }
    }
    return count;
}

// ─── Post-filter predicates ───────────────────────────────────────────────────

function highSpeedPostFilter(tags) {
    // Exclude linear motor (maglev) lines — e.g. Chūō Shinkansen.
    if (tags.propulsion === "linear_motor") return false;
    if (tags.highspeed === "yes") return true;
    if (tags.service === "high_speed") return true;
    const ms = parseInt(tags.maxspeed, 10);
    return Number.isFinite(ms) && ms >= 200;
}

function adminLevelPostFilter(tags, level) {
    return (
        tags.boundary === "administrative" && tags.admin_level === String(level)
    );
}

function applyPostFilter(category, tags) {
    switch (category.postFilter) {
        case "high-speed":
            return highSpeedPostFilter(tags);
        case "admin-4":
            return adminLevelPostFilter(tags, 4);
        case "admin-7":
            return adminLevelPostFilter(tags, 7);
        default:
            return true;
    }
}

// ─── Geometry conversion (polygon → outer-ring LineString) ──────────────────

function featureToLineStrings(feature) {
    const { type, coordinates } = feature.geometry;
    if (type === "LineString" || type === "MultiLineString") return [feature];

    // Extract OSM relation ID (osmium exports it as properties["@id"] when
    // -a type,id is used). Pass it through so bundle features carry a stable
    // relationId that can be used for per-prefecture filtering at runtime.
    const relationId =
        feature.properties?.["@id"] != null
            ? Number(feature.properties["@id"])
            : undefined;

    const props = relationId !== undefined ? { relationId } : {};

    const lines = [];
    const pushRing = (ring) => {
        if (ring.length < 4) return; // skip degenerate rings
        lines.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: ring },
            properties: { ...props },
        });
    };

    // Outer ring is coordinates[0]; holes (coordinates[1..]) are skipped.
    if (type === "Polygon") {
        pushRing(coordinates[0]);
    } else if (type === "MultiPolygon") {
        for (const poly of coordinates) pushRing(poly[0]);
    }
    return lines;
}

// ─── Bbox computation ────────────────────────────────────────────────────────

function computeBbox(coords) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walk = (c) => {
        if (typeof c[0] === "number") {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
        } else c.forEach(walk);
    };
    walk(coords);
    return [minX, minY, maxX, maxY];
}

// ─── Polygon helpers (for polygon-dissolve mode) ────────────────────────────

/**
 * Computes a bbox for Polygon / MultiPolygon geometry, walking all rings.
 */
function computePolygonBbox(geom) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walkRing = (ring) => {
        for (const c of ring) {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
        }
    };
    if (geom.type === "Polygon") {
        for (const ring of geom.coordinates) walkRing(ring);
    } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
            for (const ring of poly) walkRing(ring);
        }
    }
    return [minX, minY, maxX, maxY];
}

/**
 * Great-circle perimeter of a polygon ring in meters.
 */
function ringPerimeterMeters(ring) {
    let total = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        total += haversineMeters(ring[i], ring[i + 1]);
    }
    return total;
}

/**
 * Total perimeter of a Polygon or MultiPolygon (outer ring + holes) in meters.
 * Used for the min-feature-length filter before dissolve.
 */
function polygonPerimeterMeters(geom) {
    let total = 0;
    if (geom.type === "Polygon") {
        for (const ring of geom.coordinates) {
            total += ringPerimeterMeters(ring);
        }
    } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
            for (const ring of poly) total += ringPerimeterMeters(ring);
        }
    }
    return total;
}

/**
 * Strips consecutive duplicate coordinates from a single ring. Returns the
 * cleaned ring (may be shorter). Rings that collapse to < 3 coords are
 * returned as-is (caller should filter them out).
 */
function cleanRingCoords(ring) {
    if (ring.length < 3) return ring;
    const out = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
        const prev = ring[i - 1];
        const curr = ring[i];
        if (prev[0] !== curr[0] || prev[1] !== curr[1]) out.push(curr);
    }
    return out;
}

/**
 * Cleans consecutive duplicate coordinates from all rings of a Polygon or
 * MultiPolygon. Drops rings that collapse to < 3 coords. Returns null if
 * the geometry degenerates (all rings collapsed).
 */
function cleanPolygonFeature(feature) {
    const geom = feature.geometry;
    if (geom.type === "Polygon") {
        const cleaned = geom.coordinates.map(cleanRingCoords).filter(
            (r) =>
                r.length >= 4 &&
                r[0][0] === r[r.length - 1][0] &&
                r[0][1] === r[r.length - 1][1]
                    ? r
                    : r.length >= 3, // non-closed rings are valid in some OSM data
        );
        if (cleaned.length === 0) return null;
        return {
            ...feature,
            geometry: { type: "Polygon", coordinates: cleaned },
        };
    } else if (geom.type === "MultiPolygon") {
        const cleaned = geom.coordinates
            .map((poly) =>
                poly.map(cleanRingCoords).filter((r) => r.length >= 3),
            )
            .filter((poly) => poly.length > 0 && poly[0].length >= 3);
        if (cleaned.length === 0) return null;
        return {
            ...feature,
            geometry: { type: "MultiPolygon", coordinates: cleaned },
        };
    }
    return feature;
}

/**
 * Simplifies each ring of a Polygon or MultiPolygon using RDP with a
 * collapse-fallback so thin polygons are never silently dropped.
 *
 * For each ring:
 * 1. Simplify at `tolerance`. If the result has ≥ 4 coords, keep it.
 * 2. If it collapsed, retry at `tolerance / 4`.
 * 3. If still collapsed, return the cleaned (de-duped) unsimplified ring.
 * 4. Only drop rings whose *source* genuinely has < 4 unique coords.
 *
 * Returns null when every ring degenerates.
 */
function simplifyPolygonFeature(feature, tolerance) {
    const simplifyRing = (ring, tol) => {
        const simplified = simplifyCoords(ring, tol);
        if (simplified.length >= 4) return simplified;
        // Retry at finer tolerance.
        const finer = simplifyCoords(ring, tol / 4);
        if (finer.length >= 4) return finer;
        // Fallback: keep the cleaned (de-duped) unsimplified ring.
        const cleaned = cleanRingCoords(ring);
        return cleaned.length >= 4 ? cleaned : null;
    };

    const geom = feature.geometry;
    if (geom.type === "Polygon") {
        const simplified = geom.coordinates
            .map((ring) => simplifyRing(ring, tolerance))
            .filter((ring) => ring !== null);
        if (simplified.length === 0) return null;
        return {
            ...feature,
            geometry: { type: "Polygon", coordinates: simplified },
        };
    } else if (geom.type === "MultiPolygon") {
        const simplified = geom.coordinates
            .map((poly) =>
                poly
                    .map((ring) => simplifyRing(ring, tolerance))
                    .filter((ring) => ring !== null),
            )
            .filter((poly) => poly.length > 0);
        if (simplified.length === 0) return null;
        return {
            ...feature,
            geometry: { type: "MultiPolygon", coordinates: simplified },
        };
    }
    return feature;
}

/**
 * Returns true when two bboxes intersect (inclusive).
 */
function bboxesIntersect(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Unions an array of polyclip-ts coordinate arrays (each a GeoJSON
 * `geometry.coordinates` for a Polygon or MultiPolygon) into as few merge
 * groups as possible, returning one coordinate array per surviving group
 * (normally a single group).
 *
 * Uses a single variadic `union(first, ...rest)` pass: polyclip-ts sweeps all
 * inputs in one O(n log n) pass. The previous sequential accumulation
 * (`acc = union(acc, next)`) was O(n²) — it re-processed the growing
 * accumulator on every step and made the dissolve effectively hang on dense
 * tiles (benchmarked: 2,000 trivial squares took 123 s sequential vs 0.1 s
 * variadic).
 *
 * Fail-safe: polyclip-ts occasionally throws on degenerate OSM rings. When a
 * union throws, the input is split in half and each half is dissolved
 * independently, so one bad polygon isolates itself in its own group instead
 * of poisoning the whole tile. A final guarded pass tries to re-merge the
 * surviving groups.
 */
function unionAllCoords(coordsList) {
    if (coordsList.length <= 1) return coordsList.slice();
    try {
        return [union(coordsList[0], ...coordsList.slice(1))];
    } catch {
        const mid = Math.floor(coordsList.length / 2);
        const groups = [
            ...unionAllCoords(coordsList.slice(0, mid)),
            ...unionAllCoords(coordsList.slice(mid)),
        ];
        if (groups.length <= 1) return groups;
        try {
            return [union(groups[0], ...groups.slice(1))];
        } catch {
            return groups;
        }
    }
}

// ─── Polygon dissolve (for polygon-dissolve mode) ──────────────────────────

/**
 * Tile size in degrees for the dissolve grid. 0.25° ≈ 28 km at mid-latitudes
 * — large enough that most water bodies fall entirely inside one tile,
 * small enough that the union within each tile is fast.
 *
 * Overlap between adjacent tiles prevents seams at tile boundaries.
 *
 * Values are read from config.yaml → measuring.dissolve.
 */

/**
 * Dissolves an array of Polygon / MultiPolygon features into a smaller set
 * of tiled, unioned MultiPolygon features.
 *
 * Strategy: partition input polygons into a coarse grid, union within each
 * tile, intersect with the tile bounds for clean edges, simplify, and emit
 * one feature per non-empty tile. Adjacent tiles overlap by a small ε so
 * features straddling a boundary are present in both tiles and dissolved
 * across the seam.
 */
function polygonDissolve(inputFeatures, extractBbox, simplifyTolerance) {
    const t0 = Date.now();

    // Build tile grid.
    const tiles = [];
    for (
        let tx = extractBbox[0];
        tx < extractBbox[2];
        tx += DISSOLVE_TILE_DEG
    ) {
        for (
            let ty = extractBbox[1];
            ty < extractBbox[3];
            ty += DISSOLVE_TILE_DEG
        ) {
            const tileBbox = [
                tx - DISSOLVE_TILE_OVERLAP_DEG,
                ty - DISSOLVE_TILE_OVERLAP_DEG,
                tx + DISSOLVE_TILE_DEG + DISSOLVE_TILE_OVERLAP_DEG,
                ty + DISSOLVE_TILE_DEG + DISSOLVE_TILE_OVERLAP_DEG,
            ];
            tiles.push(tileBbox);
        }
    }

    console.log(
        `  [dissolve] ${inputFeatures.length.toLocaleString()} input polygons, ` +
            `${tiles.length} tiles (${DISSOLVE_TILE_DEG}° each)`,
    );

    const results = [];
    let emptyTiles = 0;
    let unionTimeMs = 0;

    for (const tileBbox of tiles) {
        // Find polygons whose bbox intersects this tile.
        const tilePolys = inputFeatures.filter((f) =>
            bboxesIntersect(f.bbox, tileBbox),
        );
        if (tilePolys.length === 0) {
            emptyTiles++;
            continue;
        }

        // Union all polygons in this tile in a single variadic pass.
        // polyclip-ts union/intersection expect raw coordinate arrays, NOT
        // GeoJSON geometry objects ({type, coordinates}); work with
        // .coordinates throughout and re-wrap the result. `unionAllCoords`
        // is fail-safe: a polygon that makes polyclip-ts throw isolates
        // itself into its own merge group instead of dropping out, so every
        // input polygon still contributes.
        const tUnion = Date.now();
        const groups = unionAllCoords(
            tilePolys.map((f) => f.geometry.coordinates),
        );
        unionTimeMs += Date.now() - tUnion;

        if (groups.length > 1) {
            console.log(
                `  [dissolve] tile [${tileBbox[0].toFixed(2)},${tileBbox[1].toFixed(2)}] ` +
                    `${tilePolys.length} polys → ${groups.length} merge groups ` +
                    `(some unions failed — kept as separate features)`,
            );
        }

        // Intersect each merge group with the tile bounds to get clean
        // edges, simplify, and emit.
        const tileGeom = {
            type: "Polygon",
            coordinates: [
                [
                    [tileBbox[0], tileBbox[1]],
                    [tileBbox[2], tileBbox[1]],
                    [tileBbox[2], tileBbox[3]],
                    [tileBbox[0], tileBbox[3]],
                    [tileBbox[0], tileBbox[1]],
                ],
            ],
        };

        for (const merged of groups) {
            if (!merged) continue;

            let clipped;
            try {
                clipped = intersection(merged, tileGeom.coordinates);
            } catch {
                // Fall back to the merged result if intersection fails.
                clipped = merged;
            }

            if (!clipped) continue;

            // Wrap polyclip-ts raw coordinate result back into a GeoJSON
            // geometry object for simplify/bbox helpers.
            const feat = {
                type: "Feature",
                geometry: { type: "MultiPolygon", coordinates: clipped },
                properties: {},
            };

            // Simplify.
            const simplified = simplifyPolygonFeature(feat, simplifyTolerance);

            // Skip features that fully degenerate (all rings collapsed to < 4 coords).
            if (!simplified) continue;

            // Compute bbox of the simplified geometry.
            const bbox = computePolygonBbox(simplified.geometry);

            results.push({
                type: "Feature",
                bbox,
                geometry: simplified.geometry,
                properties: {},
            });
        }
    }

    console.log(
        `  [dissolve] ${results.length} tile features ` +
            `(${emptyTiles} empty tiles), ` +
            `union: ${(unionTimeMs / 1000).toFixed(1)}s, ` +
            `total: ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    return results;
}

// ─── Simplification ──────────────────────────────────────────────────────────

function simplifyCoords(coords, tolerance) {
    // Ramer-Douglas-Peucker simplification.
    if (coords.length <= 2) return coords;

    const sqTolerance = tolerance * tolerance;

    function findFarthest(points) {
        let maxDist = 0;
        let maxIdx = 0;
        const first = points[0];
        const last = points[points.length - 1];
        const dx = last[0] - first[0];
        const dy = last[1] - first[1];
        const lenSq = dx * dx + dy * dy;

        for (let i = 1; i < points.length - 1; i++) {
            let dist;
            if (lenSq === 0) {
                const dxi = points[i][0] - first[0];
                const dyi = points[i][1] - first[1];
                dist = dxi * dxi + dyi * dyi;
            } else {
                let t =
                    ((points[i][0] - first[0]) * dx +
                        (points[i][1] - first[1]) * dy) /
                    lenSq;
                if (t < 0) t = 0;
                if (t > 1) t = 1;
                const px = first[0] + t * dx;
                const py = first[1] + t * dy;
                const dxi = points[i][0] - px;
                const dyi = points[i][1] - py;
                dist = dxi * dxi + dyi * dyi;
            }
            if (dist > maxDist) {
                maxDist = dist;
                maxIdx = i;
            }
        }
        return { index: maxIdx, dist: maxDist };
    }

    function simplify(points) {
        const { index, dist } = findFarthest(points);
        if (dist > sqTolerance) {
            const left = simplify(points.slice(0, index + 1));
            const right = simplify(points.slice(index));
            return left.slice(0, -1).concat(right);
        }
        return [points[0], points[points.length - 1]];
    }

    return simplify(coords);
}

function simplifyFeature(feature, tolerance) {
    const simplified = { ...feature, geometry: { ...feature.geometry } };
    if (feature.geometry.type === "LineString") {
        simplified.geometry.coordinates = simplifyCoords(
            feature.geometry.coordinates,
            tolerance,
        );
    } else if (feature.geometry.type === "MultiLineString") {
        simplified.geometry.coordinates = feature.geometry.coordinates.map(
            (seg) => simplifyCoords(seg, tolerance),
        );
    }
    return simplified;
}

// ─── High-speed-rail post-processing ────────────────────────────────────────

/**
 * Great-circle distance in meters between two [lon, lat] points.
 */
function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h =
        sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Cosine similarity between two 2D vectors.
 */
function cosineSimilarity(v1, v2) {
    return v1[0] * v2[0] + v1[1] * v2[1];
}

/**
 * Point-to-segment distance in meters between `p` and segment `a`–`b`
 * (small-angle planar approximation, accurate enough at track scale).
 */
function pointSegDistMeters(p, a, b) {
    const kx = 111320 * Math.cos((p[1] * Math.PI) / 180);
    const ky = 111320;
    const ax = a[0] * kx;
    const ay = a[1] * ky;
    const bx = b[0] * kx;
    const by = b[1] * ky;
    const px = p[0] * kx;
    const py = p[1] * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
    }
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ─── Segment stitching (exact shared-node assembly) ──────────────────────────
//
// OSM ways that form one continuous track share *exact* node coordinates at
// their join points. We assemble maximal polylines by walking that shared-node
// graph, so connectivity never depends on fuzzy endpoint-distance heuristics
// (an earlier distance/cross-track matcher silently shattered the network).
// A node where exactly two way-ends meet is an unambiguous pass-through and is
// always joined; at a junction (>2 way-ends) we continue along the straightest
// available track and let genuinely diverging branches start their own line.
//
// Tuning values (nodePrecision, maxTurnCos) are in config.yaml → measuring.stitching.

/** Stable key for a coordinate so shared OSM nodes hash to the same bucket. */
function nodeKey(pt) {
    return `${pt[0].toFixed(NODE_PRECISION)},${pt[1].toFixed(NODE_PRECISION)}`;
}

/**
 * Unit tangent of `coords` at the given end, pointing *out of* the endpoint
 * toward the interior of the line. Two ways that continue straight through a
 * shared node have antiparallel departure tangents (cos ≈ -1).
 */
function departureTangent(coords, atStart) {
    const a = atStart ? coords[0] : coords[coords.length - 1];
    const b = atStart ? coords[1] : coords[coords.length - 2];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const mag = Math.sqrt(dx * dx + dy * dy);
    return mag === 0 ? [0, 0] : [dx / mag, dy / mag];
}

/**
 * Stitch fragmented LineString features into maximal continuous lines by
 * walking the exact shared-node graph.
 *
 * The connected-component count never *increases*: every degree-2 node is
 * joined unconditionally, so any two ways that share a node in OSM stay
 * connected in the output. Junctions split into separate features that still
 * meet at the exact junction coordinate, so the rendered line has no gaps.
 */
function stitchSegments(features) {
    const n = features.length;
    if (n <= 1) return features;

    // node key -> endpoint stubs { way, atStart } of every way meeting there.
    const nodes = new Map();
    for (let w = 0; w < n; w++) {
        const c = features[w].geometry.coordinates;
        for (const [pt, atStart] of [
            [c[0], true],
            [c[c.length - 1], false],
        ]) {
            const k = nodeKey(pt);
            let stubs = nodes.get(k);
            if (!stubs) nodes.set(k, (stubs = []));
            stubs.push({ way: w, atStart });
        }
    }

    // Seed degree-1 ways first — those with at least one endpoint that no other
    // way shares (true chain termini). Processing termini before interior ways
    // prevents the greedy order from consuming a junction's "correct" forward
    // continuation before the chain that needs it arrives, which would otherwise
    // force the stitcher to append a backward stub and create a local zigzag.
    const degree1Seeds = [];
    const otherSeeds = [];
    for (let w = 0; w < n; w++) {
        const c = features[w].geometry.coordinates;
        const dS = (nodes.get(nodeKey(c[0])) ?? []).length;
        const dE = (nodes.get(nodeKey(c[c.length - 1])) ?? []).length;
        (dS === 1 || dE === 1 ? degree1Seeds : otherSeeds).push(w);
    }
    const seedOrder = [...degree1Seeds, ...otherSeeds];

    const used = new Array(n).fill(false);

    // From node `key`, having arrived with departure tangent `inbound` (the
    // tangent leaving `key` along the line built so far), choose the straightest
    // unused way to continue along. A degree-2 node (one unused continuation)
    // joins unconditionally; a junction requires a near-straight continuation.
    const pickNext = (key, inbound) => {
        const candidates = (nodes.get(key) ?? []).filter((s) => !used[s.way]);
        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];
        let best = null;
        let bestCos = Infinity;
        for (const s of candidates) {
            const dep = departureTangent(
                features[s.way].geometry.coordinates,
                s.atStart,
            );
            const cos = cosineSimilarity(inbound, dep);
            if (cos < bestCos) {
                bestCos = cos;
                best = s;
            }
        }
        return bestCos <= STITCH_MAX_TURN_COS ? best : null;
    };

    const result = [];

    for (const seed of seedOrder) {
        if (used[seed]) continue;
        used[seed] = true;
        const seedProps = features[seed].properties;
        let coords = [...features[seed].geometry.coordinates];

        // Grow forward from the tail node.
        for (;;) {
            const tailKey = nodeKey(coords[coords.length - 1]);
            const next = pickNext(tailKey, departureTangent(coords, false));
            if (!next) break;
            used[next.way] = true;
            const nc = features[next.way].geometry.coordinates;
            const seg = nodeKey(nc[0]) === tailKey ? nc : [...nc].reverse();
            for (let i = 1; i < seg.length; i++) coords.push(seg[i]);
        }

        // Grow backward from the head node.
        for (;;) {
            const headKey = nodeKey(coords[0]);
            const next = pickNext(headKey, departureTangent(coords, true));
            if (!next) break;
            used[next.way] = true;
            const nc = features[next.way].geometry.coordinates;
            const seg =
                nodeKey(nc[nc.length - 1]) === headKey ? nc : [...nc].reverse();
            coords = seg.slice(0, seg.length - 1).concat(coords);
        }

        result.push(makeFeature(coords, seedProps));
    }

    return result;
}

function makeFeature(coords, props) {
    const bbox = computeBbox(coords);
    return {
        type: "Feature",
        bbox,
        geometry: { type: "LineString", coordinates: coords },
        properties: { ...(props ?? {}) },
    };
}

// ─── Parallel track de-duplication ───────────────────────────────────────────
//
// Tuning values (maxLateralM, minCosine, hugSamples) are in
// config.yaml → measuring.parallelDedup.

/** Bbox [w,s,e,n] of a coordinate array, expanded by `padDeg`. */
function coordsBbox(coords, padDeg = 0) {
    let w = Infinity,
        s = Infinity,
        e = -Infinity,
        nth = -Infinity;
    for (const p of coords) {
        if (p[0] < w) w = p[0];
        if (p[0] > e) e = p[0];
        if (p[1] < s) s = p[1];
        if (p[1] > nth) nth = p[1];
    }
    return [w - padDeg, s - padDeg, e + padDeg, nth + padDeg];
}

function bboxesOverlap(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * True when every sampled point of `shorter` lies within `maxLateral` of
 * `longer` — i.e. `shorter` runs alongside `longer` for its whole length and is
 * a duplicate track. A point that strays (a diverging branch) fails fast.
 */
function shorterHugsLonger(longer, shorter, maxLateral) {
    const step = Math.max(1, Math.floor(shorter.length / PARALLEL_HUG_SAMPLES));
    for (let k = 0; k < shorter.length; k += step) {
        const p = shorter[k];
        let min = Infinity;
        for (let i = 0; i < longer.length - 1; i++) {
            const d = pointSegDistMeters(p, longer[i], longer[i + 1]);
            if (d < min) min = d;
            if (min <= maxLateral) break;
        }
        if (min > maxLateral) return false;
    }
    return true;
}

/**
 * Collapse the two ~4 m-apart tracks of a double-track line by keeping the
 * longer (most complete) track and dropping shorter near-duplicates that hug it
 * along their whole length. Unlike centerline averaging this is raw-faithful —
 * it never invents geometry, so it cannot zigzag or stagger — and preferring the
 * longest track keeps the most continuous version of each corridor.
 */
function dedupeParallelTracks(features) {
    const n = features.length;
    if (n <= 1) return features;

    // Longest first, so the most complete corridor becomes the keeper.
    const order = [...features.keys()].sort(
        (a, b) =>
            lineLengthMeters(features[b].geometry.coordinates) -
            lineLengthMeters(features[a].geometry.coordinates),
    );

    const dropped = new Array(n).fill(false);
    const bbox = features.map((f) =>
        coordsBbox(f.geometry.coordinates, PARALLEL_MAX_LATERAL_M / 111320),
    );
    const dir = features.map((f) => {
        const c = f.geometry.coordinates;
        const dx = c[c.length - 1][0] - c[0][0];
        const dy = c[c.length - 1][1] - c[0][1];
        const m = Math.sqrt(dx * dx + dy * dy);
        return m > 0 ? [dx / m, dy / m] : [0, 0];
    });

    for (let oi = 0; oi < n; oi++) {
        const i = order[oi];
        if (dropped[i]) continue;
        for (let oj = oi + 1; oj < n; oj++) {
            const j = order[oj]; // length(j) <= length(i)
            if (dropped[j]) continue;
            if (!bboxesOverlap(bbox[i], bbox[j])) continue;
            // Same axis (parallel tracks may be digitized either way).
            if (
                Math.abs(cosineSimilarity(dir[i], dir[j])) < PARALLEL_MIN_COSINE
            ) {
                continue;
            }
            if (
                shorterHugsLonger(
                    features[i].geometry.coordinates,
                    features[j].geometry.coordinates,
                    PARALLEL_MAX_LATERAL_M,
                )
            ) {
                dropped[j] = true;
            }
        }
    }

    return features.filter((_, i) => !dropped[i]);
}

// ─── Collinear gap bridging ──────────────────────────────────────────────────
//
// A handful of real OSM coverage breaks remain where a connecting segment is
// missing the high-speed tag, leaving a short gap between two otherwise-collinear
// corridors. This pass joins such corridor ends. It runs only on the assembled
// corridors and requires the two ends to face each other nearly head-on, so it
// cannot reconnect unrelated tracks. Gaps larger than the configured max are left
// for `validateLineContinuity` to flag rather than bridged blindly.
//
// Tuning values (maxGapM, minFacingCos) are in config.yaml → measuring.bridge.

function bridgeCollinearGaps(features) {
    let feats = features.map((f) => f.geometry.coordinates);

    for (;;) {
        const eps = [];
        for (let i = 0; i < feats.length; i++) {
            const c = feats[i];
            eps.push({ i, start: true, p: c[0], t: departureTangent(c, true) });
            eps.push({
                i,
                start: false,
                p: c[c.length - 1],
                t: departureTangent(c, false),
            });
        }

        let best = null;
        for (let a = 0; a < eps.length; a++) {
            for (let b = a + 1; b < eps.length; b++) {
                const ea = eps[a];
                const eb = eps[b];
                if (ea.i === eb.i) continue;
                const gap = haversineMeters(ea.p, eb.p);
                if (gap < 1 || gap > BRIDGE_MAX_GAP_M) continue;
                // Ends must face each other (inward tangents antiparallel) …
                if (cosineSimilarity(ea.t, eb.t) > -BRIDGE_MIN_FACING_COS) {
                    continue;
                }
                // … and the gap must open straight ahead of each loose end.
                const v = localUnit(ea.p, eb.p);
                if (-(v[0] * ea.t[0] + v[1] * ea.t[1]) < 0.9) continue;
                if (v[0] * eb.t[0] + v[1] * eb.t[1] < 0.9) continue;
                if (!best || gap < best.gap) best = { ea, eb, gap };
            }
        }
        if (!best) break;

        // Orient both so A ends at its loose endpoint and B starts at hers,
        // then concatenate (the join segment bridges the gap).
        const a = best.ea;
        const b = best.eb;
        const A = a.start ? [...feats[a.i]].reverse() : feats[a.i];
        const B = b.start ? feats[b.i] : [...feats[b.i]].reverse();
        const merged = A.concat(B);
        const hi = Math.max(a.i, b.i);
        const lo = Math.min(a.i, b.i);
        feats.splice(hi, 1);
        feats.splice(lo, 1);
        feats.push(merged);
    }

    return feats.map((c) => makeFeature(c));
}

// ─── Continuity validation ───────────────────────────────────────────────────

/** Unit vector a→b in local meters (for short gaps). */
function localUnit(a, b) {
    const dx =
        (b[0] - a[0]) *
        111320 *
        Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    const dy = (b[1] - a[1]) * 111320;
    const mag = Math.hypot(dx, dy);
    return mag === 0 ? [0, 0] : [dx / mag, dy / mag];
}

/** Great-circle length of a coordinate ring/line in meters. */
function lineLengthMeters(coords) {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += haversineMeters(coords[i], coords[i + 1]);
    }
    return total;
}

/**
 * Guard against the discontinuous-line regression. The substantial features
 * of a line category (≥ `minFeatureLenM`, i.e. main corridors, not station
 * sidings or platform stubs) must form a small number of connected components
 * and must not contain interior "holes": pairs of endpoints that are collinear
 * continuations of one another separated by a visible gap. Throws when the
 * geometry is too fragmented, so a bad regeneration fails loudly instead of
 * shipping a broken bundle. Returns the measured metrics.
 */
function validateLineContinuity(features, extractBbox, opts = {}) {
    const {
        maxComponents = CONTINUITY_DEFAULTS.maxComponents,
        maxHoles = CONTINUITY_DEFAULTS.maxHoles,
        minFeatureLenM = CONTINUITY_DEFAULTS.minFeatureLenM,
        holeMinM = CONTINUITY_DEFAULTS.holeMinM,
        holeMaxM = CONTINUITY_DEFAULTS.holeMaxM,
        joinTolM = CONTINUITY_DEFAULTS.joinTolM,
        edgeMarginDeg = CONTINUITY_DEFAULTS.edgeMarginDeg,
    } = opts;

    // Restrict every check to substantial features; short sidings/stubs near
    // stations have legitimate loose ends and are not rendering gaps.
    const mainFeatures = features.filter(
        (f) => lineLengthMeters(f.geometry.coordinates) >= minFeatureLenM,
    );
    const n = mainFeatures.length;
    const ends = mainFeatures.map((f) => {
        const c = f.geometry.coordinates;
        return { s: c[0], e: c[c.length - 1] };
    });

    // Connected components by endpoint proximity. Post-merge centerlines no
    // longer share exact nodes, so use a small metric tolerance rather than
    // the exact key the stitcher uses internally.
    const parent = [...Array(n).keys()];
    const find = (x) => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const pi = ends[i];
            const pj = ends[j];
            if (
                haversineMeters(pi.s, pj.s) <= joinTolM ||
                haversineMeters(pi.s, pj.e) <= joinTolM ||
                haversineMeters(pi.e, pj.s) <= joinTolM ||
                haversineMeters(pi.e, pj.e) <= joinTolM
            ) {
                parent[find(i)] = find(j);
            }
        }
    }
    const roots = new Set();
    for (let i = 0; i < n; i++) roots.add(find(i));
    const components = roots.size;

    // Interior collinear holes.
    const [west, south, east, north] = extractBbox;
    const nearEdge = (p) =>
        p[0] - west < edgeMarginDeg ||
        east - p[0] < edgeMarginDeg ||
        p[1] - south < edgeMarginDeg ||
        north - p[1] < edgeMarginDeg;

    const eps = [];
    for (let i = 0; i < n; i++) {
        const c = mainFeatures[i].geometry.coordinates;
        eps.push({ i, p: c[0], t: departureTangent(c, true) });
        eps.push({ i, p: c[c.length - 1], t: departureTangent(c, false) });
    }

    const holes = [];
    for (let a = 0; a < eps.length; a++) {
        const ea = eps[a];
        if (nearEdge(ea.p)) continue;
        for (let b = a + 1; b < eps.length; b++) {
            const eb = eps[b];
            if (ea.i === eb.i) continue;
            const d = haversineMeters(ea.p, eb.p);
            if (d < holeMinM || d > holeMaxM) continue;
            if (nearEdge(eb.p)) continue;
            // Each tangent faces into its own body, away from the gap, so two
            // ends facing each other across a hole are antiparallel.
            if (cosineSimilarity(ea.t, eb.t) > -0.9) continue;
            // The gap must open in front of ea's loose end (opposite its tangent).
            const v = localUnit(ea.p, eb.p);
            if (-(v[0] * ea.t[0] + v[1] * ea.t[1]) < 0.9) continue;
            holes.push({ a: ea.p, gap: Math.round(d) });
        }
    }

    console.log(
        `  [validate] main-corridors=${n} (≥${minFeatureLenM}m) ` +
            `components=${components} interior-holes=${holes.length}`,
    );
    if (holes.length) {
        console.log(
            `  [validate] sample holes: ` +
                holes
                    .slice(0, 5)
                    .map(
                        (h) =>
                            `${h.gap}m@[${h.a[0].toFixed(4)},${h.a[1].toFixed(4)}]`,
                    )
                    .join(", "),
        );
    }

    const problems = [];
    if (components > maxComponents) {
        problems.push(
            `${components} connected components (max ${maxComponents})`,
        );
    }
    if (holes.length > maxHoles) {
        problems.push(
            `${holes.length} interior collinear holes ${holeMinM}–${holeMaxM} m (max ${maxHoles})`,
        );
    }
    if (problems.length) {
        throw new Error(
            `Discontinuous line geometry: ${problems.join("; ")}. ` +
                `The shared-node stitcher likely regressed.`,
        );
    }

    return { components, holes: holes.length };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const attribution = {
    text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL). Geofabrik extract from download.geofabrik.de.",
    license: "ODbL-1.0",
    url: "https://www.openstreetmap.org/copyright",
};

async function main() {
    const config = YAML.parse(await readFile(configPath, "utf8"));

    if (!config.measuring) {
        throw new Error("No 'measuring' block found in config.yaml");
    }

    const cacheOnly = process.argv.includes("--cache-only");
    const checkMode = process.argv.includes("--check");
    // --only=<category> regenerates a single bundle (e.g. high-speed-rail)
    // without touching the others — handy when iterating on one category.
    const onlyArg = process.argv.find((a) => a.startsWith("--only="));
    const onlyCategory = onlyArg ? onlyArg.slice("--only=".length) : null;
    if (onlyCategory && !CATEGORIES.some((c) => c.key === onlyCategory)) {
        throw new Error(
            `Unknown --only category "${onlyCategory}". Valid: ${CATEGORIES.map((c) => c.key).join(", ")}`,
        );
    }
    const categories = onlyCategory
        ? CATEGORIES.filter((c) => c.key === onlyCategory)
        : CATEGORIES;
    const measConfig = config.measuring;
    const cacheDir = resolve(geofabrikDir, config.cacheDir ?? "cache");
    const extractBbox = measConfig.extractBbox;
    const sourceUrl = measConfig.sourcePbfUrl;

    const outputDir = checkMode
        ? resolve(
              (await import("node:os")).tmpdir(),
              `measuring-bundle-check-${Date.now()}`,
          )
        : resolve(root, "assets", "measuring");

    await mkdir(cacheDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    // 1. Ensure whole-Japan PBF is cached.
    const japanPbfPath = resolve(cacheDir, "japan-latest.osm.pbf");
    if (existsSync(japanPbfPath)) {
        console.log(`Using cached: ${japanPbfPath}`);
    } else if (cacheOnly) {
        throw new Error(
            "japan-latest.osm.pbf not cached and --cache-only is set. Run without --cache-only to download.",
        );
    } else {
        console.log(`Downloading: ${sourceUrl}`);
        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(japanPbfPath, buffer);
        console.log(`Wrote ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
    }

    const japanStat = await stat(japanPbfPath);
    console.log(
        `Japan PBF size: ${(japanStat.size / 1024 / 1024).toFixed(1)} MB`,
    );

    // 2. Extract Kantō+margin window (reuse the cached extract if present).
    const widePbfPath = resolve(cacheDir, "measuring-kanto-wide.osm.pbf");
    const bboxStr = extractBbox.join(",");
    if (existsSync(widePbfPath)) {
        console.log(`Using cached Kantō+margin extract: ${widePbfPath}`);
    } else {
        console.log(`Extracting Kantō+margin window: ${bboxStr}`);
        execFileSync(
            "osmium",
            [
                "extract",
                "-b",
                bboxStr,
                japanPbfPath,
                "-o",
                widePbfPath,
                "--overwrite",
            ],
            { stdio: "inherit" },
        );
    }
    const wideStat = await stat(widePbfPath);
    console.log(
        `Kantō+margin extract: ${(wideStat.size / 1024 / 1024).toFixed(1)} MB`,
    );

    // 3. Shared coarse filter for admin 1st/2nd.
    const adminTmpDir = join(
        (await import("node:os")).tmpdir(),
        `measuring-admin-${Date.now()}`,
    );
    await mkdir(adminTmpDir, { recursive: true });
    const adminSeqPath = join(adminTmpDir, "admin-boundaries.seq");
    let adminSeqExists = false;

    const generatedAt = new Date().toISOString();
    const sizes = {};

    for (const category of categories) {
        console.log(`\n=== ${category.key} ===`);

        let pbfPath;
        if (
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border"
        ) {
            // Three-step pipeline so osmium can assemble relations into
            // complete Polygons:
            // 1. tags-filter: extract only r/boundary=administrative.
            // 2. Extract relation IDs to a text file, then getid -r -i
            //    to pull in all member ways from the wide PBF.
            // 3. Export the complete set.
            if (!adminSeqExists) {
                console.log(
                    `  [shared] Filtering r/boundary=administrative...`,
                );
                const adminRelsPbf = join(
                    adminTmpDir,
                    "admin-rels-only.osm.pbf",
                );
                execFileSync(
                    "osmium",
                    [
                        "tags-filter",
                        widePbfPath,
                        "r/boundary=administrative",
                        "-o",
                        adminRelsPbf,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );

                console.log(`  [shared] Extracting relation IDs...`);
                const idsPath = join(adminTmpDir, "admin-rel-ids.txt");
                const opl = execSync(`osmium cat "${adminRelsPbf}" -f opl`, {
                    maxBuffer: 512 * 1024 * 1024,
                }).toString();
                const ids = [];
                for (const line of opl.split("\n")) {
                    if (!line.startsWith("r")) continue;
                    // Keep the 'r' prefix so osmium getid knows the type.
                    ids.push(line.split(" ")[0]);
                }
                writeFileSync(idsPath, ids.join("\n") + "\n");
                console.log(`  [shared] Found ${ids.length} relation IDs`);

                console.log(
                    `  [shared] Pulling in member ways with getid -r...`,
                );
                const adminCompletePbf = join(
                    adminTmpDir,
                    "admin-complete.osm.pbf",
                );
                // osmium getid exits 1 when some referenced objects are
                // outside the extract (missing ways/nodes). The output file
                // is still valid — just with those objects omitted.
                try {
                    execFileSync(
                        "osmium",
                        [
                            "getid",
                            widePbfPath,
                            "-r",
                            "-i",
                            idsPath,
                            "-o",
                            adminCompletePbf,
                            "-O",
                        ],
                        { stdio: "inherit" },
                    );
                } catch (err) {
                    if (!existsSync(adminCompletePbf)) throw err;
                    console.log(
                        `  [shared] getid reported missing objects ` +
                            `(some member ways outside extract) — continuing`,
                    );
                }

                console.log(`  [shared] Exporting to GeoJSON...`);
                execFileSync(
                    "osmium",
                    [
                        "export",
                        adminCompletePbf,
                        "-f",
                        "geojson",
                        "-a",
                        "type,id",
                        "-o",
                        adminSeqPath,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );
                adminSeqExists = true;
            }
        } else {
            console.log(`  Filtering: ${category.osmiumFilter}`);
            const tmpDir = join(
                (await import("node:os")).tmpdir(),
                `measuring-${category.key}-${Date.now()}`,
            );
            await mkdir(tmpDir, { recursive: true });
            pbfPath = join(tmpDir, `${category.key}.osm.pbf`);
            execFileSync(
                "osmium",
                [
                    "tags-filter",
                    widePbfPath,
                    ...category.osmiumFilter.split(" "),
                    "-o",
                    pbfPath,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        }

        // Export to GeoJSONSeq.
        let seqPath;
        if (
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border"
        ) {
            seqPath = adminSeqPath;
        } else {
            const tmpDir = dirname(pbfPath);
            seqPath = join(tmpDir, `${category.key}.seq`);
            console.log(`  Exporting to GeoJSONSeq...`);
            execFileSync(
                "osmium",
                [
                    "export",
                    pbfPath,
                    "-f",
                    "geojsonseq",
                    "-a",
                    "type,id",
                    "-o",
                    seqPath,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        }

        // Process features — streaming GeoJSONSeq for most categories,
        // full GeoJSON parse for admin (assembled relation polygons).
        console.log(`  Processing features...`);
        const features = [];

        const isAdmin =
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border";

        if (isAdmin) {
            // Admin: read the assembled GeoJSON FeatureCollection.
            const raw = readFileSync(seqPath, "utf8");
            const fc = JSON.parse(raw);

            for (const feature of fc.features ?? []) {
                // Only interested in assembled relation polygons.
                if (
                    feature.properties?.["@type"] !== "relation" ||
                    !applyPostFilter(category, feature.properties ?? {})
                ) {
                    continue;
                }

                // Extract relationId and name for runtime filtering.
                const props = {
                    relationId: Number(feature.properties["@id"]),
                };
                // Carry name tags for potential future UI use.
                for (const k of ["name", "name:en"]) {
                    if (feature.properties[k] != null) {
                        props[k] = feature.properties[k];
                    }
                }

                const lineFeatures = featureToLineStrings(feature);
                for (const lf of lineFeatures) {
                    // Merge relation metadata into each ring segment.
                    lf.properties = { ...props };

                    const lineStrings =
                        lf.geometry.type === "MultiLineString"
                            ? lf.geometry.coordinates.map((coords) => ({
                                  type: "Feature",
                                  geometry: {
                                      type: "LineString",
                                      coordinates: coords,
                                  },
                                  properties: { ...props },
                              }))
                            : [lf];

                    for (const ls of lineStrings) {
                        const tolerance =
                            SIMPLIFY_TOLERANCES[category.key] ?? 0.0001;
                        const simplified = simplifyFeature(ls, tolerance);
                        const bbox = computeBbox(
                            simplified.geometry.coordinates,
                        );

                        features.push({
                            type: "Feature",
                            bbox,
                            geometry: simplified.geometry,
                            properties: { ...props },
                        });
                    }
                }
            }
        } else {
            // Non-admin: stream GeoJSONSeq line by line.
            const rl = createInterface({
                input: createReadStream(seqPath, { encoding: "utf8" }),
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                const RS = String.fromCharCode(0x1e);
                const clean = line.startsWith(RS)
                    ? line.slice(1).trim()
                    : line.trim();
                if (!clean) continue;

                let feature;
                try {
                    feature = JSON.parse(clean);
                } catch {
                    continue;
                }

                // Apply post-filter.
                if (category.postFilter) {
                    if (!applyPostFilter(category, feature.properties ?? {})) {
                        continue;
                    }
                }

                // Convert polygon to outer-ring LineString, or keep as polygon
                // for dissolve.
                let lineFeatures;
                if (category.geometry === "polygon-dissolve") {
                    // Accept Polygon / MultiPolygon for the dissolve pipeline,
                    // and LineString / MultiLineString for waterway centerlines.
                    if (
                        feature.geometry.type === "Polygon" ||
                        feature.geometry.type === "MultiPolygon"
                    ) {
                        lineFeatures = [feature];
                    } else if (
                        feature.geometry.type === "LineString" ||
                        feature.geometry.type === "MultiLineString"
                    ) {
                        // Tag with waterway type so post-processing can apply
                        // per-type min-length floors.
                        const waterwayType = feature.properties?.waterway;
                        lineFeatures = [
                            {
                                ...feature,
                                properties: { waterway: waterwayType },
                            },
                        ];
                    } else {
                        continue;
                    }
                } else if (category.geometry === "polygon-to-ring") {
                    lineFeatures = featureToLineStrings(feature);
                } else {
                    // Coastline / high-speed-rail: pass-through LineString.
                    if (
                        feature.geometry.type === "LineString" ||
                        feature.geometry.type === "MultiLineString"
                    ) {
                        lineFeatures = [feature];
                    } else {
                        // Skip non-line geometry.
                        continue;
                    }
                }

                for (const lf of lineFeatures) {
                    if (category.geometry === "polygon-dissolve") {
                        if (
                            lf.geometry.type === "Polygon" ||
                            lf.geometry.type === "MultiPolygon"
                        ) {
                            // Store raw polygon geometry; dissolve + simplify
                            // happens in post-processing.
                            const bbox = computePolygonBbox(lf.geometry);
                            features.push({
                                type: "Feature",
                                bbox,
                                geometry: lf.geometry,
                                properties: {},
                            });
                        } else {
                            // Waterway centerline: split MultiLineStrings,
                            // store raw (un-simplified) so the shared-node
                            // stitcher sees full-resolution endpoints.
                            const lineStrings =
                                lf.geometry.type === "MultiLineString"
                                    ? lf.geometry.coordinates.map((coords) => ({
                                          type: "Feature",
                                          geometry: {
                                              type: "LineString",
                                              coordinates: coords,
                                          },
                                          properties: lf.properties ?? {},
                                      }))
                                    : [lf];
                            for (const ls of lineStrings) {
                                const bbox = computeBbox(
                                    ls.geometry.coordinates,
                                );
                                features.push({
                                    type: "Feature",
                                    bbox,
                                    geometry: ls.geometry,
                                    properties: {
                                        ...(lf.properties ?? {}),
                                    },
                                });
                            }
                        }
                        continue;
                    }

                    // Split MultiLineStrings into individual LineStrings.
                    const lineStrings =
                        lf.geometry.type === "MultiLineString"
                            ? lf.geometry.coordinates.map((coords) => ({
                                  type: "Feature",
                                  geometry: {
                                      type: "LineString",
                                      coordinates: coords,
                                  },
                                  properties: lf.properties ?? {},
                              }))
                            : [lf];

                    for (const ls of lineStrings) {
                        // High-speed-rail is simplified *after* stitching
                        // so the shared-node assembler sees full-resolution
                        // endpoints; every other category simplifies here.
                        const tolerance =
                            SIMPLIFY_TOLERANCES[category.key] ?? 0.0001;
                        const simplified =
                            category.key === "high-speed-rail"
                                ? ls
                                : simplifyFeature(ls, tolerance);
                        const bbox = computeBbox(
                            simplified.geometry.coordinates,
                        );

                        features.push({
                            type: "Feature",
                            bbox,
                            geometry: simplified.geometry,
                            properties: {},
                        });
                    }
                }
            }
        }

        console.log(`  Collected ${features.length.toLocaleString()} features`);

        // ── General post-processing (all categories) ─────────────────────

        const isPolygonDissolve = category.geometry === "polygon-dissolve";

        // Partition polygon-dissolve features into polygon and line subsets
        // before any post-processing. Polygons go through the existing
        // clean → min-length → dissolve pipeline; waterway centerlines go
        // through clean → stitch → min-length → simplify.
        let polyFeatures = [];
        let waterwayLineFeatures = [];
        if (isPolygonDissolve) {
            for (const f of features) {
                if (
                    f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon"
                ) {
                    polyFeatures.push(f);
                } else {
                    waterwayLineFeatures.push(f);
                }
            }
            if (waterwayLineFeatures.length > 0) {
                console.log(
                    `  [waterway] ${waterwayLineFeatures.length.toLocaleString()} line features ` +
                        `(rivers/canals/streams)`,
                );
            }
        }

        // 1. Strip consecutive duplicate coordinates.
        if (isPolygonDissolve) {
            // Polygon dissolve: clean rings, filter degenerate geometries.
            const cleaned = [];
            let droppedDegen = 0;
            for (const f of polyFeatures) {
                const c = cleanPolygonFeature(f);
                if (c) {
                    cleaned.push(c);
                } else {
                    droppedDegen++;
                }
            }
            if (droppedDegen > 0) {
                console.log(
                    `  cleanCoords: dropped ${droppedDegen} degenerate polygons`,
                );
            }
            polyFeatures = cleaned;
        } else {
            const dupPairsBefore = countDupPairs(features);
            for (const f of features) {
                const g = f.geometry;
                if (g.type === "LineString") {
                    g.coordinates = cleanCoordsInline(g.coordinates);
                } else if (g.type === "MultiLineString") {
                    g.coordinates = g.coordinates.map((seg) =>
                        cleanCoordsInline(seg),
                    );
                }
            }
            const dupPairsAfter = countDupPairs(features);
            if (dupPairsBefore > 0) {
                console.log(
                    `  cleanCoords: ${dupPairsBefore} dup-pairs → ${dupPairsAfter}`,
                );
            }
        }

        // 2. Drop features shorter than the category minimum.
        const minLen = MIN_FEATURE_LENGTH_M[category.key];
        if (minLen && minLen > 0) {
            if (isPolygonDissolve) {
                const before = polyFeatures.length;
                const kept = polyFeatures.filter(
                    (f) => polygonPerimeterMeters(f.geometry) >= minLen,
                );
                const dropped = before - kept.length;
                if (dropped > 0) {
                    console.log(
                        `  minLength: dropped ${dropped} polygon features < ${minLen}m ` +
                            `(${dropped} of ${before})`,
                    );
                }
                polyFeatures = kept;
            } else {
                const before = features.length;
                const kept = features.filter((f) => {
                    const coords = f.geometry.coordinates;
                    if (f.geometry.type === "LineString") {
                        return lineLengthMeters(coords) >= minLen;
                    }
                    // MultiLineString: sum of all segments.
                    let total = 0;
                    for (const seg of coords) {
                        total += lineLengthMeters(seg);
                    }
                    return total >= minLen;
                });
                const dropped = features.length - kept.length;
                if (dropped > 0) {
                    console.log(
                        `  minLength: dropped ${dropped} features < ${minLen}m ` +
                            `(${features.length - kept.length} of ${before})`,
                    );
                }
                features.length = 0;
                features.push(...kept);
            }
        }

        // 3. Recompute bboxes after coordinate changes.
        if (isPolygonDissolve) {
            for (const f of polyFeatures) {
                f.bbox = computePolygonBbox(f.geometry);
            }
        } else {
            for (const f of features) {
                f.bbox = computeBbox(f.geometry.coordinates);
            }
        }

        // ── Polygon dissolve post-processing ────────────────────────────
        if (isPolygonDissolve) {
            const tolerance = SIMPLIFY_TOLERANCES[category.key] ?? 0.0005;
            const dissolved = polygonDissolve(
                polyFeatures,
                extractBbox,
                tolerance,
            );
            features.length = 0;
            features.push(...dissolved);

            // ── Waterway centerline post-processing ─────────────────────
            if (waterwayLineFeatures.length > 0) {
                const tLine0 = Date.now();

                // Clean consecutive duplicate coordinates.
                const dupPairsBefore = countDupPairs(waterwayLineFeatures);
                for (const f of waterwayLineFeatures) {
                    const g = f.geometry;
                    if (g.type === "LineString") {
                        g.coordinates = cleanCoordsInline(g.coordinates);
                    }
                }
                const dupPairsAfter = countDupPairs(waterwayLineFeatures);
                const dupMsg =
                    dupPairsBefore > 0
                        ? ` (${dupPairsBefore} dup-pairs → ${dupPairsAfter})`
                        : "";

                // Stitch fragmented OSM ways into continuous rivers via the
                // exact shared-node graph — same as HSR. Per-segment
                // min-length cannot punch gaps mid-river.
                const stitchedRaw = stitchSegments(waterwayLineFeatures);
                const stitched = stitchedRaw.filter((f) => {
                    const c = f.geometry.coordinates;
                    return nodeKey(c[0]) !== nodeKey(c[c.length - 1]);
                });
                const loopsDropped = stitchedRaw.length - stitched.length;
                console.log(
                    `  [waterway] clean${dupMsg}, ` +
                        `stitch: ${waterwayLineFeatures.length} → ${stitched.length} features` +
                        (loopsDropped
                            ? ` (${loopsDropped} degenerate loops dropped)`
                            : ""),
                );

                // Min-length filter per waterway type. River/canal want a
                // low floor (~100 m); stream wants a high floor to cull the
                // ~94 k minor streams.
                const longEnough = stitched.filter((f) => {
                    const ww = f.properties?.waterway;
                    const floor = WATERWAY_MIN_LENGTH[ww] ?? 500;
                    return lineLengthMeters(f.geometry.coordinates) >= floor;
                });
                if (longEnough.length < stitched.length) {
                    const byType = {};
                    for (const f of stitched) {
                        if (longEnough.includes(f)) continue;
                        const ww = f.properties?.waterway ?? "unknown";
                        byType[ww] = (byType[ww] ?? 0) + 1;
                    }
                    const detail = Object.entries(byType)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => `${k}:${v}`)
                        .join(", ");
                    console.log(
                        `  [waterway] minLength: ${stitched.length} → ${longEnough.length} features ` +
                            `(dropped ${stitched.length - longEnough.length}: ${detail})`,
                    );
                }

                // Simplify and recompute bboxes.
                const simplified = longEnough.map((f) =>
                    simplifyFeature(f, WATERWAY_LINE_SIMPLIFY),
                );
                for (const f of simplified) {
                    f.bbox = computeBbox(f.geometry.coordinates);
                }

                console.log(
                    `  [waterway] simplified ${simplified.length} features ` +
                        `(tol=${WATERWAY_LINE_SIMPLIFY}°), ` +
                        `total: ${((Date.now() - tLine0) / 1000).toFixed(1)}s`,
                );

                features.push(...simplified);
            }
        }

        // ── High-speed-rail post-processing ─────────────────────────────
        if (category.key === "high-speed-rail") {
            const t0 = Date.now();
            console.log(`  Stitching ${features.length} features...`);
            const stitchedRaw = stitchSegments(features);
            // Drop degenerate loop ways (A→B→A) whose first and last node are
            // identical. These are OSM turnaround/siding artifacts that render
            // as out-and-back stubs rather than through-lines.
            const stitched = stitchedRaw.filter((f) => {
                const c = f.geometry.coordinates;
                return nodeKey(c[0]) !== nodeKey(c[c.length - 1]);
            });
            const loopsDropped = stitchedRaw.length - stitched.length;
            console.log(
                `  Stitched: ${features.length} → ${stitched.length} features` +
                    (loopsDropped
                        ? ` (${loopsDropped} degenerate loops dropped)`
                        : "") +
                    ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
            );

            // Drop assembled features shorter than 1 km. Isolated station
            // sidings or stub ways that didn't join a main corridor produce
            // short disconnected features that add noise to nearest-point
            // queries without contributing meaningful measurement geometry.
            const stitchedLong = stitched.filter(
                (f) =>
                    lineLengthMeters(f.geometry.coordinates) >=
                    HSR_MIN_ASSEMBLED_M,
            );
            if (stitchedLong.length < stitched.length) {
                console.log(
                    `  Post-stitch minLength: ${stitched.length} → ${stitchedLong.length} features` +
                        ` (dropped ${stitched.length - stitchedLong.length} stubs < ${HSR_MIN_ASSEMBLED_M}m)`,
                );
            }

            const t1 = Date.now();
            console.log(`  De-duplicating parallel tracks...`);
            const deduped = dedupeParallelTracks(stitchedLong);
            console.log(
                `  De-duplicated: ${stitchedLong.length} → ${deduped.length} features ` +
                    `(${((Date.now() - t1) / 1000).toFixed(1)}s)`,
            );

            // Bridge any short collinear gaps left by real OSM coverage breaks.
            const bridged = bridgeCollinearGaps(deduped);
            console.log(
                `  Bridged collinear gaps: ${deduped.length} → ${bridged.length} features`,
            );

            // Re-simplify with coarser tolerance.
            const t2 = Date.now();
            // Re-simplify with a coarser tolerance than the initial pass.
            // The stitcher works on full-resolution shared nodes; this pass
            // removes extra vertices introduced by centerline computation.
            const resimplified = bridged.map((f) => simplifyFeature(f, 0.0002));
            // Recompute bboxes.
            for (const f of resimplified) {
                f.bbox = computeBbox(f.geometry.coordinates);
            }
            console.log(
                `  Re-simplified ${resimplified.length} features ` +
                    `(${((Date.now() - t2) / 1000).toFixed(1)}s)`,
            );

            // Fail loudly if the assembled line is discontinuous.
            validateLineContinuity(resimplified, extractBbox);

            features.length = 0;
            features.push(...resimplified);
        }

        // Write bundle.
        const bundleSchemaVersion =
            category.geometry === "polygon-dissolve" ? 2 : 1;
        const bundle = {
            schemaVersion: bundleSchemaVersion,
            category: category.key,
            generatedAt,
            source: "japan-latest",
            extractBbox,
            attribution,
            features,
        };

        const artifactPath = resolve(outputDir, `${category.key}.json`);
        const serialized = JSON.stringify(bundle);
        await writeFile(artifactPath, serialized + "\n");
        const rawSize = Buffer.byteLength(serialized);
        const gzipped = gzipSync(serialized, { level: 9 });
        console.log(
            `  Wrote ${category.key}.json (${(rawSize / 1024 / 1024).toFixed(2)} MB raw, ${(gzipped.length / 1024 / 1024).toFixed(2)} MB gzip)`,
        );

        sizes[category.key] = {
            rawBytes: rawSize,
            gzipBytes: gzipped.length,
            featureCount: features.length,
        };
    }

    // Clean up admin temp dir.
    try {
        await rm(adminTmpDir, { recursive: true, force: true });
    } catch {
        // best-effort
    }

    // 4. Print summary.
    console.log(`\n=== Bundle Size Summary ===`);
    let totalRaw = 0;
    let totalGzip = 0;
    for (const [key, s] of Object.entries(sizes)) {
        console.log(
            `  ${key}: ${s.featureCount.toLocaleString()} features, ${(s.rawBytes / 1024 / 1024).toFixed(2)} MB raw, ${(s.gzipBytes / 1024 / 1024).toFixed(2)} MB gzip`,
        );
        totalRaw += s.rawBytes;
        totalGzip += s.gzipBytes;
    }
    console.log(
        `  TOTAL: ${(totalRaw / 1024 / 1024).toFixed(2)} MB raw, ${(totalGzip / 1024 / 1024).toFixed(2)} MB gzip`,
    );

    // 5. --check mode: diff against committed.
    if (checkMode) {
        await checkAgainstCommitted(outputDir, root);
    }
}

// ─── --check mode ─────────────────────────────────────────────────────────────

async function checkAgainstCommitted(tempDir, root) {
    const committedDir = resolve(root, "assets", "measuring");

    if (!existsSync(committedDir)) {
        console.error(
            "[check] assets/measuring/ does not exist. Run pnpm data:measuring without --check first to generate bundles.",
        );
        process.exitCode = 1;
        return;
    }

    let mismatch = false;
    const files = CATEGORIES.map((c) => `${c.key}.json`);

    for (const file of files) {
        const genPath = resolve(tempDir, file);
        const commPath = resolve(committedDir, file);

        let generated, committed;
        try {
            generated = await readFile(genPath, "utf8");
            committed = await readFile(commPath, "utf8");
        } catch (err) {
            console.error(`[check] Cannot compare ${file}: ${err.message}`);
            mismatch = true;
            continue;
        }

        try {
            const genObj = JSON.parse(generated);
            const comObj = JSON.parse(committed);

            // Compare structural equality (not whitespace).
            // Strip generatedAt since it always differs.
            genObj.generatedAt = "";
            comObj.generatedAt = "";

            if (JSON.stringify(genObj) !== JSON.stringify(comObj)) {
                console.error(
                    `[check] Mismatch in ${file}: generated differs from committed`,
                );
                mismatch = true;
            } else {
                console.log(`[check] ${file}: OK`);
            }
        } catch {
            if (generated !== committed) {
                console.error(`[check] Mismatch in ${file}`);
                mismatch = true;
            }
        }
    }

    if (mismatch) {
        throw new Error(
            "Measuring bundle artifacts differ from committed versions. Run pnpm data:measuring to regenerate.",
        );
    }

    // Clean up temp dir.
    await rm(tempDir, { recursive: true, force: true });
}

// Exported for unit/structural tests (the module runs `main` only when invoked
// directly via the guard below, so importing it has no side effects).
export {
    stitchSegments,
    validateLineContinuity,
    polygonDissolve,
    cleanPolygonFeature,
    simplifyPolygonFeature,
    polygonPerimeterMeters,
};

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

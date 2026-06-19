/**
 * Polygon dissolve for water-body extraction.
 *
 * Partitions input polygons into a coarse grid, unions within each tile,
 * intersects with tile bounds for clean edges, simplifies, and emits
 * one feature per non-empty tile.
 *
 * @module polygonDissolve
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir, totalmem } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { union, intersection } from "polyclip-ts";

import {
    bboxesIntersect,
    computePolygonBbox,
    simplifyPolygonFeature,
} from "./geometryCleanup.mjs";

// ─── GEOS-backed union (used by the packs pipeline; falls back to polyclip-ts) ─

let geosModule = null;
let wkbModule = null;
let geosReady = false;

async function initGeosUnion() {
    if (geosReady) return;
    try {
        const [{ initGeosWasm, unaryUnionWKB }, wkb] = await Promise.all([
            import("../../../../src/shared/geometry/geosWasmNode.ts"),
            import("../../../../src/shared/geometry/wkb.ts"),
        ]);
        await initGeosWasm();
        geosModule = { unaryUnionWKB };
        wkbModule = wkb;
        geosReady = true;
    } catch (err) {
        // Under plain Node (no tsx loader) the .ts dynamic imports will fail;
        // keep polyclip-ts as the fallback.
        console.warn(
            `[polygonDissolve] GEOS wasm unavailable (${err.message}); falling back to polyclip-ts`,
        );
        geosReady = false;
    }
}

await initGeosUnion();

function flattenPolygonCoords(coordsList) {
    const polygons = [];
    for (const coords of coordsList) {
        if (!coords || coords.length === 0) continue;
        if (
            Array.isArray(coords[0][0][0]) &&
            typeof coords[0][0][0][0] === "number"
        ) {
            // MultiPolygon coordinates: an array of polygons.
            for (const poly of coords) polygons.push(poly);
        } else if (typeof coords[0][0][0] === "number") {
            // Polygon coordinates: an array of rings.
            polygons.push(coords);
        }
    }
    return polygons;
}

/**
 * Unary-union a list of GeoJSON Polygon/MultiPolygon coordinate arrays using
 * GEOS (when available) and returns a list of merged coordinate groups.
 *
 * Falls back to `unionAllCoords` (polyclip-ts) if GEOS is not available or
 * the GEOS operation fails.
 *
 * @param {number[][][][]|number[][][][][]} coordsList
 * @returns {number[][][][]} list of MultiPolygon coordinate groups
 */
export function geosUnaryUnionCoords(coordsList) {
    if (coordsList.length <= 1) return coordsList.slice();
    if (!geosReady || !geosModule || !wkbModule) {
        return unionAllCoords(coordsList);
    }

    try {
        const polygons = flattenPolygonCoords(coordsList);
        if (polygons.length === 0) return [];

        const wkb = wkbModule.encodeWkb({
            type: "MultiPolygon",
            coordinates: polygons,
        });
        // Skip the pre-union MakeValid. Concatenating overlapping water polygons
        // makes the MultiPolygon "invalid", so the default validate path runs
        // GEOSMakeValid first — and its even-odd linework turns doubly-covered
        // overlaps (e.g. a riverbank polygon over a water polygon) into HOLES,
        // baking spurious islands into the dissolved water. GEOSUnaryUnion
        // dissolves overlaps correctly on its own. Fall back to the validated
        // path for genuinely malformed input, then to polyclip-ts.
        // See docs/water-bundle-notes-handoff2.md.
        const outWkb =
            geosModule.unaryUnionWKB(wkb, { validate: false }) ??
            geosModule.unaryUnionWKB(wkb);
        if (!outWkb) return unionAllCoords(coordsList);

        const out = wkbModule.decodeWkb(outWkb);
        if (!out) return unionAllCoords(coordsList);

        return [out.type === "Polygon" ? [out.coordinates] : out.coordinates];
    } catch (err) {
        console.warn(
            `[geosUnaryUnionCoords] GEOS union failed (${err.message}); falling back to polyclip-ts`,
        );
        return unionAllCoords(coordsList);
    }
}

// ─── Line-at-polygon clipping ────────────────────────────────────────────────
//
// Clips LineStrings at dissolved-polygon boundaries so centerlines end
// exactly at the water-body edge instead of flowing through it. Uses
// proper segment–ring intersection to compute boundary crossing points.

/**
 * Winding-number point-in-ring test.
 */
export function pointInRing(px, py, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        ) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * Spatial grid index over a MultiPolygon's rings. Build once, then use
 * `pointInGrid` for O(1)-per-point queries instead of checking every ring.
 */
export function buildPolygonGrid(multiPolyCoords, bbox, cellDeg = 0.05) {
    const [minX, minY, maxX, maxY] = bbox;
    const cols = Math.ceil((maxX - minX) / cellDeg);
    const rows = Math.ceil((maxY - minY) / cellDeg);
    const polys = multiPolyCoords;

    // Per-polygon outer-ring bboxes.
    const outerBboxes = polys.map((poly) => {
        let bx0 = Infinity,
            by0 = Infinity,
            bx1 = -Infinity,
            by1 = -Infinity;
        for (const [x, y] of poly[0]) {
            if (x < bx0) bx0 = x;
            if (y < by0) by0 = y;
            if (x > bx1) bx1 = x;
            if (y > by1) by1 = y;
        }
        return [bx0, by0, bx1, by1];
    });

    const grid = new Array(cols * rows);
    for (let ci = 0; ci < cols; ci++) {
        const cellMinX = minX + ci * cellDeg;
        const cellMaxX = cellMinX + cellDeg;
        for (let ri = 0; ri < rows; ri++) {
            const cellMinY = minY + ri * cellDeg;
            const cellMaxY = cellMinY + cellDeg;
            const entry = [];
            for (let pi = 0; pi < polys.length; pi++) {
                const [pxMin, pyMin, pxMax, pyMax] = outerBboxes[pi];
                if (
                    pxMin <= cellMaxX &&
                    pxMax >= cellMinX &&
                    pyMin <= cellMaxY &&
                    pyMax >= cellMinY
                ) {
                    entry.push(pi);
                }
            }
            if (entry.length > 0) grid[ci * rows + ri] = entry;
        }
    }
    return { grid, polys, cols, rows, cellDeg, minX, minY };
}

/** Grid-accelerated point-in-MultiPolygon test. */
export function pointInGrid(px, py, idx) {
    const ci = Math.floor((px - idx.minX) / idx.cellDeg);
    const ri = Math.floor((py - idx.minY) / idx.cellDeg);
    if (ci < 0 || ci >= idx.cols || ri < 0 || ri >= idx.rows) return false;
    const entry = idx.grid[ci * idx.rows + ri];
    if (!entry) return false;
    for (const pi of entry) {
        if (pointInRing(px, py, idx.polys[pi][0])) return true;
    }
    return false;
}

/**
 * Finds the intersection parameter t ∈ (0,1) of line segment A→B with the
 * edge C→D.  Returns Infinity when the segments don't intersect.
 */
export function segSegT(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax,
        ry = by - ay;
    const sx = dx - cx,
        sy = dy - cy;
    const denom = rx * sy - ry * sx;
    if (denom === 0) return Infinity; // parallel
    const cx_ = cx - ax,
        cy_ = cy - ay;
    const t = (cx_ * sy - cy_ * sx) / denom;
    const u = (cx_ * ry - cy_ * rx) / denom;
    return t > 0 && t < 1 && u > 0 && u < 1 ? t : Infinity;
}

/**
 * For a line segment A→B, returns all intersection parameters t ∈ (0,1)
 * where the segment crosses the outer-ring boundary of polygons whose
 * bounding box overlaps the segment.  Uses the grid index to narrow
 * which polygons are tested.  Results are sorted ascending.
 */
export function segmentPolyIntersections(ax, ay, bx, by, gridIdx) {
    const hits = [];
    // Determine which grid cells the segment's bbox overlaps.
    const segMinX = Math.min(ax, bx);
    const segMaxX = Math.max(ax, bx);
    const segMinY = Math.min(ay, by);
    const segMaxY = Math.max(ay, by);
    const ci0 = Math.max(
        0,
        Math.floor((segMinX - gridIdx.minX) / gridIdx.cellDeg),
    );
    const ci1 = Math.min(
        gridIdx.cols - 1,
        Math.floor((segMaxX - gridIdx.minX) / gridIdx.cellDeg),
    );
    const ri0 = Math.max(
        0,
        Math.floor((segMinY - gridIdx.minY) / gridIdx.cellDeg),
    );
    const ri1 = Math.min(
        gridIdx.rows - 1,
        Math.floor((segMaxY - gridIdx.minY) / gridIdx.cellDeg),
    );

    const checked = new Set();
    for (let ci = ci0; ci <= ci1; ci++) {
        for (let ri = ri0; ri <= ri1; ri++) {
            const entry = gridIdx.grid[ci * gridIdx.rows + ri];
            if (!entry) continue;
            for (const pi of entry) {
                if (checked.has(pi)) continue;
                checked.add(pi);
                const ring = gridIdx.polys[pi][0]; // outer ring
                for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
                    const t = segSegT(
                        ax,
                        ay,
                        bx,
                        by,
                        ring[k][0],
                        ring[k][1],
                        ring[l][0],
                        ring[l][1],
                    );
                    if (t < Infinity) hits.push(t);
                }
            }
        }
    }
    hits.sort((a, b) => a - b);
    return hits;
}

/**
 * Clips a LineString so that only portions *outside* the dissolved polygon
 * survive.  Segments that cross the polygon boundary are split at the exact
 * intersection point, producing clean endpoints on the polygon edge.
 */
export function clipLineAtPolygon(coords, gridIdx) {
    const segments = [];
    let cur = [];

    for (let i = 0; i < coords.length - 1; i++) {
        const [ax, ay] = coords[i];
        const [bx, by] = coords[i + 1];
        const aIn = pointInGrid(ax, ay, gridIdx);
        const bIn = pointInGrid(bx, by, gridIdx);

        if (!aIn && !bIn) {
            // Entire segment is outside — keep it.
            cur.push(coords[i]);
            continue;
        }

        if (aIn && bIn) {
            // Entire segment is inside — flush what we had.
            if (cur.length >= 2) segments.push(cur);
            cur = [];
            continue;
        }

        // Segment crosses the boundary. Find intersection points.
        const hits = segmentPolyIntersections(ax, ay, bx, by, gridIdx);
        if (hits.length === 0) {
            // Degenerate: inside/outside flags disagree but no real
            // intersection found (vertex on edge, etc.) — keep or flush
            // based on the start-point flag.
            if (!aIn) {
                cur.push(coords[i]);
            } else {
                if (cur.length >= 2) segments.push(cur);
                cur = [];
            }
            continue;
        }

        if (!aIn && bIn) {
            // Outside → inside: keep up to first intersection.
            cur.push(coords[i]);
            const t = hits[0];
            cur.push([ax + t * (bx - ax), ay + t * (by - ay)]);
            if (cur.length >= 2) segments.push(cur);
            cur = [];
        } else {
            // Inside → outside: start new segment at last intersection.
            if (cur.length >= 2) segments.push(cur);
            cur = [];
            const t = hits[hits.length - 1];
            cur.push([ax + t * (bx - ax), ay + t * (by - ay)]);
        }
    }

    // Last vertex.
    const last = coords[coords.length - 1];
    if (!pointInGrid(last[0], last[1], gridIdx)) {
        cur.push(last);
    }
    if (cur.length >= 2) segments.push(cur);

    return segments;
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
export function unionAllCoords(coordsList) {
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

/**
 * Clip a Polygon/MultiPolygon coordinate array to an axis-aligned rectangle.
 * Returns MultiPolygon coordinates (array of polygons); `[]` when the input
 * lies fully outside the rect or the clip degenerates. Fail-safe: on a
 * polyclip-ts throw, returns the input as MultiPolygon coords unchanged so one
 * bad ring can't drop a whole blob (callers may re-validate downstream).
 *
 * This is the same rectangle-clip `dissolveTile` already applies per tile —
 * factored out so the parallel path can clip each pre-merged band blob to its
 * disjoint band rectangle (the partition that lets the caller concatenate
 * blobs instead of unioning them).
 *
 * @param {number[][][]|number[][][][]} coords - Polygon or MultiPolygon coords
 * @param {number[]} rect - [w, s, e, n]
 * @returns {number[][][][]} MultiPolygon coordinates
 */
export function clipCoordsToRect(coords, rect) {
    const [w, s, e, n] = rect;
    const rectGeom = [
        [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
        ],
    ];
    try {
        const clipped = intersection(coords, rectGeom);
        return clipped && clipped.length > 0 ? clipped : [];
    } catch {
        // MultiPolygon coords have a point ([x,y]) at coords[0][0][0]; Polygon
        // coords have a number there — wrap the latter into a MultiPolygon.
        return Array.isArray(coords?.[0]?.[0]?.[0]) ? coords : [coords];
    }
}

/**
 * Approximate area (m²) of a polygon (outer ring minus holes) in lon/lat via
 * an equirectangular projection at the ring's mean latitude. Good enough for a
 * small drop-threshold; we are not measuring water, just rejecting slivers.
 *
 * @param {number[][][]} poly - Polygon coordinates (outer ring first, then holes)
 * @returns {number} signed-summed absolute area in m²
 */
export function polygonAreaM2(poly) {
    if (!poly || poly.length === 0 || poly[0].length < 4) return 0;
    let latSum = 0,
        latN = 0;
    for (const [, y] of poly[0]) {
        latSum += y;
        latN++;
    }
    const mLat = 111320;
    const mLon = 111320 * Math.cos(((latSum / latN) * Math.PI) / 180);
    const ringArea = (ring) => {
        let a = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        }
        return Math.abs(a / 2) * mLon * mLat;
    };
    let area = ringArea(poly[0]);
    for (let h = 1; h < poly.length; h++) area -= ringArea(poly[h]);
    return Math.max(0, area);
}

/**
 * Drops member polygons whose area is below `minAreaM2` (degenerate slivers).
 * Returns a new array of the surviving polygons.
 *
 * @param {number[][][][]} polygons - MultiPolygon coordinates (array of polygons)
 * @param {number} minAreaM2
 * @returns {{kept: number[][][][], dropped: number}}
 */
export function filterTinyPolygons(polygons, minAreaM2) {
    if (!polygons || minAreaM2 <= 0) {
        return { kept: polygons ?? [], dropped: 0 };
    }
    const kept = [];
    let dropped = 0;
    for (const poly of polygons) {
        if (polygonAreaM2(poly) >= minAreaM2) kept.push(poly);
        else dropped++;
    }
    return { kept, dropped };
}

/**
 * Buckets dissolved water member polygons into a coarse grid, emitting one
 * `MultiPolygon` Feature per non-empty cell.
 *
 * Why: the runtime selects buffer-input features by **feature bbox** (one bbox
 * test per feature). A dissolve that emits one continent-scale `MultiPolygon`
 * gives that feature a bbox spanning the whole region, so it is *always*
 * selected and the runtime buffers ~100k coords at once — which over-simplifies
 * and self-intersects into the body-of-water masking notch. Emitting many small
 * features instead restores effective windowing: only water near the play area
 * is selected and buffered. The runtime already unions the per-feature buffers,
 * so emitting overlapping/touching pieces is expected (see
 * `lineBufferComputation.computeLineBuffer`).
 *
 * Members are assigned **whole** by their bbox center — never cut — so no
 * artificial straight edges are introduced (unlike a geometric box clip). A
 * member larger than a cell simply yields a feature with a slightly larger
 * bbox; that is still vastly better than one region-spanning feature.
 *
 * @param {number[][][][]} polygons - MultiPolygon coordinates (array of polygons)
 * @param {number} cellDeg - grid cell size in degrees
 * @returns {Array<{type:'Feature',bbox:number[],geometry:object,properties:object}>}
 */
export function bucketPolygonsToGridFeatures(polygons, cellDeg = 0.1) {
    if (!polygons || polygons.length === 0) return [];
    const buckets = new Map();
    for (const poly of polygons) {
        if (!poly || poly.length === 0) continue;
        // bbox center of the outer ring → grid cell key.
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
        for (const [x, y] of poly[0]) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const key = `${Math.floor(cx / cellDeg)},${Math.floor(cy / cellDeg)}`;
        let cell = buckets.get(key);
        if (!cell) {
            cell = [];
            buckets.set(key, cell);
        }
        cell.push(poly);
    }

    const features = [];
    for (const cellPolys of buckets.values()) {
        const geometry = { type: "MultiPolygon", coordinates: cellPolys };
        features.push({
            type: "Feature",
            bbox: computePolygonBbox(geometry),
            geometry,
            properties: {},
        });
    }
    return features;
}

// ─── Polygon dissolve (for polygon-dissolve mode) ──────────────────────────

/**
 * Dissolves an array of Polygon / MultiPolygon features into a smaller set
 * of tiled, unioned MultiPolygon features.
 *
 * Strategy: partition input polygons into a coarse grid, union within each
 * tile, intersect with the tile bounds for clean edges, simplify, and emit
 * one feature per non-empty tile. Adjacent tiles overlap by a small ε so
 * features straddling a boundary are present in both tiles and dissolved
 * across the seam.
 *
 * @param {object[]} inputFeatures
 * @param {number[]} extractBbox - [west, south, east, north]
 * @param {number} simplifyTolerance - degrees
 * @param {object} opts
 * @param {number} opts.tileDeg - tile size in degrees
 * @param {number} opts.overlapDeg - overlap between adjacent tiles
 */
/**
 * Build the coarse tile grid (with overlap) used to partition the dissolve.
 * A tile is the atomic unit of work — it is never split across shards, so
 * tile membership (and therefore the dissolved result) is independent of how
 * many processes run the dissolve.
 *
 * @param {number[]} extractBbox - [west, south, east, north]
 * @param {number} tileDeg - tile size in degrees
 * @param {number} overlapDeg - overlap between adjacent tiles
 * @returns {number[][]} array of [w, s, e, n] tile bboxes
 */
export function buildTileGrid(extractBbox, tileDeg = 0.25, overlapDeg = 0.01) {
    const tiles = [];
    for (let tx = extractBbox[0]; tx < extractBbox[2]; tx += tileDeg) {
        for (let ty = extractBbox[1]; ty < extractBbox[3]; ty += tileDeg) {
            tiles.push([
                tx - overlapDeg,
                ty - overlapDeg,
                tx + tileDeg + overlapDeg,
                ty + tileDeg + overlapDeg,
            ]);
        }
    }
    return tiles;
}

/**
 * Dissolve every polygon assigned to one tile: union → clip to tile bounds →
 * simplify → emit. Pure and independent of every other tile — this is the
 * unit of parallelism, shared verbatim by the sequential and parallel paths
 * so the two can never drift.
 *
 * polyclip-ts union/intersection expect raw coordinate arrays, not GeoJSON
 * geometry objects; we work with `.coordinates` throughout and re-wrap.
 * `geosUnaryUnionCoords` is fail-safe — a polygon that makes the union throw
 * isolates itself into its own merge group instead of dropping out.
 *
 * @param {number[]} tileBbox - [w, s, e, n] (already includes overlap)
 * @param {Array<{geometry:{coordinates:any}}>} tilePolys - polys in this tile
 * @param {number} simplifyTolerance - degrees
 * @returns {{features: object[], unionMs: number, groupCount: number}}
 */
export function dissolveTile(tileBbox, tilePolys, simplifyTolerance) {
    const tUnion = Date.now();
    const groups = geosUnaryUnionCoords(
        tilePolys.map((f) => f.geometry.coordinates),
    );
    const unionMs = Date.now() - tUnion;

    const tileGeom = [
        [
            [tileBbox[0], tileBbox[1]],
            [tileBbox[2], tileBbox[1]],
            [tileBbox[2], tileBbox[3]],
            [tileBbox[0], tileBbox[3]],
            [tileBbox[0], tileBbox[1]],
        ],
    ];

    const features = [];
    for (const merged of groups) {
        if (!merged) continue;

        let clipped;
        try {
            clipped = intersection(merged, tileGeom);
        } catch {
            // Fall back to the merged result if intersection fails.
            clipped = merged;
        }
        if (!clipped) continue;

        const feat = {
            type: "Feature",
            geometry: { type: "MultiPolygon", coordinates: clipped },
            properties: {},
        };
        const simplified = simplifyPolygonFeature(feat, simplifyTolerance);
        // Skip features that fully degenerate (all rings collapsed to < 4).
        if (!simplified) continue;

        features.push({
            type: "Feature",
            bbox: computePolygonBbox(simplified.geometry),
            geometry: simplified.geometry,
            properties: {},
        });
    }

    return { features, unionMs, groupCount: groups.length };
}

export function polygonDissolve(
    inputFeatures,
    extractBbox,
    simplifyTolerance,
    { tileDeg = 0.25, overlapDeg = 0.01 } = {},
) {
    const t0 = Date.now();
    const tiles = buildTileGrid(extractBbox, tileDeg, overlapDeg);

    console.log(
        `  [dissolve] ${inputFeatures.length.toLocaleString()} input polygons, ` +
            `${tiles.length} tiles (${tileDeg}° each)`,
    );

    const results = [];
    let emptyTiles = 0;
    let unionTimeMs = 0;

    for (let tileIdx = 0; tileIdx < tiles.length; tileIdx++) {
        const tileBbox = tiles[tileIdx];
        const tilePolys = inputFeatures.filter((f) =>
            bboxesIntersect(f.bbox, tileBbox),
        );
        if (tilePolys.length === 0) {
            emptyTiles++;
            continue;
        }

        const { features, unionMs, groupCount } = dissolveTile(
            tileBbox,
            tilePolys,
            simplifyTolerance,
        );
        unionTimeMs += unionMs;

        if (tileIdx % 25 === 0 || unionMs > 1000) {
            console.log(
                `  [dissolve] tile ${tileIdx + 1}/${tiles.length} ` +
                    `[${tileBbox[0].toFixed(2)},${tileBbox[1].toFixed(2)}] ` +
                    `${tilePolys.length.toLocaleString()} polys → ` +
                    `${groupCount} group(s) (${unionMs}ms)`,
            );
        }
        if (groupCount > 1) {
            console.log(
                `  [dissolve] tile [${tileBbox[0].toFixed(2)},${tileBbox[1].toFixed(2)}] ` +
                    `${tilePolys.length} polys → ${groupCount} merge groups ` +
                    `(some unions failed — kept as separate features)`,
            );
        }

        for (const f of features) results.push(f);
    }

    console.log(
        `  [dissolve] ${results.length} tile features ` +
            `(${emptyTiles} empty tiles), ` +
            `union: ${(unionTimeMs / 1000).toFixed(1)}s, ` +
            `total: ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    return results;
}

const WORKER_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    "dissolveWorker.mjs",
);

/**
 * Parallel, two-level `polygonDissolve`.
 *
 * Level 1 (parallel): split the (column-major) tile grid into `effJobs`
 * **whole-column bands** — one shard per band. Each shard dissolves its tiles
 * (`dissolveTile`), **pre-merges** them into a few compact blobs, then **clips
 * each blob to its band's disjoint nominal rectangle** (the column strip
 * *without* the per-tile overlap). Because the bands' rectangles partition the
 * extract edge-to-edge, the returned blobs have no interior overlap — so the
 * caller can simply **concatenate** them into one valid MultiPolygon instead of
 * unioning them. That whole-region union is the single-threaded fan-in that
 * OOMs on water-dense regions; the clip replaces it with N bounded box-clips.
 *
 * A water body straddling a band seam becomes two edge-touching pieces, which
 * is equivalent for measuring (distance-to-water is a min; inside-water is a
 * per-feature test) but avoids the invalid overlapping geometry that the union
 * existed to repair.
 *
 * Whole-column bands are load-bearing twice: a shard loads only ~1/N of the
 * input (memory), and each band clips to a clean rectangle. Trade-off:
 * contiguous bands can be more load-imbalanced than a scattered assignment —
 * wall-clock is bound by the densest band.
 *
 * Each shard is its own OS process with its own V8 + GEOS-wasm heap, capped so
 * the shards together stay under ~70% of total RAM (a runaway tile can only
 * OOM its own shard; heaps are reclaimed on exit). The union of the returned
 * blobs equals the sequential dissolve's union — only the partitioning differs.
 *
 * @param {Array<{bbox:number[],geometry:object}>} inputFeatures
 * @param {number[]} extractBbox - [west, south, east, north]
 * @param {number} simplifyTolerance - degrees
 * @param {object} opts
 * @param {number} opts.tileDeg
 * @param {number} opts.overlapDeg
 * @param {number} opts.jobs - requested shard count (capped by RAM + tiles)
 * @returns {Promise<object[]>} pre-merged band blobs (coarser than tiles)
 */
export async function polygonDissolveParallel(
    inputFeatures,
    extractBbox,
    simplifyTolerance,
    { tileDeg = 0.25, overlapDeg = 0.01, jobs = 1 } = {},
) {
    const t0 = Date.now();
    const tiles = buildTileGrid(extractBbox, tileDeg, overlapDeg);

    // Grid dimensions — computed with the same loop bounds buildTileGrid uses,
    // so column/row counts match its (column-major) tile order exactly with no
    // floating-point drift. tile index === col * nRows + row.
    let nCols = 0;
    for (let tx = extractBbox[0]; tx < extractBbox[2]; tx += tileDeg) nCols++;
    let nRows = 0;
    for (let ty = extractBbox[1]; ty < extractBbox[3]; ty += tileDeg) nRows++;

    // Never oversubscribe RAM: keep the sum of shard heaps under ~70% of total
    // memory, and guarantee each shard enough heap for the densest single tile.
    const MIN_CHILD_MB = 2048;
    const budgetMB = Math.floor((totalmem() / 1024 / 1024) * 0.7);
    const maxByMem = Math.max(1, Math.floor(budgetMB / MIN_CHILD_MB));
    // Bands are whole-column strips (so each clips to a clean rectangle); at
    // most nCols of them.
    const effJobs = Math.max(1, Math.min(jobs, nCols, maxByMem));
    const perChildMB = Math.max(MIN_CHILD_MB, Math.floor(budgetMB / effJobs));

    // One contiguous strip of whole columns per shard, plus the band's disjoint
    // nominal rectangle (column strip without the per-tile overlap), clamped to
    // the extract. Adjacent bands share an x-edge exactly, so their clipped
    // blobs partition the extract — no interior overlap, concatenable.
    const colsPerBand = Math.max(1, Math.ceil(nCols / effJobs));
    const bands = [];
    for (let c0 = 0; c0 < nCols; c0 += colsPerBand) {
        const c1 = Math.min(c0 + colsPerBand, nCols);
        bands.push({
            tiles: tiles.slice(c0 * nRows, c1 * nRows),
            clipRect: [
                Math.max(extractBbox[0], extractBbox[0] + c0 * tileDeg),
                extractBbox[1],
                Math.min(extractBbox[2], extractBbox[0] + c1 * tileDeg),
                extractBbox[3],
            ],
        });
    }

    console.log(
        `  [dissolve] ${inputFeatures.length.toLocaleString()} input polygons, ` +
            `${tiles.length} tiles (${nCols}×${nRows}) — ${bands.length} ` +
            `band(s) clipped + pre-merged in parallel, ~${perChildMB}MB heap each`,
    );
    if (effJobs < jobs) {
        console.log(
            `  [dissolve] (capped from --jobs ${jobs} to ${effJobs} to stay ` +
                `under the ${budgetMB}MB RAM budget / ${nCols} columns)`,
        );
    }

    const dir = await mkdtemp(join(tmpdir(), "dissolve-shards-"));
    try {
        const specs = [];
        for (let s = 0; s < bands.length; s++) {
            const band = bands[s].tiles;
            const clipRect = bands[s].clipRect;

            // Deduped feature subset for this contiguous band (~1/N of input).
            const idx = new Set();
            for (const tile of band) {
                for (let fi = 0; fi < inputFeatures.length; fi++) {
                    if (bboxesIntersect(inputFeatures[fi].bbox, tile)) {
                        idx.add(fi);
                    }
                }
            }
            const subset = [];
            for (const fi of idx) {
                const f = inputFeatures[fi];
                subset.push({ bbox: f.bbox, geometry: f.geometry });
            }

            const inputPath = join(dir, `input-${s}.json`);
            const outputPath = join(dir, `output-${s}.json`);
            const specPath = join(dir, `spec-${s}.json`);
            await writeFile(inputPath, JSON.stringify(subset));
            await writeFile(
                specPath,
                JSON.stringify({
                    shardId: s,
                    totalShards: bands.length,
                    inputPath,
                    outputPath,
                    tiles: band,
                    clipRect,
                    simplifyTolerance,
                }),
            );
            specs.push({ specPath, outputPath });
        }

        // Parent-measured wall-clock per shard (spawn→exit), so we can report
        // band balance without the shards reporting back.
        const durationsMs = await Promise.all(
            specs.map(({ specPath }) => runShard(specPath, perChildMB)),
        );

        const ranked = durationsMs
            .map((ms, i) => ({ shard: i, ms }))
            .sort((a, b) => b.ms - a.ms);
        const maxMs = ranked[0].ms;
        const minMs = ranked[ranked.length - 1].ms;
        const meanMs =
            durationsMs.reduce((sum, m) => sum + m, 0) / durationsMs.length;
        const secs = (ms) => (ms / 1000).toFixed(1);
        console.log(
            `  [dissolve] band balance: ${durationsMs.length} shards, ` +
                `slowest ${secs(maxMs)}s, spread ${secs(minMs)}–${secs(maxMs)}s, ` +
                `max/mean ${(meanMs > 0 ? maxMs / meanMs : 1).toFixed(2)}×`,
        );
        const top = ranked
            .slice(0, 6)
            .map((r) => `shard ${r.shard + 1} (${secs(r.ms)}s)`)
            .join(", ");
        console.log(
            `  [dissolve]   slowest first: ${top}${ranked.length > 6 ? ", …" : ""}`,
        );

        const results = [];
        for (const { outputPath } of specs) {
            const feats = JSON.parse(await readFile(outputPath, "utf8"));
            for (const f of feats) results.push(f);
        }

        console.log(
            `  [dissolve] ${results.length} pre-merged band blob(s) from ` +
                `${bands.length} shard(s), total: ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
        return results;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/** Run one dissolve shard as a child process; resolve with its wall-clock ms. */
function runShard(specPath, perChildMB) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const child = spawn(
            process.execPath,
            [
                "--import",
                "tsx",
                `--max-old-space-size=${perChildMB}`,
                WORKER_PATH,
                specPath,
            ],
            // Drop the parent's (large) NODE_OPTIONS heap so the per-shard cap
            // above is authoritative; inherit stdio so shard logs stream live.
            {
                stdio: ["ignore", "inherit", "inherit"],
                env: { ...process.env, NODE_OPTIONS: "" },
            },
        );
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (code === 0) resolve(Date.now() - startedAt);
            else
                reject(
                    new Error(
                        `dissolve shard failed (code=${code} signal=${signal}) — ${specPath}`,
                    ),
                );
        });
    });
}

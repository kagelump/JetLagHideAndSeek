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
        const outWkb = geosModule.unaryUnionWKB(wkb);
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
 * Parallel `polygonDissolve`: shard the (independent) tiles across child
 * processes, then concatenate. Same tiles, same per-tile op (`dissolveTile`),
 * so the result is identical to the sequential path up to feature order.
 *
 * Each shard is its own OS process with its own V8 + GEOS-wasm heap, capped so
 * the shards together stay under ~70% of total RAM. This is both the speedup
 * (one busy core per shard) and the memory hardening (a runaway tile can only
 * OOM its own shard, never the parent; heaps are reclaimed on shard exit).
 *
 * @param {Array<{bbox:number[],geometry:object}>} inputFeatures
 * @param {number[]} extractBbox - [west, south, east, north]
 * @param {number} simplifyTolerance - degrees
 * @param {object} opts
 * @param {number} opts.tileDeg
 * @param {number} opts.overlapDeg
 * @param {number} opts.jobs - requested shard count (capped by RAM + tiles)
 * @returns {Promise<object[]>} dissolved tile features
 */
export async function polygonDissolveParallel(
    inputFeatures,
    extractBbox,
    simplifyTolerance,
    { tileDeg = 0.25, overlapDeg = 0.01, jobs = 1 } = {},
) {
    const t0 = Date.now();
    const tiles = buildTileGrid(extractBbox, tileDeg, overlapDeg);

    // Never oversubscribe RAM: keep the sum of shard heaps under ~70% of total
    // memory, and guarantee each shard enough heap for the densest single tile.
    const MIN_CHILD_MB = 2048;
    const budgetMB = Math.floor((totalmem() / 1024 / 1024) * 0.7);
    const maxByMem = Math.max(1, Math.floor(budgetMB / MIN_CHILD_MB));
    const effJobs = Math.max(1, Math.min(jobs, tiles.length, maxByMem));
    const perChildMB = Math.max(MIN_CHILD_MB, Math.floor(budgetMB / effJobs));

    console.log(
        `  [dissolve] ${inputFeatures.length.toLocaleString()} input polygons, ` +
            `${tiles.length} tiles — parallel across ${effJobs} shard(s), ` +
            `~${perChildMB}MB heap each`,
    );
    if (effJobs < jobs) {
        console.log(
            `  [dissolve] (capped from --jobs ${jobs} to ${effJobs} to stay ` +
                `under the ${budgetMB}MB RAM budget)`,
        );
    }

    // Round-robin tile→shard assignment spreads spatially-clustered density
    // across shards. Collect each shard's deduped feature subset so a child
    // only loads ~1/shards of the input (the memory win).
    const shardTiles = Array.from({ length: effJobs }, () => []);
    const shardFeatureIdx = Array.from({ length: effJobs }, () => new Set());
    for (let i = 0; i < tiles.length; i++) {
        const s = i % effJobs;
        shardTiles[s].push(tiles[i]);
        const set = shardFeatureIdx[s];
        for (let fi = 0; fi < inputFeatures.length; fi++) {
            if (bboxesIntersect(inputFeatures[fi].bbox, tiles[i])) set.add(fi);
        }
    }

    const dir = await mkdtemp(join(tmpdir(), "dissolve-shards-"));
    try {
        const specs = [];
        for (let s = 0; s < effJobs; s++) {
            const inputPath = join(dir, `input-${s}.json`);
            const outputPath = join(dir, `output-${s}.json`);
            const specPath = join(dir, `spec-${s}.json`);

            const subset = [];
            for (const fi of shardFeatureIdx[s]) {
                const f = inputFeatures[fi];
                subset.push({ bbox: f.bbox, geometry: f.geometry });
            }
            await writeFile(inputPath, JSON.stringify(subset));
            await writeFile(
                specPath,
                JSON.stringify({
                    shardId: s,
                    totalShards: effJobs,
                    inputPath,
                    outputPath,
                    tiles: shardTiles[s],
                    simplifyTolerance,
                }),
            );
            specs.push({ specPath, outputPath });
        }

        await Promise.all(
            specs.map(({ specPath }) => runShard(specPath, perChildMB)),
        );

        const results = [];
        for (const { outputPath } of specs) {
            const feats = JSON.parse(await readFile(outputPath, "utf8"));
            for (const f of feats) results.push(f);
        }

        console.log(
            `  [dissolve] ${results.length} tile features from ${effJobs} ` +
                `shard(s), total: ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
        return results;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/** Run one dissolve shard as a child process; resolve on clean exit. */
function runShard(specPath, perChildMB) {
    return new Promise((resolve, reject) => {
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
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `dissolve shard failed (code=${code} signal=${signal}) — ${specPath}`,
                    ),
                );
        });
    });
}

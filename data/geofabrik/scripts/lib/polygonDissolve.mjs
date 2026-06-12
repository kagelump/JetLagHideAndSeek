/**
 * Polygon dissolve for water-body extraction.
 *
 * Partitions input polygons into a coarse grid, unions within each tile,
 * intersects with tile bounds for clean edges, simplifies, and emits
 * one feature per non-empty tile.
 *
 * @module polygonDissolve
 */

import { union, intersection } from "polyclip-ts";

import {
    bboxesIntersect,
    computePolygonBbox,
    simplifyPolygonFeature,
} from "./geometryCleanup.mjs";

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
export function polygonDissolve(
    inputFeatures,
    extractBbox,
    simplifyTolerance,
    { tileDeg = 0.25, overlapDeg = 0.01 } = {},
) {
    const t0 = Date.now();

    // Build tile grid.
    const tiles = [];
    for (let tx = extractBbox[0]; tx < extractBbox[2]; tx += tileDeg) {
        for (let ty = extractBbox[1]; ty < extractBbox[3]; ty += tileDeg) {
            const tileBbox = [
                tx - overlapDeg,
                ty - overlapDeg,
                tx + tileDeg + overlapDeg,
                ty + tileDeg + overlapDeg,
            ];
            tiles.push(tileBbox);
        }
    }

    console.log(
        `  [dissolve] ${inputFeatures.length.toLocaleString()} input polygons, ` +
            `${tiles.length} tiles (${tileDeg}° each)`,
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

            // Skip features that fully degenerate (all rings collapsed to < 4
            // coords).
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

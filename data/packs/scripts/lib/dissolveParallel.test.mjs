/**
 * polygonDissolveParallel two-level invariance test.
 *
 * The parallel dissolve splits tiles into whole-column bands, pre-merges each
 * band in its own process, and clips each band's blob to its disjoint band
 * rectangle before returning it (the parent then *concatenates* the blobs — no
 * whole-region union). Two guarantees:
 *
 *   1. Covered area (after a re-union that dedups any seam touching) is
 *      identical regardless of shard count — only the partitioning differs.
 *   2. The returned blobs are disjoint: their summed area equals their union
 *      area, i.e. the band-rectangle clip leaves no interior overlap for the
 *      caller to repair. This is the property that lets the caller concatenate
 *      instead of union.
 *
 * The test spawns real worker processes (jobs=1 vs jobs=2), including a feature
 * that straddles the band seam so the clip path is exercised.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { union } from "polyclip-ts";

import { polygonDissolveParallel } from "../../../geofabrik/scripts/lib/polygonDissolve.mjs";

/** Build a square polygon Feature with a precomputed bbox. */
function square(x, y, size) {
    const ring = [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
    ];
    return {
        type: "Feature",
        bbox: [x, y, x + size, y + size],
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {},
    };
}

/** Shoelace area of a ring (absolute). */
function ringArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(a / 2);
}

/** Net area of MultiPolygon coordinates (outer rings minus holes). */
function multiPolyArea(mp) {
    let a = 0;
    for (const poly of mp) {
        a += ringArea(poly[0]);
        for (let k = 1; k < poly.length; k++) a -= ringArea(poly[k]);
    }
    return a;
}

/** Union every returned blob (dedups band-seam overlap) and return its area. */
function unionArea(features) {
    if (features.length === 0) return 0;
    const merged = union(...features.map((f) => f.geometry.coordinates));
    return multiPolyArea(merged);
}

/** Sum of each blob's own area (double-counts any interior overlap). */
function summedArea(features) {
    let a = 0;
    for (const f of features) a += multiPolyArea(f.geometry.coordinates);
    return a;
}

describe("polygonDissolveParallel (two-level)", () => {
    // 1°×1° extract → 16 tiles at the default 0.25°, so jobs=2 splits the grid
    // into two contiguous bands.
    const EXTRACT_BBOX = [139.0, 35.0, 140.0, 36.0];

    const features = [
        square(139.02, 35.02, 0.1),
        square(139.06, 35.06, 0.1), // overlaps previous → must merge
        square(139.52, 35.02, 0.05),
        square(139.02, 35.52, 0.05),
        square(139.77, 35.77, 0.05),
        square(139.3, 35.3, 0.02),
        // Straddles the jobs=2 band seam at x=139.5 → must be split into two
        // edge-touching pieces (one per band) with no overlap.
        square(139.48, 35.42, 0.04),
    ];

    it("covers the same area for jobs=1 and jobs=2", async () => {
        const one = await polygonDissolveParallel(
            features,
            EXTRACT_BBOX,
            0.0001,
            {
                jobs: 1,
            },
        );
        const two = await polygonDissolveParallel(
            features,
            EXTRACT_BBOX,
            0.0001,
            {
                jobs: 2,
            },
        );

        assert.ok(one.length >= 1, "jobs=1 produced no blobs");
        assert.ok(two.length >= 1, "jobs=2 produced no blobs");

        const areaOne = unionArea(one);
        const areaTwo = unionArea(two);
        assert.ok(areaOne > 0, "expected non-zero covered area");
        assert.ok(
            Math.abs(areaOne - areaTwo) <= areaOne * 1e-6,
            `shard count changed covered area: jobs=1 ${areaOne} vs jobs=2 ${areaTwo}`,
        );

        // The band-clipped blobs must be disjoint: summed area == union area
        // (no double-counted overlap). The straddling square exercises a real
        // seam cut, so this would fail if the clip left bands overlapping.
        const summedTwo = summedArea(two);
        assert.ok(
            Math.abs(summedTwo - areaTwo) <= areaTwo * 1e-6,
            `jobs=2 blobs overlap: summed ${summedTwo} vs union ${areaTwo}`,
        );
    });
});

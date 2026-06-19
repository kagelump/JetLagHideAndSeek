/**
 * polygonDissolveParallel two-level invariance test.
 *
 * The parallel dissolve splits tiles into contiguous bands, pre-merges each
 * band in its own process, and returns the band blobs (the parent then unions
 * those into one polygon). Because union is associative/commutative and tiles
 * are never split across bands, the *covered area after a final union* must be
 * identical regardless of shard count — only the partitioning differs. This
 * test spawns real worker processes (jobs=1 vs jobs=2) and asserts that, which
 * is the core correctness guarantee of the multiprocess path.
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
    });
});

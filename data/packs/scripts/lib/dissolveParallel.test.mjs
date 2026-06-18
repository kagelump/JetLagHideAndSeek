/**
 * polygonDissolveParallel sharding-invariance test.
 *
 * The dissolve is parallelized by assigning whole tiles to child processes.
 * Since a tile is never split across shards and every shard runs the same
 * per-tile op (`dissolveTile`), the dissolved feature *set* must be identical
 * regardless of shard count — only feature order may differ. This test spawns
 * real worker processes (jobs=1 vs jobs=2) and asserts that invariant, which
 * is the core correctness guarantee of the multiprocess path.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

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

/** Stable serialization of the dissolved feature set (order-independent). */
function fingerprint(features) {
    return features
        .map((f) => JSON.stringify({ bbox: f.bbox, geom: f.geometry }))
        .sort();
}

describe("polygonDissolveParallel", () => {
    // 1°×1° extract → 16 tiles at the default 0.25°, so jobs=2 splits tiles
    // across two shards.
    const EXTRACT_BBOX = [139.0, 35.0, 140.0, 36.0];

    // Squares scattered into several different tiles, plus an overlapping pair
    // in one tile (must merge) and two non-overlapping squares in another tile.
    const features = [
        square(139.02, 35.02, 0.1),
        square(139.06, 35.06, 0.1), // overlaps the previous → one merged feature
        square(139.52, 35.02, 0.05),
        square(139.02, 35.52, 0.05),
        square(139.77, 35.77, 0.05),
        square(139.3, 35.3, 0.02),
    ];

    it("produces the same feature set for jobs=1 and jobs=2", async () => {
        const seq = await polygonDissolveParallel(
            features,
            EXTRACT_BBOX,
            0.0001,
            {
                jobs: 1,
            },
        );
        const par = await polygonDissolveParallel(
            features,
            EXTRACT_BBOX,
            0.0001,
            {
                jobs: 2,
            },
        );

        assert.ok(
            seq.length > 1,
            `expected several tile features, got ${seq.length}`,
        );
        assert.deepStrictEqual(
            fingerprint(par),
            fingerprint(seq),
            "shard count changed the dissolved result",
        );
    });
});

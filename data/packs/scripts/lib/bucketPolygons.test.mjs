/**
 * bucketPolygonsToGridFeatures tests.
 *
 * The dissolve fuses water into 1–2 region-spanning MultiPolygons; the runtime
 * windows buffer input by *feature bbox*, so it would always select and buffer
 * the whole thing (the body-of-water masking notch). Bucketing splits the
 * dissolved member polygons into many small, well-bounded grid features so the
 * runtime windows them effectively. Members are assigned whole (by bbox center)
 * — never cut — so no member is dropped and no artificial edges appear.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
    bucketPolygonsToGridFeatures,
    polygonAreaM2,
    filterTinyPolygons,
} from "../../../geofabrik/scripts/lib/polygonDissolve.mjs";

/** A small square polygon (one outer ring) centered at [cx, cy]. */
function square(cx, cy, s = 0.001) {
    const h = s / 2;
    return [
        [
            [cx - h, cy - h],
            [cx + h, cy - h],
            [cx + h, cy + h],
            [cx - h, cy + h],
            [cx - h, cy - h],
        ],
    ];
}

/** Total member-polygon count across all emitted features. */
function totalMembers(features) {
    return features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
}

describe("bucketPolygonsToGridFeatures", () => {
    it("returns [] for empty input", () => {
        assert.deepEqual(bucketPolygonsToGridFeatures([], 0.1), []);
        assert.deepEqual(bucketPolygonsToGridFeatures(undefined, 0.1), []);
    });

    it("groups members in the same cell into one feature", () => {
        // Three members all within one 0.1° cell.
        const polys = [
            square(139.61, 35.61),
            square(139.62, 35.62),
            square(139.63, 35.63),
        ];
        const features = bucketPolygonsToGridFeatures(polys, 0.1);
        assert.equal(features.length, 1);
        assert.equal(features[0].geometry.type, "MultiPolygon");
        assert.equal(features[0].geometry.coordinates.length, 3);
    });

    it("splits members in different cells into separate features", () => {
        // Two members ~1° apart → different cells.
        const polys = [square(139.6, 35.6), square(140.6, 36.6)];
        const features = bucketPolygonsToGridFeatures(polys, 0.1);
        assert.equal(features.length, 2);
    });

    it("never drops a member (all members preserved across features)", () => {
        const polys = [];
        for (let i = 0; i < 50; i++) {
            polys.push(square(139.0 + i * 0.05, 35.0 + (i % 7) * 0.05));
        }
        const features = bucketPolygonsToGridFeatures(polys, 0.1);
        assert.equal(totalMembers(features), polys.length);
    });

    it("gives each feature a tight bbox covering only its own members", () => {
        const polys = [square(139.6, 35.6), square(140.6, 36.6)];
        const features = bucketPolygonsToGridFeatures(polys, 0.1);
        // No feature's bbox should span the full 1° gap between the two members.
        for (const f of features) {
            const [w, s, e, n] = f.bbox;
            assert.ok(e - w < 0.5, `bbox too wide: ${e - w}`);
            assert.ok(n - s < 0.5, `bbox too tall: ${n - s}`);
        }
    });

    it("produces many small features from a dense region (windowing win)", () => {
        // A 1°×1° field of small water bodies → expect roughly (1/cell)^2 cells.
        const polys = [];
        for (let x = 0; x < 1; x += 0.05) {
            for (let y = 0; y < 1; y += 0.05) {
                polys.push(square(139 + x, 35 + y));
            }
        }
        const features = bucketPolygonsToGridFeatures(polys, 0.1);
        // ~10×10 cells, far more than the 1 feature a giant blob would emit.
        assert.ok(
            features.length > 20,
            `expected many features, got ${features.length}`,
        );
        assert.equal(totalMembers(features), polys.length);
    });
});

describe("polygonAreaM2 + filterTinyPolygons", () => {
    /** A square of side `sDeg` degrees → known approx area. */
    function squareDeg(cx, cy, sDeg) {
        const h = sDeg / 2;
        return [
            [
                [cx - h, cy - h],
                [cx + h, cy - h],
                [cx + h, cy + h],
                [cx - h, cy + h],
                [cx - h, cy - h],
            ],
        ];
    }

    it("approximates polygon area in m²", () => {
        // ~0.001° square at lat 35 ≈ 91 m × 111 m ≈ 10,100 m².
        const a = polygonAreaM2(squareDeg(139, 35, 0.001));
        assert.ok(a > 8000 && a < 12000, `area ${a}`);
    });

    it("returns 0 for a degenerate (collinear) ring", () => {
        const collinear = [
            [
                [139.0, 35.0],
                [139.001, 35.0],
                [139.002, 35.0],
                [139.0, 35.0],
            ],
        ];
        assert.equal(polygonAreaM2(collinear), 0);
    });

    it("subtracts hole area", () => {
        const outer = squareDeg(139, 35, 0.002)[0];
        const hole = squareDeg(139, 35, 0.001)[0].slice().reverse();
        const withHole = polygonAreaM2([outer, hole]);
        const solid = polygonAreaM2([outer]);
        assert.ok(withHole < solid && withHole > 0);
    });

    it("drops members below the area threshold, keeps larger ones", () => {
        const tiny = squareDeg(139, 35, 0.00005); // ~25 m² — degenerate sliver
        const pond = squareDeg(139.1, 35, 0.001); // ~10,000 m² — real pond
        const { kept, dropped } = filterTinyPolygons([tiny, pond], 100);
        assert.equal(dropped, 1);
        assert.equal(kept.length, 1);
        assert.ok(polygonAreaM2(kept[0]) > 100);
    });

    it("is a no-op when threshold <= 0", () => {
        const polys = [squareDeg(139, 35, 0.00001)];
        const { kept, dropped } = filterTinyPolygons(polys, 0);
        assert.equal(dropped, 0);
        assert.equal(kept.length, 1);
    });
});

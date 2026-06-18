/**
 * Tests for the pure boundary-source helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    partitionExtractLevels,
    bboxIntersects,
    filterParentFeaturesByBbox,
} from "./boundarySources.mjs";

describe("partitionExtractLevels", () => {
    it("removes parent levels from the region build", () => {
        const { regionLevels, parentLevels } = partitionExtractLevels(
            [4, 6, 7, 8, 9, 10],
            [4],
        );
        assert.deepEqual(regionLevels, [6, 7, 8, 9, 10]);
        assert.deepEqual(parentLevels, [4]);
    });

    it("only counts parent levels actually present in extract", () => {
        const { regionLevels, parentLevels } = partitionExtractLevels(
            [6, 8, 10],
            [2, 4],
        );
        assert.deepEqual(regionLevels, [6, 8, 10]);
        assert.deepEqual(parentLevels, []);
    });

    it("treats an empty parent level list as no-op", () => {
        const { regionLevels, parentLevels } = partitionExtractLevels(
            [4, 6, 8],
            [],
        );
        assert.deepEqual(regionLevels, [4, 6, 8]);
        assert.deepEqual(parentLevels, []);
    });
});

describe("bboxIntersects", () => {
    it("detects overlap and adjacency", () => {
        assert.equal(bboxIntersects([0, 0, 2, 2], [1, 1, 3, 3]), true);
        assert.equal(bboxIntersects([0, 0, 2, 2], [2, 2, 4, 4]), true); // touching
    });

    it("rejects disjoint boxes", () => {
        assert.equal(bboxIntersects([0, 0, 1, 1], [2, 2, 3, 3]), false);
    });
});

/** A square polygon feature centered near (cx, cy) with half-size h. */
function squareFeature(cx, cy, h, adminLevel, name) {
    return {
        type: "Feature",
        properties: { "@id": name, admin_level: String(adminLevel), name },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [cx - h, cy - h],
                    [cx + h, cy - h],
                    [cx + h, cy + h],
                    [cx - h, cy + h],
                    [cx - h, cy - h],
                ],
            ],
        },
    };
}

describe("filterParentFeaturesByBbox", () => {
    const features = [
        squareFeature(0, 0, 1, 4, "self"), // [-1,-1,1,1]
        squareFeature(2, 0, 1, 4, "neighbor"), // [1,-1,3,1] touches self
        squareFeature(10, 10, 1, 4, "far"), // disjoint
        squareFeature(0, 0, 1, 2, "country"), // overlaps but wrong level
    ];

    // Region bbox = the "self" state's own extent (what osmium fileinfo yields).
    const selfBbox = [-1, -1, 1, 1];

    it("keeps own + bbox-touching neighbors at the allowed level", () => {
        const got = filterParentFeaturesByBbox(features, selfBbox, [4]);
        const names = got.map((f) => f.properties.name).sort();
        assert.deepEqual(names, ["neighbor", "self"]);
    });

    it("drops features outside the bbox and at disallowed levels", () => {
        const got = filterParentFeaturesByBbox(features, selfBbox, [4]);
        assert.ok(!got.some((f) => f.properties.name === "far"));
        assert.ok(!got.some((f) => f.properties.name === "country"));
    });

    it("returns whole features (no geometric clipping)", () => {
        const [first] = filterParentFeaturesByBbox(
            [squareFeature(0, 0, 5, 4, "big")],
            [0, 0, 0.1, 0.1],
            [4],
        );
        // Original 5-unit half-size square is preserved intact.
        assert.deepEqual(first.geometry.coordinates[0][0], [-5, -5]);
    });
});

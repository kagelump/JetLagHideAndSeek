/**
 * Tests for meta.json schema validation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateMeta, META_SCHEMA_VERSION } from "./metaSchema.mjs";

/** Build a minimal valid meta object. */
function validMeta(overrides = {}) {
    return {
        schemaVersion: META_SCHEMA_VERSION,
        regionId: "europe-netherlands",
        label: "Netherlands",
        regionPath: ["Europe", "Netherlands"],
        bbox: [3.31, 50.75, 7.22, 53.7],
        osmSnapshot: "2026-06-08",
        adminLevels: { matching: [4, 7, 9, 10], extract: [4, 7, 8, 9, 10] },
        categories: { measuring: [], matching: [] },
        artifacts: ["poi", "measuring", "boundaries", "transit"],
        attribution: "© OpenStreetMap contributors, ODbL — via Geofabrik",
        ...overrides,
    };
}

describe("validateMeta", () => {
    it("accepts a valid meta object", () => {
        const errors = validateMeta(validMeta());
        assert.deepEqual(errors, []);
    });

    it("rejects null / non-object", () => {
        assert.ok(validateMeta(null).length > 0);
        assert.ok(validateMeta("string").length > 0);
    });

    it("rejects wrong schemaVersion", () => {
        const errors = validateMeta(validMeta({ schemaVersion: 99 }));
        assert.ok(errors.some((e) => e.includes("schemaVersion")));
    });

    describe("bbox", () => {
        it("rejects missing bbox", () => {
            const errors = validateMeta(validMeta({ bbox: undefined }));
            assert.ok(errors.some((e) => e.includes("bbox")));
        });

        it("rejects west >= east", () => {
            const errors = validateMeta(validMeta({ bbox: [10, 0, 5, 10] }));
            assert.ok(errors.some((e) => e.includes("west")));
        });

        it("rejects south >= north", () => {
            const errors = validateMeta(validMeta({ bbox: [0, 10, 10, 5] }));
            assert.ok(errors.some((e) => e.includes("south")));
        });

        it("rejects out-of-range bbox", () => {
            const errors = validateMeta(
                validMeta({ bbox: [-200, 0, 10, 100] }),
            );
            assert.ok(errors.some((e) => e.includes("within")));
        });
    });

    describe("required string fields", () => {
        it("rejects missing regionId", () => {
            const errors = validateMeta(validMeta({ regionId: undefined }));
            assert.ok(errors.some((e) => e.includes("regionId")));
        });

        it("rejects missing osmSnapshot", () => {
            const errors = validateMeta(validMeta({ osmSnapshot: undefined }));
            assert.ok(errors.some((e) => e.includes("osmSnapshot")));
        });

        it("rejects missing attribution", () => {
            const errors = validateMeta(validMeta({ attribution: undefined }));
            assert.ok(errors.some((e) => e.includes("attribution")));
        });
    });

    describe("categories", () => {
        it("rejects unknown measuring category", () => {
            const errors = validateMeta(
                validMeta({
                    categories: {
                        measuring: ["unknown-cat"],
                        matching: [],
                    },
                }),
            );
            assert.ok(
                errors.some((e) => e.includes("unknown measuring category")),
            );
        });

        it("rejects unknown matching category", () => {
            const errors = validateMeta(
                validMeta({
                    categories: {
                        measuring: [],
                        matching: ["not-a-category"],
                    },
                }),
            );
            assert.ok(
                errors.some((e) => e.includes("unknown matching category")),
            );
        });

        it("accepts known measuring categories", () => {
            const errors = validateMeta(
                validMeta({
                    categories: {
                        measuring: ["coastline", "high-speed-rail"],
                        matching: ["museum", "park", "station"],
                    },
                }),
            );
            assert.deepEqual(errors, []);
        });
    });

    describe("regionPath", () => {
        it("rejects non-array regionPath", () => {
            const errors = validateMeta(
                validMeta({ regionPath: "not-an-array" }),
            );
            assert.ok(errors.some((e) => e.includes("regionPath")));
        });

        it("rejects regionPath with empty strings", () => {
            const errors = validateMeta(
                validMeta({ regionPath: ["Europe", ""] }),
            );
            assert.ok(errors.some((e) => e.includes("regionPath")));
        });
    });
});

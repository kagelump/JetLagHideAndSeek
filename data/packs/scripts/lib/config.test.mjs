/**
 * Tests for the pack pipeline config loader and validator.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateConfig } from "./config.mjs";

/** Minimal valid config to use as a baseline. */
function baseConfig(overrides = {}) {
    return {
        regions: [
            {
                id: "europe-netherlands",
                label: "Netherlands",
                regionPath: ["Europe", "Netherlands"],
                pbfUrl: "https://download.geofabrik.de/europe/netherlands-latest.osm.pbf",
                adminLevels: {
                    matching: [4, 7, 9, 10],
                    extract: [4, 7, 8, 9, 10],
                },
                artifacts: ["poi", "measuring", "boundaries", "transit"],
                ...overrides,
            },
        ],
    };
}

describe("validateConfig", () => {
    it("accepts a valid sample config", () => {
        const errors = validateConfig(baseConfig());
        assert.deepEqual(errors, []);
    });

    it("rejects null / non-object config", () => {
        assert.ok(validateConfig(null).length > 0);
        assert.ok(validateConfig("string").length > 0);
    });

    it("rejects missing regions array", () => {
        const errors = validateConfig({});
        assert.ok(errors.some((e) => e.includes("regions")));
    });

    it("rejects empty regions array", () => {
        const errors = validateConfig({ regions: [] });
        assert.ok(
            errors.some((e) => e.includes("regions")) &&
                errors.some((e) => e.includes("at least one")),
        );
    });

    describe("region id", () => {
        it("rejects missing id", () => {
            const errors = validateConfig(baseConfig({ id: undefined }));
            assert.ok(errors.some((e) => e.includes('"id"')));
        });

        it("rejects id with invalid charset", () => {
            const errors = validateConfig(
                baseConfig({ id: "Europe_Netherlands" }),
            );
            assert.ok(errors.some((e) => e.includes("must match")));
        });

        it("rejects duplicate ids", () => {
            const cfg = {
                regions: [
                    {
                        id: "same-id",
                        label: "A",
                        regionPath: ["A"],
                        pbfUrl: "https://example.com/a.pbf",
                        adminLevels: {
                            matching: [4, 7, 9, 10],
                            extract: [4, 7, 9, 10],
                        },
                        artifacts: ["poi"],
                    },
                    {
                        id: "same-id",
                        label: "B",
                        regionPath: ["B"],
                        pbfUrl: "https://example.com/b.pbf",
                        adminLevels: {
                            matching: [4, 7, 9, 10],
                            extract: [4, 7, 9, 10],
                        },
                        artifacts: ["poi"],
                    },
                ],
            };
            const errors = validateConfig(cfg);
            assert.ok(errors.some((e) => e.includes("duplicate")));
        });
    });

    describe("label", () => {
        it("rejects missing label", () => {
            const errors = validateConfig(baseConfig({ label: undefined }));
            assert.ok(errors.some((e) => e.includes("label")));
        });
    });

    describe("regionPath", () => {
        it("rejects missing regionPath", () => {
            const errors = validateConfig(
                baseConfig({ regionPath: undefined }),
            );
            assert.ok(errors.some((e) => e.includes("regionPath")));
        });

        it("rejects empty regionPath", () => {
            const errors = validateConfig(baseConfig({ regionPath: [] }));
            assert.ok(errors.some((e) => e.includes("regionPath")));
        });
    });

    describe("pbfUrl", () => {
        it("rejects missing pbfUrl", () => {
            const errors = validateConfig(baseConfig({ pbfUrl: undefined }));
            assert.ok(errors.some((e) => e.includes("pbfUrl")));
        });
    });

    describe("adminLevels", () => {
        it("rejects matching not exactly 4 levels", () => {
            const errors = validateConfig(
                baseConfig({
                    adminLevels: { matching: [4, 7], extract: [4, 7, 9, 10] },
                }),
            );
            assert.ok(errors.some((e) => e.includes("exactly 4")));
        });

        it("rejects non-ascending matching", () => {
            const errors = validateConfig(
                baseConfig({
                    adminLevels: {
                        matching: [10, 7, 4, 2],
                        extract: [2, 4, 7, 10],
                    },
                }),
            );
            assert.ok(errors.some((e) => e.includes("ascending")));
        });

        it("rejects extract missing a matching level", () => {
            const errors = validateConfig(
                baseConfig({
                    adminLevels: {
                        matching: [4, 7, 9, 10],
                        extract: [4, 7, 9],
                    },
                }),
            );
            assert.ok(
                errors.some((e) => e.includes("missing") && e.includes("10")),
            );
        });

        it("rejects missing adminLevels", () => {
            const errors = validateConfig(
                baseConfig({ adminLevels: undefined }),
            );
            assert.ok(errors.some((e) => e.includes("adminLevels")));
        });
    });

    describe("artifacts", () => {
        it("rejects unknown artifact kind", () => {
            const errors = validateConfig(
                baseConfig({ artifacts: ["poi", "unknown-kind"] }),
            );
            assert.ok(errors.some((e) => e.includes("unknown artifact kind")));
        });

        it("rejects empty artifacts", () => {
            const errors = validateConfig(baseConfig({ artifacts: [] }));
            assert.ok(errors.some((e) => e.includes("artifacts")));
        });
    });

    describe("measuringOverrides / transitOverrides", () => {
        it("rejects non-object measuringOverrides", () => {
            const errors = validateConfig(
                baseConfig({ measuringOverrides: "not-an-object" }),
            );
            assert.ok(errors.some((e) => e.includes("measuringOverrides")));
        });

        it("rejects non-object transitOverrides", () => {
            const errors = validateConfig(
                baseConfig({ transitOverrides: ["array"] }),
            );
            assert.ok(errors.some((e) => e.includes("transitOverrides")));
        });

        it("accepts valid overrides objects", () => {
            const errors = validateConfig(
                baseConfig({
                    measuringOverrides: { "body-of-water": { enabled: false } },
                    transitOverrides: { maxClusterMeters: 200 },
                }),
            );
            assert.deepEqual(errors, []);
        });

        it("rejects invalid transitOverrides option types", () => {
            const errors = validateConfig(
                baseConfig({
                    transitOverrides: {
                        wayGeometry: "yes",
                        simplifyMeters: -5,
                    },
                }),
            );
            assert.ok(
                errors.some((e) => e.includes("wayGeometry")),
                "errors include wayGeometry type",
            );
            assert.ok(
                errors.some((e) => e.includes("simplifyMeters")),
                "errors include simplifyMeters type",
            );
        });
    });

    describe("boundarySources", () => {
        it("accepts a valid boundarySource and reference", () => {
            const cfg = baseConfig({ boundarySource: "north-america" });
            cfg.boundarySources = [
                {
                    id: "north-america",
                    pbfUrl: "https://download.geofabrik.de/north-america-latest.osm.pbf",
                    levels: [4],
                },
            ];
            assert.deepEqual(validateConfig(cfg), []);
        });

        it("rejects a region referencing an undeclared boundarySource", () => {
            const cfg = baseConfig({ boundarySource: "does-not-exist" });
            const errors = validateConfig(cfg);
            assert.ok(
                errors.some((e) =>
                    e.includes("not a declared boundarySources"),
                ),
            );
        });

        it("rejects malformed boundarySources entries", () => {
            const cfg = baseConfig();
            cfg.boundarySources = [{ id: "Bad Id", pbfUrl: "", levels: [] }];
            const errors = validateConfig(cfg);
            assert.ok(errors.some((e) => e.includes('"id" must match')));
            assert.ok(errors.some((e) => e.includes('"pbfUrl"')));
            assert.ok(errors.some((e) => e.includes('"levels"')));
        });

        it("rejects duplicate boundarySource ids", () => {
            const cfg = baseConfig();
            cfg.boundarySources = [
                { id: "na", pbfUrl: "https://x/y.pbf", levels: [4] },
                { id: "na", pbfUrl: "https://x/z.pbf", levels: [4] },
            ];
            const errors = validateConfig(cfg);
            assert.ok(errors.some((e) => e.includes("duplicate id")));
        });
    });
});

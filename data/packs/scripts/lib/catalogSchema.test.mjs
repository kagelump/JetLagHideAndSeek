/**
 * Tests for catalog.json schema validation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateCatalog, CATALOG_SCHEMA_VERSION } from "./catalogSchema.mjs";

/** Build a minimal valid catalog object. */
function validCatalog(overrides = {}) {
    return {
        schemaVersion: CATALOG_SCHEMA_VERSION,
        generatedAt: "2026-06-12T00:00:00.000Z",
        attributionUrl: "https://kagelump.github.io/JetLagHideAndSeek/NOTICE",
        packs: [
            {
                id: "europe-netherlands",
                label: "Netherlands",
                regionPath: ["Europe", "Netherlands"],
                bbox: [3.31, 50.75, 7.22, 53.7],
                osmSnapshot: "2026-06-08",
                totalBytes: 31457280,
                artifacts: [
                    {
                        kind: "poi",
                        category: null,
                        url: "https://github.com/kagelump/JetLagHideAndSeek/releases/download/packs-2026-06-12/europe-netherlands-poi.json.gz",
                        bytes: 1234567,
                        md5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                        schemaVersion: 1,
                    },
                    {
                        kind: "measuring",
                        category: "coastline",
                        url: "https://github.com/kagelump/JetLagHideAndSeek/releases/download/packs-2026-06-12/europe-netherlands-measuring-coastline.json.gz",
                        bytes: 234567,
                        md5: "cccccccccccccccccccccccccccccccc",
                        sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                        schemaVersion: 1,
                    },
                ],
            },
        ],
        ...overrides,
    };
}

describe("validateCatalog", () => {
    it("accepts a valid catalog", () => {
        const errors = validateCatalog(validCatalog());
        assert.deepEqual(errors, []);
    });

    it("accepts catalog with multiple packs", () => {
        const catalog = validCatalog({
            packs: [
                ...validCatalog().packs,
                {
                    id: "asia-japan-kanto",
                    label: "Kanto",
                    regionPath: ["Asia", "Japan", "Kanto"],
                    bbox: [138.5, 34.8, 141.0, 37.0],
                    osmSnapshot: "2026-06-01",
                    totalBytes: 100000,
                    artifacts: [
                        {
                            kind: "meta",
                            category: null,
                            url: "https://github.com/kagelump/JetLagHideAndSeek/releases/download/packs-2026-06-12/asia-japan-kanto-meta.json.gz",
                            bytes: 500,
                            md5: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                            sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                            schemaVersion: 1,
                        },
                    ],
                },
            ],
        });
        const errors = validateCatalog(catalog);
        assert.deepEqual(errors, []);
    });

    it("rejects null / non-object", () => {
        assert.ok(validateCatalog(null).length > 0);
        assert.ok(validateCatalog("string").length > 0);
        assert.ok(validateCatalog(42).length > 0);
    });

    it("rejects wrong schemaVersion", () => {
        const errors = validateCatalog(validCatalog({ schemaVersion: 1 }));
        assert.ok(errors.some((e) => e.includes("schemaVersion")));
    });

    it("rejects missing generatedAt", () => {
        const errors = validateCatalog(
            validCatalog({ generatedAt: undefined }),
        );
        assert.ok(errors.some((e) => e.includes("generatedAt")));
    });

    it("rejects invalid generatedAt date", () => {
        const errors = validateCatalog(
            validCatalog({ generatedAt: "not-a-date" }),
        );
        assert.ok(errors.some((e) => e.includes("generatedAt")));
    });

    it("rejects missing attributionUrl", () => {
        const errors = validateCatalog(
            validCatalog({ attributionUrl: undefined }),
        );
        assert.ok(errors.some((e) => e.includes("attributionUrl")));
    });

    it("rejects relative attributionUrl", () => {
        const errors = validateCatalog(
            validCatalog({ attributionUrl: "/relative/path" }),
        );
        assert.ok(errors.some((e) => e.includes("attributionUrl")));
    });

    it("rejects non-array packs", () => {
        const errors = validateCatalog(validCatalog({ packs: "not-array" }));
        assert.ok(errors.some((e) => e.includes("packs")));
    });

    it("rejects empty packs array", () => {
        const errors = validateCatalog(validCatalog({ packs: [] }));
        assert.equal(errors.length, 0); // empty is valid (no packs yet)
    });

    describe("pack entry validation", () => {
        it("rejects missing pack id", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].id;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("id")));
        });

        it("rejects missing pack label", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].label;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("label")));
        });

        it("rejects missing regionPath", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].regionPath;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("regionPath")));
        });

        it("rejects empty regionPath", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            regionPath: [],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("regionPath")));
        });

        it("rejects missing bbox", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].bbox;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("bbox")));
        });

        it("rejects invalid bbox values", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            bbox: [10, 0, 5, 10],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("west")));
        });

        it("rejects missing osmSnapshot", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].osmSnapshot;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("osmSnapshot")));
        });

        it("rejects missing totalBytes", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].totalBytes;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("totalBytes")));
        });

        it("rejects negative totalBytes", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            totalBytes: -1,
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("totalBytes")));
        });
    });

    describe("artifact entry validation", () => {
        it("rejects missing artifacts array", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].artifacts;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("artifacts")));
        });

        it("rejects empty artifacts array", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            artifacts: [],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("artifacts")));
        });

        it("rejects unknown artifact kind", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            artifacts: [
                                {
                                    ...validCatalog().packs[0].artifacts[0],
                                    kind: "unknown-kind",
                                },
                            ],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("unknown artifact kind")));
        });

        it("rejects missing artifact url", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].artifacts[0].url;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("url")));
        });

        it("rejects relative artifact url", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            artifacts: [
                                {
                                    ...validCatalog().packs[0].artifacts[0],
                                    url: "/relative/path.json.gz",
                                },
                            ],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("url")));
        });

        it("rejects missing md5", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].artifacts[0].md5;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("md5")));
        });

        it("rejects md5 with wrong length", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            artifacts: [
                                {
                                    ...validCatalog().packs[0].artifacts[0],
                                    md5: "short",
                                },
                            ],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("md5")));
        });

        it("rejects md5 with non-hex characters", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            artifacts: [
                                {
                                    ...validCatalog().packs[0].artifacts[0],
                                    md5: "z".repeat(32),
                                },
                            ],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("md5")));
        });

        it("rejects missing sha256", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].artifacts[0].sha256;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("sha256")));
        });

        it("rejects missing schemaVersion", () => {
            const catalog = validCatalog();
            delete catalog.packs[0].artifacts[0].schemaVersion;
            const errors = validateCatalog(catalog);
            assert.ok(errors.some((e) => e.includes("schemaVersion")));
        });

        it("rejects negative bytes", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            artifacts: [
                                {
                                    ...validCatalog().packs[0].artifacts[0],
                                    bytes: -100,
                                },
                            ],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("bytes")));
        });
    });

    describe("edge cases", () => {
        it("rejects non-string category", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            artifacts: [
                                {
                                    ...validCatalog().packs[0].artifacts[0],
                                    category: 42,
                                },
                            ],
                        },
                    ],
                }),
            );
            assert.ok(errors.some((e) => e.includes("category")));
        });

        it("accepts null category (POI type)", () => {
            const errors = validateCatalog(validCatalog());
            assert.deepEqual(errors, []);
        });

        it("accepts string category (measuring sub-type)", () => {
            const errors = validateCatalog(validCatalog());
            assert.deepEqual(errors, []);
        });

        it("handles meta kind artifact", () => {
            const errors = validateCatalog(
                validCatalog({
                    packs: [
                        {
                            ...validCatalog().packs[0],
                            artifacts: [
                                {
                                    kind: "meta",
                                    category: null,
                                    url: "https://github.com/kagelump/JetLagHideAndSeek/releases/download/packs-2026-06-12/europe-netherlands-meta.json.gz",
                                    bytes: 500,
                                    md5: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                                    sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                                    schemaVersion: 1,
                                },
                            ],
                        },
                    ],
                }),
            );
            assert.deepEqual(errors, []);
        });
    });
});

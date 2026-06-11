import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateConfig } from "./config.mjs";
import { applyEnv } from "./cache.mjs";

// ─── config.mjs tests ────────────────────────────────────────────────────────

describe("validateConfig", () => {
    it("accepts a valid minimal config", () => {
        const cfg = {
            locales: [
                {
                    id: "japan",
                    maxClusterMeters: 150,
                    aliases: [],
                    gtfs: [
                        {
                            id: "test-feed",
                            label: "Test Feed",
                            namespace: "test-ns",
                            url: "https://example.com/gtfs.zip",
                            requiresKey: false,
                            lineGrouping: "route_id",
                            routeTypes: [1],
                            defaultColor: "#FF0000",
                            license: "CC BY 4.0",
                        },
                    ],
                    operators: [
                        {
                            match: { gtfsNamespace: "test-ns" },
                            routeSource: "gtfs",
                        },
                    ],
                },
            ],
        };
        assert.deepEqual(validateConfig(cfg), []);
    });

    it("rejects missing locales array", () => {
        const errors = validateConfig({}, "cfg.yaml");
        assert.ok(errors.length > 0);
        assert.ok(errors.some((e) => e.includes("locales")));
    });

    it("rejects empty locales array", () => {
        const errors = validateConfig({ locales: [] }, "cfg.yaml");
        assert.ok(errors.length > 0);
    });

    it("rejects duplicate locale ids", () => {
        const cfg = {
            locales: [
                { id: "japan", maxClusterMeters: 150 },
                { id: "japan", maxClusterMeters: 200 },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("duplicate locale id")));
    });

    it("rejects missing locale id", () => {
        const cfg = {
            locales: [{ maxClusterMeters: 150 }],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes('"id" must be')));
    });

    it("rejects empty locale id", () => {
        const cfg = {
            locales: [{ id: "", maxClusterMeters: 150 }],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes('"id" must be')));
    });

    it("rejects non-positive maxClusterMeters", () => {
        const cfg = {
            locales: [{ id: "jp", maxClusterMeters: 0 }],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("maxClusterMeters")));
    });

    it("rejects missing maxClusterMeters", () => {
        const cfg = {
            locales: [{ id: "jp" }],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("maxClusterMeters")));
    });

    it("rejects duplicate feed id", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    gtfs: [
                        {
                            id: "dup",
                            namespace: "ns1",
                            lineGrouping: "route_id",
                            license: "CC0",
                        },
                        {
                            id: "dup",
                            namespace: "ns2",
                            lineGrouping: "route_id",
                            license: "CC0",
                        },
                    ],
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("duplicate feed id")));
    });

    it("rejects duplicate namespace", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    gtfs: [
                        {
                            id: "a",
                            namespace: "same-ns",
                            lineGrouping: "route_id",
                            license: "CC0",
                        },
                        {
                            id: "b",
                            namespace: "same-ns",
                            lineGrouping: "route_id",
                            license: "CC0",
                        },
                    ],
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("duplicate namespace")));
    });

    it("rejects missing license on GTFS feed", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    gtfs: [
                        {
                            id: "f",
                            namespace: "ns",
                            lineGrouping: "route_id",
                        },
                    ],
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("license")));
    });

    it("rejects empty license on GTFS feed", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    gtfs: [
                        {
                            id: "f",
                            namespace: "ns",
                            lineGrouping: "route_id",
                            license: "",
                        },
                    ],
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("license")));
    });

    it("rejects bad lineGrouping", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    gtfs: [
                        {
                            id: "f",
                            namespace: "ns",
                            lineGrouping: "direction",
                            license: "CC0",
                        },
                    ],
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("lineGrouping")));
    });

    it("rejects bad routeSource", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    operators: [
                        {
                            match: { gtfsNamespace: "ns" },
                            routeSource: "wikipedia",
                        },
                    ],
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("routeSource")));
    });

    it("rejects missing url on GTFS feed", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    gtfs: [
                        {
                            id: "f",
                            namespace: "ns",
                            lineGrouping: "route_id",
                            license: "CC0",
                        },
                    ],
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("url")));
    });

    it("rejects non-array gtfs when present", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    gtfs: "not-an-array",
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("gtfs")));
    });

    it("accepts valid overrides", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    overrides: {
                        relations: {
                            12345: { suppressJumpWarning: true },
                            67890: { stopOrder: ["osm:node:1", "osm:node:2"] },
                        },
                    },
                },
            ],
        };
        assert.deepEqual(validateConfig(cfg), []);
    });

    it("rejects non-numeric relation override keys", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    overrides: {
                        relations: {
                            "not-a-number": { suppressJumpWarning: true },
                        },
                    },
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("numeric relation ID")));
    });

    it("rejects non-array stopOrder", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    overrides: {
                        relations: { 123: { stopOrder: "not-an-array" } },
                    },
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(errors.some((e) => e.includes("stopOrder must be an array")));
    });

    it("rejects non-boolean suppressJumpWarning", () => {
        const cfg = {
            locales: [
                {
                    id: "jp",
                    maxClusterMeters: 150,
                    overrides: {
                        relations: { 123: { suppressJumpWarning: "yes" } },
                    },
                },
            ],
        };
        const errors = validateConfig(cfg);
        assert.ok(
            errors.some((e) =>
                e.includes("suppressJumpWarning must be a boolean"),
            ),
        );
    });
});

// ─── cache.mjs tests ─────────────────────────────────────────────────────────

describe("applyEnv", () => {
    it("substitutes known env vars", () => {
        process.env.TEST_VAR = "abc123";
        try {
            assert.equal(
                applyEnv("https://api.example.com/?key=${TEST_VAR}"),
                "https://api.example.com/?key=abc123",
            );
        } finally {
            delete process.env.TEST_VAR;
        }
    });

    it("URI-encodes substituted values", () => {
        process.env.TEST_KEY = "key/with=special&chars";
        try {
            const result = applyEnv("https://api.example.com/?key=${TEST_KEY}");
            // The key should be URI-encoded.
            assert.ok(!result.includes("key/with=special"));
            assert.ok(
                result.includes("%2F") ||
                    result.includes("%3D") ||
                    result.includes("%26"),
            );
        } finally {
            delete process.env.TEST_KEY;
        }
    });

    it("leaves unknown vars as empty", () => {
        const result = applyEnv(
            "https://api.example.com/?key=${UNKNOWN_VAR_XYZ}",
        );
        assert.equal(result, "https://api.example.com/?key=");
    });

    it("leaves URL without placeholders unchanged", () => {
        const result = applyEnv("https://example.com/data.zip");
        assert.equal(result, "https://example.com/data.zip");
    });

    it("uses custom env object when provided", () => {
        const customEnv = { CUSTOM_KEY: "value-from-custom" };
        assert.equal(
            applyEnv("https://api.example.com/?key=${CUSTOM_KEY}", customEnv),
            "https://api.example.com/?key=value-from-custom",
        );
    });
});

// ─── fetchToCache tests ──────────────────────────────────────────────────────

describe("fetchToCache", () => {
    let tmpDir;

    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "transit-cache-test-"));
    });

    after(async () => {
        if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    });

    it("reads from cache when file exists", async () => {
        const { fetchToCache } = await import("./cache.mjs");

        const cacheFile = join(tmpDir, "cached.txt");
        await writeFile(cacheFile, Buffer.from("cached content"));

        const result = await fetchToCache(
            "https://example.com/data.zip",
            cacheFile,
            { cacheOnly: true },
        );
        assert.ok(result instanceof Uint8Array);
        assert.equal(new TextDecoder().decode(result), "cached content");
    });

    it("throws in cacheOnly mode when file is missing", async () => {
        const { fetchToCache } = await import("./cache.mjs");

        const cacheFile = join(tmpDir, "missing.txt");
        await assert.rejects(
            fetchToCache("https://example.com/data.zip", cacheFile, {
                cacheOnly: true,
            }),
            /not cached.*--cache-only/,
        );
    });

    it("returns null when requiresKey is true and ODPT_KEY is unset and file is missing", async () => {
        // Import fresh to pick up module-level state correctly.
        const { fetchToCache } = await import("./cache.mjs");

        const cacheFile = join(tmpDir, "keyless-missing.zip");
        delete process.env.ODPT_KEY;

        const result = await fetchToCache(
            "https://api.example.com/?key=${ODPT_KEY}",
            cacheFile,
            { requiresKey: true },
        );
        assert.equal(result, null);
    });

    it("downloads and caches file when not cached (mock fetch)", async () => {
        const { fetchToCache } = await import("./cache.mjs");

        const cacheFile = join(tmpDir, "download-test.zip");
        const expected = new Uint8Array([1, 2, 3, 4]);

        // Mock global fetch for this test.
        const origFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => ({
                ok: true,
                async arrayBuffer() {
                    return expected.buffer;
                },
            });

            const result = await fetchToCache(
                "https://example.com/data.zip",
                cacheFile,
            );
            assert.ok(result instanceof Uint8Array);
            assert.deepEqual([...result], [...expected]);
        } finally {
            globalThis.fetch = origFetch;
        }
    });
});

// ─── loadEnv tests ──────────────────────────────────────────────────────────

describe("loadEnv", () => {
    let tmpDir;

    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "transit-loadenv-"));
    });

    after(async () => {
        if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    });

    it("merges ~/.env vars not already in process.env", async () => {
        const { loadEnv, applyEnv } = await import("./cache.mjs");

        const homeEnv = join(tmpDir, ".env");
        await writeFile(
            homeEnv,
            Buffer.from(
                "# comment\nODPT_KEY=secret-from-file\nALREADY_SET=should-not-override\n",
            ),
        );

        const origHome = process.env.HOME;
        const origOdpKey = process.env.ODPT_KEY;
        const origAlreadySet = process.env.ALREADY_SET;
        try {
            process.env.HOME = tmpDir;
            delete process.env.ODPT_KEY;
            process.env.ALREADY_SET = "already-in-env";

            const env = await loadEnv();
            assert.equal(env.ODPT_KEY, "secret-from-file");
            // process.env wins over ~/.env.
            assert.equal(env.ALREADY_SET, "already-in-env");

            // URL substitution uses the merged env.
            assert.equal(
                applyEnv("https://api.example.com/?key=${ODPT_KEY}", env),
                "https://api.example.com/?key=secret-from-file",
            );
        } finally {
            process.env.HOME = origHome;
            if (origOdpKey !== undefined) process.env.ODPT_KEY = origOdpKey;
            else delete process.env.ODPT_KEY;
            if (origAlreadySet !== undefined)
                process.env.ALREADY_SET = origAlreadySet;
            else delete process.env.ALREADY_SET;
        }
    });
});

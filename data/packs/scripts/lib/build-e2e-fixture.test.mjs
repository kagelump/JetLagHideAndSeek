import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildE2eFixture } from "../build-e2e-fixture.mjs";

describe("build-e2e-fixture", () => {
    let outDir;

    before(async () => {
        outDir = await mkdtemp(join(tmpdir(), "e2e-fixture-test-"));
    });

    after(async () => {
        await rm(outDir, { recursive: true, force: true });
    });

    it("writes transit, meta, and manifest artifacts without a real PBF", async () => {
        const fakePresets = [
            {
                id: "osm-e2e-fixture-test",
                label: "Test Operator",
                stations: [
                    { id: "n1", name: "Shinjuku", lat: 35.69, lon: 139.7 },
                    { id: "n2", name: "Shibuya", lat: 35.66, lon: 139.7 },
                ],
            },
        ];
        const uncompressed = Buffer.from(
            JSON.stringify({ schemaVersion: 1, presets: fakePresets }),
            "utf8",
        );

        await buildE2eFixture({
            outDir,
            cacheDir: join(outDir, "cache"),
            pbfPath: "/dev/null/does-not-exist.osm.pbf",
            buildTransit: async () => ({
                gzPath: join(outDir, "transit.json.gz"),
                uncompressed,
                presets: fakePresets,
            }),
        });

        const files = await readdir(outDir);
        assert.deepEqual(files.sort(), [
            "manifest.json",
            "meta.json",
            "transit.json",
        ]);

        const transit = JSON.parse(
            await readFile(join(outDir, "transit.json"), "utf8"),
        );
        assert.strictEqual(transit.presets.length, 1);
        assert.strictEqual(transit.presets[0].stations.length, 2);

        const meta = JSON.parse(
            await readFile(join(outDir, "meta.json"), "utf8"),
        );
        assert.strictEqual(meta.regionId, "e2e-fixture");
        assert.deepStrictEqual(meta.adminLevels.matching, [4, 7, 9, 10]);

        const manifest = JSON.parse(
            await readFile(join(outDir, "manifest.json"), "utf8"),
        );
        assert.strictEqual(manifest.id, "e2e-fixture");
        assert.strictEqual(manifest.artifacts["transit.json"].stations, 2);
        assert.strictEqual(manifest.artifacts["transit.json"].presets, 1);
        assert.strictEqual(
            typeof manifest.artifacts["transit.json"].sha256,
            "string",
        );
    });

    it("writes measuring artifacts and includes them in meta/manifest", async () => {
        const fakePresets = [
            {
                id: "osm-e2e-fixture-test",
                label: "Test Operator",
                stations: [
                    { id: "n1", name: "Tokyo", lat: 35.68, lon: 139.76 },
                ],
            },
        ];
        const transitUncompressed = Buffer.from(
            JSON.stringify({ schemaVersion: 1, presets: fakePresets }),
            "utf8",
        );

        const measuringBodyOfWater = Buffer.from(
            JSON.stringify({
                schemaVersion: 1,
                type: "measuring",
                category: "body-of-water",
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "Polygon",
                            coordinates: [
                                [
                                    [139.77, 35.69],
                                    [139.78, 35.69],
                                    [139.78, 35.7],
                                    [139.77, 35.7],
                                    [139.77, 35.69],
                                ],
                            ],
                        },
                        properties: { name: "Test Water" },
                    },
                ],
            }),
            "utf8",
        );

        await buildE2eFixture({
            outDir,
            cacheDir: join(outDir, "cache"),
            pbfPath: "/dev/null/does-not-exist.osm.pbf",
            buildTransit: async () => ({
                gzPath: join(outDir, "transit.json.gz"),
                uncompressed: transitUncompressed,
                presets: fakePresets,
            }),
            buildMeasuring: async () => ({
                artifacts: new Map([
                    [
                        "measuring-body-of-water",
                        {
                            gzPath: join(
                                outDir,
                                "measuring-body-of-water.json.gz",
                            ),
                            uncompressed: measuringBodyOfWater,
                        },
                    ],
                ]),
                categories: ["body-of-water"],
            }),
        });

        const files = await readdir(outDir);
        assert.ok(files.includes("measuring-body-of-water.json"));

        const meta = JSON.parse(
            await readFile(join(outDir, "meta.json"), "utf8"),
        );
        assert.ok(meta.artifacts.includes("measuring-body-of-water.json"));

        const manifest = JSON.parse(
            await readFile(join(outDir, "manifest.json"), "utf8"),
        );
        assert.ok(manifest.artifacts["measuring-body-of-water.json"]);
        assert.strictEqual(
            manifest.artifacts["measuring-body-of-water.json"].features,
            1,
        );
    });

    it("writes boundaries artifact and includes it in meta/manifest", async () => {
        const fakePresets = [
            {
                id: "osm-e2e-fixture-test",
                label: "Test Operator",
                stations: [
                    { id: "n1", name: "Tokyo", lat: 35.68, lon: 139.76 },
                ],
            },
        ];
        const transitUncompressed = Buffer.from(
            JSON.stringify({ schemaVersion: 1, presets: fakePresets }),
            "utf8",
        );

        const boundariesUncompressed = Buffer.from(
            JSON.stringify({
                schemaVersion: 1,
                type: "boundaries",
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "Polygon",
                            coordinates: [
                                [
                                    [139.76, 35.68],
                                    [139.78, 35.68],
                                    [139.78, 35.7],
                                    [139.76, 35.7],
                                    [139.76, 35.68],
                                ],
                            ],
                        },
                        properties: {
                            "@id": 12345,
                            name: "Chiyoda",
                            admin_level: "7",
                        },
                    },
                ],
            }),
            "utf8",
        );

        await buildE2eFixture({
            outDir,
            cacheDir: join(outDir, "cache"),
            pbfPath: "/dev/null/does-not-exist.osm.pbf",
            buildTransit: async () => ({
                gzPath: join(outDir, "transit.json.gz"),
                uncompressed: transitUncompressed,
                presets: fakePresets,
            }),
            buildBoundaries: async () => ({
                gzPath: join(outDir, "boundaries.json.gz"),
                uncompressed: boundariesUncompressed,
            }),
        });

        const files = await readdir(outDir);
        assert.ok(files.includes("boundaries.json"));

        const meta = JSON.parse(
            await readFile(join(outDir, "meta.json"), "utf8"),
        );
        assert.ok(meta.artifacts.includes("boundaries.json"));

        const manifest = JSON.parse(
            await readFile(join(outDir, "manifest.json"), "utf8"),
        );
        assert.ok(manifest.artifacts["boundaries.json"]);
        assert.strictEqual(
            typeof manifest.artifacts["boundaries.json"].sha256,
            "string",
        );
    });
});

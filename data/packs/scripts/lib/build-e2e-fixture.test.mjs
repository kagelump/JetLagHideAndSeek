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
});

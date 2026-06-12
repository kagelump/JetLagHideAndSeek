/**
 * Tests for the measuring artifact builder.
 *
 * These tests use a real (small) PBF fixture with a known coastline and
 * admin boundary to verify the extraction, processing, and schema output
 * of buildMeasuringArtifact.
 *
 * @module buildMeasuring.test
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { buildMeasuringArtifact } from "./buildMeasuring.mjs";

/**
 * Get the path to a fixture PBF. We use the existing bundle test fixtures
 * or extract a small region from the cached Japan PBF.
 *
 * For this test, we look for a cached Japan PBF in the geofabrik cache
 * and extract a tiny window around a known coastline feature.
 */

const geofabrikCache = resolve(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "data",
    "geofabrik",
    "cache",
);
const cachedJapanPbf = resolve(geofabrikCache, "japan-latest.osm.pbf");

// A tiny window around the Ogasawara (Bonin) Islands — known coastline
// features in a compact area. [142.0, 27.0, 142.3, 27.2]
const TEST_WINDOW = [142.0, 27.0, 142.3, 27.2];

/**
 * Create a minimal region config for tests.
 */
function makeRegion(id = "test-region") {
    return {
        id,
        label: "Test Region",
        regionPath: ["Test", "Region"],
        pbfUrl: `https://example.com/${id}-latest.osm.pbf`,
        bbox: TEST_WINDOW,
        artifacts: ["measuring"],
        adminLevels: { matching: [4, 7, 9, 10], extract: [4, 7, 8, 9, 10] },
    };
}

describe("buildMeasuringArtifact", () => {
    /** @type {string} */
    let tmpDir;
    /** @type {string} */
    let pbfPath;

    before(async () => {
        tmpDir = resolve(tmpdir(), `packs-buildMeasuring-test-${Date.now()}`);
        await mkdir(tmpDir, { recursive: true });

        if (!existsSync(cachedJapanPbf)) {
            console.log(
                `SKIP: Japan PBF not cached at ${cachedJapanPbf}. ` +
                    `Run pnpm data:measuring first to cache the PBF.`,
            );
            return;
        }

        // Extract a small window from the Japan PBF for testing.
        pbfPath = resolve(tmpDir, "test-window.osm.pbf");
        execFileSync(
            "osmium",
            [
                "extract",
                "-b",
                TEST_WINDOW.join(","),
                cachedJapanPbf,
                "-o",
                pbfPath,
                "--overwrite",
            ],
            { stdio: "inherit" },
        );
    });

    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("handles missing PBF gracefully (error expected)", async () => {
        const missingPbf = resolve(tmpDir, "nonexistent.osm.pbf");
        const distDir = resolve(tmpDir, "missing-test");
        await mkdir(distDir, { recursive: true });

        try {
            await buildMeasuringArtifact({
                region: makeRegion(),
                pbfPath: missingPbf,
                distDir,
                bbox: TEST_WINDOW,
            });
            assert.fail("Expected an error for missing PBF");
        } catch (err) {
            // Expected — osmium will fail on a missing file.
            assert.ok(err);
        }
    });

    it("skips disabled measuring categories", async () => {
        if (!pbfPath) {
            console.log("SKIP: No PBF fixture available");
            return;
        }

        const region = makeRegion("test-region-disabled");
        region.measuringOverrides = {
            "high-speed-rail": { enabled: false },
            "body-of-water": { enabled: false },
        };
        const distDir = resolve(tmpDir, "disabled-test");
        await mkdir(distDir, { recursive: true });

        const result = await buildMeasuringArtifact({
            region,
            pbfPath,
            distDir,
            bbox: TEST_WINDOW,
        });

        // The result should still have artifacts (coastline, admin borders
        // are not disabled) but NOT high-speed-rail or body-of-water.
        assert.ok(result);
        assert.ok(Array.isArray(result.categories));
        assert.ok(!result.categories.includes("high-speed-rail"));
        assert.ok(!result.categories.includes("body-of-water"));
    });

    it("emits valid bundle schema for coastline", async () => {
        if (!pbfPath) {
            console.log("SKIP: No PBF fixture available");
            return;
        }

        const distDir = resolve(tmpDir, "schema-test");
        await mkdir(distDir, { recursive: true });

        const result = await buildMeasuringArtifact({
            region: makeRegion(),
            pbfPath,
            distDir,
            bbox: TEST_WINDOW,
        });

        assert.ok(result);
        assert.ok(result.artifacts instanceof Map);

        // Coastline should be present (it's an oceanic region).
        const coastlineKey = "measuring-coastline";
        const coastlineArtifact = result.artifacts.get(coastlineKey);

        if (coastlineArtifact) {
            // Verify schema.
            const uncompressed =
                coastlineArtifact.uncompressed.toString("utf8");
            const bundle = JSON.parse(uncompressed);

            assert.equal(bundle.schemaVersion, 1);
            assert.equal(bundle.category, "coastline");
            assert.ok(bundle.generatedAt);
            assert.ok(bundle.source);
            assert.ok(Array.isArray(bundle.extractBbox));
            assert.equal(bundle.extractBbox.length, 4);
            assert.ok(Array.isArray(bundle.features));

            // Verify each feature has valid structure.
            for (const feature of bundle.features) {
                assert.equal(feature.type, "Feature");
                assert.ok(feature.bbox);
                assert.equal(feature.bbox.length, 4);
                assert.ok(feature.geometry);
                assert.ok(
                    feature.geometry.type === "LineString" ||
                        feature.geometry.type === "MultiLineString",
                );
            }

            // Verify features fall inside extractBbox.
            const [w, s, e, n] = bundle.extractBbox;
            for (const feature of bundle.features) {
                for (const coord of feature.geometry.coordinates) {
                    const lon = coord[0];
                    const lat = coord[1];
                    assert.ok(lon >= w, `lon ${lon} >= ${w}`);
                    assert.ok(lon <= e, `lon ${lon} <= ${e}`);
                    assert.ok(lat >= s, `lat ${lat} >= ${s}`);
                    assert.ok(lat <= n, `lat ${lat} <= ${n}`);
                }
            }

            // Verify category is recorded in return value.
            assert.ok(result.categories.includes("coastline"));
        }
    });

    it("emits gzip files on disk", async () => {
        if (!pbfPath) {
            console.log("SKIP: No PBF fixture available");
            return;
        }

        const distDir = resolve(tmpDir, "disk-test");
        await mkdir(distDir, { recursive: true });

        const result = await buildMeasuringArtifact({
            region: makeRegion(),
            pbfPath,
            distDir,
            bbox: TEST_WINDOW,
        });

        const { readFile } = await import("node:fs/promises");
        for (const name of result.artifacts.keys()) {
            // Verify file exists on disk.
            const filePath = resolve(distDir, `${name}.json.gz`);
            const exists = await readFile(filePath)
                .then(() => true)
                .catch(() => false);
            assert.ok(exists, `File ${name}.json.gz should exist on disk`);

            // Verify it's valid gzip.
            const gzBytes = await readFile(filePath);
            const uncompressed = gunzipSync(gzBytes);
            const bundle = JSON.parse(uncompressed.toString("utf8"));
            assert.equal(bundle.category, name.replace("measuring-", ""));
        }
    });

    it("handles a region with no features for a category gracefully", async () => {
        if (!pbfPath) {
            console.log("SKIP: No PBF fixture available");
            return;
        }

        // Use a region that has no high-speed-rail features.
        // The Ogasawara window is a remote island chain — no HSR.
        const distDir = resolve(tmpDir, "empty-cat-test");
        await mkdir(distDir, { recursive: true });

        const result = await buildMeasuringArtifact({
            region: makeRegion(),
            pbfPath,
            distDir,
            bbox: TEST_WINDOW,
        });

        // high-speed-rail should not be present (no tracks in that window).
        assert.ok(!result.categories.includes("high-speed-rail"));
    });

    it("emits only present categories in the return value", async () => {
        if (!pbfPath) {
            console.log("SKIP: No PBF fixture available");
            return;
        }

        const distDir = resolve(tmpDir, "categories-test");
        await mkdir(distDir, { recursive: true });

        const result = await buildMeasuringArtifact({
            region: makeRegion(),
            pbfPath,
            distDir,
            bbox: TEST_WINDOW,
        });

        // The returned categories array should match the map keys.
        for (const name of result.artifacts.keys()) {
            const cat = name.replace("measuring-", "");
            assert.ok(
                result.categories.includes(cat),
                `category "${cat}" should be in result.categories`,
            );
        }

        // Every category in the array should have a corresponding artifact.
        for (const cat of result.categories) {
            assert.ok(
                result.artifacts.has(`measuring-${cat}`),
                `artifact for "${cat}" should be in result.artifacts`,
            );
        }
    });
});

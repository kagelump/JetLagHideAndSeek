/**
 * Tests for the catalog generator (build-catalog.mjs).
 *
 * Uses synthetic dist fixtures in temporary directories.
 * Tests building from scratch, --base merge, and rejection of missing files.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { buildCatalog } from "../build-catalog.mjs";
import { validateCatalog } from "./catalogSchema.mjs";

const REPO = "test-org/JetLagHideAndSeek";
const TAG = "packs-2026-06-12";

/** @type {string} */
let tmpDir;
let distDir;

/**
 * Create a fake dist directory for a region with meta.json and hashes.json.
 *
 * @param {string} regionId
 * @param {object} [overrides]
 * @returns {Promise<string>} dist dir path
 */
async function createFakeDist(regionId, overrides = {}) {
    const regionDistDir = resolve(distDir, regionId);
    await mkdir(regionDistDir, { recursive: true });

    const meta = {
        schemaVersion: 1,
        regionId,
        label: overrides.label ?? "Test Region",
        regionPath: overrides.regionPath ?? ["Test", regionId],
        bbox: overrides.bbox ?? [0, 0, 10, 10],
        osmSnapshot: overrides.osmSnapshot ?? "2026-06-08",
        adminLevels: { matching: [4, 7, 9, 10], extract: [4, 7, 8, 9, 10] },
        categories: { measuring: [], matching: [] },
        attribution: "© Test",
        ...overrides,
    };
    await writeFile(
        resolve(regionDistDir, "meta.json"),
        JSON.stringify(meta, null, 2) + "\n",
    );

    const hashes = {
        poi: {
            bytes: 1000,
            md5: "a".repeat(32),
            sha256: "b".repeat(64),
        },
        ...(overrides.extraHashes ?? {}),
    };
    await writeFile(
        resolve(regionDistDir, "hashes.json"),
        JSON.stringify(hashes, null, 2) + "\n",
    );

    return regionDistDir;
}

describe("buildCatalog", () => {
    before(async () => {
        tmpDir = resolve(tmpdir(), `packs-build-catalog-test-${Date.now()}`);
        distDir = resolve(tmpDir, "dist");
        await mkdir(distDir, { recursive: true });
    });

    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("builds a catalog from a single region", async () => {
        await createFakeDist("test-region");

        const catalog = await buildCatalog({
            regionIds: ["test-region"],
            tag: TAG,
            repo: REPO,
            distDir,
        });

        assert.equal(catalog.schemaVersion, 2);
        assert.equal(catalog.packs.length, 1);
        assert.equal(catalog.packs[0].id, "test-region");
        assert.equal(catalog.packs[0].label, "Test Region");
        assert.deepEqual(catalog.packs[0].regionPath, ["Test", "test-region"]);
        assert.deepEqual(catalog.packs[0].bbox, [0, 0, 10, 10]);
        assert.equal(catalog.packs[0].osmSnapshot, "2026-06-08");
        assert.equal(catalog.packs[0].totalBytes, 1000);

        assert.equal(catalog.packs[0].artifacts.length, 1);
        assert.equal(catalog.packs[0].artifacts[0].kind, "poi");
        assert.equal(catalog.packs[0].artifacts[0].category, null);
        assert.equal(
            catalog.packs[0].artifacts[0].url,
            `https://github.com/${REPO}/releases/download/${TAG}/test-region-poi.json.gz`,
        );
        assert.equal(catalog.packs[0].artifacts[0].bytes, 1000);
        assert.equal(catalog.packs[0].artifacts[0].md5, "a".repeat(32));
        assert.equal(catalog.packs[0].artifacts[0].sha256, "b".repeat(64));
        assert.equal(catalog.packs[0].artifacts[0].schemaVersion, 1);
    });

    it("propagates the per-artifact schemaVersion from hashes.json", async () => {
        // Regression: the catalog hardcoded schemaVersion 1 for every artifact,
        // so v2 blobs (polygon-dissolve measuring, e.g. body-of-water) were
        // rejected on-device with "payload has 2, expected 1". The real version
        // must flow blob → hashes.json → catalog.
        await createFakeDist("schema-region", {
            extraHashes: {
                "measuring-body-of-water": {
                    bytes: 500,
                    md5: "c".repeat(32),
                    sha256: "d".repeat(64),
                    schemaVersion: 2,
                },
            },
        });

        const catalog = await buildCatalog({
            regionIds: ["schema-region"],
            tag: TAG,
            repo: REPO,
            distDir,
        });

        const artifacts = catalog.packs[0].artifacts;
        const water = artifacts.find((a) => a.category === "body-of-water");
        const poi = artifacts.find((a) => a.kind === "poi");
        assert.equal(water.schemaVersion, 2, "v2 blob must keep v2 in catalog");
        assert.equal(poi.schemaVersion, 1, "legacy entry defaults to 1");
    });

    it("builds a catalog with multiple regions", async () => {
        await createFakeDist("region-alpha", { label: "Alpha" });
        await createFakeDist("region-beta", { label: "Beta" });

        const catalog = await buildCatalog({
            regionIds: ["region-alpha", "region-beta"],
            tag: TAG,
            repo: REPO,
            distDir,
        });

        assert.equal(catalog.packs.length, 2);
        // Sorted by id.
        assert.equal(catalog.packs[0].id, "region-alpha");
        assert.equal(catalog.packs[1].id, "region-beta");
    });

    it("builds measuring artifacts with category suffix", async () => {
        await createFakeDist("measuring-region", {
            extraHashes: {
                "measuring-coastline": {
                    bytes: 500,
                    md5: "c".repeat(32),
                    sha256: "d".repeat(64),
                },
                "measuring-body-of-water": {
                    bytes: 2000,
                    md5: "e".repeat(32),
                    sha256: "f".repeat(64),
                },
            },
        });

        const catalog = await buildCatalog({
            regionIds: ["measuring-region"],
            tag: TAG,
            repo: REPO,
            distDir,
        });

        const artifacts = catalog.packs[0].artifacts;
        // POI + 2 measuring
        assert.equal(artifacts.length, 3);

        const coastline = artifacts.find(
            (a) => a.kind === "measuring" && a.category === "coastline",
        );
        assert.ok(coastline);
        assert.equal(
            coastline.url,
            `https://github.com/${REPO}/releases/download/${TAG}/measuring-region-measuring-coastline.json.gz`,
        );
        assert.equal(coastline.bytes, 500);

        const bodyOfWater = artifacts.find(
            (a) => a.kind === "measuring" && a.category === "body-of-water",
        );
        assert.ok(bodyOfWater);
        assert.equal(
            bodyOfWater.url,
            `https://github.com/${REPO}/releases/download/${TAG}/measuring-region-measuring-body-of-water.json.gz`,
        );
        assert.equal(bodyOfWater.bytes, 2000);

        // totalBytes includes all.
        assert.equal(catalog.packs[0].totalBytes, 1000 + 500 + 2000);
    });

    it("--base merge preserves existing packs and replaces specified ones", async () => {
        // Create a base catalog with two packs.
        const baseCatalog = {
            schemaVersion: 2,
            generatedAt: "2026-06-01T00:00:00.000Z",
            attributionUrl: `https://${REPO.split("/")[0]}.github.io/${REPO.split("/")[1]}/NOTICE`,
            packs: [
                {
                    id: "region-alpha",
                    label: "Alpha (old)",
                    regionPath: ["Test", "region-alpha"],
                    bbox: [0, 0, 1, 1],
                    osmSnapshot: "2026-06-01",
                    totalBytes: 100,
                    artifacts: [
                        {
                            kind: "poi",
                            category: null,
                            url: "https://example.com/old-alpha-poi.json.gz",
                            bytes: 100,
                            md5: "a".repeat(32),
                            sha256: "b".repeat(64),
                            schemaVersion: 1,
                        },
                    ],
                },
                {
                    id: "region-beta",
                    label: "Beta",
                    regionPath: ["Test", "region-beta"],
                    bbox: [0, 0, 2, 2],
                    osmSnapshot: "2026-06-01",
                    totalBytes: 200,
                    artifacts: [
                        {
                            kind: "poi",
                            category: null,
                            url: "https://example.com/beta-poi.json.gz",
                            bytes: 200,
                            md5: "c".repeat(32),
                            sha256: "d".repeat(64),
                            schemaVersion: 1,
                        },
                    ],
                },
            ],
        };

        // Dist has a new alpha.
        await createFakeDist("region-alpha", { label: "Alpha (new)" });

        const catalog = await buildCatalog({
            regionIds: ["region-alpha"],
            tag: TAG,
            repo: REPO,
            baseCatalog,
            distDir,
        });

        assert.equal(catalog.packs.length, 2);
        // Alpha was replaced.
        const alpha = catalog.packs.find((p) => p.id === "region-alpha");
        assert.equal(alpha.label, "Alpha (new)");
        // Beta was preserved.
        const beta = catalog.packs.find((p) => p.id === "region-beta");
        assert.ok(beta);
        assert.equal(beta.label, "Beta");
    });

    it("validates the catalog output", async () => {
        await createFakeDist("valid-region");
        const catalog = await buildCatalog({
            regionIds: ["valid-region"],
            tag: TAG,
            repo: REPO,
            distDir,
        });
        const errors = validateCatalog(catalog);
        assert.deepEqual(errors, []);
    });

    it("throws if regionIds is empty", async () => {
        await assert.rejects(
            () =>
                buildCatalog({
                    regionIds: [],
                    tag: TAG,
                    repo: REPO,
                    distDir,
                }),
            /At least one region ID/,
        );
    });

    it("throws if tag is missing", async () => {
        await assert.rejects(
            () =>
                buildCatalog({
                    regionIds: ["test"],
                    tag: undefined,
                    repo: REPO,
                    distDir,
                }),
            /--tag/,
        );
    });

    it("throws if repo is missing", async () => {
        await assert.rejects(
            () =>
                buildCatalog({
                    regionIds: ["test"],
                    tag: TAG,
                    repo: undefined,
                    distDir,
                }),
            /--repo/,
        );
    });

    it("throws if dist dir does not exist", async () => {
        await assert.rejects(
            () =>
                buildCatalog({
                    regionIds: ["nonexistent-region"],
                    tag: TAG,
                    repo: REPO,
                    distDir,
                }),
            /does not exist/,
        );
    });
});

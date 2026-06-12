/**
 * Tests for the publish script.
 *
 * No live GitHub calls — all shell/fetch calls are injected via mocks.
 * Tests assert the correct command sequences for first-publish and republish.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

/** @type {string} */
let tmpDir;
let distDir;
let siteDir;

/**
 * Create a minimal valid dist directory for a region.
 *
 * @param {string} regionId
 * @param {object} [overrides]
 * @returns {Promise<string>} region dist dir path
 */
async function createMinimalDist(regionId, overrides = {}) {
    const regionDistDir = resolve(distDir, regionId);
    await mkdir(regionDistDir, { recursive: true });

    const meta = {
        schemaVersion: 1,
        regionId,
        label: overrides.label ?? "Test Region",
        regionPath: overrides.regionPath ?? ["Test", regionId],
        bbox: [0, 0, 10, 10],
        osmSnapshot: "2026-06-08",
        adminLevels: { matching: [4, 7, 9, 10], extract: [4, 7, 8, 9, 10] },
        categories: { measuring: [], matching: [] },
        attribution: "© Test",
    };
    await writeFile(
        resolve(regionDistDir, "meta.json"),
        JSON.stringify(meta, null, 2) + "\n",
    );

    // Create hashes.json with a valid poi entry.
    const { gzipSync } = await import("node:zlib");
    const { createHash } = await import("node:crypto");
    const fakeContent = `{"type":"poi","version":1}`;
    const gzBytes = gzipSync(fakeContent);
    const sha256 = createHash("sha256").update(fakeContent).digest("hex");
    const md5 = createHash("md5").update(gzBytes).digest("hex");

    const hashes = {
        poi: {
            bytes: gzBytes.length,
            md5,
            sha256,
        },
    };
    await writeFile(
        resolve(regionDistDir, "hashes.json"),
        JSON.stringify(hashes, null, 2) + "\n",
    );
    await writeFile(resolve(regionDistDir, "poi.json.gz"), gzBytes);

    return regionDistDir;
}

describe("publish script", () => {
    before(async () => {
        tmpDir = resolve(tmpdir(), `packs-publish-test-${Date.now()}`);
        distDir = resolve(tmpDir, "dist");
        siteDir = resolve(tmpDir, "site");
        await mkdir(distDir, { recursive: true });
        await mkdir(siteDir, { recursive: true });
    });

    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("preflight fails when dist dir is missing", async () => {
        const { publish } = await import("../publish.mjs");

        await publish({
            regionId: "nonexistent",
            tag: "packs-2026-06-12",
            repo: "test/JetLagHideAndSeek",
            distDir,
            siteDir,
            skipLint: true,
            execFn: async () => ({
                stdout: "",
                stderr: "",
                exitCode: 0,
            }),
            fetchFn: async () => null,
        });

        assert.equal(process.exitCode, 1);
        process.exitCode = 0;
    });

    it("executes correct gh commands for first publish", async () => {
        await createMinimalDist("test-region");

        /** @type {Array<string>} */
        const commands = [];

        const mockExec = async (cmd, options = {}) => {
            commands.push(cmd);

            if (cmd === "gh auth status") {
                return { stdout: "Logged in", stderr: "", exitCode: 0 };
            }
            if (cmd.startsWith("gh release view")) {
                return { stdout: "", stderr: "release not found", exitCode: 1 };
            }
            if (cmd.startsWith("gh release create")) {
                return { stdout: "Created!", stderr: "", exitCode: 0 };
            }
            if (cmd.startsWith("gh release upload")) {
                return { stdout: "Uploaded!", stderr: "", exitCode: 0 };
            }
            if (cmd === "git status --porcelain") {
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            if (cmd === "git remote get-url origin") {
                return {
                    stdout: "https://github.com/test/JetLagHideAndSeek.git",
                    stderr: "",
                    exitCode: 0,
                };
            }
            if (cmd.startsWith("git -C")) {
                return { stdout: "", stderr: "", exitCode: 0 };
            }

            return { stdout: "", stderr: "", exitCode: 0 };
        };

        const mockFetch = async () => null;

        const { publish } = await import("../publish.mjs");

        await publish({
            regionId: "test-region",
            tag: "packs-2026-06-12",
            repo: "test/JetLagHideAndSeek",
            distDir,
            siteDir,
            skipLint: true,
            execFn: mockExec,
            fetchFn: mockFetch,
        });

        const cmdStr = commands.join("\n");
        assert.ok(cmdStr.includes("gh auth status"), "should check gh auth");
        assert.ok(
            cmdStr.includes("gh release create packs-2026-06-12"),
            "should create release when it doesn't exist",
        );
        assert.ok(
            cmdStr.includes("gh release upload packs-2026-06-12"),
            "should upload artifacts",
        );

        // Should commit to master via git -C <root> (site/packs/ flow).
        assert.ok(
            cmdStr.includes("git -C") && cmdStr.includes("add site/packs/"),
            "should add site/packs/ to git",
        );
        assert.ok(
            cmdStr.includes("push origin master"),
            "should push to master",
        );

        process.exitCode = 0;
    });

    it("executes correct gh commands for republish (release exists)", async () => {
        await createMinimalDist("test-region");

        /** @type {Array<string>} */
        const commands = [];

        const mockExec = async (cmd, options = {}) => {
            commands.push(cmd);

            if (cmd === "gh auth status") {
                return { stdout: "Logged in", stderr: "", exitCode: 0 };
            }
            if (cmd.startsWith("gh release view")) {
                return {
                    stdout: '{"id":123}',
                    stderr: "",
                    exitCode: 0,
                };
            }
            if (cmd.startsWith("gh release upload")) {
                return { stdout: "Uploaded!", stderr: "", exitCode: 0 };
            }
            if (cmd === "git status --porcelain") {
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            if (cmd.startsWith("git -C")) {
                return { stdout: "", stderr: "", exitCode: 0 };
            }

            return { stdout: "", stderr: "", exitCode: 0 };
        };

        const mockFetch = async () => ({
            schemaVersion: 2,
            generatedAt: "2026-06-01T00:00:00.000Z",
            attributionUrl: "https://test.github.io/JetLagHideAndSeek/NOTICE",
            packs: [
                {
                    id: "existing-region",
                    label: "Existing",
                    regionPath: ["Test", "existing"],
                    bbox: [0, 0, 1, 1],
                    osmSnapshot: "2026-06-01",
                    totalBytes: 100,
                    artifacts: [
                        {
                            kind: "poi",
                            category: null,
                            url: "https://example.com/old.json.gz",
                            bytes: 100,
                            md5: "a".repeat(32),
                            sha256: "b".repeat(64),
                            schemaVersion: 1,
                        },
                    ],
                },
            ],
        });

        const { publish } = await import("../publish.mjs");

        await publish({
            regionId: "test-region",
            tag: "packs-2026-06-12",
            repo: "test/JetLagHideAndSeek",
            distDir,
            siteDir,
            skipLint: true,
            execFn: mockExec,
            fetchFn: mockFetch,
        });

        const cmdStr = commands.join("\n");
        assert.ok(
            !cmdStr.includes("gh release create"),
            "should NOT create release (already exists)",
        );
        assert.ok(
            cmdStr.includes("gh release upload"),
            "should upload artifacts to existing release",
        );

        process.exitCode = 0;
    });

    it("warns when working tree is dirty", async () => {
        const mockExec = async (cmd) => {
            if (cmd === "git status --porcelain") {
                return {
                    stdout: " M modified-file.txt",
                    stderr: "",
                    exitCode: 0,
                };
            }
            if (cmd.startsWith("gh release")) {
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            if (
                cmd.startsWith("git -C") ||
                cmd.startsWith("git remote")
            ) {
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            return { stdout: "", stderr: "", exitCode: 0 };
        };

        const mockFetch = async () => null;

        const { publish } = await import("../publish.mjs");

        await publish({
            regionId: "test-region",
            tag: "packs-2026-06-12",
            repo: "test/JetLagHideAndSeek",
            distDir,
            siteDir,
            skipLint: true,
            execFn: mockExec,
            fetchFn: mockFetch,
        });

        // Dirty tree is a warning, not an error.
        assert.equal(process.exitCode, 0);
        process.exitCode = 0;
    });

    it("aborts on gh auth failure", async () => {
        const mockExec = async (cmd) => {
            if (cmd === "gh auth status") {
                return {
                    stdout: "",
                    stderr: "not logged in",
                    exitCode: 1,
                };
            }
            return { stdout: "", stderr: "", exitCode: 0 };
        };

        const { publish } = await import("../publish.mjs");

        await publish({
            regionId: "test-region",
            tag: "packs-2026-06-12",
            repo: "test/JetLagHideAndSeek",
            distDir,
            siteDir,
            skipLint: true,
            execFn: mockExec,
            fetchFn: async () => null,
        });

        assert.equal(process.exitCode, 1);
        process.exitCode = 0;
    });

    it("generates correct catalog URL", async () => {
        const mockExec = async (cmd) => {
            if (cmd === "gh auth status") {
                return { stdout: "Logged in", stderr: "", exitCode: 0 };
            }
            if (cmd.startsWith("gh release view")) {
                return { stdout: '{"id":1}', stderr: "", exitCode: 0 };
            }
            if (cmd.startsWith("gh release upload")) {
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            if (cmd === "git status --porcelain") {
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            if (cmd.startsWith("git")) {
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            if (cmd.startsWith("cp ")) {
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            return { stdout: "", stderr: "", exitCode: 0 };
        };

        const mockFetch = async () => null;

        const { publish } = await import("../publish.mjs");

        const result = await publish({
            regionId: "test-region",
            tag: "packs-2026-06-12",
            repo: "custom-org/JetLagHideAndSeek",
            distDir,
            siteDir,
            skipLint: true,
            execFn: mockExec,
            fetchFn: mockFetch,
        });

        assert.ok(result);
        assert.equal(result.tag, "packs-2026-06-12");
        assert.equal(
            result.catalogUrl,
            "https://jetlag.hinoka.org/packs/catalog.json",
        );

        process.exitCode = 0;
    });

    it("builds valid index.html from catalog", async () => {
        const mod = await import("../publish.mjs");

        const catalog = {
            schemaVersion: 2,
            generatedAt: "2026-06-12T00:00:00.000Z",
            attributionUrl: "https://test.github.io/NOTICE",
            packs: [
                {
                    id: "europe-netherlands",
                    label: "Netherlands",
                    regionPath: ["Europe", "Netherlands"],
                    bbox: [3.31, 50.75, 7.22, 53.7],
                    osmSnapshot: "2026-06-08",
                    totalBytes: 1048576,
                    artifacts: [],
                },
            ],
        };

        const html = mod.buildIndexHtml(catalog);

        assert.ok(html.includes("<table>"));
        assert.ok(html.includes("europe-netherlands"));
        assert.ok(html.includes("Netherlands"));
        assert.ok(html.includes("Europe / Netherlands"));
        assert.ok(html.includes("1.0 MB"));
        assert.ok(html.includes("NOTICE"));
    });
});

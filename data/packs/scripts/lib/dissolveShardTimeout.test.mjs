/**
 * Dissolve shard timeout tests (Layer 2).
 *
 * Tests that a shard exceeding its wall-clock budget is SIGKILL'd and the
 * caller can retry with forceSkipUnion. Uses a stub worker script so the
 * test doesn't depend on real dissolve data or GEOS.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { runShard } from "../../../geofabrik/scripts/lib/polygonDissolve.mjs";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Write a stub worker script to a temp directory that either hangs or exits. */
async function createStubWorker(dir, { hang = false } = {}) {
    const path = join(dir, "stub-worker.mjs");
    const code = hang
        ? `// Hang forever (simulates a stuck dissolve).\nsetTimeout(() => {}, 3600_000);\n`
        : `// Exit immediately with empty output.\nimport { writeFile } from "node:fs/promises";\nconst spec = JSON.parse(await (await import("node:fs/promises")).readFile(process.argv[2], "utf8"));\nawait writeFile(spec.outputPath, "[]");\n`;
    await writeFile(path, code, "utf8");
    return path;
}

/** Write a minimal spec file for a stub worker. */
async function createSpec(dir, outputPath) {
    const path = join(dir, "spec.json");
    await writeFile(
        path,
        JSON.stringify({
            shardId: 0,
            totalShards: 1,
            inputPath: join(dir, "input.json"),
            outputPath,
            tiles: [],
            clipRect: null,
            simplifyTolerance: 0.0001,
        }),
    );
    // Worker needs an input file (even empty).
    await writeFile(join(dir, "input.json"), "[]");
    return path;
}

describe("dissolve shard timeout (Layer 2)", () => {
    /** @type {string} */
    let tmpDir;

    before(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "dissolve-timeout-test-"));
    });

    after(async () => {
        try {
            await rm(tmpDir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it("kills a hanging shard and resolves with timedOut", async () => {
        // Stub worker that hangs (never exits).
        const workerPath = await createStubWorker(tmpDir, { hang: true });
        const outputPath = join(tmpDir, `output-${randomUUID()}.json`);
        const specPath = await createSpec(tmpDir, outputPath);

        // 2-second timeout — the worker hangs forever, so this must fire.
        const result = await runShard(specPath, 128, 2000, workerPath);

        assert.equal(result.timedOut, true, "hanging shard should time out");
        assert.ok(
            result.ms >= 1900,
            `elapsed ${result.ms}ms should be >= timeout`,
        );
    });

    it("resolves with timedOut=false for a fast worker", async () => {
        const workerPath = await createStubWorker(tmpDir, { hang: false });
        const outputPath = join(tmpDir, `output-fast-${randomUUID()}.json`);
        const specPath = await createSpec(tmpDir, outputPath);

        // 60-second timeout — the worker exits instantly, so no timeout.
        const result = await runShard(specPath, 128, 60_000, workerPath);

        assert.equal(result.timedOut, false, "fast worker should not time out");
        assert.ok(result.ms < 5000, `fast worker took ${result.ms}ms`);
    });

    it("aborts on non-timeout child failure", async () => {
        // Worker that exits with code 1 (not SIGKILL).
        const path = join(tmpDir, "failing-worker.mjs");
        await writeFile(path, "process.exit(1);\n", "utf8");
        const outputPath = join(tmpDir, `output-fail-${randomUUID()}.json`);
        const specPath = await createSpec(tmpDir, outputPath);

        await assert.rejects(
            () => runShard(specPath, 128, 30_000, path),
            /dissolve shard failed/,
            "non-timeout failure should reject",
        );
    });

    it("clears the timeout timer on clean exit", async () => {
        // Regression: if the timeout isn't cleared on clean exit, a slow test
        // runner (CI) might fire it after the test is done. This test just
        // verifies the happy path doesn't leave state behind.
        const workerPath = await createStubWorker(tmpDir, { hang: false });
        const outputPath = join(tmpDir, `output-clean-${randomUUID()}.json`);
        const specPath = await createSpec(tmpDir, outputPath);

        const result = await runShard(specPath, 128, 5000, workerPath);

        assert.equal(result.timedOut, false);
        // If the timer leaked, this test passing doesn't prove it — but a
        // failure (unclean exit) would be caught by the non-timeout-failure
        // test above.
    });
});

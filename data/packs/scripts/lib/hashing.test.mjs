/**
 * Tests for hash computation and verification.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

import { computeHashes, verifyHashes } from "./hashing.mjs";

describe("computeHashes", () => {
    it("computes bytes, md5, and sha256", () => {
        const uncompressed = JSON.stringify({ hello: "world" });
        const gzBytes = gzipSync(uncompressed);

        const result = computeHashes(gzBytes, uncompressed);

        assert.equal(typeof result.bytes, "number");
        assert.ok(result.bytes > 0);
        assert.equal(typeof result.md5, "string");
        assert.equal(result.md5.length, 32);
        assert.equal(typeof result.sha256, "string");
        assert.equal(result.sha256.length, 64);

        // Verify sha256 independently.
        const expectedSha256 = createHash("sha256")
            .update(uncompressed)
            .digest("hex");
        assert.equal(result.sha256, expectedSha256);

        // Verify md5 independently.
        const expectedMd5 = createHash("md5").update(gzBytes).digest("hex");
        assert.equal(result.md5, expectedMd5);
    });

    it("handles uncompressed as string or Buffer", () => {
        const uncompressed = "plain text";
        const gzBytes = gzipSync(uncompressed);

        const fromStr = computeHashes(gzBytes, uncompressed);
        const fromBuf = computeHashes(
            gzBytes,
            Buffer.from(uncompressed, "utf8"),
        );

        assert.equal(fromStr.sha256, fromBuf.sha256);
        assert.equal(fromStr.md5, fromBuf.md5);
    });
});

describe("verifyHashes", () => {
    /** @type {string} */
    let tmpDir;

    before(async () => {
        tmpDir = resolve(tmpdir(), `packs-hashing-test-${Date.now()}`);
        await mkdir(tmpDir, { recursive: true });
    });

    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it("passes when all hashes match", async () => {
        const uncompressed = JSON.stringify({ a: 1, b: 2 });
        const gzBytes = gzipSync(uncompressed);
        const hashes = computeHashes(gzBytes, uncompressed);

        const gzPath = resolve(tmpDir, "poi.json.gz");
        await writeFile(gzPath, gzBytes);

        const hashesPath = resolve(tmpDir, "hashes.json");
        await writeFile(hashesPath, JSON.stringify({ poi: hashes }, null, 2));

        const errors = await verifyHashes(
            hashesPath,
            new Map([
                ["poi", { gzPath, uncompressed: Buffer.from(uncompressed) }],
            ]),
        );
        assert.deepEqual(errors, []);
    });

    it("fails on byte count mismatch", async () => {
        const uncompressed = "data";
        const gzBytes = gzipSync(uncompressed);
        const hashes = computeHashes(gzBytes, uncompressed);

        const gzPath = resolve(tmpDir, "poi.json.gz");
        await writeFile(gzPath, gzBytes);

        const hashesPath = resolve(tmpDir, "hashes.json");
        // Intentional wrong byte count.
        await writeFile(
            hashesPath,
            JSON.stringify({ poi: { ...hashes, bytes: 99999 } }, null, 2),
        );

        const errors = await verifyHashes(
            hashesPath,
            new Map([
                ["poi", { gzPath, uncompressed: Buffer.from(uncompressed) }],
            ]),
        );
        assert.ok(errors.some((e) => e.includes("bytes")));
    });

    it("fails on md5 mismatch", async () => {
        const uncompressed = "data";
        const gzBytes = gzipSync(uncompressed);
        const hashes = computeHashes(gzBytes, uncompressed);

        const gzPath = resolve(tmpDir, "poi.json.gz");
        await writeFile(gzPath, gzBytes);

        const hashesPath = resolve(tmpDir, "hashes.json");
        await writeFile(
            hashesPath,
            JSON.stringify(
                { poi: { ...hashes, md5: "a".repeat(32) } },
                null,
                2,
            ),
        );

        const errors = await verifyHashes(
            hashesPath,
            new Map([
                ["poi", { gzPath, uncompressed: Buffer.from(uncompressed) }],
            ]),
        );
        assert.ok(errors.some((e) => e.includes("md5")));
    });

    it("fails on sha256 mismatch", async () => {
        const uncompressed = "data";
        const gzBytes = gzipSync(uncompressed);
        const hashes = computeHashes(gzBytes, uncompressed);

        const gzPath = resolve(tmpDir, "poi.json.gz");
        await writeFile(gzPath, gzBytes);

        const hashesPath = resolve(tmpDir, "hashes.json");
        await writeFile(
            hashesPath,
            JSON.stringify(
                { poi: { ...hashes, sha256: "b".repeat(64) } },
                null,
                2,
            ),
        );

        const errors = await verifyHashes(
            hashesPath,
            new Map([
                ["poi", { gzPath, uncompressed: Buffer.from(uncompressed) }],
            ]),
        );
        assert.ok(errors.some((e) => e.includes("sha256")));
    });

    it("flags missing hash entry for existing file", async () => {
        const uncompressed = "data";
        const gzBytes = gzipSync(uncompressed);

        const gzPath = resolve(tmpDir, "poi.json.gz");
        await writeFile(gzPath, gzBytes);

        const hashesPath = resolve(tmpDir, "hashes.json");
        // Empty — no poi entry.
        await writeFile(hashesPath, JSON.stringify({}, null, 2));

        const errors = await verifyHashes(
            hashesPath,
            new Map([
                ["poi", { gzPath, uncompressed: Buffer.from(uncompressed) }],
            ]),
        );
        assert.ok(errors.some((e) => e.includes("missing hash entry")));
    });
});

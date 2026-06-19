/**
 * Hash helpers for pack artifacts.
 *
 * md5 of the .gz bytes (FS verify) and sha256 of the uncompressed JSON
 * (content verify) — same field names and semantics as the existing
 * regionPacks.ts download/verify path.
 *
 * @module hashing
 */

import { createHash } from "node:crypto";

/**
 * Compute hex digests for artifact bytes.
 *
 * @param {Uint8Array|Buffer} gzBytes - gzipped payload
 * @param {Uint8Array|Buffer|string} uncompressed - uncompressed payload
 * @returns {{ bytes: number, md5: string, sha256: string, schemaVersion: number|undefined }}
 */
export function computeHashes(gzBytes, uncompressed) {
    const uncompBuf =
        typeof uncompressed === "string"
            ? Buffer.from(uncompressed, "utf8")
            : uncompressed;

    return {
        bytes: gzBytes.length,
        md5: createHash("md5").update(gzBytes).digest("hex"),
        sha256: createHash("sha256").update(uncompBuf).digest("hex"),
        schemaVersion: extractSchemaVersion(uncompBuf),
    };
}

/**
 * Extract the top-level `schemaVersion` from an artifact payload without fully
 * parsing it (payloads can be many MB). Every builder emits `schemaVersion` as
 * the first top-level key, so a scan of the JSON head finds it cheaply. The
 * catalog needs this per-artifact (e.g. polygon-dissolve measuring bundles are
 * v2 while line bundles are v1) — hardcoding it desyncs the catalog from the
 * blob and makes the on-device install reject the artifact.
 *
 * @param {Buffer} uncompBuf
 * @returns {number|undefined} the schemaVersion, or undefined when absent
 */
function extractSchemaVersion(uncompBuf) {
    const head = uncompBuf.subarray(0, 4096).toString("utf8");
    const m = head.match(/"schemaVersion"\s*:\s*(\d+)/);
    return m ? Number(m[1]) : undefined;
}

/**
 * Verify that hashes on disk match the actual files.
 *
 * @param {string} hashesPath - path to hashes.json
 * @param {Map<string, {gzPath: string, uncompressed: Buffer}>} files -
 *   artifact kind-or-kind-category → {gzPath, uncompressed}
 * @returns {Promise<string[]>} error messages (empty = valid)
 */
export async function verifyHashes(hashesPath, files) {
    const { readFile } = await import("node:fs/promises");

    const errors = [];
    let expected;
    try {
        expected = JSON.parse(await readFile(hashesPath, "utf8"));
    } catch (err) {
        return [`Cannot read ${hashesPath}: ${err.message}`];
    }

    // For generic kind-level ARTIFACT_KINDS entries and category-level artifacts.
    for (const [artifactName, { gzPath, uncompressed }] of files) {
        const entry = expected[artifactName];
        if (!entry) {
            // Optional artifact — only flag if the file exists on disk.
            // If the file doesn't exist, it's genuinely absent.
            const { existsSync } = await import("node:fs");
            if (existsSync(gzPath)) {
                errors.push(
                    `${hashesPath}: missing hash entry for "${artifactName}" but file exists`,
                );
            }
            continue;
        }

        const { readFile } = await import("node:fs/promises");
        const actualGz = await readFile(gzPath);
        const actual = computeHashes(actualGz, uncompressed);

        if (actual.bytes !== entry.bytes) {
            errors.push(
                `${hashesPath}: "${artifactName}" bytes: expected ${entry.bytes}, got ${actual.bytes}`,
            );
        }
        if (actual.md5 !== entry.md5) {
            errors.push(
                `${hashesPath}: "${artifactName}" md5: expected ${entry.md5}, got ${actual.md5}`,
            );
        }
        if (actual.sha256 !== entry.sha256) {
            errors.push(
                `${hashesPath}: "${artifactName}" sha256: expected ${entry.sha256}, got ${actual.sha256}`,
            );
        }
    }

    return errors;
}

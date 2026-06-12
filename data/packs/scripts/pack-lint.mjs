/**
 * Pack lint — validate a built pack's dist directory.
 *
 * Usage:
 *   pnpm data:pack:lint -- --region <id>
 *
 * Checks: meta validates, every artifact in hashes.json exists with matching
 * bytes/hashes, gz files gunzip, bbox is sane.
 *
 * @module pack-lint
 */

/* global console, process */

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { verifyHashes } from "./lib/hashing.mjs";
import { validateMeta } from "./lib/metaSchema.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packsDir = resolve(scriptDir, "..");
const distBase = resolve(packsDir, "dist");

/**
 * Lint a single region's dist directory. Returns error messages.
 *
 * @param {string} regionId
 * @returns {Promise<string[]>} error messages (empty = valid)
 */
export async function lintRegion(regionId) {
    const errors = [];
    const distDir = resolve(distBase, regionId);

    if (!existsSync(distDir)) {
        return [`dist/${regionId}/ does not exist`];
    }

    // 1. Validate meta.json.
    const metaPath = resolve(distDir, "meta.json");
    if (!existsSync(metaPath)) {
        errors.push(`dist/${regionId}/meta.json: missing`);
    } else {
        try {
            const meta = JSON.parse(await readFile(metaPath, "utf8"));
            const metaErrors = validateMeta(meta, `dist/${regionId}/meta.json`);
            errors.push(...metaErrors);
        } catch (err) {
            errors.push(`dist/${regionId}/meta.json: ${err.message}`);
        }
    }

    // 2. Validate hashes.json.
    const hashesPath = resolve(distDir, "hashes.json");
    if (!existsSync(hashesPath)) {
        errors.push(`dist/${regionId}/hashes.json: missing`);
    } else {
        let hashes;
        try {
            hashes = JSON.parse(await readFile(hashesPath, "utf8"));
        } catch (err) {
            errors.push(`dist/${regionId}/hashes.json: ${err.message}`);
            return errors;
        }

        // For each entry in hashes, verify the gz file exists and hashes match.
        for (const [artifactName, entry] of Object.entries(hashes)) {
            const gzPath = resolve(distDir, `${artifactName}.json.gz`);
            if (!existsSync(gzPath)) {
                // measuring artifacts use category-suffixed names.
                // Stub builders won't produce real files, so check both patterns.
                const byKind = resolve(
                    distDir,
                    `measuring-${artifactName}.json.gz`,
                );
                if (!existsSync(byKind)) {
                    errors.push(
                        `dist/${regionId}/${artifactName}.json.gz: missing from disk but listed in hashes.json`,
                    );
                    continue;
                }
            }

            // If the file exists, verify hashes.
            const gzFile = existsSync(gzPath)
                ? gzPath
                : resolve(distDir, `measuring-${artifactName}.json.gz`);

            try {
                const gzBytes = await readFile(gzFile);
                if (gzBytes.length !== entry.bytes) {
                    errors.push(
                        `dist/${regionId}/${basename(gzFile)}: bytes mismatch (expected ${entry.bytes}, got ${gzBytes.length})`,
                    );
                }

                // Verify it gunzips.
                let uncompressed;
                try {
                    uncompressed = gunzipSync(gzBytes);
                } catch (err) {
                    errors.push(
                        `dist/${regionId}/${basename(gzFile)}: not valid gzip: ${err.message}`,
                    );
                    continue;
                }

                // Check sha256 of uncompressed.
                const { createHash } = await import("node:crypto");
                const actualSha256 = createHash("sha256")
                    .update(uncompressed)
                    .digest("hex");
                if (actualSha256 !== entry.sha256) {
                    errors.push(
                        `dist/${regionId}/${basename(gzFile)}: sha256 mismatch`,
                    );
                }

                // Check md5 of gz.
                const actualMd5 = createHash("md5")
                    .update(gzBytes)
                    .digest("hex");
                if (actualMd5 !== entry.md5) {
                    errors.push(
                        `dist/${regionId}/${basename(gzFile)}: md5 mismatch`,
                    );
                }
            } catch (err) {
                errors.push(
                    `dist/${regionId}/${basename(gzFile)}: ${err.message}`,
                );
            }
        }
    }

    // 3. Boundary-specific checks if boundaries.json.gz exists.
    const boundariesPath = resolve(distDir, "boundaries.json.gz");
    if (existsSync(boundariesPath)) {
        const boundaryErrors = await lintBoundaries(
            distDir,
            distBase,
            regionId,
        );
        errors.push(...boundaryErrors);
    }

    return errors;
}

/**
 * Lint the boundaries artifact for a region.
 *
 * @param {string} distDir - path to dist/<regionId>/
 * @param {string} distBase - path to dist/
 * @param {string} regionId - region id for error messages
 * @returns {Promise<string[]>} error messages
 */
async function lintBoundaries(distDir, distBase, regionId) {
    const errors = [];
    const boundariesPath = resolve(distDir, "boundaries.json.gz");

    try {
        const { decodeDeltaPolygon } = await import("./lib/deltaEncode.mjs");
        const gzBytes = await readFile(boundariesPath);
        const uncompressed = gunzipSync(gzBytes);
        const artifact = JSON.parse(uncompressed.toString("utf8"));

        // Read meta to get expected levels.
        const metaPath = resolve(distDir, "meta.json");
        let metaLevels = null;
        if (existsSync(metaPath)) {
            try {
                const meta = JSON.parse(await readFile(metaPath, "utf8"));
                metaLevels = meta.adminLevels?.extract ?? null;
            } catch {
                /* ignore */
            }
        }

        // Check levels in artifact ⊆ extract config.
        if (metaLevels && Array.isArray(artifact.levels)) {
            const extractSet = new Set(metaLevels);
            for (const lv of artifact.levels) {
                if (!extractSet.has(lv)) {
                    errors.push(
                        `boundaries.json.gz: level ${lv} not in adminLevels.extract (${JSON.stringify(metaLevels)})`,
                    );
                }
            }
        }

        // Every index row has a polygon and vice versa.
        const idxRelIds = new Set(
            artifact.index.map((e) => String(e.relationId)),
        );
        const polyRelIds = new Set(Object.keys(artifact.polygons));

        for (const id of idxRelIds) {
            if (!polyRelIds.has(id)) {
                errors.push(
                    `boundaries.json.gz: index row ${id} has no polygon entry`,
                );
            }
        }
        for (const id of polyRelIds) {
            if (!idxRelIds.has(id)) {
                errors.push(
                    `boundaries.json.gz: polygon ${id} has no index entry`,
                );
            }
        }

        // Decode round-trip on up to 3 random relations.
        const relIds = [...polyRelIds];
        const sampleCount = Math.min(3, relIds.length);
        for (let si = 0; si < sampleCount; si++) {
            const rid = relIds[si];
            const encoded = artifact.polygons[rid];
            try {
                const decoded = decodeDeltaPolygon(encoded);
                const { encodeDeltaPolygon } = await import(
                    "./lib/deltaEncode.mjs"
                );
                // decodeDeltaPolygon always returns MultiPolygon coords
                // ([polygon[ring[point]]]). Unpack the outer wrapper for
                // single-polygon geometries so encodeDeltaPolygon gets the
                // right shape.
                const reencoded = encodeDeltaPolygon({
                    type: decoded.length > 1 ? "MultiPolygon" : "Polygon",
                    coordinates:
                        decoded.length > 1 ? decoded : decoded[0],
                });
                if (JSON.stringify(reencoded) !== JSON.stringify(encoded)) {
                    errors.push(
                        `boundaries.json.gz: relation ${rid} failed decode/re-encode round-trip`,
                    );
                }
            } catch (err) {
                errors.push(
                    `boundaries.json.gz: relation ${rid} decode failed: ${err.message}`,
                );
            }
        }

        // Centroid falls inside polygon bbox for each index entry.
        for (const entry of artifact.index) {
            const bbox = entry.bbox;
            const centroid = entry.centroid;
            if (bbox && centroid) {
                if (
                    centroid[0] < bbox[0] ||
                    centroid[0] > bbox[2] ||
                    centroid[1] < bbox[1] ||
                    centroid[1] > bbox[3]
                ) {
                    errors.push(
                        `boundaries.json.gz: centroid ${JSON.stringify(centroid)} outside bbox ${JSON.stringify(bbox)} for relation ${entry.relationId}`,
                    );
                }
            }
        }

        // Warn above 10 MB gz.
        if (gzBytes.length > 10 * 1024 * 1024) {
            const mb = (gzBytes.length / 1024 / 1024).toFixed(2);
            console.warn(
                `  WARNING: boundaries.json.gz is ${mb} MB (>10 MB threshold)`,
            );
        }
    } catch (err) {
        errors.push(`boundaries.json.gz: lint error: ${err.message}`);
    }

    return errors;
}

async function main() {
    const args = process.argv.slice(2);
    let regionId = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--region" && i + 1 < args.length) {
            regionId = args[++i];
        }
    }

    if (!regionId) {
        console.error("Usage: pnpm data:pack:lint -- --region <id>");
        process.exitCode = 2;
        return;
    }

    const errors = await lintRegion(regionId);

    if (errors.length > 0) {
        console.error(`\nLint FAILED for ${regionId}:`);
        for (const err of errors) {
            console.error(`  ${err}`);
        }
        process.exitCode = 1;
    } else {
        console.log(`Lint PASSED for ${regionId}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

/**
 * Catalog generator — builds catalog.json from built pack dist directories.
 *
 * Usage:
 *   pnpm data:pack:catalog -- --region europe-netherlands [--tag packs-2026-06-12]
 *   pnpm data:pack:catalog -- --all [--tag packs-2026-06-12]
 *   pnpm data:pack:catalog -- --region europe-netherlands --base catalog.json --tag packs-2026-06-12
 *
 * Input: one or more dist/<region-id>/ directories (each must have meta.json
 *   and hashes.json) plus a release --tag.
 * Output: data/packs/dist/catalog.json
 *
 * --base: start from an existing catalog and replace only the specified
 *   regions' entries (preserves untouched packs).
 *
 * @module build-catalog
 */

/* global console, process */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
    validateCatalog,
    CATALOG_SCHEMA_VERSION,
} from "./lib/catalogSchema.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packsDir = resolve(scriptDir, "..");
const distBase = resolve(packsDir, "dist");

/**
 * Build a catalog from one or more region dist directories.
 *
 * @param {object} options
 * @param {string[]} options.regionIds - region IDs to include
 * @param {string} options.tag - release tag (e.g. "packs-2026-06-12")
 * @param {string} options.repo - GitHub repo slug (e.g. "kagelump/JetLagHideAndSeek")
 * @param {object} [options.baseCatalog] - existing catalog to merge into
 * @param {string} [options.attributionUrl] - optional override for attributionUrl
 * @param {string} [options.distDir] - override dist directory (for testing)
 * @returns {Promise<object>} the built catalog object
 */
export async function buildCatalog({
    regionIds,
    tag,
    repo,
    baseCatalog,
    attributionUrl,
    distDir,
}) {
    if (!regionIds || regionIds.length === 0) {
        throw new Error("At least one region ID is required");
    }
    if (!tag) {
        throw new Error("Release --tag is required");
    }
    if (!repo) {
        throw new Error("--repo is required");
    }

    // Start from base catalog (or empty).
    const catalog = baseCatalog
        ? structuredClone(baseCatalog)
        : {
              schemaVersion: CATALOG_SCHEMA_VERSION,
              generatedAt: new Date().toISOString(),
              attributionUrl:
                  attributionUrl ??
                  `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/NOTICE`,
              packs: [],
          };

    // Remove entries for regions we're rebuilding (merge mode).
    const existingPackIds = new Set(regionIds);
    catalog.packs = catalog.packs.filter((p) => !existingPackIds.has(p.id));

    // Use override distDir or default.
    const baseDistDir = distDir ?? distBase;

    // Build new pack entries.
    for (const regionId of regionIds) {
        const regionDistDir = resolve(baseDistDir, regionId);

        if (!existsSync(regionDistDir)) {
            throw new Error(
                `dist/${regionId}/ does not exist. Build the pack first.`,
            );
        }

        // Load meta.json.
        const metaPath = resolve(regionDistDir, "meta.json");
        if (!existsSync(metaPath)) {
            throw new Error(`dist/${regionId}/meta.json not found`);
        }
        /** @type {object} */
        const meta = JSON.parse(await readFile(metaPath, "utf8"));

        // Load hashes.json.
        const hashesPath = resolve(regionDistDir, "hashes.json");
        if (!existsSync(hashesPath)) {
            throw new Error(`dist/${regionId}/hashes.json not found`);
        }
        /** @type {Record<string, {bytes: number, md5: string, sha256: string}>} */
        const hashes = JSON.parse(await readFile(hashesPath, "utf8"));

        // Build artifact entries from hashes.
        const artifacts = buildArtifacts(hashes, regionId, tag, repo);

        // Compute total bytes.
        const totalBytes = artifacts.reduce((sum, a) => sum + a.bytes, 0);

        catalog.packs.push({
            id: regionId,
            label: meta.label,
            regionPath: meta.regionPath,
            bbox: meta.bbox,
            osmSnapshot: meta.osmSnapshot,
            totalBytes,
            artifacts,
        });
    }

    // Sort packs by id for deterministic output.
    catalog.packs.sort((a, b) => a.id.localeCompare(b.id));

    // Update generatedAt to now.
    catalog.generatedAt = new Date().toISOString();

    return catalog;
}

/**
 * Build artifact entries from hashes.json entries.
 *
 * The hashes keys follow the naming convention:
 *   <kind>                   -> poi, boundaries, transit, meta
 *   measuring-<category>     -> e.g. measuring-coastline
 *
 * @param {Record<string, {bytes: number, md5: string, sha256: string}>} hashes
 * @param {string} regionId
 * @param {string} tag
 * @param {string} repo
 * @returns {Array<object>}
 */
function buildArtifacts(hashes, regionId, tag, repo) {
    const artifacts = [];
    const releaseBase = `https://github.com/${repo}/releases/download/${tag}`;

    // track which artifact kinds we've seen for dedup
    const seen = new Set();

    for (const [key, hashEntry] of Object.entries(hashes)) {
        let kind;
        let category = null;

        // Determine kind and category from key.
        // measuring-coastline -> kind="measuring", category="coastline"
        // poi -> kind="poi", category=null
        if (key.startsWith("measuring-")) {
            kind = "measuring";
            category = key.slice("measuring-".length);
        } else {
            kind = key;
        }

        // Dedup: if we've already seen this kind (e.g. measuring has sub-entries),
        // each sub-entry is separate artifact.
        const dedupKey = `${kind}:${category ?? ""}`;
        if (seen.has(dedupKey)) {
            continue;
        }
        seen.add(dedupKey);

        // Build the asset name.
        // poi -> <regionId>-poi.json.gz
        // measuring-coastline -> <regionId>-measuring-coastline.json.gz
        const assetName = category
            ? `${regionId}-${kind}-${category}.json.gz`
            : `${regionId}-${kind}.json.gz`;

        artifacts.push({
            kind,
            category,
            url: `${releaseBase}/${assetName}`,
            bytes: hashEntry.bytes,
            md5: hashEntry.md5,
            sha256: hashEntry.sha256,
            schemaVersion: 1,
        });
    }

    return artifacts;
}

/**
 * Parse CLI args.
 *
 * @param {string[]} argv
 * @returns {{ region?: string, all: boolean, base?: string, tag?: string, repo?: string }}
 */
function parseArgs(argv) {
    const opts = {
        region: undefined,
        all: false,
        base: undefined,
        tag: undefined,
        repo: undefined,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--region" && i + 1 < argv.length) {
            opts.region = argv[++i];
        } else if (arg === "--all") {
            opts.all = true;
        } else if (arg === "--base" && i + 1 < argv.length) {
            opts.base = argv[++i];
        } else if (arg === "--tag" && i + 1 < argv.length) {
            opts.tag = argv[++i];
        } else if (arg === "--repo" && i + 1 < argv.length) {
            opts.repo = argv[++i];
        }
    }
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (!opts.tag) {
        console.error(
            "Usage: pnpm data:pack:catalog -- --region <id> | --all --tag <release-tag> [--repo <org/repo>] [--base <path>]",
        );
        process.exitCode = 2;
        return;
    }

    const repo = opts.repo ?? "kagelump/JetLagHideAndSeek";
    const distBaseFull = resolve(packsDir, "dist");

    // Determine which regions to include.
    let regionIds = [];
    if (opts.all) {
        // Discover all region directories.
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(distBaseFull, {
            withFileTypes: true,
        });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                regionIds.push(entry.name);
            }
        }
        regionIds.sort();
    } else if (opts.region) {
        regionIds = [opts.region];
    } else {
        console.error(
            "Usage: pnpm data:pack:catalog -- --region <id> | --all --tag <release-tag>",
        );
        process.exitCode = 2;
        return;
    }

    // Load base catalog if provided.
    let baseCatalog = undefined;
    if (opts.base) {
        if (!existsSync(opts.base)) {
            console.error(`Base catalog not found: ${opts.base}`);
            process.exitCode = 1;
            return;
        }
        baseCatalog = JSON.parse(await readFile(opts.base, "utf8"));
    }

    const catalog = await buildCatalog({
        regionIds,
        tag: opts.tag,
        repo,
        baseCatalog,
    });

    // Validate the catalog before writing.
    const validationErrors = validateCatalog(catalog);
    if (validationErrors.length > 0) {
        console.error("Catalog validation FAILED:");
        for (const err of validationErrors) {
            console.error(`  ${err}`);
        }
        process.exitCode = 1;
        return;
    }

    // Write catalog.json.
    const catalogPath = resolve(packsDir, "dist", "catalog.json");
    await mkdir(resolve(packsDir, "dist"), { recursive: true });
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n");

    console.log(`Wrote ${catalogPath}`);
    console.log(
        `  ${catalog.packs.length} pack(s), ${catalog.packs.reduce((s, p) => s + p.artifacts.length, 0)} artifact(s)`,
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

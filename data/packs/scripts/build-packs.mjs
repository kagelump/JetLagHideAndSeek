/**
 * Pack pipeline CLI entry point.
 *
 * Usage:
 *   pnpm data:pack -- --region europe-netherlands
 *   pnpm data:pack -- --all
 *
 * For each selected region: cache the PBF, run enabled artifact builders,
 * write meta.json + hashes.json, and run pack-lint.
 *
 * @module build-packs
 */

/* global console, process, fetch */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { loadConfig } from "./lib/config.mjs";
import { computeHashes } from "./lib/hashing.mjs";
import { buildMeasuringArtifact } from "./lib/buildMeasuring.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packsDir = resolve(scriptDir, "..");
const configPath = resolve(packsDir, "regions.yaml");
const root = resolve(packsDir, "..", "..");

// Paths to shared pipeline resources.
const geofabrikDir = resolve(root, "data", "geofabrik");
const selectorsPath = resolve(geofabrikDir, "poi-selectors.json");

/** Artifact builder registry. */
const BUILDERS = {
    poi: buildPoiArtifact,
    measuring: buildMeasuringArtifact,
    boundaries: buildBoundariesArtifact,
    transit: buildTransitArtifactFn,
};

/**
 * Build the poi artifact for a region.
 *
 * @returns {Promise<{gzPath: string, uncompressed: Buffer}|null>}
 */
async function buildPoiArtifact({ region, pbfPath, distDir }) {
    // Load poi-selectors.json (shared with the Japan pipeline).
    if (!existsSync(selectorsPath)) {
        console.warn(
            `  [poi] ${selectorsPath} not found — skipping. ` +
                `Run pnpm data:poi-selectors first.`,
        );
        return null;
    }
    const selectorsJson = JSON.parse(readFileSync(selectorsPath, "utf8"));
    const tagsFilterArgs = selectorsJson.tagsFilterArgs;
    if (!tagsFilterArgs || tagsFilterArgs.length === 0) {
        console.warn(
            `  [poi] poi-selectors.json has no tagsFilterArgs — skipping.`,
        );
        return null;
    }

    // Determine PBF bbox via osmium fileinfo.
    let bbox = region.bbox ?? null;
    try {
        const { execFileSync } = await import("node:child_process");
        const fileinfo = execFileSync("osmium", [
            "fileinfo",
            pbfPath,
            "--no-progress",
        ]);
        const text = fileinfo.toString("utf8");
        const m = text.match(
            /Bounding box(?:es)?:\s*\(([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\)/,
        );
        if (m) {
            const [west, south, east, north] = [
                parseFloat(m[1]),
                parseFloat(m[2]),
                parseFloat(m[3]),
                parseFloat(m[4]),
            ];
            if ([west, south, east, north].every(Number.isFinite)) {
                bbox = [west, south, east, north];
            }
        }
    } catch {
        // osmium fileinfo may fail; keep fallback bbox from config.
    }

    // Import the shared extraction lib from the geofabrik pipeline.
    const { extractPoisFromPbf } = await import(
        "../../../data/geofabrik/scripts/lib/extractPois.mjs"
    );

    const { serialized, columnar } = await extractPoisFromPbf({
        pbfPath,
        selectorsJson,
        tagsFilterArgs,
        regionMeta: {
            id: region.id,
            label: region.label,
            bbox,
            source: region.pbfUrl,
        },
    });

    // Write gzipped artifact.
    const gzipped = gzipSync(serialized, { level: 9 });
    const gzPath = resolve(distDir, "poi.json.gz");
    await writeFile(gzPath, gzipped);

    console.log(`    poi.json.gz: ${(gzipped.length / 1024).toFixed(1)} KB gz`);

    return {
        gzPath,
        uncompressed: Buffer.from(serialized, "utf8"),
        columnar,
    };
}

/**
 * Build the boundaries artifact for a region.
 *
 * @returns {Promise<{gzPath: string, uncompressed: Buffer}|null>}
 */
async function buildBoundariesArtifact({ region, pbfPath, distDir }) {
    const { buildBoundaries } = await import("./lib/buildBoundaries.mjs");
    return buildBoundaries({ region, pbfPath, distDir });
}

/**
 * Parse CLI args into { region?, all }.
 * @param {string[]} argv
 * @returns {{ region?: string, all: boolean }}
 */
function parseArgs(argv) {
    const opts = { region: undefined, all: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--region" && i + 1 < argv.length) {
            opts.region = argv[++i];
        } else if (argv[i] === "--all") {
            opts.all = true;
        }
    }
    return opts;
}

/**
 * Build the transit artifact for a region.
 */
async function buildTransitArtifactFn({ region, pbfPath, distDir, cacheDir }) {
    const { buildTransitArtifact } = await import("./lib/buildTransit.mjs");
    return buildTransitArtifact({ region, pbfPath, distDir, cacheDir });
}

/**
 * Ensure the region's PBF is cached. Reuses the fetch/cache pattern from
 * the Geofabrik pipeline.
 *
 * @param {object} region - region config entry
 * @param {string} cacheDir - cache directory
 * @param {boolean} cacheOnly - never download
 * @returns {Promise<string>} path to the cached PBF
 */
async function ensurePbf(region, cacheDir, cacheOnly) {
    await mkdir(cacheDir, { recursive: true });

    const pbfName = `${region.id}-latest.osm.pbf`;
    const pbfPath = resolve(cacheDir, pbfName);

    if (existsSync(pbfPath)) {
        console.log(`  Using cached PBF: ${pbfPath}`);
        return pbfPath;
    }

    if (cacheOnly) {
        throw new Error(
            `PBF not cached for ${region.id} and --cache-only is set. ` +
                `Run without --cache-only to download.`,
        );
    }

    console.log(`  Downloading PBF: ${region.pbfUrl}`);
    const response = await fetch(region.pbfUrl);
    if (!response.ok) {
        throw new Error(
            `PBF download failed for ${region.id}: HTTP ${response.status}`,
        );
    }

    const buf = Buffer.from(await response.arrayBuffer());
    await writeFile(pbfPath, buf);
    const mb = (buf.length / 1024 / 1024).toFixed(1);
    console.log(`  Wrote ${mb} MB to ${pbfPath}`);
    return pbfPath;
}

/**
 * Derive the OSM snapshot date from the PBF's Last-Modified header or
 * fall back to the file's mtime.
 *
 * @param {string} pbfPath
 * @returns {Promise<string>} YYYY-MM-DD date string
 */
async function osmSnapshot(pbfPath) {
    const st = await stat(pbfPath);
    const d = st.mtime;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Build one region: cache PBF, run enabled builders, write meta + hashes.
 *
 * @param {object} region - region config entry
 * @param {string} distDir - dist/<region-id>/ output directory
 * @param {string} cacheDir - PBF cache directory
 * @param {boolean} cacheOnly - never download
 */
async function buildRegion(region, distDir, cacheDir, cacheOnly) {
    console.log(`\n=== ${region.label} (${region.id}) ===`);

    const pbfPath = await ensurePbf(region, cacheDir, cacheOnly);

    await mkdir(distDir, { recursive: true });

    // Run enabled builders.
    const hashes = {};
    let poiColumnar = null; // captured from POI builder for meta
    let measuringCategories = []; // captured from measuring builder for meta
    const enabledKinds =
        region.artifacts && region.artifacts.length > 0
            ? region.artifacts
            : Object.keys(BUILDERS);

    for (const kind of enabledKinds) {
        const builder = BUILDERS[kind];
        if (!builder) {
            console.log(`  [${kind}] unknown — skipping`);
            continue;
        }

        console.log(`  [${kind}] building...`);
        const result = await builder({ region, pbfPath, distDir, cacheDir });

        if (result) {
            // Measuring: multi-artifact return (Map of "measuring-<cat>" → {gzPath, uncompressed}).
            if (kind === "measuring" && result.artifacts instanceof Map) {
                const measHashes = {};
                for (const [name, art] of result.artifacts) {
                    const h = computeHashes(
                        await readFile(art.gzPath),
                        art.uncompressed,
                    );
                    measHashes[name] = h;
                    console.log(
                        `    ${name}.json.gz: ${(h.bytes / 1024).toFixed(1)} KB gz`,
                    );
                }
                // Flatten measuring-X keys into the top-level hashes object.
                // Consumers (pack-lint, build-catalog, publish) expect flat keys.
                Object.assign(hashes, measHashes);

                // Record emitted categories for meta.json.
                if (Array.isArray(result.categories)) {
                    measuringCategories = result.categories;
                }
            } else if (result.gzPath && result.uncompressed) {
                // Single artifact per kind (poi, boundaries, transit).
                const h = computeHashes(
                    await readFile(result.gzPath),
                    result.uncompressed,
                );
                hashes[kind] = h;
                console.log(
                    `    ${basename(result.gzPath)}: ${(h.bytes / 1024).toFixed(1)} KB gz`,
                );
            }
            // Capture POI columnar for meta.
            if (kind === "poi" && result.columnar) {
                poiColumnar = result.columnar;
            }
        }
    }

    // Build meta.json.
    const snapshot = await osmSnapshot(pbfPath);

    // Derive bbox from POI columnar, config, or osmium fileinfo.
    let metaBbox = poiColumnar?.bbox ?? region.bbox ?? null;
    if (!metaBbox || metaBbox.every((v) => v === 0)) {
        try {
            const { execFileSync } = await import("node:child_process");
            const fileinfo = execFileSync("osmium", [
                "fileinfo",
                pbfPath,
                "--no-progress",
            ]);
            const text = fileinfo.toString("utf8");
            const m = text.match(
                /Bounding box(?:es)?:\s*\(([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\)/,
            );
            if (m) {
                const [west, south, east, north] = [
                    parseFloat(m[1]),
                    parseFloat(m[2]),
                    parseFloat(m[3]),
                    parseFloat(m[4]),
                ];
                if ([west, south, east, north].every(Number.isFinite)) {
                    metaBbox = [west, south, east, north];
                }
            }
        } catch {
            // osmium unavailable — keep fallback.
        }
    }
    if (!metaBbox) metaBbox = [0, 0, 0, 0];
    const matchingCategories = poiColumnar
        ? Object.keys(poiColumnar.categories).sort()
        : [];

    const meta = {
        schemaVersion: 1,
        regionId: region.id,
        label: region.label,
        regionPath: region.regionPath,
        bbox: metaBbox,
        osmSnapshot: snapshot,
        adminLevels: {
            matching: region.adminLevels?.matching ?? [4, 7, 9, 10],
            extract: region.adminLevels?.extract ??
                region.adminLevels?.matching ?? [4, 7, 9, 10],
        },
        categories: {
            measuring: measuringCategories,
            matching: matchingCategories,
        },
        artifacts: region.artifacts ?? Object.keys(BUILDERS),
        attribution: "© OpenStreetMap contributors, ODbL — via Geofabrik",
    };

    const metaPath = resolve(distDir, "meta.json");
    const metaSerialized = JSON.stringify(meta, null, 2) + "\n";
    await writeFile(metaPath, metaSerialized);

    // Also write gzipped meta so the catalog can reference it.
    const metaGzipped = gzipSync(metaSerialized, { level: 9 });
    const metaGzPath = resolve(distDir, "meta.json.gz");
    await writeFile(metaGzPath, metaGzipped);
    hashes.meta = computeHashes(
        metaGzipped,
        Buffer.from(metaSerialized, "utf8"),
    );
    console.log(
        `    meta.json.gz: ${(hashes.meta.bytes / 1024).toFixed(1)} KB gz`,
    );
    console.log(`  Wrote meta.json`);

    // Write hashes.json.
    const hashesPath = resolve(distDir, "hashes.json");
    await writeFile(hashesPath, JSON.stringify(hashes, null, 2) + "\n");
    console.log(`  Wrote hashes.json`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (!opts.region && !opts.all) {
        console.error(
            "Usage: pnpm data:pack -- --region <id> | --all [--cache-only]",
        );
        process.exitCode = 2;
        return;
    }

    const config = await loadConfig(configPath);
    const cacheOnly = process.argv.includes("--cache-only");
    const cacheDir = resolve(packsDir, "cache");
    const distBase = resolve(packsDir, "dist");

    await mkdir(cacheDir, { recursive: true });
    await mkdir(distBase, { recursive: true });

    const regions = opts.all
        ? config.regions
        : config.regions.filter((r) => r.id === opts.region);

    if (regions.length === 0) {
        console.error(`No region found matching "${opts.region}"`);
        process.exitCode = 1;
        return;
    }

    for (const region of regions) {
        const distDir = resolve(distBase, region.id);
        await buildRegion(region, distDir, cacheDir, cacheOnly);
    }

    console.log("\nDone.");
}

// Invocation guard.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

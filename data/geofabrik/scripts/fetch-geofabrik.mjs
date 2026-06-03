/* global console, process, fetch */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import YAML from "yaml";
import {
    buildColumnar,
    computeStats,
    deduplicateRecords,
    loadCategoryOf,
    reduceFeature,
} from "./poiReducer.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const geofabrikDir = resolve(scriptDir, "..");
const configPath = resolve(geofabrikDir, "config.yaml");
const root = resolve(geofabrikDir, "..", "..");

const attribution = {
    notice: "See data/geofabrik/NOTICE.md for attribution, license, and usage-rule notes.",
    sources: ["https://download.geofabrik.de/asia/japan.html"],
    text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL). Geofabrik extract from download.geofabrik.de.",
};

async function main() {
    const config = YAML.parse(await readFile(configPath, "utf8"));

    const cacheOnly = process.argv.includes("--cache-only");
    const extractPoi = process.argv.includes("--poi");
    const runBundle = process.argv.includes("--bundle");
    const runPacks = process.argv.includes("--packs");
    const checkMode = process.argv.includes("--check");
    const cacheDir = resolve(geofabrikDir, config.cacheDir ?? "cache");
    const outputDir = resolve(geofabrikDir, config.outputDir ?? "generated");

    // Bundle artifacts go under assets/poi/ at repo root.
    const bundleDir = checkMode
        ? resolve(
              (await import("node:os")).tmpdir(),
              `poi-bundle-check-${Date.now()}`,
          )
        : resolve(root, "assets", "poi");

    // Pack artifacts go under data/geofabrik/dist/poi/ (git-ignored).
    const packsDir = resolve(geofabrikDir, "dist", "poi");

    await mkdir(cacheDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    if (runBundle) await mkdir(bundleDir, { recursive: true });
    if (runPacks) await mkdir(packsDir, { recursive: true });

    // Load the selector registry for the bundle / packs stage.
    let categoryOf;
    if (runBundle || runPacks) {
        const selectorsPath = resolve(geofabrikDir, "poi-selectors.json");
        if (!existsSync(selectorsPath)) {
            throw new Error(
                `${selectorsPath} not found. Run pnpm data:poi-selectors first.`,
            );
        }
        categoryOf = await loadCategoryOf(selectorsPath);
    }

    const regionMetas = [];
    const packMetas = [];

    for (const region of config.regions) {
        console.log(`\n=== ${region.label} (${region.id}) ===`);

        // 1. Download PBF
        const pbfPath = resolve(cacheDir, `${region.id}-latest.osm.pbf`);
        if (existsSync(pbfPath)) {
            console.log(`  Using cached: ${pbfPath}`);
        } else if (cacheOnly) {
            throw new Error(
                `PBF not cached for ${region.id} and --cache-only is set. Run without --cache-only to download.`,
            );
        } else {
            console.log(`  Downloading: ${region.url}`);
            const response = await fetch(region.url);
            if (!response.ok) {
                throw new Error(
                    `Download failed for ${region.id}: ${response.status}`,
                );
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            await writeFile(pbfPath, buffer);
            console.log(
                `  Wrote ${(buffer.length / 1024 / 1024).toFixed(1)} MB`,
            );
        }

        const pbfStat = await stat(pbfPath);
        console.log(
            `  PBF size: ${(pbfStat.size / 1024 / 1024).toFixed(1)} MB`,
        );

        // 2. Extract POIs if requested (legacy --poi stage)
        if (extractPoi) {
            await runPoiStage(config, region, pbfPath, pbfStat, outputDir);
        }

        // 3. Bundle stage (--bundle) — only for regions flagged `bundle: true`.
        const isBundled = Boolean(region.bundle);
        if (runBundle && isBundled) {
            const result = await runBundleStage(
                region,
                pbfPath,
                categoryOf,
                bundleDir,
            );
            regionMetas.push(result.meta);
            // If also running packs, reuse the serialized columnar.
            if (runPacks) {
                const packMeta = await emitPack(
                    result.meta,
                    result.serialized,
                    packsDir,
                    config.packsBaseUrl,
                );
                packMetas.push(packMeta);
            }
        } else if (runPacks) {
            // Packs stage: process every region (both bundled and pack-only).
            const result = await runBundleStage(
                region,
                pbfPath,
                categoryOf,
                packsDir,
            );
            const packMeta = await emitPack(
                result.meta,
                result.serialized,
                packsDir,
                config.packsBaseUrl,
            );
            packMetas.push(packMeta);
        }
    }

    // After all regions, write the regions index.
    if (runBundle) {
        await writeRegionsIndex(regionMetas, bundleDir, checkMode);
    }

    // After all regions, write the packs manifest.
    if (runPacks) {
        await writePacksManifest(packMetas, packsDir);
    }

    // In --check mode, compare generated bundle against committed.
    if (runBundle && checkMode) {
        await checkAgainstCommitted(bundleDir, root);
    }
}

// ─── Legacy --poi stage (node-only, key-level) ──────────────────────────

async function runPoiStage(config, region, pbfPath, pbfStat, outputDir) {
    const poiPbfPath = resolve(outputDir, `${region.id}-pois.osm.pbf`);
    const poiGeoJsonPath = resolve(outputDir, `${region.id}-pois.geojson`);
    const poiStatsPath = resolve(outputDir, `${region.id}-pois-stats.json`);

    const filterExprs = config.poiNodeKeys.map((k) => `n/${k}`);
    console.log(
        `  Extracting POIs with osmium tags-filter (${filterExprs.length} keys)...`,
    );
    execFileSync(
        "osmium",
        ["tags-filter", pbfPath, ...filterExprs, "-o", poiPbfPath, "-O"],
        { stdio: "inherit" },
    );

    const poiPbfStat = await stat(poiPbfPath);
    console.log(
        `  POI-only PBF: ${(poiPbfStat.size / 1024 / 1024).toFixed(1)} MB`,
    );

    console.log(`  Converting POIs to GeoJSON...`);
    execFileSync(
        "osmium",
        ["export", poiPbfPath, "-f", "geojson", "-o", poiGeoJsonPath, "-O"],
        { stdio: "inherit" },
    );

    const poiGeoJsonStat = await stat(poiGeoJsonPath);
    const rawGeoJsonSizeMB = poiGeoJsonStat.size / 1024 / 1024;

    const featureCount = countGeoJsonFeatures(poiGeoJsonPath);
    console.log(`  POI count: ${featureCount.toLocaleString()}`);

    const rawGeoJson = await readFile(poiGeoJsonPath);
    const gzipped = gzipSync(rawGeoJson, { level: 9 });
    const gzippedSizeMB = gzipped.length / 1024 / 1024;

    const stats = {
        region: region.id,
        label: region.label,
        source: {
            url: region.url,
            pbfSizeMb: +(pbfStat.size / 1024 / 1024).toFixed(2),
        },
        pois: {
            count: featureCount,
            filterKeys: config.poiNodeKeys,
            formats: {
                pbf: {
                    file: poiPbfPath,
                    sizeMb: +(poiPbfStat.size / 1024 / 1024).toFixed(2),
                },
                geojson: {
                    file: poiGeoJsonPath,
                    sizeMb: +rawGeoJsonSizeMB.toFixed(2),
                },
                "geojson.gz": {
                    estimatedSizeMb: +gzippedSizeMB.toFixed(2),
                    compressionRatio: +(
                        rawGeoJsonSizeMB / gzippedSizeMB
                    ).toFixed(1),
                },
            },
        },
    };

    await writeFile(poiStatsPath, JSON.stringify(stats, null, 2) + "\n");
    console.log(`  Stats written to ${poiStatsPath}`);

    console.log(`\n  📊 POI Summary for ${region.label}:`);
    console.log(`     Count:     ${featureCount.toLocaleString()} POIs`);
    console.log(
        `     PBF:       ${(poiPbfStat.size / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(`     GeoJSON:   ${rawGeoJsonSizeMB.toFixed(2)} MB`);
    console.log(
        `     GeoJSON.gz: ${gzippedSizeMB.toFixed(2)} MB (${(rawGeoJsonSizeMB / gzippedSizeMB).toFixed(1)}x ratio)`,
    );
}

// ─── Bundle stage (curated, centroid-reduced, columnar) ────────────────

async function runBundleStage(region, pbfPath, categoryOf, bundleDir) {
    // Compute PBF bbox via osmium fileinfo.
    let bbox = region.bbox;
    try {
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
        // osmium fileinfo may fail; keep fallback bbox from config or null.
    }

    // Determine source sequence from file modification time or header.
    let sourceSequence = null;
    try {
        const fileinfo = execFileSync("osmium", [
            "fileinfo",
            pbfPath,
            "--no-progress",
        ]);
        const text = fileinfo.toString("utf8");
        const m = text.match(/Sequence\s*number:\s*(\d+)/);
        if (m) sourceSequence = parseInt(m[1], 10);
    } catch {
        // best-effort
    }

    const tagsFilterArgs = getTagsFilterArgs();
    const tmpDir = join(
        (await import("node:os")).tmpdir(),
        `poi-bundle-${region.id}-${Date.now()}`,
    );
    await mkdir(tmpDir, { recursive: true });

    try {
        const curatedPath = join(tmpDir, "curated.osm.pbf");
        const geoSeqPath = join(tmpDir, "curated.seq");

        // 1. osmium tags-filter with exact key=value from registry.
        console.log(
            `  [bundle] Filtering ${tagsFilterArgs.length} tag selectors...`,
        );
        execFileSync(
            "osmium",
            [
                "tags-filter",
                pbfPath,
                ...tagsFilterArgs,
                "-o",
                curatedPath,
                "-O",
            ],
            { stdio: "inherit" },
        );

        // 2. osmium export to GeoJSONSeq for streaming.
        console.log(`  [bundle] Exporting to GeoJSONSeq...`);
        execFileSync(
            "osmium",
            [
                "export",
                curatedPath,
                "-f",
                "geojsonseq",
                "-u",
                "type_id",
                "-a",
                "id,type",
                "-o",
                geoSeqPath,
                "-O",
            ],
            { stdio: "inherit" },
        );

        // 3. Stream, reduce, collect.
        console.log(`  [bundle] Reducing features...`);
        const records = [];
        const rl = createInterface({
            input: createReadStream(geoSeqPath, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            // Strip GeoJSONSeq 0x1e record separator and any surrounding whitespace.
            // Strip GeoJSONSeq RS (0x1e) record separator.
            const RS = String.fromCharCode(0x1e);
            const clean = line.startsWith(RS)
                ? line.slice(1).trim()
                : line.trim();
            if (!clean) continue;
            let feature;
            try {
                feature = JSON.parse(clean);
            } catch {
                continue; // skip unparseable lines
            }
            const record = reduceFeature(feature, categoryOf);
            if (record) records.push(record);
        }

        console.log(
            `  [bundle] Reduced ${records.length.toLocaleString()} named features`,
        );

        // 3a. Deduplicate: OSM may have both a node and a way for the same POI.
        const deduped = deduplicateRecords(records);
        if (deduped.length < records.length) {
            console.log(
                `  [bundle] Deduped: ${deduped.length.toLocaleString()} (removed ${(records.length - deduped.length).toLocaleString()} duplicates)`,
            );
        }

        // 4. Build columnar JSON.
        const generatedAt = new Date().toISOString();
        const columnar = buildColumnar(deduped, {
            id: region.id,
            label: region.label,
            bbox: bbox ?? region.bbox ?? [0, 0, 0, 0],
            generatedAt,
            sourceSequence,
            source: region.url,
            attribution: {
                text: attribution.text,
                license: "ODbL-1.0",
                url: "https://www.openstreetmap.org/copyright",
            },
        });

        const artifactPath = resolve(bundleDir, `${region.id}.json`);
        const serialized = JSON.stringify(columnar);
        await writeFile(artifactPath, serialized + "\n");
        console.log(
            `  [bundle] Wrote ${region.id}.json (${(Buffer.byteLength(serialized) / 1024 / 1024).toFixed(2)} MB)`,
        );

        // 5. Compute stats.
        const gzipped = gzipSync(serialized, { level: 9 });
        const stats = computeStats(columnar, gzipped.length);
        const statsPath = resolve(bundleDir, `${region.id}.stats.json`);
        await writeFile(statsPath, JSON.stringify(stats, null, 2) + "\n");
        console.log(
            `  [bundle] ${region.id}.stats.json (gzip: ${stats.gzipSizeMb} MB)`,
        );

        // Print per-category counts.
        console.log(`\n  📊 Bundle Summary for ${region.label}:`);
        console.log(
            `     Total: ${columnar.totalCount.toLocaleString()} features across ${Object.keys(columnar.categories).length} categories`,
        );
        for (const [cat, data] of Object.entries(columnar.categories)) {
            console.log(`     ${cat}: ${data.count.toLocaleString()}`);
        }

        return {
            meta: {
                id: region.id,
                label: region.label,
                bbox: columnar.bbox,
                totalCount: columnar.totalCount,
                file: `${region.id}.json`,
            },
            serialized,
        };
    } finally {
        // Clean up temp files.
        const { rm } = await import("node:fs/promises");
        try {
            await rm(tmpDir, { recursive: true, force: true });
        } catch {
            // best-effort cleanup
        }
    }
}

// ─── Packs emission ─────────────────────────────────────────────────────

/** Maximum gzipped pack size in bytes (8 MB). */
const PACK_SIZE_BUDGET_BYTES = 8 * 1024 * 1024;

/**
 * Gzips the columnar JSON, writes `<id>.json.gz` to packsDir, and returns
 * pack manifest metadata with byte size and sha256.
 */
async function emitPack(meta, serialized, packsDir, packsBaseUrl) {
    const gzipped = gzipSync(serialized, { level: 9 });
    // sha256 = uncompressed JSON (verified at runtime after inflation).
    const sha256 = createHash("sha256").update(serialized).digest("hex");
    // md5 = gzipped bytes (verified at download time via expo-file-system).
    const md5 = createHash("md5").update(gzipped).digest("hex");

    if (gzipped.length > PACK_SIZE_BUDGET_BYTES) {
        throw new Error(
            `Pack ${meta.id} gzipped size ${(gzipped.length / 1024 / 1024).toFixed(2)} MB ` +
                `exceeds budget of ${(PACK_SIZE_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB. ` +
                `Consider splitting the region or raising the budget.`,
        );
    }

    const gzPath = resolve(packsDir, `${meta.id}.json.gz`);
    await writeFile(gzPath, gzipped);
    console.log(
        `  [packs] Wrote ${meta.id}.json.gz (${(gzipped.length / 1024 / 1024).toFixed(2)} MB, sha256: ${sha256.slice(0, 12)}…)`,
    );

    return {
        id: meta.id,
        label: meta.label,
        bbox: meta.bbox,
        totalCount: meta.totalCount,
        url: `${packsBaseUrl ?? "https://<cdn>/poi"}/${meta.id}.json.gz`,
        bytes: gzipped.length,
        sha256,
        md5,
    };
}

async function writePacksManifest(packMetas, packsDir) {
    // totalCount is filled from the bundle stage result — grab it from the
    // per-region .json if available (written by runBundleStage when
    // packs-only).
    const generatedAt = new Date().toISOString();
    const manifest = {
        schemaVersion: 1,
        generatedAt,
        packs: packMetas,
    };
    const manifestPath = resolve(packsDir, "packs.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(
        `\n  Wrote packs manifest (${packMetas.length} packs) to ${manifestPath}`,
    );
}

// ─── Regions index ──────────────────────────────────────────────────────

async function writeRegionsIndex(regionMetas, bundleDir) {
    const generatedAt = new Date().toISOString();
    const index = {
        schemaVersion: 1,
        generatedAt,
        regions: regionMetas,
    };
    const indexPath = resolve(bundleDir, "regions.json");
    await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
    console.log(`\n  Wrote regions index (${regionMetas.length} regions)`);
}

// ─── --check mode ───────────────────────────────────────────────────────

async function checkAgainstCommitted(bundleDir, root) {
    const { readFile: readFileAsync } = await import("node:fs/promises");
    const committedDir = resolve(root, "assets", "poi");

    const files = ["regions.json"];
    // Also check per-region files by scanning the generated dir.
    const { readdir } = await import("node:fs/promises");
    for (const entry of await readdir(bundleDir)) {
        if (entry.endsWith(".json") && entry !== "regions.json") {
            files.push(entry);
        }
    }

    let mismatch = false;
    for (const file of files) {
        const genPath = resolve(bundleDir, file);
        const commPath = resolve(committedDir, file);

        let generated, committed;
        try {
            generated = await readFileAsync(genPath, "utf8");
            committed = await readFileAsync(commPath, "utf8");
        } catch (err) {
            console.error(`[check] Cannot compare ${file}: ${err.message}`);
            mismatch = true;
            continue;
        }

        // Compare parsed JSON for structural equality (not whitespace).
        try {
            const genObj = JSON.parse(generated);
            const comObj = JSON.parse(committed);
            if (JSON.stringify(genObj) !== JSON.stringify(comObj)) {
                console.error(
                    `[check] Mismatch in ${file}: generated differs from committed`,
                );
                mismatch = true;
            } else {
                console.log(`[check] ${file}: OK`);
            }
        } catch {
            // JSON parse error — fall back to string comparison.
            if (generated !== committed) {
                console.error(`[check] Mismatch in ${file}`);
                mismatch = true;
            }
        }
    }

    if (mismatch) {
        throw new Error(
            "Bundle artifacts differ from committed versions. Run pnpm data:geofabrik:bundle to regenerate.",
        );
    }

    // Clean up temp dir.
    const { rm } = await import("node:fs/promises");
    await rm(bundleDir, { recursive: true, force: true });
}

// ─── Tag filter helpers ─────────────────────────────────────────────────

function getTagsFilterArgs() {
    // Read the committed poi-selectors.json so the pipeline always uses
    // the exact snapshot — no TS import needed here.
    const selectorsPath = resolve(geofabrikDir, "poi-selectors.json");
    const raw = readFileSyncUtf8(selectorsPath);
    const selectors = JSON.parse(raw);
    return selectors.tagsFilterArgs ?? [];
}

// ─── Utility ────────────────────────────────────────────────────────────

function countGeoJsonFeatures(filePath) {
    const result = execFileSync("osmium", [
        "fileinfo",
        filePath,
        "--no-progress",
        "-F",
        "geojson",
    ]);
    const text = result.toString("utf8");
    const match = /(?:Number of nodes|Number of features):\s*(\d[\d,]*)/.exec(
        text,
    );
    if (match) {
        return parseInt(match[1].replace(/,/g, ""), 10);
    }

    console.warn(
        "  ⚠ Could not parse feature count from osmium fileinfo; using fallback.",
    );
    const content = readFileSyncUtf8(filePath);
    return (content.match(/"type"\s*:\s*"Feature"/g) ?? []).length;
}

function readFileSyncUtf8(filePath) {
    return readFileSync(filePath, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

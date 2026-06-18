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

/* global console, process */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";
import { gzipSync, gunzipSync } from "node:zlib";

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
async function buildBoundariesArtifact({
    region,
    pbfPath,
    distDir,
    cacheDir,
    boundarySource,
    cacheOnly,
}) {
    const { buildBoundaries } = await import("./lib/buildBoundaries.mjs");

    let parentFeatures = null;
    let parentLevels = null;
    let regionBbox = null;
    if (boundarySource) {
        parentFeatures = await getParentAdminFeatures(
            boundarySource,
            cacheDir,
            cacheOnly,
        );
        parentLevels = boundarySource.levels;
        regionBbox = region.bbox ?? (await pbfBbox(pbfPath));
        if (!regionBbox) {
            console.warn(
                `  [boundaries] No region bbox for ${region.id}; parent levels (${parentLevels.join(",")}) will be skipped`,
            );
        }
    }

    return buildBoundaries({
        region,
        pbfPath,
        distDir,
        parentFeatures,
        parentLevels,
        regionBbox,
    });
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
 * Download a file via http/https to `destPath`, following redirects.
 *
 * Uses the `node:http`/`node:https` modules with `family: 4` (IPv4-only)
 * rather than the global `fetch` (undici). On some Linux / Node 22.x
 * combinations undici's Happy Eyeballs connection manager times out even
 * when raw TCP/TLS and `https.get` work — see the `internalConnectMultiple`
 * ETIMEDOUT bug. This helper keeps the same AbortSignal-based timeout
 * contract so the retry loop in `ensurePbfFile` works unchanged.
 *
 * @param {string} url - source URL
 * @param {string} destPath - where to write the file
 * @param {AbortSignal} signal - abort signal for timeout/cancellation
 * @param {object} headers - request headers
 * @param {number} [maxRedirects=10] - redirect limit
 * @returns {Promise<Buffer>} downloaded file contents
 */
function downloadFile(url, destPath, signal, headers, maxRedirects = 10) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const getFn = parsed.protocol === "https:" ? httpsGet : httpGet;

        // Passing `signal` in options lets Node's HTTP module destroy the
        // request on abort and emit an AbortError on the error path.
        const req = getFn(
            parsed,
            { headers, family: 4, signal },
            async (res) => {
                // Follow redirects
                if (
                    res.statusCode >= 300 &&
                    res.statusCode < 400 &&
                    res.headers.location &&
                    maxRedirects > 0
                ) {
                    const redirectUrl = new URL(
                        res.headers.location,
                        url,
                    ).toString();
                    res.resume();
                    try {
                        const buf = await downloadFile(
                            redirectUrl,
                            destPath,
                            signal,
                            headers,
                            maxRedirects - 1,
                        );
                        resolve(buf);
                    } catch (err) {
                        reject(err);
                    }
                    return;
                }

                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const err = new Error(`HTTP ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    res.resume();
                    reject(err);
                    return;
                }

                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", async () => {
                    try {
                        const buf = Buffer.concat(chunks);
                        await writeFile(destPath, buf);
                        resolve(buf);
                    } catch (err) {
                        reject(err);
                    }
                });
                res.on("error", (err) => reject(err));
            },
        );

        req.on("error", (err) => reject(err));
        req.end();
    });
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
    const pbfPath = resolve(cacheDir, `${region.id}-latest.osm.pbf`);
    return ensurePbfFile(region.pbfUrl, pbfPath, cacheOnly, region.id);
}

/**
 * Download a PBF from `url` to `pbfPath` (reusing the cached copy when present).
 *
 * @param {string} url - source URL
 * @param {string} pbfPath - destination path
 * @param {boolean} cacheOnly - never download
 * @param {string} label - identifier for log/error messages
 * @returns {Promise<string>} path to the cached PBF
 */
async function ensurePbfFile(url, pbfPath, cacheOnly, label) {
    if (existsSync(pbfPath)) {
        console.log(`  Using cached PBF: ${pbfPath}`);
        return pbfPath;
    }

    if (cacheOnly) {
        throw new Error(
            `PBF not cached for ${label} and --cache-only is set. ` +
                `Run without --cache-only to download.`,
        );
    }

    console.log(`  Downloading PBF: ${url}`);

    // Retry on transient failures (Geofabrik occasionally returns 503/429
    // when hot-linked or overloaded). Use a descriptive UA and a per-attempt
    // timeout so a stuck connection does not hang forever.
    const maxAttempts = 4;
    const perAttemptTimeoutMs = 5 * 60 * 1000;
    const headers = {
        "User-Agent": "JetLagHideAndSeek-pack-builder/1.0",
    };

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                perAttemptTimeoutMs,
            );
            const buf = await downloadFile(
                url,
                pbfPath,
                controller.signal,
                headers,
            );
            clearTimeout(timeoutId);

            const mb = (buf.length / 1024 / 1024).toFixed(1);
            console.log(`  Wrote ${mb} MB to ${pbfPath}`);
            return pbfPath;
        } catch (err) {
            lastError = err;
            const isAbort = err.name === "AbortError";
            const isHttpTransient =
                err.statusCode &&
                (err.statusCode === 503 ||
                    err.statusCode === 429 ||
                    err.statusCode === 502);
            const isNetworkTransient =
                err.message &&
                /ETIMEDOUT|ECONNRESET|ENOTFOUND/.test(err.message);
            const isTransient =
                isAbort || isHttpTransient || isNetworkTransient;
            if (!isTransient || attempt === maxAttempts) {
                throw err;
            }
            const delayMs = 2 ** attempt * 1000;
            console.log(
                `  Download attempt ${attempt}/${maxAttempts} failed (${err.message}); retrying in ${delayMs}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw lastError;
}

/** In-process memo so a single --all run assembles each parent admin set once. */
const parentAdminMemo = new Map();

/**
 * Assemble (and cache) a boundary source's admin features from its parent PBF.
 *
 * The expensive osmium pass over the (large) parent PBF runs once per source:
 * memoized in-process for --all and persisted to cache/parents/ across runs.
 *
 * @param {object} boundarySource - { id, pbfUrl, levels }
 * @param {string} cacheDir - PBF cache directory
 * @param {boolean} cacheOnly - never download
 * @returns {Promise<object[]>} assembled GeoJSON admin features
 */
function getParentAdminFeatures(boundarySource, cacheDir, cacheOnly) {
    if (parentAdminMemo.has(boundarySource.id)) {
        return parentAdminMemo.get(boundarySource.id);
    }
    const promise = (async () => {
        const parentsDir = resolve(cacheDir, "parents");
        await mkdir(parentsDir, { recursive: true });
        const levels = boundarySource.levels;
        const cacheFile = resolve(
            parentsDir,
            `${boundarySource.id}-admin-L${levels.join("-")}.json.gz`,
        );

        if (existsSync(cacheFile)) {
            try {
                const obj = JSON.parse(
                    gunzipSync(await readFile(cacheFile)).toString("utf8"),
                );
                if (Array.isArray(obj?.features)) {
                    console.log(
                        `  [boundaries] Using cached parent admin set: ${cacheFile} (${obj.features.length} features)`,
                    );
                    return obj.features;
                }
            } catch {
                // Corrupt/stale cache — fall through to rebuild.
            }
        }

        const pbfPath = resolve(
            parentsDir,
            `${boundarySource.id}-latest.osm.pbf`,
        );
        await ensurePbfFile(
            boundarySource.pbfUrl,
            pbfPath,
            cacheOnly,
            boundarySource.id,
        );

        const { assembleAdminBoundaries } = await import(
            "../../../data/geofabrik/scripts/lib/osmiumPipeline.mjs"
        );
        console.log(
            `  [boundaries] Assembling parent admin set "${boundarySource.id}" (levels ${levels.join(",")})...`,
        );
        const { features } = await assembleAdminBoundaries({ pbfPath, levels });
        const payload = JSON.stringify({
            boundarySource: boundarySource.id,
            levels,
            generatedAt: new Date().toISOString(),
            features,
        });
        await writeFile(cacheFile, gzipSync(payload, { level: 9 }));
        console.log(
            `  [boundaries] Cached parent admin set: ${cacheFile} (${features.length} features)`,
        );
        return features;
    })();
    parentAdminMemo.set(boundarySource.id, promise);
    return promise;
}

/**
 * Read a PBF's bounding box via osmium fileinfo. Returns null on failure.
 *
 * @param {string} pbfPath
 * @returns {Promise<number[]|null>} [west, south, east, north]
 */
async function pbfBbox(pbfPath) {
    try {
        const { execFileSync } = await import("node:child_process");
        const text = execFileSync("osmium", [
            "fileinfo",
            pbfPath,
            "--no-progress",
        ]).toString("utf8");
        const m = text.match(
            /Bounding box(?:es)?:\s*\(([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\)/,
        );
        if (m) {
            const b = [
                parseFloat(m[1]),
                parseFloat(m[2]),
                parseFloat(m[3]),
                parseFloat(m[4]),
            ];
            if (b.every(Number.isFinite)) return b;
        }
    } catch {
        // osmium unavailable — caller falls back.
    }
    return null;
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
async function buildRegion(
    region,
    distDir,
    cacheDir,
    cacheOnly,
    boundarySource,
) {
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
        const result = await builder({
            region,
            pbfPath,
            distDir,
            cacheDir,
            boundarySource,
            cacheOnly,
        });

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

    const boundarySourceById = new Map(
        (config.boundarySources ?? []).map((b) => [b.id, b]),
    );

    for (const region of regions) {
        const distDir = resolve(distBase, region.id);
        const boundarySource = region.boundarySource
            ? boundarySourceById.get(region.boundarySource)
            : null;
        await buildRegion(region, distDir, cacheDir, cacheOnly, boundarySource);
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

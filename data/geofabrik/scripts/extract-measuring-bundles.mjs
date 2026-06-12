/* global console, process, fetch */

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import YAML from "yaml";

import { applyPostFilter } from "./lib/postFilters.mjs";
import {
    cleanCoordsInline,
    countDupPairs,
    featureToLineStrings,
    computeBbox,
    computePolygonBbox,
    polygonPerimeterMeters,
    cleanPolygonFeature,
    simplifyPolygonFeature,
    bboxesIntersect,
    simplifyCoords,
    simplifyFeature,
} from "./lib/geometryCleanup.mjs";
import {
    stitchSegments,
    dedupeParallelTracks,
    bridgeCollinearGaps,
    validateLineContinuity,
    nodeKey,
    haversineMeters,
    lineLengthMeters,
} from "./lib/lineStitching.mjs";
import {
    polygonDissolve,
    unionAllCoords,
    buildPolygonGrid,
    clipLineAtPolygon,
} from "./lib/polygonDissolve.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const geofabrikDir = resolve(scriptDir, "..");
const configPath = resolve(geofabrikDir, "config.yaml");
const root = resolve(geofabrikDir, "..", "..");

// ─── Config ────────────────────────────────────────────────────────────────────

/** Full config, read once at module load. */
const _cfg = YAML.parse(readFileSync(configPath, "utf8"));
const _m = _cfg.measuring ?? {};

// ─── Category definitions ────────────────────────────────────────────────────

const CATEGORIES = (_m.categories ?? []).map((c) => ({
    ...c,
    postFilter: c.postFilter ?? null,
    simplifyTolerance: c.simplifyTolerance ?? 0.0001,
    minFeatureLengthM: c.minFeatureLengthM ?? 100,
}));

// ─── Per-category lookup tables ──────────────────────────────────────────────

/** Simplify tolerances in degrees, keyed by category key. */
const SIMPLIFY_TOLERANCES = Object.fromEntries(
    CATEGORIES.map((c) => [c.key, c.simplifyTolerance]),
);

/** Minimum feature length in meters, keyed by category key. */
const MIN_FEATURE_LENGTH_M = Object.fromEntries(
    CATEGORIES.map((c) => [c.key, c.minFeatureLengthM]),
);

// ─── Algorithm tuning constants ──────────────────────────────────────────────

/** Simplify tolerance for waterway centerlines (degrees, ≈ 111 m). */
const WATERWAY_LINE_SIMPLIFY = _m.waterwayLineSimplify ?? 0.001;

// -- Polygon dissolve --
const DISSOLVE_TILE_DEG = _m.dissolve?.tileDeg ?? 0.25;
const DISSOLVE_TILE_OVERLAP_DEG = _m.dissolve?.overlapDeg ?? 0.01;

// -- Segment stitching --
const NODE_PRECISION = _m.stitching?.nodePrecision ?? 7;
const STITCH_MAX_TURN_COS = _m.stitching?.maxTurnCos ?? -0.5;

// -- Parallel track de-duplication --
const PARALLEL_MAX_LATERAL_M = _m.parallelDedup?.maxLateralM ?? 30;
const PARALLEL_MIN_COSINE = _m.parallelDedup?.minCosine ?? 0.966;
const PARALLEL_HUG_SAMPLES = _m.parallelDedup?.hugSamples ?? 80;

// -- Collinear gap bridging --
const BRIDGE_MAX_GAP_M = _m.bridge?.maxGapM ?? 1500;
const BRIDGE_MIN_FACING_COS = _m.bridge?.minFacingCos ?? 0.95;

// -- HSR post-processing --
const HSR_MIN_ASSEMBLED_M = _m.hsr?.minAssembledM ?? 1000;

// -- Waterway centerline post-processing --
const WATERWAY_MIN_LENGTH = _m.waterway?.minLength ?? {
    river: 100,
    canal: 100,
    stream: 500,
};

// -- Continuity validation defaults --
const CONTINUITY_DEFAULTS = _m.continuity ?? {
    maxComponents: 40,
    maxHoles: 8,
    minFeatureLenM: 1000,
    holeMinM: 40,
    holeMaxM: 2500,
    joinTolM: 25,
    edgeMarginDeg: 0.02,
};

const attribution = {
    text: "© OpenStreetMap contributors, Data available under the Open Database License (ODbL). Geofabrik extract from download.geofabrik.de.",
    license: "ODbL",
    notice: "See data/geofabrik/NOTICE.md for full attribution and license information.",
    url: "https://www.openstreetmap.org/copyright",
};

async function main() {
    const config = YAML.parse(await readFile(configPath, "utf8"));

    if (!config.measuring) {
        throw new Error("No 'measuring' block found in config.yaml");
    }

    const cacheOnly = process.argv.includes("--cache-only");
    const checkMode = process.argv.includes("--check");
    // --only=<category> regenerates a single bundle (e.g. high-speed-rail)
    // without touching the others — handy when iterating on one category.
    const onlyArg = process.argv.find((a) => a.startsWith("--only="));
    const onlyCategory = onlyArg ? onlyArg.slice("--only=".length) : null;
    if (onlyCategory && !CATEGORIES.some((c) => c.key === onlyCategory)) {
        throw new Error(
            `Unknown --only category "${onlyCategory}". Valid: ${CATEGORIES.map((c) => c.key).join(", ")}`,
        );
    }
    const categories = onlyCategory
        ? CATEGORIES.filter((c) => c.key === onlyCategory)
        : CATEGORIES;
    const measConfig = config.measuring;
    const cacheDir = resolve(geofabrikDir, config.cacheDir ?? "cache");
    const extractBbox = measConfig.extractBbox;
    const sourceUrl = measConfig.sourcePbfUrl;

    const outputDir = checkMode
        ? resolve(
              (await import("node:os")).tmpdir(),
              `measuring-bundle-check-${Date.now()}`,
          )
        : resolve(root, "assets", "measuring");

    await mkdir(cacheDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    // 1. Ensure whole-Japan PBF is cached.
    const japanPbfPath = resolve(cacheDir, "japan-latest.osm.pbf");
    if (existsSync(japanPbfPath)) {
        console.log(`Using cached: ${japanPbfPath}`);
    } else if (cacheOnly) {
        throw new Error(
            "japan-latest.osm.pbf not cached and --cache-only is set. Run without --cache-only to download.",
        );
    } else {
        console.log(`Downloading: ${sourceUrl}`);
        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(japanPbfPath, buffer);
        console.log(`Wrote ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
    }

    const japanStat = await stat(japanPbfPath);
    console.log(
        `Japan PBF size: ${(japanStat.size / 1024 / 1024).toFixed(1)} MB`,
    );

    // 2. Extract Kantō+margin window (reuse the cached extract if present).
    const widePbfPath = resolve(cacheDir, "measuring-kanto-wide.osm.pbf");
    const bboxStr = extractBbox.join(",");
    if (existsSync(widePbfPath)) {
        console.log(`Using cached Kantō+margin extract: ${widePbfPath}`);
    } else {
        console.log(`Extracting Kantō+margin window: ${bboxStr}`);
        execFileSync(
            "osmium",
            [
                "extract",
                "-b",
                bboxStr,
                japanPbfPath,
                "-o",
                widePbfPath,
                "--overwrite",
            ],
            { stdio: "inherit" },
        );
    }
    const wideStat = await stat(widePbfPath);
    console.log(
        `Kantō+margin extract: ${(wideStat.size / 1024 / 1024).toFixed(1)} MB`,
    );

    // 3. Shared coarse filter for admin 1st/2nd.
    const adminTmpDir = join(
        (await import("node:os")).tmpdir(),
        `measuring-admin-${Date.now()}`,
    );
    await mkdir(adminTmpDir, { recursive: true });
    const adminSeqPath = join(adminTmpDir, "admin-boundaries.seq");
    let adminSeqExists = false;

    const generatedAt = new Date().toISOString();
    const sizes = {};

    for (const category of categories) {
        console.log(`\n=== ${category.key} ===`);

        let pbfPath;
        if (
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border" ||
            category.key === "admin-boundaries"
        ) {
            // Three-step pipeline so osmium can assemble relations into
            // complete Polygons:
            // 1. tags-filter: extract only r/boundary=administrative.
            // 2. Extract relation IDs to a text file, then getid -r -i
            //    to pull in all member ways from the wide PBF.
            // 3. Export the complete set.
            if (!adminSeqExists) {
                console.log(
                    `  [shared] Filtering r/boundary=administrative...`,
                );
                const adminRelsPbf = join(
                    adminTmpDir,
                    "admin-rels-only.osm.pbf",
                );
                execFileSync(
                    "osmium",
                    [
                        "tags-filter",
                        widePbfPath,
                        "r/boundary=administrative",
                        "-o",
                        adminRelsPbf,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );

                console.log(`  [shared] Extracting relation IDs...`);
                const idsPath = join(adminTmpDir, "admin-rel-ids.txt");
                const { execSync } = await import("node:child_process");
                const opl = execSync(`osmium cat "${adminRelsPbf}" -f opl`, {
                    maxBuffer: 512 * 1024 * 1024,
                }).toString();
                const ids = [];
                for (const line of opl.split("\n")) {
                    if (!line.startsWith("r")) continue;
                    // Keep the 'r' prefix so osmium getid knows the type.
                    ids.push(line.split(" ")[0]);
                }
                writeFileSync(idsPath, ids.join("\n") + "\n");
                console.log(`  [shared] Found ${ids.length} relation IDs`);

                console.log(
                    `  [shared] Pulling in member ways with getid -r...`,
                );
                const adminCompletePbf = join(
                    adminTmpDir,
                    "admin-complete.osm.pbf",
                );
                // osmium getid exits 1 when some referenced objects are
                // outside the extract (missing ways/nodes). The output file
                // is still valid — just with those objects omitted.
                try {
                    execFileSync(
                        "osmium",
                        [
                            "getid",
                            widePbfPath,
                            "-r",
                            "-i",
                            idsPath,
                            "-o",
                            adminCompletePbf,
                            "-O",
                        ],
                        { stdio: "inherit" },
                    );
                } catch (err) {
                    if (!existsSync(adminCompletePbf)) throw err;
                    console.log(
                        `  [shared] getid reported missing objects ` +
                            `(some member ways outside extract) — continuing`,
                    );
                }

                console.log(`  [shared] Exporting to GeoJSON...`);
                execFileSync(
                    "osmium",
                    [
                        "export",
                        adminCompletePbf,
                        "-f",
                        "geojson",
                        "-a",
                        "type,id",
                        "-o",
                        adminSeqPath,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );
                adminSeqExists = true;
            }
        } else {
            console.log(`  Filtering: ${category.osmiumFilter}`);
            const tmpDir = join(
                (await import("node:os")).tmpdir(),
                `measuring-${category.key}-${Date.now()}`,
            );
            await mkdir(tmpDir, { recursive: true });
            pbfPath = join(tmpDir, `${category.key}.osm.pbf`);
            execFileSync(
                "osmium",
                [
                    "tags-filter",
                    widePbfPath,
                    ...category.osmiumFilter.split(" "),
                    "-o",
                    pbfPath,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        }

        // Export to GeoJSONSeq.
        let seqPath;
        if (
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border" ||
            category.key === "admin-boundaries"
        ) {
            seqPath = adminSeqPath;
        } else {
            const tmpDir = dirname(pbfPath);
            seqPath = join(tmpDir, `${category.key}.seq`);
            console.log(`  Exporting to GeoJSONSeq...`);
            execFileSync(
                "osmium",
                [
                    "export",
                    pbfPath,
                    "-f",
                    "geojsonseq",
                    "-a",
                    "type,id",
                    "-o",
                    seqPath,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        }

        // Process features — streaming GeoJSONSeq for most categories,
        // full GeoJSON parse for admin (assembled relation polygons).
        console.log(`  Processing features...`);
        const features = [];

        const isAdmin =
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border" ||
            category.key === "admin-boundaries";

        if (isAdmin) {
            // Admin: read the assembled GeoJSON FeatureCollection.
            const raw = readFileSync(seqPath, "utf8");
            const fc = JSON.parse(raw);

            for (const feature of fc.features ?? []) {
                // Only interested in assembled relation polygons.
                if (
                    feature.properties?.["@type"] !== "relation" ||
                    !applyPostFilter(category, feature.properties ?? {})
                ) {
                    continue;
                }

                if (category.geometry === "polygon") {
                    // polygon mode: keep full Polygon/MultiPolygon with
                    // admin_level, name, name:en, and osmId for client-side
                    // point-in-polygon matching.
                    const geom = feature.geometry;
                    if (
                        geom.type !== "Polygon" &&
                        geom.type !== "MultiPolygon"
                    ) {
                        continue;
                    }

                    const props = {
                        osmId: Number(feature.properties["@id"]),
                        admin_level: feature.properties.admin_level ?? "",
                    };
                    for (const k of ["name", "name:en"]) {
                        if (feature.properties[k] != null) {
                            props[k] = feature.properties[k];
                        }
                    }

                    const cleaned = cleanPolygonFeature(feature);
                    if (!cleaned) continue;

                    const tolerance =
                        SIMPLIFY_TOLERANCES[category.key] ?? 0.0001;
                    const simplified = simplifyPolygonFeature(
                        cleaned,
                        tolerance,
                    );
                    if (!simplified) continue;

                    const bbox = computePolygonBbox(simplified.geometry);

                    features.push({
                        type: "Feature",
                        bbox,
                        geometry: simplified.geometry,
                        properties: props,
                    });
                } else {
                    // polygon-to-ring mode: existing border-ring extraction.
                    // Extract relationId and name for runtime filtering.
                    const props = {
                        relationId: Number(feature.properties["@id"]),
                    };
                    // Carry name tags for potential future UI use.
                    for (const k of ["name", "name:en"]) {
                        if (feature.properties[k] != null) {
                            props[k] = feature.properties[k];
                        }
                    }

                    const lineFeatures = featureToLineStrings(feature);
                    for (const lf of lineFeatures) {
                        // Merge relation metadata into each ring segment.
                        lf.properties = { ...props };

                        const lineStrings =
                            lf.geometry.type === "MultiLineString"
                                ? lf.geometry.coordinates.map((coords) => ({
                                      type: "Feature",
                                      geometry: {
                                          type: "LineString",
                                          coordinates: coords,
                                      },
                                      properties: { ...props },
                                  }))
                                : [lf];

                        for (const ls of lineStrings) {
                            const tolerance =
                                SIMPLIFY_TOLERANCES[category.key] ?? 0.0001;
                            const simplified = simplifyFeature(ls, tolerance);
                            const bbox = computeBbox(
                                simplified.geometry.coordinates,
                            );

                            features.push({
                                type: "Feature",
                                bbox,
                                geometry: simplified.geometry,
                                properties: { ...props },
                            });
                        }
                    }
                }
            }
        } else {
            // Non-admin: stream GeoJSONSeq line by line.
            const rl = createInterface({
                input: createReadStream(seqPath, { encoding: "utf8" }),
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                const RS = String.fromCharCode(0x1e);
                const clean = line.startsWith(RS)
                    ? line.slice(1).trim()
                    : line.trim();
                if (!clean) continue;

                let feature;
                try {
                    feature = JSON.parse(clean);
                } catch {
                    continue;
                }

                // Apply post-filter.
                if (category.postFilter) {
                    if (!applyPostFilter(category, feature.properties ?? {})) {
                        continue;
                    }
                }

                // Convert polygon to outer-ring LineString, or keep as polygon
                // for dissolve.
                let lineFeatures;
                if (category.geometry === "polygon-dissolve") {
                    // Accept Polygon / MultiPolygon for the dissolve pipeline,
                    // and LineString / MultiLineString for waterway centerlines.
                    if (
                        feature.geometry.type === "Polygon" ||
                        feature.geometry.type === "MultiPolygon"
                    ) {
                        lineFeatures = [feature];
                    } else if (
                        feature.geometry.type === "LineString" ||
                        feature.geometry.type === "MultiLineString"
                    ) {
                        // Skip underground/covered waterways (layer ≤ -1).
                        // These are tunnels or culverts — not bodies of water
                        // you can walk to.
                        const layer = parseInt(feature.properties?.layer, 10);
                        if (Number.isFinite(layer) && layer <= -1) continue;

                        // Tag with waterway type so post-processing can apply
                        // per-type min-length floors.
                        const waterwayType = feature.properties?.waterway;
                        lineFeatures = [
                            {
                                ...feature,
                                properties: { waterway: waterwayType },
                            },
                        ];
                    } else {
                        continue;
                    }
                } else if (category.geometry === "polygon-to-ring") {
                    lineFeatures = featureToLineStrings(feature);
                } else {
                    // Coastline / high-speed-rail: pass-through LineString.
                    if (
                        feature.geometry.type === "LineString" ||
                        feature.geometry.type === "MultiLineString"
                    ) {
                        lineFeatures = [feature];
                    } else {
                        // Skip non-line geometry.
                        continue;
                    }
                }

                for (const lf of lineFeatures) {
                    if (category.geometry === "polygon-dissolve") {
                        if (
                            lf.geometry.type === "Polygon" ||
                            lf.geometry.type === "MultiPolygon"
                        ) {
                            // Store raw polygon geometry; dissolve + simplify
                            // happens in post-processing.
                            const bbox = computePolygonBbox(lf.geometry);
                            features.push({
                                type: "Feature",
                                bbox,
                                geometry: lf.geometry,
                                properties: {},
                            });
                        } else {
                            // Waterway centerline: split MultiLineStrings,
                            // store raw (un-simplified) so the shared-node
                            // stitcher sees full-resolution endpoints.
                            const lineStrings =
                                lf.geometry.type === "MultiLineString"
                                    ? lf.geometry.coordinates.map((coords) => ({
                                          type: "Feature",
                                          geometry: {
                                              type: "LineString",
                                              coordinates: coords,
                                          },
                                          properties: lf.properties ?? {},
                                      }))
                                    : [lf];
                            for (const ls of lineStrings) {
                                const bbox = computeBbox(
                                    ls.geometry.coordinates,
                                );
                                features.push({
                                    type: "Feature",
                                    bbox,
                                    geometry: ls.geometry,
                                    properties: {
                                        ...(lf.properties ?? {}),
                                    },
                                });
                            }
                        }
                        continue;
                    }

                    // Split MultiLineStrings into individual LineStrings.
                    const lineStrings =
                        lf.geometry.type === "MultiLineString"
                            ? lf.geometry.coordinates.map((coords) => ({
                                  type: "Feature",
                                  geometry: {
                                      type: "LineString",
                                      coordinates: coords,
                                  },
                                  properties: lf.properties ?? {},
                              }))
                            : [lf];

                    for (const ls of lineStrings) {
                        // High-speed-rail is simplified *after* stitching
                        // so the shared-node assembler sees full-resolution
                        // endpoints; every other category simplifies here.
                        const tolerance =
                            SIMPLIFY_TOLERANCES[category.key] ?? 0.0001;
                        const simplified =
                            category.key === "high-speed-rail"
                                ? ls
                                : simplifyFeature(ls, tolerance);
                        const bbox = computeBbox(
                            simplified.geometry.coordinates,
                        );

                        features.push({
                            type: "Feature",
                            bbox,
                            geometry: simplified.geometry,
                            properties: {},
                        });
                    }
                }
            }
        }

        console.log(`  Collected ${features.length.toLocaleString()} features`);

        // ── General post-processing (all categories) ─────────────────────

        const isPolygonDissolve = category.geometry === "polygon-dissolve";

        // Partition polygon-dissolve features into polygon and line subsets
        // before any post-processing. Polygons go through the existing
        // clean → min-length → dissolve pipeline; waterway centerlines go
        // through clean → stitch → min-length → simplify.
        let polyFeatures = [];
        let waterwayLineFeatures = [];
        if (isPolygonDissolve) {
            for (const f of features) {
                if (
                    f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon"
                ) {
                    polyFeatures.push(f);
                } else {
                    waterwayLineFeatures.push(f);
                }
            }
            if (waterwayLineFeatures.length > 0) {
                console.log(
                    `  [waterway] ${waterwayLineFeatures.length.toLocaleString()} line features ` +
                        `(rivers/canals/streams)`,
                );
            }
        }

        // 1. Strip consecutive duplicate coordinates.
        if (isPolygonDissolve) {
            // Polygon dissolve: clean rings, filter degenerate geometries.
            const cleaned = [];
            let droppedDegen = 0;
            for (const f of polyFeatures) {
                const c = cleanPolygonFeature(f);
                if (c) {
                    cleaned.push(c);
                } else {
                    droppedDegen++;
                }
            }
            if (droppedDegen > 0) {
                console.log(
                    `  cleanCoords: dropped ${droppedDegen} degenerate polygons`,
                );
            }
            polyFeatures = cleaned;
        } else {
            const dupPairsBefore = countDupPairs(features);
            for (const f of features) {
                const g = f.geometry;
                if (g.type === "LineString") {
                    g.coordinates = cleanCoordsInline(g.coordinates);
                } else if (g.type === "MultiLineString") {
                    g.coordinates = g.coordinates.map((seg) =>
                        cleanCoordsInline(seg),
                    );
                }
            }
            const dupPairsAfter = countDupPairs(features);
            if (dupPairsBefore > 0) {
                console.log(
                    `  cleanCoords: ${dupPairsBefore} dup-pairs → ${dupPairsAfter}`,
                );
            }
        }

        // 2. Drop features shorter than the category minimum.
        const minLen = MIN_FEATURE_LENGTH_M[category.key];
        if (minLen && minLen > 0) {
            if (isPolygonDissolve) {
                const before = polyFeatures.length;
                const kept = polyFeatures.filter(
                    (f) => polygonPerimeterMeters(f.geometry) >= minLen,
                );
                const dropped = before - kept.length;
                if (dropped > 0) {
                    console.log(
                        `  minLength: dropped ${dropped} polygon features < ${minLen}m ` +
                            `(${dropped} of ${before})`,
                    );
                }
                polyFeatures = kept;
            } else {
                const before = features.length;
                const kept = features.filter((f) => {
                    const coords = f.geometry.coordinates;
                    if (f.geometry.type === "LineString") {
                        return lineLengthMeters(coords) >= minLen;
                    }
                    // MultiLineString: sum of all segments.
                    let total = 0;
                    for (const seg of coords) {
                        total += lineLengthMeters(seg);
                    }
                    return total >= minLen;
                });
                const dropped = features.length - kept.length;
                if (dropped > 0) {
                    console.log(
                        `  minLength: dropped ${dropped} features < ${minLen}m ` +
                            `(${features.length - kept.length} of ${before})`,
                    );
                }
                features.length = 0;
                features.push(...kept);
            }
        }

        // 3. Recompute bboxes after coordinate changes.
        if (isPolygonDissolve) {
            for (const f of polyFeatures) {
                f.bbox = computePolygonBbox(f.geometry);
            }
        } else {
            for (const f of features) {
                f.bbox = computeBbox(f.geometry.coordinates);
            }
        }

        // ── Polygon dissolve post-processing ────────────────────────────
        if (isPolygonDissolve) {
            const tolerance = SIMPLIFY_TOLERANCES[category.key] ?? 0.0005;
            const dissolved = polygonDissolve(
                polyFeatures,
                extractBbox,
                tolerance,
                {
                    tileDeg: DISSOLVE_TILE_DEG,
                    overlapDeg: DISSOLVE_TILE_OVERLAP_DEG,
                },
            );
            features.length = 0;
            features.push(...dissolved);

            // ── Cross-tile polygon merge ───────────────────────────────
            // Per-tile dissolve clips to tile bounds, so adjacent tiles
            // produce different outlines for the same polygon in the
            // overlap zone. Merge all tile outputs into one clean polygon
            // to eliminate overlap artifacts. The merged result also serves
            // as the clipping reference for waterway centerlines.
            let mergedPolyCoords = null;
            if (features.length > 1) {
                const tMerge = Date.now();
                const mergedCoords = unionAllCoords(
                    features.map((f) => f.geometry.coordinates),
                );
                if (mergedCoords.length > 0) {
                    mergedPolyCoords = mergedCoords[0];
                    // Replace per-tile features with the merged result to
                    // eliminate overlap artifacts at tile boundaries.
                    const mergedFeat = {
                        type: "Feature",
                        bbox: computePolygonBbox({
                            type: "MultiPolygon",
                            coordinates: mergedPolyCoords,
                        }),
                        geometry: {
                            type: "MultiPolygon",
                            coordinates: mergedPolyCoords,
                        },
                        properties: {},
                    };
                    features.length = 0;
                    features.push(mergedFeat);
                }
                console.log(
                    `  [dissolve] cross-tile merge: → 1 merged polygon` +
                        ` (${((Date.now() - tMerge) / 1000).toFixed(1)}s)`,
                );
            } else if (features.length === 1) {
                mergedPolyCoords = features[0].geometry.coordinates;
            }

            // ── Waterway centerline post-processing ─────────────────────
            if (waterwayLineFeatures.length > 0) {
                const tLine0 = Date.now();

                // Clean consecutive duplicate coordinates.
                const dupPairsBefore = countDupPairs(waterwayLineFeatures);
                for (const f of waterwayLineFeatures) {
                    const g = f.geometry;
                    if (g.type === "LineString") {
                        g.coordinates = cleanCoordsInline(g.coordinates);
                    }
                }
                const dupPairsAfter = countDupPairs(waterwayLineFeatures);
                const dupMsg =
                    dupPairsBefore > 0
                        ? ` (${dupPairsBefore} dup-pairs → ${dupPairsAfter})`
                        : "";

                // Stitch fragmented OSM ways into continuous rivers via the
                // exact shared-node graph — same as HSR. Per-segment
                // min-length cannot punch gaps mid-river.
                const stitchedRaw = stitchSegments(waterwayLineFeatures, {
                    nodePrecision: NODE_PRECISION,
                    maxTurnCos: STITCH_MAX_TURN_COS,
                });
                const stitched = stitchedRaw.filter((f) => {
                    const c = f.geometry.coordinates;
                    return (
                        nodeKey(c[0], NODE_PRECISION) !==
                        nodeKey(c[c.length - 1], NODE_PRECISION)
                    );
                });
                const loopsDropped = stitchedRaw.length - stitched.length;
                console.log(
                    `  [waterway] clean${dupMsg}, ` +
                        `stitch: ${waterwayLineFeatures.length} → ${stitched.length} features` +
                        (loopsDropped
                            ? ` (${loopsDropped} degenerate loops dropped)`
                            : ""),
                );

                // Min-length filter per waterway type. River/canal want a
                // low floor (~100 m); stream wants a high floor to cull the
                // ~94 k minor streams.
                const longEnough = stitched.filter((f) => {
                    const ww = f.properties?.waterway;
                    const floor = WATERWAY_MIN_LENGTH[ww] ?? 500;
                    return lineLengthMeters(f.geometry.coordinates) >= floor;
                });
                if (longEnough.length < stitched.length) {
                    const byType = {};
                    for (const f of stitched) {
                        if (longEnough.includes(f)) continue;
                        const ww = f.properties?.waterway ?? "unknown";
                        byType[ww] = (byType[ww] ?? 0) + 1;
                    }
                    const detail = Object.entries(byType)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => `${k}:${v}`)
                        .join(", ");
                    console.log(
                        `  [waterway] minLength: ${stitched.length} → ${longEnough.length} features ` +
                            `(dropped ${stitched.length - longEnough.length}: ${detail})`,
                    );
                }

                // Simplify and recompute bboxes.
                const simplified = longEnough.map((f) =>
                    simplifyFeature(f, WATERWAY_LINE_SIMPLIFY),
                );
                for (const f of simplified) {
                    f.bbox = computeBbox(f.geometry.coordinates);
                }

                console.log(
                    `  [waterway] simplified ${simplified.length} features ` +
                        `(tol=${WATERWAY_LINE_SIMPLIFY}°), ` +
                        `total: ${((Date.now() - tLine0) / 1000).toFixed(1)}s`,
                );

                // Clip waterway lines at dissolved polygon boundaries.
                // Centerlines stop at the water-body edge with exact
                // intersection points — they don't flow through the
                // riverbank polygon and aren't crudely removed.
                if (mergedPolyCoords) {
                    const gridIdx = buildPolygonGrid(
                        mergedPolyCoords,
                        extractBbox,
                        0.05,
                    );
                    let clippedCount = 0;
                    let clippedSegments = 0;
                    const clipped = [];
                    for (const f of simplified) {
                        const segs = clipLineAtPolygon(
                            f.geometry.coordinates,
                            gridIdx,
                        );
                        if (segs.length === 0) {
                            clippedCount++;
                            continue;
                        }
                        if (segs.length === 1) {
                            const segBbox = computeBbox(segs[0]);
                            if (bboxesIntersect(segBbox, extractBbox)) {
                                clipped.push({
                                    ...f,
                                    geometry: {
                                        type: "LineString",
                                        coordinates: segs[0],
                                    },
                                    bbox: segBbox,
                                });
                            } else {
                                clippedCount++;
                            }
                        } else {
                            clippedCount++;
                            clippedSegments += segs.length;
                            for (const seg of segs) {
                                const segBbox = computeBbox(seg);
                                if (!bboxesIntersect(segBbox, extractBbox)) {
                                    clippedSegments--;
                                    continue;
                                }
                                clipped.push({
                                    type: "Feature",
                                    geometry: {
                                        type: "LineString",
                                        coordinates: seg,
                                    },
                                    properties: f.properties,
                                    bbox: segBbox,
                                });
                            }
                        }
                    }
                    if (clippedCount > 0) {
                        console.log(
                            `  [waterway] clip at polygon: ${simplified.length} → ` +
                                `${clipped.length} features ` +
                                `(${clippedCount} trimmed, ${clippedSegments} segments)`,
                        );
                    }
                    features.push(...clipped);
                } else {
                    features.push(...simplified);
                }
            }
        }

        // ── High-speed-rail post-processing ─────────────────────────────
        if (category.key === "high-speed-rail") {
            const t0 = Date.now();
            console.log(`  Stitching ${features.length} features...`);
            const stitchedRaw = stitchSegments(features, {
                nodePrecision: NODE_PRECISION,
                maxTurnCos: STITCH_MAX_TURN_COS,
            });
            // Drop degenerate loop ways (A→B→A) whose first and last node are
            // identical. These are OSM turnaround/siding artifacts that render
            // as out-and-back stubs rather than through-lines.
            const stitched = stitchedRaw.filter((f) => {
                const c = f.geometry.coordinates;
                return (
                    nodeKey(c[0], NODE_PRECISION) !==
                    nodeKey(c[c.length - 1], NODE_PRECISION)
                );
            });
            const loopsDropped = stitchedRaw.length - stitched.length;
            console.log(
                `  Stitched: ${features.length} → ${stitched.length} features` +
                    (loopsDropped
                        ? ` (${loopsDropped} degenerate loops dropped)`
                        : "") +
                    ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
            );

            // Drop assembled features shorter than 1 km. Isolated station
            // sidings or stub ways that didn't join a main corridor produce
            // short disconnected features that add noise to nearest-point
            // queries without contributing meaningful measurement geometry.
            const stitchedLong = stitched.filter(
                (f) =>
                    lineLengthMeters(f.geometry.coordinates) >=
                    HSR_MIN_ASSEMBLED_M,
            );
            if (stitchedLong.length < stitched.length) {
                console.log(
                    `  Post-stitch minLength: ${stitched.length} → ${stitchedLong.length} features` +
                        ` (dropped ${stitched.length - stitchedLong.length} stubs < ${HSR_MIN_ASSEMBLED_M}m)`,
                );
            }

            const t1 = Date.now();
            console.log(`  De-duplicating parallel tracks...`);
            const deduped = dedupeParallelTracks(stitchedLong, {
                maxLateralM: PARALLEL_MAX_LATERAL_M,
                minCosine: PARALLEL_MIN_COSINE,
                hugSamples: PARALLEL_HUG_SAMPLES,
            });
            console.log(
                `  De-duplicated: ${stitchedLong.length} → ${deduped.length} features ` +
                    `(${((Date.now() - t1) / 1000).toFixed(1)}s)`,
            );

            // Bridge any short collinear gaps left by real OSM coverage breaks.
            const bridged = bridgeCollinearGaps(deduped, {
                maxGapM: BRIDGE_MAX_GAP_M,
                minFacingCos: BRIDGE_MIN_FACING_COS,
            });
            console.log(
                `  Bridged collinear gaps: ${deduped.length} → ${bridged.length} features`,
            );

            // Re-simplify with coarser tolerance.
            const t2 = Date.now();
            // Re-simplify with a coarser tolerance than the initial pass.
            // The stitcher works on full-resolution shared nodes; this pass
            // removes extra vertices introduced by centerline computation.
            const resimplified = bridged.map((f) => simplifyFeature(f, 0.0002));
            // Recompute bboxes.
            for (const f of resimplified) {
                f.bbox = computeBbox(f.geometry.coordinates);
            }
            console.log(
                `  Re-simplified ${resimplified.length} features ` +
                    `(${((Date.now() - t2) / 1000).toFixed(1)}s)`,
            );

            // Fail loudly if the assembled line is discontinuous.
            validateLineContinuity(
                resimplified,
                extractBbox,
                CONTINUITY_DEFAULTS,
            );

            features.length = 0;
            features.push(...resimplified);
        }

        // Write bundle.
        const bundleSchemaVersion =
            category.geometry === "polygon-dissolve" ? 2 : 1;
        const bundle = {
            schemaVersion: bundleSchemaVersion,
            category: category.key,
            generatedAt,
            source: "japan-latest",
            extractBbox,
            attribution,
            features,
        };

        const artifactPath = resolve(outputDir, `${category.key}.json`);
        const serialized = JSON.stringify(bundle);
        await writeFile(artifactPath, serialized + "\n");
        const rawSize = Buffer.byteLength(serialized);
        const gzipped = gzipSync(serialized, { level: 9 });
        console.log(
            `  Wrote ${category.key}.json (${(rawSize / 1024 / 1024).toFixed(2)} MB raw, ${(gzipped.length / 1024 / 1024).toFixed(2)} MB gzip)`,
        );

        sizes[category.key] = {
            rawBytes: rawSize,
            gzipBytes: gzipped.length,
            featureCount: features.length,
        };
    }

    // Clean up admin temp dir.
    try {
        await rm(adminTmpDir, { recursive: true, force: true });
    } catch {
        // best-effort
    }

    // 4. Print summary.
    console.log(`\n=== Bundle Size Summary ===`);
    let totalRaw = 0;
    let totalGzip = 0;
    for (const [key, s] of Object.entries(sizes)) {
        console.log(
            `  ${key}: ${s.featureCount.toLocaleString()} features, ${(s.rawBytes / 1024 / 1024).toFixed(2)} MB raw, ${(s.gzipBytes / 1024 / 1024).toFixed(2)} MB gzip`,
        );
        totalRaw += s.rawBytes;
        totalGzip += s.gzipBytes;
    }
    console.log(
        `  TOTAL: ${(totalRaw / 1024 / 1024).toFixed(2)} MB raw, ${(totalGzip / 1024 / 1024).toFixed(2)} MB gzip`,
    );

    // 5. --check mode: diff against committed.
    if (checkMode) {
        await checkAgainstCommitted(outputDir, root);
    }
}

// ─── --check mode ─────────────────────────────────────────────────────────────

async function checkAgainstCommitted(tempDir, root) {
    const committedDir = resolve(root, "assets", "measuring");

    if (!existsSync(committedDir)) {
        console.error(
            "[check] assets/measuring/ does not exist. Run pnpm data:measuring without --check first to generate bundles.",
        );
        process.exitCode = 1;
        return;
    }

    let mismatch = false;
    const files = CATEGORIES.map((c) => `${c.key}.json`);

    for (const file of files) {
        const genPath = resolve(tempDir, file);
        const commPath = resolve(committedDir, file);

        let generated, committed;
        try {
            generated = await readFile(genPath, "utf8");
            committed = await readFile(commPath, "utf8");
        } catch (err) {
            console.error(`[check] Cannot compare ${file}: ${err.message}`);
            mismatch = true;
            continue;
        }

        try {
            const genObj = JSON.parse(generated);
            const comObj = JSON.parse(committed);

            // Compare structural equality (not whitespace).
            // Strip generatedAt since it always differs.
            genObj.generatedAt = "";
            comObj.generatedAt = "";

            if (JSON.stringify(genObj) !== JSON.stringify(comObj)) {
                console.error(
                    `[check] Mismatch in ${file}: generated differs from committed`,
                );
                mismatch = true;
            } else {
                console.log(`[check] ${file}: OK`);
            }
        } catch {
            if (generated !== committed) {
                console.error(`[check] Mismatch in ${file}`);
                mismatch = true;
            }
        }
    }

    if (mismatch) {
        throw new Error(
            "Measuring bundle artifacts differ from committed versions. Run pnpm data:measuring to regenerate.",
        );
    }

    // Clean up temp dir.
    await rm(tempDir, { recursive: true, force: true });
}

// Exported for unit/structural tests (the module runs `main` only when invoked
// directly via the guard below, so importing it has no side effects).
export {
    stitchSegments,
    validateLineContinuity,
    polygonDissolve,
    unionAllCoords,
    cleanPolygonFeature,
    simplifyPolygonFeature,
    polygonPerimeterMeters,
};

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

/**
 * Measuring artifact builder for the packs pipeline.
 *
 * For a region PBF, extracts each enabled measuring category and emits:
 *   dist/<region-id>/measuring-<category>.json.gz
 *
 * Reuses the shared extraction helpers from the Geofabrik pipeline
 * (postFilters, geometryCleanup, lineStitching, polygonDissolve) and
 * the category definitions from data/geofabrik/config.yaml.
 *
 * @module buildMeasuring
 */

/* global console */

import { execFileSync } from "node:child_process";
import {
    createReadStream,
    existsSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import YAML from "yaml";

import { applyPostFilter } from "../../../geofabrik/scripts/lib/postFilters.mjs";
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
    simplifyFeature,
} from "../../../geofabrik/scripts/lib/geometryCleanup.mjs";
import {
    stitchSegments,
    dedupeParallelTracks,
    bridgeCollinearGaps,
    validateLineContinuity,
    nodeKey,
    lineLengthMeters,
} from "../../../geofabrik/scripts/lib/lineStitching.mjs";
import {
    polygonDissolve,
    polygonDissolveParallel,
    geosUnaryUnionCoords,
    buildPolygonGrid,
    bucketPolygonsToGridFeatures,
    filterTinyPolygons,
    clipLineAtPolygon,
} from "../../../geofabrik/scripts/lib/polygonDissolve.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packsDir = resolve(scriptDir, "..", "..");
const geofabrikDir = resolve(packsDir, "..", "..", "data", "geofabrik");
const configPath = resolve(geofabrikDir, "config.yaml");

// ─── Config ────────────────────────────────────────────────────────────────────

/** Full geofabrik config, read once at module load. */
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

const SIMPLIFY_TOLERANCES = Object.fromEntries(
    CATEGORIES.map((c) => [c.key, c.simplifyTolerance]),
);

const MIN_FEATURE_LENGTH_M = Object.fromEntries(
    CATEGORIES.map((c) => [c.key, c.minFeatureLengthM]),
);

// ─── Algorithm tuning constants (from config) ──────────────────────────────

const WATERWAY_LINE_SIMPLIFY = _m.waterwayLineSimplify ?? 0.001;
const DISSOLVE_TILE_DEG = _m.dissolve?.tileDeg ?? 0.25;
const DISSOLVE_TILE_OVERLAP_DEG = _m.dissolve?.overlapDeg ?? 0.01;
/**
 * Grid cell size for re-tiling dissolved water into many small emitted features
 * (instead of 1–2 region-spanning MultiPolygons). The runtime windows buffer
 * input by feature bbox, so small features keep each buffer op local — avoiding
 * the body-of-water masking notch. See bucketPolygonsToGridFeatures.
 */
const WATER_EMIT_CELL_DEG = _m.dissolve?.emitCellDeg ?? 0.1;
/**
 * Drop dissolved water-area members below this area (m²). Aimed at **degenerate
 * slivers** — the dissolve + per-ring simplification can collapse a thin water
 * strip into a near-zero-area polygon that, when buffered, MakeValid-recovers
 * into a spurious circular blob in the mask. Real water (ponds, lakes, river
 * channels) is far larger and survives; narrow rivers are independently covered
 * by waterway centerlines. Default 100 m² removes only collapsed slivers.
 */
const MIN_WATER_POLYGON_AREA_M2 = _m.dissolve?.minWaterPolygonAreaM2 ?? 100;
/** Skip union (pass-through) when input exceeds this many polygons. */
const DISSOLVE_MAX_UNION_POLYGONS = _m.dissolve?.maxUnionPolygons;
/** Skip union (pass-through) when input exceeds this many total coords. */
const DISSOLVE_MAX_UNION_COORDS = _m.dissolve?.maxUnionCoords;
/** Wall-clock budget per parallel shard (ms); SIGKILL + forceSkipUnion retry. */
const DISSOLVE_SHARD_TIMEOUT_MS = _m.dissolve?.shardTimeoutMs;
const NODE_PRECISION = _m.stitching?.nodePrecision ?? 7;
const STITCH_MAX_TURN_COS = _m.stitching?.maxTurnCos ?? -0.5;
const PARALLEL_MAX_LATERAL_M = _m.parallelDedup?.maxLateralM ?? 30;
const PARALLEL_MIN_COSINE = _m.parallelDedup?.minCosine ?? 0.966;
const PARALLEL_HUG_SAMPLES = _m.parallelDedup?.hugSamples ?? 80;
const BRIDGE_MAX_GAP_M = _m.bridge?.maxGapM ?? 1500;
const BRIDGE_MIN_FACING_COS = _m.bridge?.minFacingCos ?? 0.95;
const HSR_MIN_ASSEMBLED_M = _m.hsr?.minAssembledM ?? 1000;
const WATERWAY_MIN_LENGTH = _m.waterway?.minLength ?? {
    river: 100,
    canal: 100,
    stream: 500,
};
const CONTINUITY_DEFAULTS = _m.continuity ?? {
    maxComponents: 40,
    maxHoles: 8,
    minFeatureLenM: 1000,
    holeMinM: 40,
    holeMaxM: 2500,
    joinTolM: 25,
    edgeMarginDeg: 0.02,
};

// ─── Attribution block ──────────────────────────────────────────────────────

const attribution = {
    text: "© OpenStreetMap contributors, Data available under the Open Database License (ODbL). Geofabrik extract from download.geofabrik.de.",
    license: "ODbL",
    notice: "See data/geofabrik/NOTICE.md for full attribution and license information.",
    url: "https://www.openstreetmap.org/copyright",
};

// ─── Default post-filter dispatch ───────────────────────────────────────────

/**
 * Determine whether a feature should be included for a category,
 * applying the configured postFilter.
 */
function passesPostFilter(categoryDef, tags) {
    if (!categoryDef.postFilter) return true;
    return applyPostFilter(categoryDef, tags);
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Build measuring artifacts for a region.
 *
 * @param {object} options
 * @param {object} options.region - Region config entry from regions.yaml
 * @param {string} options.pbfPath - Path to the cached region PBF
 * @param {string} options.distDir - Output dist/<region-id>/ directory
 * @param {Bbox} options.bbox - Region bounding box [w, s, e, n]
 * @returns {Promise<{artifacts: Map<string, {gzPath: string, uncompressed: Buffer}>, categories: string[]}>}
 *   Map of "measuring-<category>" to {gzPath, uncompressed}, plus the list of
 *   non-empty category keys.
 */
export async function buildMeasuringArtifact({
    region,
    pbfPath,
    distDir,
    bbox,
    jobs = 1,
}) {
    const measuringOverrides = region.measuringOverrides ?? {};
    const generatedAt = new Date().toISOString();

    // Resolve bbox: parameter > region config > osmium fileinfo.
    let extractBbox = bbox ?? region.bbox ?? null;
    if (!extractBbox) {
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
                    extractBbox = [west, south, east, north];
                }
            }
        } catch {
            // osmium fileinfo may fail.
        }
    }
    if (!extractBbox) {
        throw new Error(
            `Cannot determine bbox for ${region.id}: provide bbox in region config, ` +
                `pass as parameter, or ensure osmium fileinfo works on the PBF`,
        );
    }

    const artifacts = new Map();
    const emittedCategories = [];

    // Determine which categories to process.
    const categories = CATEGORIES.filter((catDef) => {
        const overrides = measuringOverrides[catDef.key];
        if (overrides && overrides.enabled === false) {
            console.log(
                `  [measuring/${catDef.key}] disabled by region override`,
            );
            return false;
        }
        return true;
    });

    // Shared admin extraction (for admin-1st-border, admin-2nd-border).
    const adminTmpDir = join(
        (await import("node:os")).tmpdir(),
        `packs-measuring-admin-${Date.now()}`,
    );
    await mkdir(adminTmpDir, { recursive: true });
    const adminSeqPath = join(adminTmpDir, "admin-boundaries.seq");
    let adminSeqExists = false;

    try {
        for (const catDef of categories) {
            console.log(`  [measuring/${catDef.key}] extracting...`);

            const overrides = measuringOverrides[catDef.key] ?? {};

            // Determine osmium filter expression.
            const osmiumFilter = overrides.osmiumFilter ?? catDef.osmiumFilter;

            // Determine post-filter.  Admin-border categories use the
            // region's actual matching levels, not hardcoded 4/7 (R3).
            let postFilterName = overrides.postFilter ?? catDef.postFilter;
            if (catDef.key === "admin-1st-border" && !overrides.postFilter) {
                const lv = region.adminLevels?.matching?.[0];
                if (lv != null) postFilterName = `admin-${lv}`;
            } else if (
                catDef.key === "admin-2nd-border" &&
                !overrides.postFilter
            ) {
                const lv = region.adminLevels?.matching?.[1];
                if (lv != null) postFilterName = `admin-${lv}`;
            }
            const effectiveCatDef = { ...catDef, postFilter: postFilterName };

            // --- Step 1: osmium tags-filter ---
            let seqPath;
            if (
                catDef.key === "admin-1st-border" ||
                catDef.key === "admin-2nd-border" ||
                catDef.key === "admin-boundaries"
            ) {
                // Admin boundaries share a three-step pipeline.
                if (!adminSeqExists) {
                    console.log(
                        `  [measuring/admin] Filtering r/boundary=administrative...`,
                    );
                    const adminRelsPbf = join(
                        adminTmpDir,
                        "admin-rels-only.osm.pbf",
                    );
                    execFileSync(
                        "osmium",
                        [
                            "tags-filter",
                            pbfPath,
                            "r/boundary=administrative",
                            "-o",
                            adminRelsPbf,
                            "-O",
                        ],
                        { stdio: "inherit" },
                    );

                    console.log(
                        `  [measuring/admin] Extracting relation IDs...`,
                    );
                    const idsPath = join(adminTmpDir, "admin-rel-ids.txt");
                    const { execSync } = await import("node:child_process");
                    const opl = execSync(
                        `osmium cat "${adminRelsPbf}" -f opl`,
                        { maxBuffer: 512 * 1024 * 1024 },
                    ).toString();
                    const ids = [];
                    for (const line of opl.split("\n")) {
                        if (!line.startsWith("r")) continue;
                        ids.push(line.split(" ")[0]);
                    }
                    writeFileSync(idsPath, ids.join("\n") + "\n");
                    console.log(
                        `  [measuring/admin] Found ${ids.length} relation IDs`,
                    );

                    console.log(
                        `  [measuring/admin] Pulling in member ways with getid -r...`,
                    );
                    const adminCompletePbf = join(
                        adminTmpDir,
                        "admin-complete.osm.pbf",
                    );
                    try {
                        execFileSync(
                            "osmium",
                            [
                                "getid",
                                pbfPath,
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
                            `  [measuring/admin] getid reported missing objects ` +
                                `— continuing`,
                        );
                    }

                    console.log(`  [measuring/admin] Exporting to GeoJSON...`);
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
                seqPath = adminSeqPath;
            } else {
                // Standard tags-filter for non-admin categories.
                const tmpDir = join(
                    (await import("node:os")).tmpdir(),
                    `packs-measuring-${catDef.key}-${Date.now()}`,
                );
                await mkdir(tmpDir, { recursive: true });
                const pbfPathFiltered = join(tmpDir, `${catDef.key}.osm.pbf`);

                execFileSync(
                    "osmium",
                    [
                        "tags-filter",
                        pbfPath,
                        ...osmiumFilter.split(" "),
                        "-o",
                        pbfPathFiltered,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );

                // Export to GeoJSONSeq.
                seqPath = join(tmpDir, `${catDef.key}.seq`);
                console.log(
                    `  [measuring/${catDef.key}] Exporting to GeoJSONSeq...`,
                );
                execFileSync(
                    "osmium",
                    [
                        "export",
                        pbfPathFiltered,
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

            // --- Step 2: Process features ---
            console.log(`  [measuring/${catDef.key}] Processing features...`);
            const features = [];

            const isAdmin =
                catDef.key === "admin-1st-border" ||
                catDef.key === "admin-2nd-border" ||
                catDef.key === "admin-boundaries";

            if (isAdmin) {
                // Admin: read the assembled GeoJSON FeatureCollection.
                const raw = readFileSync(seqPath, "utf8");
                const fc = JSON.parse(raw);

                for (const feature of fc.features ?? []) {
                    if (
                        feature.properties?.["@type"] !== "relation" ||
                        !passesPostFilter(
                            effectiveCatDef,
                            feature.properties ?? {},
                        )
                    ) {
                        continue;
                    }

                    if (catDef.geometry === "polygon") {
                        // polygon mode: keep full Polygon/MultiPolygon.
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
                            SIMPLIFY_TOLERANCES[catDef.key] ?? 0.0001;
                        const simplified = simplifyPolygonFeature(
                            cleaned,
                            tolerance,
                        );
                        if (!simplified) continue;

                        const bbox2 = computePolygonBbox(simplified.geometry);
                        features.push({
                            type: "Feature",
                            bbox: bbox2,
                            geometry: simplified.geometry,
                            properties: props,
                        });
                    } else {
                        // polygon-to-ring mode: extract boundary rings.
                        const props = {
                            relationId: Number(feature.properties["@id"]),
                        };
                        for (const k of ["name", "name:en"]) {
                            if (feature.properties[k] != null) {
                                props[k] = feature.properties[k];
                            }
                        }

                        const lineFeatures = featureToLineStrings(feature);
                        for (const lf of lineFeatures) {
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
                                    SIMPLIFY_TOLERANCES[catDef.key] ?? 0.0001;
                                const simplified2 = simplifyFeature(
                                    ls,
                                    tolerance,
                                );
                                const bbox2 = computeBbox(
                                    simplified2.geometry.coordinates,
                                );
                                features.push({
                                    type: "Feature",
                                    bbox: bbox2,
                                    geometry: simplified2.geometry,
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
                    if (
                        !passesPostFilter(
                            effectiveCatDef,
                            feature.properties ?? {},
                        )
                    ) {
                        continue;
                    }

                    // Convert polygon to outer-ring LineString, or keep as polygon.
                    let lineFeatures;
                    if (catDef.geometry === "polygon-dissolve") {
                        if (
                            feature.geometry.type === "Polygon" ||
                            feature.geometry.type === "MultiPolygon"
                        ) {
                            lineFeatures = [feature];
                        } else if (
                            feature.geometry.type === "LineString" ||
                            feature.geometry.type === "MultiLineString"
                        ) {
                            const layer = parseInt(
                                feature.properties?.layer,
                                10,
                            );
                            if (Number.isFinite(layer) && layer <= -1) continue;
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
                    } else if (catDef.geometry === "polygon-to-ring") {
                        lineFeatures = featureToLineStrings(feature);
                    } else {
                        // pass-through LineString.
                        if (
                            feature.geometry.type === "LineString" ||
                            feature.geometry.type === "MultiLineString"
                        ) {
                            lineFeatures = [feature];
                        } else {
                            continue;
                        }
                    }

                    for (const lf of lineFeatures) {
                        if (catDef.geometry === "polygon-dissolve") {
                            if (
                                lf.geometry.type === "Polygon" ||
                                lf.geometry.type === "MultiPolygon"
                            ) {
                                const bbox2 = computePolygonBbox(lf.geometry);
                                features.push({
                                    type: "Feature",
                                    bbox: bbox2,
                                    geometry: lf.geometry,
                                    properties: {},
                                });
                            } else {
                                const lineStrings =
                                    lf.geometry.type === "MultiLineString"
                                        ? lf.geometry.coordinates.map(
                                              (coords) => ({
                                                  type: "Feature",
                                                  geometry: {
                                                      type: "LineString",
                                                      coordinates: coords,
                                                  },
                                                  properties:
                                                      lf.properties ?? {},
                                              }),
                                          )
                                        : [lf];
                                for (const ls of lineStrings) {
                                    const bbox2 = computeBbox(
                                        ls.geometry.coordinates,
                                    );
                                    features.push({
                                        type: "Feature",
                                        bbox: bbox2,
                                        geometry: ls.geometry,
                                        properties: {
                                            ...(lf.properties ?? {}),
                                        },
                                    });
                                }
                            }
                            continue;
                        }

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
                            const tolerance =
                                SIMPLIFY_TOLERANCES[catDef.key] ?? 0.0001;
                            const simplified =
                                catDef.key === "high-speed-rail"
                                    ? ls
                                    : simplifyFeature(ls, tolerance);
                            const bbox2 = computeBbox(
                                simplified.geometry.coordinates,
                            );
                            features.push({
                                type: "Feature",
                                bbox: bbox2,
                                geometry: simplified.geometry,
                                properties: {},
                            });
                        }
                    }
                }
            }

            console.log(
                `  [measuring/${catDef.key}] Collected ${features.length.toLocaleString()} features`,
            );

            // If no features, skip this category entirely.
            if (features.length === 0) {
                console.log(
                    `  [measuring/${catDef.key}] No features — skipping`,
                );
                continue;
            }

            // ── General post-processing ─────────────────────────────────────

            const isPolygonDissolve = catDef.geometry === "polygon-dissolve";

            // Partition polygon-dissolve features.
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
                        `  [measuring/${catDef.key}] [waterway] ${waterwayLineFeatures.length.toLocaleString()} line features`,
                    );
                }
            }

            // 1. Strip consecutive duplicate coordinates.
            if (isPolygonDissolve) {
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
                        `  [measuring/${catDef.key}] cleanCoords: dropped ${droppedDegen} degenerate polygons`,
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
                        `  [measuring/${catDef.key}] cleanCoords: ${dupPairsBefore} dup-pairs → ${dupPairsAfter}`,
                    );
                }
            }

            // 2. Drop features shorter than the category minimum.
            const minLen = MIN_FEATURE_LENGTH_M[catDef.key];
            if (minLen && minLen > 0) {
                if (isPolygonDissolve) {
                    const before = polyFeatures.length;
                    const kept = polyFeatures.filter(
                        (f) => polygonPerimeterMeters(f.geometry) >= minLen,
                    );
                    const dropped = before - kept.length;
                    if (dropped > 0) {
                        console.log(
                            `  [measuring/${catDef.key}] minLength: dropped ${dropped} polygon features < ${minLen}m`,
                        );
                    }
                    polyFeatures = kept;
                } else {
                    const kept = features.filter((f) => {
                        const coords = f.geometry.coordinates;
                        if (f.geometry.type === "LineString") {
                            return lineLengthMeters(coords) >= minLen;
                        }
                        let total = 0;
                        for (const seg of coords) {
                            total += lineLengthMeters(seg);
                        }
                        return total >= minLen;
                    });
                    const dropped = features.length - kept.length;
                    if (dropped > 0) {
                        console.log(
                            `  [measuring/${catDef.key}] minLength: dropped ${dropped} features < ${minLen}m`,
                        );
                    }
                    features.length = 0;
                    features.push(...kept);
                }
            }

            // If all features were dropped by min-length filter, skip.
            const totalFeatures = isPolygonDissolve
                ? polyFeatures.length
                : features.length;
            if (totalFeatures === 0) {
                console.log(
                    `  [measuring/${catDef.key}] No features after min-length — skipping`,
                );
                continue;
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
                const tolerance = SIMPLIFY_TOLERANCES[catDef.key] ?? 0.0005;
                // Per-region dissolve tuning: water-dense regions (e.g. the
                // Netherlands) can shrink the tile to cut peak polyclip-ts
                // memory/time on tiles that fall back from GEOS.
                const tileDeg =
                    overrides.dissolve?.tileDeg ?? DISSOLVE_TILE_DEG;
                const overlapDeg =
                    overrides.dissolve?.overlapDeg ?? DISSOLVE_TILE_OVERLAP_DEG;
                // Shard the (independent) dissolve tiles across child processes
                // when --jobs > 1: faster, and each shard's heap is isolated.
                const dissolveOpts = {
                    tileDeg,
                    overlapDeg,
                    maxUnionPolygons:
                        overrides.dissolve?.maxUnionPolygons ??
                        DISSOLVE_MAX_UNION_POLYGONS,
                    maxUnionCoords:
                        overrides.dissolve?.maxUnionCoords ??
                        DISSOLVE_MAX_UNION_COORDS,
                };
                const dissolved =
                    jobs > 1
                        ? await polygonDissolveParallel(
                              polyFeatures,
                              extractBbox,
                              tolerance,
                              {
                                  ...dissolveOpts,
                                  jobs,
                                  shardTimeoutMs:
                                      overrides.dissolve?.shardTimeoutMs ??
                                      DISSOLVE_SHARD_TIMEOUT_MS,
                              },
                          )
                        : polygonDissolve(
                              polyFeatures,
                              extractBbox,
                              tolerance,
                              dissolveOpts,
                          );
                features.length = 0;
                for (const f of dissolved) features.push(f);

                // Cross-tile polygon assembly.
                //
                // The parallel path (jobs > 1) returns band blobs already
                // clipped to disjoint band rectangles — they tile the extract
                // edge-to-edge with no interior overlap, so we keep them as
                // separate (valid) features and only concatenate their polygons
                // to build the waterway-clipping grid. This skips the
                // whole-region GEOS/polyclip-ts union, which is what OOMs on
                // water-dense regions (e.g. the Netherlands).
                //
                // The sequential path (jobs === 1) still emits overlapping tile
                // features, so it must union them to become valid.
                let mergedPolyCoords = null;
                if (jobs > 1) {
                    const allPolys = [];
                    for (const f of features) {
                        const g = f.geometry;
                        if (g.type === "MultiPolygon") {
                            for (const poly of g.coordinates)
                                allPolys.push(poly);
                        } else if (g.type === "Polygon") {
                            allPolys.push(g.coordinates);
                        }
                    }
                    mergedPolyCoords = allPolys.length > 0 ? allPolys : null;
                    console.log(
                        `  [measuring/${catDef.key}] [dissolve] band-partition: ` +
                            `kept ${features.length} disjoint blob(s) ` +
                            `(no cross-tile union)`,
                    );
                } else if (features.length > 1) {
                    const tMerge = Date.now();
                    const mergedCoords = geosUnaryUnionCoords(
                        features.map((f) => f.geometry.coordinates),
                        {
                            maxUnionPolygons: dissolveOpts.maxUnionPolygons,
                            maxUnionCoords: dissolveOpts.maxUnionCoords,
                        },
                    );
                    if (mergedCoords.length > 0) {
                        mergedPolyCoords = mergedCoords[0];
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
                        `  [measuring/${catDef.key}] [dissolve] cross-tile merge: → 1 merged polygon` +
                            ` (${((Date.now() - tMerge) / 1000).toFixed(1)}s)`,
                    );
                } else if (features.length === 1) {
                    mergedPolyCoords = features[0].geometry.coordinates;
                }

                // Drop degenerate sliver members (collapsed by dissolve +
                // simplification): their buffer MakeValid-recovers into a
                // spurious circular blob in the mask. Real water survives; narrow
                // rivers are covered by waterway centerlines. Applied before both
                // the emitted features and the waterway-clip grid below.
                if (mergedPolyCoords && MIN_WATER_POLYGON_AREA_M2 > 0) {
                    const before = mergedPolyCoords.length;
                    const { kept, dropped } = filterTinyPolygons(
                        mergedPolyCoords,
                        MIN_WATER_POLYGON_AREA_M2,
                    );
                    mergedPolyCoords = kept.length > 0 ? kept : null;
                    if (dropped > 0) {
                        console.log(
                            `  [measuring/${catDef.key}] [dissolve] drop slivers: ` +
                                `${before} → ${kept.length} members ` +
                                `(${dropped} < ${MIN_WATER_POLYGON_AREA_M2}m²)`,
                        );
                    }
                }

                // Re-tile the dissolved water into many small features.
                //
                // The dissolve fuses water into 1–2 region-spanning
                // MultiPolygons. The runtime selects buffer input by *feature
                // bbox*, so such a feature is always selected and buffered whole
                // (~100k coords) — which over-simplifies and self-intersects into
                // the body-of-water masking notch. Bucketing the dissolved member
                // polygons into a coarse grid (whole members, no cuts) restores
                // effective windowing; the runtime unions the per-feature buffers,
                // so touching/overlapping pieces are fine. The waterway-clip grid
                // still uses the un-bucketed `mergedPolyCoords` below.
                if (mergedPolyCoords && mergedPolyCoords.length > 0) {
                    const bucketed = bucketPolygonsToGridFeatures(
                        mergedPolyCoords,
                        WATER_EMIT_CELL_DEG,
                    );
                    features.length = 0;
                    features.push(...bucketed);
                    console.log(
                        `  [measuring/${catDef.key}] [dissolve] emit re-tile: ` +
                            `${mergedPolyCoords.length} member polygon(s) → ` +
                            `${bucketed.length} grid feature(s) ` +
                            `(${WATER_EMIT_CELL_DEG}° cells)`,
                    );
                }

                // Waterway centerline post-processing.
                if (waterwayLineFeatures.length > 0) {
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
                        `  [measuring/${catDef.key}] [waterway] clean${dupMsg}, ` +
                            `stitch: ${waterwayLineFeatures.length} → ${stitched.length} features` +
                            (loopsDropped
                                ? ` (${loopsDropped} degenerate loops dropped)`
                                : ""),
                    );

                    const longEnough = stitched.filter((f) => {
                        const ww = f.properties?.waterway;
                        const floor = WATERWAY_MIN_LENGTH[ww] ?? 500;
                        return (
                            lineLengthMeters(f.geometry.coordinates) >= floor
                        );
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
                            `  [measuring/${catDef.key}] [waterway] minLength: ${stitched.length} → ${longEnough.length} features` +
                                ` (dropped ${stitched.length - longEnough.length}: ${detail})`,
                        );
                    }

                    const simplified = longEnough.map((f) =>
                        simplifyFeature(f, WATERWAY_LINE_SIMPLIFY),
                    );
                    for (const f of simplified) {
                        f.bbox = computeBbox(f.geometry.coordinates);
                    }

                    console.log(
                        `  [measuring/${catDef.key}] [waterway] simplified ${simplified.length} features ` +
                            `(tol=${WATERWAY_LINE_SIMPLIFY}°)`,
                    );

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
                                    if (
                                        !bboxesIntersect(segBbox, extractBbox)
                                    ) {
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
                                `  [measuring/${catDef.key}] [waterway] clip at polygon: ${simplified.length} → ` +
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
            if (catDef.key === "high-speed-rail") {
                const t0 = Date.now();
                console.log(
                    `  [measuring/${catDef.key}] Stitching ${features.length} features...`,
                );
                const stitchedRaw = stitchSegments(features, {
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
                    `  [measuring/${catDef.key}] Stitched: ${features.length} → ${stitched.length} features` +
                        (loopsDropped
                            ? ` (${loopsDropped} degenerate loops dropped)`
                            : "") +
                        ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
                );

                const stitchedLong = stitched.filter(
                    (f) =>
                        lineLengthMeters(f.geometry.coordinates) >=
                        HSR_MIN_ASSEMBLED_M,
                );
                if (stitchedLong.length < stitched.length) {
                    console.log(
                        `  [measuring/${catDef.key}] Post-stitch minLength: ${stitched.length} → ${stitchedLong.length} features` +
                            ` (dropped ${stitched.length - stitchedLong.length} stubs < ${HSR_MIN_ASSEMBLED_M}m)`,
                    );
                }

                const t1 = Date.now();
                console.log(
                    `  [measuring/${catDef.key}] De-duplicating parallel tracks...`,
                );
                const deduped = dedupeParallelTracks(stitchedLong, {
                    maxLateralM: PARALLEL_MAX_LATERAL_M,
                    minCosine: PARALLEL_MIN_COSINE,
                    hugSamples: PARALLEL_HUG_SAMPLES,
                });
                console.log(
                    `  [measuring/${catDef.key}] De-duplicated: ${stitchedLong.length} → ${deduped.length} features` +
                        ` (${((Date.now() - t1) / 1000).toFixed(1)}s)`,
                );

                const bridged = bridgeCollinearGaps(deduped, {
                    maxGapM: BRIDGE_MAX_GAP_M,
                    minFacingCos: BRIDGE_MIN_FACING_COS,
                });
                console.log(
                    `  [measuring/${catDef.key}] Bridged collinear gaps: ${deduped.length} → ${bridged.length} features`,
                );

                const resimplified = bridged.map((f) =>
                    simplifyFeature(f, 0.0002),
                );
                for (const f of resimplified) {
                    f.bbox = computeBbox(f.geometry.coordinates);
                }
                console.log(
                    `  [measuring/${catDef.key}] Re-simplified ${resimplified.length} features`,
                );

                validateLineContinuity(
                    resimplified,
                    extractBbox,
                    CONTINUITY_DEFAULTS,
                );

                features.length = 0;
                features.push(...resimplified);
            }

            // If we ended up with zero features after full processing, skip.
            if (features.length === 0) {
                console.log(
                    `  [measuring/${catDef.key}] No features after full processing — skipping`,
                );
                continue;
            }

            // --- Step 3: Write bundle ---
            const bundleSchemaVersion =
                catDef.geometry === "polygon-dissolve" ? 2 : 1;
            const bundle = {
                schemaVersion: bundleSchemaVersion,
                category: catDef.key,
                generatedAt,
                source: region.pbfUrl,
                extractBbox,
                attribution,
                features,
            };

            const artifactName = `measuring-${catDef.key}`;
            const artifactPath = resolve(distDir, `${artifactName}.json.gz`);
            const serialized = JSON.stringify(bundle);
            const gzipped = gzipSync(serialized, { level: 9 });

            await writeFile(artifactPath, gzipped);
            const rawSize = Buffer.byteLength(serialized);
            console.log(
                `  [measuring/${catDef.key}] Wrote ${artifactName}.json.gz` +
                    ` (${(rawSize / 1024 / 1024).toFixed(2)} MB raw, ` +
                    `${(gzipped.length / 1024 / 1024).toFixed(2)} MB gzip)` +
                    ` — ${features.length.toLocaleString()} features`,
            );

            artifacts.set(artifactName, {
                gzPath: artifactPath,
                uncompressed: Buffer.from(serialized, "utf8"),
            });
            emittedCategories.push(catDef.key);
        }
    } finally {
        // Clean up admin temp dir.
        try {
            await rm(adminTmpDir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    }

    return { artifacts, categories: emittedCategories };
}

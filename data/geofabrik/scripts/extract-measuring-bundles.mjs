/* global console, process, fetch */

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const geofabrikDir = resolve(scriptDir, "..");
const configPath = resolve(geofabrikDir, "config.yaml");
const root = resolve(geofabrikDir, "..", "..");

// ─── Category definitions ────────────────────────────────────────────────────

const CATEGORIES = [
    {
        key: "coastline",
        osmiumFilter: "w/natural=coastline",
        postFilter: null,
        geometry: "pass",
    },
    {
        key: "high-speed-rail",
        osmiumFilter: "w/railway=rail",
        postFilter: "high-speed",
        geometry: "pass",
    },
    {
        key: "body-of-water",
        osmiumFilter:
            "w/natural=water r/natural=water w/landuse=basin w/waterway=riverbank",
        postFilter: null,
        geometry: "polygon-to-ring",
    },
    {
        key: "admin-1st-border",
        osmiumFilter: "r/boundary=administrative",
        postFilter: "admin-4",
        geometry: "polygon-to-ring",
    },
    {
        key: "admin-2nd-border",
        osmiumFilter: "r/boundary=administrative",
        postFilter: "admin-7",
        geometry: "polygon-to-ring",
    },
];

// ─── Simplify tolerances (degrees) ────────────────────────────────────────────

const SIMPLIFY_TOLERANCES = {
    "high-speed-rail": 0.0001,
    coastline: 0.0005,
    "body-of-water": 0.0005,
    "admin-1st-border": 0.0003,
    "admin-2nd-border": 0.0003,
};

// ─── Post-filter predicates ───────────────────────────────────────────────────

function highSpeedPostFilter(tags) {
    if (tags.highspeed === "yes") return true;
    const ms = parseInt(tags.maxspeed, 10);
    return Number.isFinite(ms) && ms >= 200;
}

function adminLevelPostFilter(tags, level) {
    return tags.admin_level === String(level);
}

function applyPostFilter(category, tags) {
    switch (category.postFilter) {
        case "high-speed":
            return highSpeedPostFilter(tags);
        case "admin-4":
            return adminLevelPostFilter(tags, 4);
        case "admin-7":
            return adminLevelPostFilter(tags, 7);
        default:
            return true;
    }
}

// ─── Geometry conversion (polygon → outer-ring LineString) ──────────────────

function featureToLineStrings(feature) {
    const { type, coordinates } = feature.geometry;
    if (type === "LineString" || type === "MultiLineString") return [feature];

    const lines = [];
    const pushRing = (ring) => {
        if (ring.length < 4) return; // skip degenerate rings
        lines.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: ring },
            properties: {},
        });
    };

    // Outer ring is coordinates[0]; holes (coordinates[1..]) are skipped.
    if (type === "Polygon") {
        pushRing(coordinates[0]);
    } else if (type === "MultiPolygon") {
        for (const poly of coordinates) pushRing(poly[0]);
    }
    return lines;
}

// ─── Bbox computation ────────────────────────────────────────────────────────

function computeBbox(coords) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walk = (c) => {
        if (typeof c[0] === "number") {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
        } else c.forEach(walk);
    };
    walk(coords);
    return [minX, minY, maxX, maxY];
}

// ─── Simplification ──────────────────────────────────────────────────────────

function simplifyCoords(coords, tolerance) {
    // Ramer-Douglas-Peucker simplification.
    if (coords.length <= 2) return coords;

    const sqTolerance = tolerance * tolerance;

    function findFarthest(points) {
        let maxDist = 0;
        let maxIdx = 0;
        const first = points[0];
        const last = points[points.length - 1];
        const dx = last[0] - first[0];
        const dy = last[1] - first[1];
        const lenSq = dx * dx + dy * dy;

        for (let i = 1; i < points.length - 1; i++) {
            let dist;
            if (lenSq === 0) {
                const dxi = points[i][0] - first[0];
                const dyi = points[i][1] - first[1];
                dist = dxi * dxi + dyi * dyi;
            } else {
                let t =
                    ((points[i][0] - first[0]) * dx +
                        (points[i][1] - first[1]) * dy) /
                    lenSq;
                if (t < 0) t = 0;
                if (t > 1) t = 1;
                const px = first[0] + t * dx;
                const py = first[1] + t * dy;
                const dxi = points[i][0] - px;
                const dyi = points[i][1] - py;
                dist = dxi * dxi + dyi * dyi;
            }
            if (dist > maxDist) {
                maxDist = dist;
                maxIdx = i;
            }
        }
        return { index: maxIdx, dist: maxDist };
    }

    function simplify(points) {
        const { index, dist } = findFarthest(points);
        if (dist > sqTolerance) {
            const left = simplify(points.slice(0, index + 1));
            const right = simplify(points.slice(index));
            return left.slice(0, -1).concat(right);
        }
        return [points[0], points[points.length - 1]];
    }

    return simplify(coords);
}

function simplifyFeature(feature, tolerance) {
    const simplified = { ...feature, geometry: { ...feature.geometry } };
    if (feature.geometry.type === "LineString") {
        simplified.geometry.coordinates = simplifyCoords(
            feature.geometry.coordinates,
            tolerance,
        );
    } else if (feature.geometry.type === "MultiLineString") {
        simplified.geometry.coordinates = feature.geometry.coordinates.map(
            (seg) => simplifyCoords(seg, tolerance),
        );
    }
    return simplified;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const attribution = {
    text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL). Geofabrik extract from download.geofabrik.de.",
    license: "ODbL-1.0",
    url: "https://www.openstreetmap.org/copyright",
};

async function main() {
    const config = YAML.parse(await readFile(configPath, "utf8"));

    if (!config.measuring) {
        throw new Error("No 'measuring' block found in config.yaml");
    }

    const cacheOnly = process.argv.includes("--cache-only");
    const checkMode = process.argv.includes("--check");
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

    // 2. Extract Kantō+margin window.
    const widePbfPath = resolve(cacheDir, "measuring-kanto-wide.osm.pbf");
    const bboxStr = extractBbox.join(",");
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
    const adminPbfPath = join(adminTmpDir, "admin-boundaries.osm.pbf");
    const adminSeqPath = join(adminTmpDir, "admin-boundaries.seq");
    let adminSeqExists = false;

    const generatedAt = new Date().toISOString();
    const sizes = {};

    for (const category of CATEGORIES) {
        console.log(`\n=== ${category.key} ===`);

        let pbfPath;
        if (
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border"
        ) {
            // Shared coarse filter for admin boundaries.
            if (!adminSeqExists) {
                console.log(
                    `  [shared] Filtering r/boundary=administrative...`,
                );
                execFileSync(
                    "osmium",
                    [
                        "tags-filter",
                        widePbfPath,
                        "r/boundary=administrative",
                        "-o",
                        adminPbfPath,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );
                console.log(`  [shared] Exporting to GeoJSONSeq...`);
                execFileSync(
                    "osmium",
                    [
                        "export",
                        adminPbfPath,
                        "-f",
                        "geojsonseq",
                        "-a",
                        "type",
                        "-o",
                        adminSeqPath,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );
                adminSeqExists = true;
            }
            pbfPath = adminPbfPath;
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
            category.key === "admin-2nd-border"
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
                    "type",
                    "-o",
                    seqPath,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        }

        // Stream, post-filter, convert, simplify, collect.
        console.log(`  Processing features...`);
        const features = [];
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

            // Convert polygon to outer-ring LineString.
            let lineFeatures;
            if (category.geometry === "polygon-to-ring") {
                lineFeatures = featureToLineStrings(feature);
            } else {
                // Coastline / high-speed-rail: pass-through LineString.
                if (
                    feature.geometry.type === "LineString" ||
                    feature.geometry.type === "MultiLineString"
                ) {
                    lineFeatures = [feature];
                } else {
                    // Skip non-line geometry (shouldn't happen with way filters).
                    continue;
                }
            }

            for (const lf of lineFeatures) {
                // Simplify.
                const tolerance = SIMPLIFY_TOLERANCES[category.key] ?? 0.0001;
                const simplified = simplifyFeature(lf, tolerance);

                // Compute bbox on simplified geometry.
                const bbox = computeBbox(simplified.geometry.coordinates);

                features.push({
                    type: "Feature",
                    bbox,
                    geometry: simplified.geometry,
                    properties: {},
                });
            }
        }

        console.log(`  Collected ${features.length.toLocaleString()} features`);

        // Write bundle.
        const bundle = {
            schemaVersion: 1,
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

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

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

// ─── High-speed-rail post-processing ────────────────────────────────────────

/**
 * Great-circle distance in meters between two [lon, lat] points.
 */
function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h =
        sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Direction vector of a LineString at an endpoint, pointing into/out of
 * the line. Returns [dx, dy] in degrees.
 */
function endpointDirection(coords, atStart) {
    let i, j;
    if (atStart) {
        i = 0;
        j = 1;
    } else {
        i = coords.length - 1;
        j = coords.length - 2;
    }
    const dx = coords[i][0] - coords[j][0];
    const dy = coords[i][1] - coords[j][1];
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag === 0) return [0, 0];
    return [dx / mag, dy / mag];
}

/**
 * Cosine similarity between two 2D vectors.
 */
function cosineSimilarity(v1, v2) {
    return v1[0] * v2[0] + v1[1] * v2[1];
}

/**
 * Cross-track distance in meters: how far is `point` from the line
 * passing through `linePt` with direction vector `dir`?
 */
function crossTrackDistanceMeters(point, linePt, dir) {
    // Perpendicular vector: rotate dir by 90°.
    const perpX = -dir[1];
    const perpY = dir[0];
    const dx =
        (point[0] - linePt[0]) *
        111320 *
        Math.cos((((point[1] + linePt[1]) / 2) * Math.PI) / 180);
    const dy = (point[1] - linePt[1]) * 111320;
    return Math.abs(dx * perpX + dy * perpY);
}

/**
 * Average perpendicular distance (meters) from line B's points to line A.
 * Uses cross-track distance to the great-circle segment for each point.
 */
function averagePerpendicularDistanceMeters(lineA, lineB) {
    let total = 0;
    let count = 0;
    for (const pt of lineB) {
        let minDist = Infinity;
        // Find the closest segment on lineA.
        for (let i = 0; i < lineA.length - 1; i++) {
            const a = lineA[i];
            const b = lineA[i + 1];
            // Simple point-to-segment distance in degrees (good enough
            // for short segments at this scale).
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const lenSq = dx * dx + dy * dy;
            let t = 0;
            if (lenSq > 0) {
                t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
                if (t < 0) t = 0;
                if (t > 1) t = 1;
            }
            const px = a[0] + t * dx;
            const py = a[1] + t * dy;
            const distDeg = Math.sqrt((pt[0] - px) ** 2 + (pt[1] - py) ** 2);
            // Approximate: 1° ≈ 111,320 m.
            const distM = distDeg * 111320;
            if (distM < minDist) minDist = distM;
        }
        total += minDist;
        count++;
    }
    return count > 0 ? total / count : Infinity;
}

/**
 * Build a centerline between two roughly parallel LineStrings.
 * Walks both lines from start to end, computing midpoints at corresponding
 * positions.
 */
function buildCenterline(lineA, lineB) {
    // Ensure both lines run in the same direction.
    const aDir = endpointDirection(lineA, false);
    const bDir = endpointDirection(lineB, false);
    const bCoords =
        cosineSimilarity(aDir, bDir) < 0 ? [...lineB].reverse() : lineB;

    // Walk both lines, sampling midpoints.
    const pts = [];
    const maxLen = Math.max(lineA.length, bCoords.length);
    for (let i = 0; i < maxLen; i++) {
        const frac = maxLen === 1 ? 0 : i / (maxLen - 1);
        const idxA = Math.round(frac * (lineA.length - 1));
        const idxB = Math.round(frac * (bCoords.length - 1));
        pts.push([
            (lineA[idxA][0] + bCoords[idxB][0]) / 2,
            (lineA[idxA][1] + bCoords[idxB][1]) / 2,
        ]);
    }

    return pts;
}

// ─── Segment stitching ──────────────────────────────────────────────────────

const STITCH_MAX_DIST_M = 25; // tight endpoint distance
const STITCH_MAX_CROSS_TRACK_M = 15; // perpendicular offset at connection
// Gap-bridging pass: when endpoints are 25-200 m apart but the features are
// truly collinear (cross-track < 5 m), connect them. This bridges small
// gaps in OSM coverage without creating false connections between parallel
// tracks (which have cross-track > 15 m).
const STITCH_GAP_MAX_DIST_M = 200;
const STITCH_GAP_MAX_CROSS_TRACK_M = 5;
const STITCH_MIN_COSINE = 0.866; // cos(30°)

/**
 * Phase 1: Stitch fragmented LineString features into continuous lines.
 *
 * Builds an endpoint adjacency graph, walks connected components, and
 * returns merged features. Branches (junctions) produce separate lines.
 */
function stitchSegments(features) {
    const n = features.length;
    if (n <= 1) return features;

    // Build adjacency: adjacency[i] = array of [neighborIdx, connectPts]
    // where connectPts describes how they connect.
    const adjacency = Array.from({ length: n }, () => []);

    // Index endpoints for fast lookup.
    const endpoints = [];
    for (let i = 0; i < n; i++) {
        const coords = features[i].geometry.coordinates;
        endpoints.push({
            start: coords[0],
            end: coords[coords.length - 1],
        });
    }

    // O(n²) endpoint matching. At 4228 features this is ~18M comparisons
    // which is fine for a build-time script.
    for (let i = 0; i < n; i++) {
        const ei = endpoints[i];
        const coordsI = features[i].geometry.coordinates;
        const dirIStart = endpointDirection(coordsI, true);
        const dirIEnd = endpointDirection(coordsI, false);

        for (let j = i + 1; j < n; j++) {
            const ej = endpoints[j];
            const coordsJ = features[j].geometry.coordinates;
            const dirJStart = endpointDirection(coordsJ, true);
            const dirJEnd = endpointDirection(coordsJ, false);

            // Check all 4 endpoint pairings.
            const pairs = [
                { ei: ei.start, ej: ej.start, di: dirIStart, dj: dirJStart },
                { ei: ei.start, ej: ej.end, di: dirIStart, dj: dirJEnd },
                { ei: ei.end, ej: ej.start, di: dirIEnd, dj: dirJStart },
                { ei: ei.end, ej: ej.end, di: dirIEnd, dj: dirJEnd },
            ];

            let matched = false;
            for (const pair of pairs) {
                const dist = haversineMeters(pair.ei, pair.ej);
                if (dist > STITCH_MAX_DIST_M) continue;
                const cos = -cosineSimilarity(pair.di, pair.dj);
                if (cos < STITCH_MIN_COSINE) continue;
                const crossTrack = crossTrackDistanceMeters(
                    pair.ei,
                    pair.ej,
                    pair.dj,
                );
                if (crossTrack > STITCH_MAX_CROSS_TRACK_M) continue;

                adjacency[i].push(j);
                adjacency[j].push(i);
                matched = true;
                break;
            }

            // Gap-bridging: only if the tight check didn't match.
            if (!matched) {
                for (const pair of pairs) {
                    const dist = haversineMeters(pair.ei, pair.ej);
                    if (dist > STITCH_GAP_MAX_DIST_M) continue;
                    const cos = -cosineSimilarity(pair.di, pair.dj);
                    if (cos < STITCH_MIN_COSINE) continue;
                    const crossTrack = crossTrackDistanceMeters(
                        pair.ei,
                        pair.ej,
                        pair.dj,
                    );
                    if (crossTrack > STITCH_GAP_MAX_CROSS_TRACK_M) continue;

                    adjacency[i].push(j);
                    adjacency[j].push(i);
                    break;
                }
            }
        }
    }

    // Walk graph.
    const visited = new Array(n).fill(false);
    const result = [];

    for (let i = 0; i < n; i++) {
        if (visited[i]) continue;

        // Find the longest path starting from this node.
        const path = walkLongestPath(i, adjacency, visited);
        if (!path.length) continue;

        // Merge coordinates along the path.
        const merged = mergePathCoordinates(path, features);
        result.push(makeFeature(merged));
    }

    return result;
}

/**
 * Depth-first walk from `start`, preferring the neighbor that continues
 * in the same direction (fewest branches taken). Returns an ordered array
 * of feature indices.
 */
function walkLongestPath(start, adjacency, visited) {
    // Find the farthest unvisited endpoint reachable from start.
    // Use BFS through ALL nodes (including visited ones) to find an
    // unvisited endpoint — visited nodes act as pass-through.
    const endpoint = findFarthestUnvisitedEndpoint(
        start,
        adjacency,
        visited,
    );

    // Greedy walk from the endpoint, collecting unvisited nodes.
    const path = [];
    let cur = endpoint;
    while (cur !== undefined && !visited[cur]) {
        visited[cur] = true;
        path.push(cur);
        // Follow the first unvisited neighbor.
        let next;
        for (const neighbor of adjacency[cur]) {
            if (!visited[neighbor]) {
                next = neighbor;
                break;
            }
        }
        cur = next;
    }

    return path;
}

/**
 * BFS from `start` through the adjacency graph to find the farthest
 * unvisited endpoint. Traverses through visited nodes (they act as
 * pass-through) so branches can still find their way to an endpoint.
 */
function findFarthestUnvisitedEndpoint(start, adjacency, visited) {
    // If start is unvisited and has degree <= 1, it's already an endpoint.
    if (!visited[start] && adjacency[start].length <= 1) return start;

    // BFS from start, tracking distance.
    const dist = new Map();
    dist.set(start, 0);
    const queue = [start];
    let bestNode = start;

    while (queue.length) {
        const cur = queue.shift();
        const d = dist.get(cur) + 1;

        for (const neighbor of adjacency[cur]) {
            if (dist.has(neighbor)) continue;
            dist.set(neighbor, d);
            // Prefer unvisited endpoints, but traverse through visited nodes.
            if (!visited[neighbor]) {
                if (d > (dist.get(bestNode) ?? 0)) bestNode = neighbor;
                queue.push(neighbor);
            } else if (adjacency[neighbor].length > 1) {
                // Pass through visited junction nodes.
                queue.push(neighbor);
            }
        }
    }

    return bestNode;
}

/**
 * Merge the coordinates of features along a path into a single array.
 * Handles coordinate reversal when features connect end-to-start, etc.
 */
function mergePathCoordinates(path, features) {
    if (path.length === 0) return [];
    if (path.length === 1) return [...features[path[0]].geometry.coordinates];

    const result = [...features[path[0]].geometry.coordinates];

    for (let p = 1; p < path.length; p++) {
        const prevCoords = features[path[p - 1]].geometry.coordinates;
        const curCoords = features[path[p]].geometry.coordinates;

        const prevEnd = prevCoords[prevCoords.length - 1];
        const curStart = curCoords[0];
        const curEnd = curCoords[curCoords.length - 1];

        const dStart = haversineMeters(prevEnd, curStart);
        const dEnd = haversineMeters(prevEnd, curEnd);

        let segment;
        if (dEnd < dStart) {
            // Reverse current segment.
            segment = [...curCoords].reverse();
        } else {
            segment = [...curCoords];
        }

        // Skip the first point if it's essentially the same as the
        // previous endpoint (avoid duplicate coordinate).
        const segStart = segment[0];
        if (haversineMeters(prevEnd, segStart) < 2) {
            segment = segment.slice(1);
        }

        for (const pt of segment) result.push(pt);
    }

    return result;
}

function makeFeature(coords) {
    const bbox = computeBbox(coords);
    return {
        type: "Feature",
        bbox,
        geometry: { type: "LineString", coordinates: coords },
        properties: {},
    };
}

// ─── Parallel track merging ─────────────────────────────────────────────────

const PARALLEL_MAX_LATERAL_M = 30; // max perpendicular distance for dual tracks
const PARALLEL_MIN_COSINE = 0.966; // cos(15°)

/**
 * Phase 2: Merge parallel line pairs into single centerlines.
 *
 * Greedy: for each unmerged line, find the closest parallel partner within
 * 30 m lateral distance, merge into a centerline, and mark both as merged.
 */
function mergeParallelTracks(features) {
    const n = features.length;
    if (n <= 1) return features;

    const merged = new Array(n).fill(false);
    const result = [];

    // Compute overall direction for each feature.
    const directions = features.map((f) => {
        const coords = f.geometry.coordinates;
        const start = coords[0];
        const end = coords[coords.length - 1];
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const mag = Math.sqrt(dx * dx + dy * dy);
        return mag > 0 ? [dx / mag, dy / mag] : [0, 0];
    });

    for (let i = 0; i < n; i++) {
        if (merged[i]) continue;

        let bestJ = -1;
        let bestDist = Infinity;

        for (let j = i + 1; j < n; j++) {
            if (merged[j]) continue;

            // Direction check.
            const cos = cosineSimilarity(directions[i], directions[j]);
            if (cos < PARALLEL_MIN_COSINE) continue;

            // Lateral distance check.
            const avgDist = averagePerpendicularDistanceMeters(
                features[i].geometry.coordinates,
                features[j].geometry.coordinates,
            );
            if (avgDist < PARALLEL_MAX_LATERAL_M && avgDist < bestDist) {
                bestDist = avgDist;
                bestJ = j;
            }
        }

        if (bestJ >= 0) {
            // Merge into centerline.
            const center = buildCenterline(
                features[i].geometry.coordinates,
                features[bestJ].geometry.coordinates,
            );
            result.push(makeFeature(center));
            merged[i] = true;
            merged[bestJ] = true;
        } else {
            result.push(features[i]);
            merged[i] = true;
        }
    }

    return result;
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

        // ── High-speed-rail post-processing ─────────────────────────────
        if (category.key === "high-speed-rail") {
            const t0 = Date.now();
            console.log(`  Stitching ${features.length} features...`);
            const stitched = stitchSegments(features);
            console.log(
                `  Stitched: ${features.length} → ${stitched.length} features ` +
                    `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
            );

            const t1 = Date.now();
            console.log(`  Merging parallel tracks...`);
            const merged = mergeParallelTracks(stitched);
            console.log(
                `  Merged: ${merged.length.toLocaleString()} features ` +
                    `(${((Date.now() - t1) / 1000).toFixed(1)}s)`,
            );

            // Re-simplify with coarser tolerance.
            const t2 = Date.now();
            // Re-simplify with a coarser tolerance than the initial pass
            // (0.0002° vs 0.0001°). The initial pass keeps endpoints
            // accurate enough for stitching; this pass removes extra
            // vertices introduced by centerline computation.
            const resimplified = merged.map((f) =>
                simplifyFeature(f, 0.0002),
            );
            // Recompute bboxes.
            for (const f of resimplified) {
                f.bbox = computeBbox(f.geometry.coordinates);
            }
            console.log(
                `  Re-simplified ${resimplified.length} features ` +
                    `(${((Date.now() - t2) / 1000).toFixed(1)}s)`,
            );

            features.length = 0;
            features.push(...resimplified);
        }

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

/**
 * Transit artifact builder for the packs pipeline.
 *
 * Extracts OSM station nodes from a region PBF, maps + dedupes them
 * using the transit pipeline's osmStations module, builds per-operator
 * presets and a coverage preset, and emits a transit.json.gz artifact
 * with the same schema as committed transit bundles.
 *
 * @module buildTransit
 */

/* global console */

import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";

import { processOsmRoutes } from "../../../transit/scripts/lib/osmRoutes.mjs";
import {
    buildOperatorNormalizer,
    splitOperators,
} from "../../../transit/scripts/lib/normalizeOperator.mjs";
import {
    mapOsmNode,
    dedupeOsmStations,
} from "../../../transit/scripts/lib/osmStations.mjs";
import { extractRouteRelationsFromPbf } from "../../../transit/scripts/lib/extractOsmRoutes.mjs";
import { attachRoutesToPresets } from "../../../transit/scripts/lib/attachRoutes.mjs";

/**
 * Build the transit artifact for a region.
 *
 * @param {object} opts
 * @param {object} opts.region - region config entry
 * @param {string} opts.pbfPath - path to the region PBF
 * @param {string} opts.distDir - dist/<region-id>/ output directory
 * @param {string} opts.cacheDir - pack cache directory
 * @returns {Promise<{gzPath: string, uncompressed: Buffer, presets: object[]}|null>}
 */
export async function buildTransitArtifact({
    region,
    pbfPath,
    distDir,
    cacheDir,
}) {
    // Station tags to extract (matching the transit pipeline defaults).
    const stationTags = [
        "n/railway=station",
        "n/railway=halt",
        "n/public_transport=station",
        "n/railway=tram_stop",
        "n/aerialway=station",
    ];

    const tmpDir = join(tmpdir(), `transit-pack-${region.id}-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    try {
        // 1. Tags-filter: extract station nodes.
        const filteredPbf = join(tmpDir, "stations.osm.pbf");
        console.log(`  Filtering station tags...`);
        execFileSync(
            "osmium",
            ["tags-filter", pbfPath, ...stationTags, "-o", filteredPbf, "-O"],
            { stdio: "inherit" },
        );

        // 2. Export to GeoJSONSeq.
        const seqPath = join(tmpDir, "stations.seq");
        console.log(`  Exporting to GeoJSONSeq...`);
        execFileSync(
            "osmium",
            [
                "export",
                filteredPbf,
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

        // 3. Stream, map, collect records.
        console.log(`  Mapping station records...`);
        const records = [];
        const stats = {
            skippedNoName: 0,
            skippedNoId: 0,
            skippedNonRailway: 0,
        };
        const suffixes = region.transitOverrides?.nameSuffixes ?? [];
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

            // Only nodes.
            if (feature.properties?.["@type"] !== "node") continue;

            const rec = mapOsmNode(feature, region.id, suffixes, stats);
            if (rec) records.push(rec);
        }

        console.log(`  Mapped ${records.length} station records`);
        if (stats.skippedNonRailway > 0) {
            console.log(
                `  Skipped ${stats.skippedNonRailway} non-railway node(s)`,
            );
        }

        if (records.length === 0) {
            console.log(`  No stations found — skipping transit artifact.`);
            return null;
        }

        // 4. Deduplicate using the shared transit pipeline dedup.
        const maxClusterMeters =
            region.transitOverrides?.maxClusterMeters ?? 150;
        const { kept: deduped, stats: dedupStats } = dedupeOsmStations(
            records,
            maxClusterMeters,
        );
        const totalDedupDropped =
            dedupStats.droppedById +
            dedupStats.droppedByWikidata +
            dedupStats.droppedByNameDist;
        if (totalDedupDropped > 0) {
            console.log(
                `  Dedup dropped: ${dedupStats.droppedById} by id, ` +
                    `${dedupStats.droppedByWikidata} by wikidata, ` +
                    `${dedupStats.droppedByNameDist} by name+dist`,
            );
        }

        // Drop stations that fall outside the PBF bbox (with a small slop).
        // Geofabrik extracts occasionally include outlying nodes tagged with
        // the region's operator/name; these break the pack-lint bbox check.
        const regionBbox = derivePbfBbox(pbfPath);
        const recordsInBbox = regionBbox
            ? filterRecordsByBbox(deduped, regionBbox)
            : deduped;
        if (recordsInBbox.length < deduped.length) {
            console.log(
                `  Dropped ${deduped.length - recordsInBbox.length} station(s) outside region bbox`,
            );
        }

        // 5. Extract and process OSM route relations.
        const routeCacheDir = join(cacheDir, "transit-routes", region.id);
        const stationRecords = recordsInBbox.map((rec) => ({
            id: rec.id,
            name: rec.name,
            nameEn: rec.nameEn,
            lat: rec.lat,
            lon: rec.lon,
            tags: rec.tags,
        }));
        const localeConfig = {
            nameSuffixes: region.transitOverrides?.nameSuffixes ?? [],
            aliases: region.transitOverrides?.aliases ?? [],
            maxClusterMeters,
            routeColors: region.transitOverrides?.routeColors ?? {},
            operatorNames: region.transitOverrides?.operatorNames ?? {},
            directionTokens: region.transitOverrides?.directionTokens,
            useRailwayInfrastructure:
                region.transitOverrides?.useRailwayInfrastructure ?? false,
            railwayAttachMeters:
                region.transitOverrides?.railwayAttachMeters ?? 120,
            simplifyMeters: region.transitOverrides?.simplifyMeters ?? 11,
            wayGeometry: region.transitOverrides?.wayGeometry ?? true,
        };

        const includeRailway =
            region.transitOverrides?.useRailwayInfrastructure ?? false;
        const routeModes = region.transitOverrides?.routeModes;
        const { relations, nodeCoords, ways } =
            await extractRouteRelationsFromPbf({
                pbfPath,
                cacheDir: routeCacheDir,
                regionId: region.id,
                includeRailway,
                routeModes,
            });
        const { lines: rawLines } =
            relations.length > 0 && stationRecords.length > 0
                ? processOsmRoutes(
                      relations,
                      stationRecords,
                      localeConfig,
                      nodeCoords,
                      ways,
                  )
                : { lines: [] };

        // 5b. Clip route geometry to the region bbox. Geofabrik extracts can
        // include relations whose ways extend past the nominal region boundary
        // (e.g., long-distance Amtrak routes entering Northern California).
        // Keep only the portion inside the bbox so pack-lint passes and the
        // map doesn't render tracks in unrelated areas.
        const lines = regionBbox
            ? clipLinesToBbox(rawLines, regionBbox)
            : rawLines;

        // 6. Build per-operator presets with nested stations and routes.
        const operatorNames = region.transitOverrides?.operatorNames ?? {};
        const normalizeOp = buildOperatorNormalizer(operatorNames);
        const presets = buildPresets(
            recordsInBbox,
            region.id,
            lines,
            normalizeOp,
        );

        const totalStations = presets.reduce(
            (sum, p) => sum + p.stations.length,
            0,
        );

        const totalRoutes = presets.reduce(
            (sum, p) => sum + p.routes.length,
            0,
        );

        // 7. Build attribution.
        const attribution = {
            text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL).",
            license: "ODbL-1.0",
            url: "https://www.openstreetmap.org/copyright",
        };

        // 8. Build bundle (same schema as committed transit bundles:
        //    top-level attribution + presets; stations are nested inside
        //    each preset).
        const bundle = {
            schemaVersion: 1,
            attribution,
            presets,
        };

        const serialized = JSON.stringify(bundle);
        const gzipped = gzipSync(serialized, { level: 9 });
        const gzPath = join(distDir, "transit.json.gz");
        await writeFile(gzPath, gzipped);

        console.log(
            `    transit.json.gz: ${(gzipped.length / 1024).toFixed(1)} KB gz, ` +
                `${totalStations} stations, ${totalRoutes} routes, ${presets.length} presets`,
        );

        return {
            gzPath,
            uncompressed: Buffer.from(serialized, "utf8"),
            presets,
        };
    } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

// Re-import writeFile for use in try block above.
import { writeFile } from "node:fs/promises";

/**
 * Build per-operator presets with nested stations, matching the
 * committed transit bundle schema. Each preset is a self-contained
 * HidingZonePreset: it owns its stations, routes, colors, and source.
 *
 * @param {object[]} records - deduped station records
 * @param {string} regionId - region id
 * @param {object[]} lines - OSM route lines from processOsmRoutes
 * @param {(raw: string | null | undefined) => string | null} normalizeOp - operator normalizer
 */
function buildPresets(records, regionId, lines, normalizeOp) {
    // Group records by normalized operator.
    const byOperator = new Map();
    for (const rec of records) {
        const ops = rec.operator
            ? splitOperators(rec.operator, normalizeOp)
            : [];
        const primaryOp = ops[0] || "other";
        if (!byOperator.has(primaryOp)) byOperator.set(primaryOp, []);
        byOperator.get(primaryOp).push(rec);
    }

    const presets = [];
    const MIN_OPERATOR_STATIONS = 3;
    const leftoverStations = [];

    // Per-operator presets (≥ MIN_OPERATOR_STATIONS).
    // Small operators are folded into the coverage "other" preset.
    for (const [operator, opRecords] of byOperator) {
        if (opRecords.length === 0) continue;

        if (operator === "other" || opRecords.length < MIN_OPERATOR_STATIONS) {
            leftoverStations.push(...opRecords);
            continue;
        }

        presets.push({
            id: `osm-${regionId}-${slugify(operator)}`,
            label: operator,
            operator,
            kind: "operator",
            bbox: computeRecordsBbox(opRecords),
            defaultColor: "#1f6f78",
            source: {
                kind: "osm-pack",
                namespace: `pack:${regionId}`,
            },
            routes: [],
            stations: opRecords.map(toStationContribution),
        });
    }

    // Coverage preset: only leftover stations (no operator or operator
    // with < MIN_OPERATOR_STATIONS). This mirrors Japan's buildOtherPreset
    // which holds leftover stations only — avoids duplicating every station
    // into coverage and causing double-colored rings.
    if (leftoverStations.length > 0) {
        presets.push({
            id: `osm-${regionId}-coverage`,
            label: `Other stations (${regionId})`,
            operator: "other",
            kind: "coverage",
            bbox: computeRecordsBbox(leftoverStations),
            defaultColor: "#1f6f78",
            source: {
                kind: "osm-pack",
                namespace: `pack:${regionId}`,
            },
            routes: [],
            stations: leftoverStations.map(toStationContribution),
        });
    }

    // Attach routes globally across presets.
    attachRoutesToPresets(presets, lines, normalizeOp);

    return presets;
}

function toStationContribution(rec) {
    const sourceId = rec.id;
    return {
        id: sourceId,
        lat: rec.lat,
        lon: rec.lon,
        mergeKey: sourceId,
        name: rec.name,
        routeIds: [],
        sourceId,
    };
}

/**
 * Slugify a name for use in preset IDs.  Mirrors the robust slugify in
 * conflateStage.mjs: names with little ASCII content get a deterministic
 * hash suffix so the id never becomes empty or generic.
 */
function slugify(name) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    if (slug && slug.length >= 5) return slug;

    // Fallback: djb2 hash so preset ids stay deterministic.
    let hash = 5381;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
    }
    const hashPart = (hash >>> 0).toString(36);
    return slug ? `${slug}-${hashPart}` : `op${hashPart}`;
}

function computeRecordsBbox(records) {
    let west = Infinity,
        south = Infinity,
        east = -Infinity,
        north = -Infinity;
    for (const r of records) {
        if (r.lon < west) west = r.lon;
        if (r.lon > east) east = r.lon;
        if (r.lat < south) south = r.lat;
        if (r.lat > north) north = r.lat;
    }
    return [west, south, east, north];
}

/**
 * Derive the region bbox from a PBF using osmium fileinfo.
 * Returns null if osmium fails or the bbox cannot be parsed.
 *
 * @param {string} pbfPath
 * @returns {[number, number, number, number] | null}
 */
function derivePbfBbox(pbfPath) {
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
            if (
                [west, south, east, north].every(Number.isFinite) &&
                west < east &&
                south < north
            ) {
                return [west, south, east, north];
            }
        }
    } catch {
        // osmium may be unavailable — fall back to no filtering.
    }
    return null;
}

/**
 * Filter station records to those inside (or near) the region bbox.
 *
 * @param {object[]} records
 * @param {[number, number, number, number]} bbox
 * @returns {object[]}
 */
function filterRecordsByBbox(records, bbox) {
    const [west, south, east, north] = bbox;
    const SLOP = 0.001;
    return records.filter(
        (r) =>
            r.lon >= west - SLOP &&
            r.lon <= east + SLOP &&
            r.lat >= south - SLOP &&
            r.lat <= north + SLOP,
    );
}

/**
 * Clip a set of route lines to the region bbox. Routes whose geometry is
 * entirely outside the bbox are dropped.
 *
 * @param {object[]} lines - line records from processOsmRoutes
 * @param {[number, number, number, number]} bbox - [west, south, east, north]
 * @returns {object[]} clipped lines
 */
function clipLinesToBbox(lines, bbox) {
    const clipped = [];
    for (const line of lines) {
        const geometry = clipGeometryToBbox(line.geometry, bbox);
        if (!geometry) continue;
        clipped.push({ ...line, geometry });
    }
    return clipped;
}

/**
 * Clip a GeoJSON LineString or MultiLineString to a bbox.
 * Returns a MultiLineString (even for a single clipped segment) or null if
 * nothing remains inside the bbox.
 *
 * @param {{type: string, coordinates: any[]}} geometry
 * @param {[number, number, number, number]} bbox - [west, south, east, north]
 * @returns {{type: "MultiLineString", coordinates: number[][][]} | null}
 */
function clipGeometryToBbox(geometry, bbox) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;

    const parts =
        geometry.type === "LineString"
            ? [geometry.coordinates]
            : geometry.type === "MultiLineString"
              ? geometry.coordinates
              : null;
    if (!parts) return null;

    const segments = [];
    for (const part of parts) {
        if (!Array.isArray(part) || part.length < 2) continue;
        for (let i = 0; i < part.length - 1; i++) {
            const clipped = clipSegmentToBbox(part[i], part[i + 1], bbox);
            if (clipped) segments.push(clipped);
        }
    }

    if (segments.length === 0) return null;

    // Chain consecutive segments that share an endpoint into polylines.
    const EPS = 1e-9;
    const chains = [];
    let current = null;
    for (const seg of segments) {
        if (!current) {
            current = [...seg];
            continue;
        }
        const last = current[current.length - 1];
        const start = seg[0];
        if (
            Math.abs(last[0] - start[0]) < EPS &&
            Math.abs(last[1] - start[1]) < EPS
        ) {
            current.push(seg[1]);
        } else {
            chains.push(current);
            current = [...seg];
        }
    }
    if (current) chains.push(current);

    const valid = chains.filter((c) => c.length >= 2);
    if (valid.length === 0) return null;
    return { type: "MultiLineString", coordinates: valid };
}

/**
 * Liang-Barsky line clipping to a rectangle.
 *
 * @param {[number, number]} a - [lon, lat] start
 * @param {[number, number]} b - [lon, lat] end
 * @param {[number, number, number, number]} bbox - [west, south, east, north]
 * @returns {[[number, number], [number, number]] | null}
 */
function clipSegmentToBbox(a, b, bbox) {
    const [xmin, ymin, xmax, ymax] = bbox;
    let [x0, y0] = a;
    let [x1, y1] = b;
    const dx = x1 - x0;
    const dy = y1 - y0;

    const p = [-dx, dx, -dy, dy];
    const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
    let u1 = 0;
    let u2 = 1;

    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null;
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) {
                u1 = Math.max(u1, t);
            } else {
                u2 = Math.min(u2, t);
            }
        }
    }

    if (u1 > u2) return null;

    return [
        [x0 + u1 * dx, y0 + u1 * dy],
        [x0 + u2 * dx, y0 + u2 * dy],
    ];
}

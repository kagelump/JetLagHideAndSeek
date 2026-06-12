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
import { buildOperatorNormalizer } from "../../../transit/scripts/lib/normalizeOperator.mjs";
import { createOsmElementId } from "../../../transit/scripts/lib/osmStations.mjs";
import { extractRouteRelationsFromPbf } from "../../../transit/scripts/lib/extractOsmRoutes.mjs";

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

            const rec = mapStationRecord(feature);
            if (rec) records.push(rec);
        }

        console.log(`  Mapped ${records.length} station records`);

        if (records.length === 0) {
            console.log(`  No stations found — skipping transit artifact.`);
            return null;
        }

        // 4. Deduplicate by (name, rounded lat/lon).
        const deduped = dedupeStations(records);

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
            id: createOsmElementId("node", rec.osmId),
            name: rec.name,
            nameEn: rec.nameEn,
            lat: rec.lat,
            lon: rec.lon,
            tags: {
                railway: rec.railway ?? undefined,
                public_transport: rec.publicTransport ?? undefined,
            },
        }));
        const localeConfig = {
            nameSuffixes: region.transitOverrides?.nameSuffixes ?? [],
            aliases: region.transitOverrides?.aliases ?? [],
            maxClusterMeters: region.transitOverrides?.maxClusterMeters ?? 150,
        };

        const { relations, nodeCoords } = await extractRouteRelationsFromPbf({
            pbfPath,
            cacheDir: routeCacheDir,
            regionId: region.id,
        });
        const { lines } =
            relations.length > 0 && stationRecords.length > 0
                ? processOsmRoutes(
                      relations,
                      stationRecords,
                      localeConfig,
                      nodeCoords,
                  )
                : { lines: [] };

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
 * Map an OSM GeoJSON feature to a station record.
 * Simplified version of mapOsmNode from osmStations.mjs.
 */
function mapStationRecord(feature) {
    const props = feature.properties ?? {};
    const geom = feature.geometry;

    if (!geom || (geom.type !== "Point" && !geom.coordinates)) return null;

    const [lon, lat] =
        geom.type === "Point"
            ? geom.coordinates
            : [props.lon ?? 0, props.lat ?? 0];

    const name = props.name?.trim();
    if (!name) return null;

    const osmId = Number(props["@id"]);
    if (!Number.isFinite(osmId)) return null;

    // Extract operator from tags.
    const operator = props.operator?.trim() ?? "other";

    return {
        osmId,
        name,
        nameEn: props["name:en"]?.trim() ?? null,
        lat,
        lon,
        operator,
        railway: props.railway ?? null,
        station: props.station ?? null,
        publicTransport: props.public_transport ?? null,
    };
}

/**
 * Deduplicate station records by (name, rounded lat/lon).
 */
function dedupeStations(records) {
    const seen = new Set();
    const result = [];
    for (const rec of records) {
        const key = `${rec.name}|${rec.lat.toFixed(4)}|${rec.lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(rec);
    }
    return result;
}

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
    // Map records to station contributions (committed bundle format).
    const toStationContribution = (rec) => {
        const sourceId = createOsmElementId("node", rec.osmId);
        return {
            id: sourceId,
            lat: rec.lat,
            lon: rec.lon,
            mergeKey: sourceId,
            name: rec.name,
            // nameEn is not part of TransitStationContribution; omit.
            routeIds: [],
            sourceId,
        };
    };

    // Group records by normalized operator.
    const byOperator = new Map();
    for (const rec of records) {
        const op = normalizeOp(rec.operator) || rec.operator || "other";
        if (!byOperator.has(op)) byOperator.set(op, []);
        byOperator.get(op).push(rec);
    }

    // Index routes by normalized operator.
    const linesByOperator = new Map();
    for (const line of lines) {
        const op = normalizeOp(line.operator);
        if (!op) continue;
        if (!linesByOperator.has(op)) linesByOperator.set(op, []);
        linesByOperator.get(op).push(line);
    }

    const presets = [];

    // Per-operator presets.
    for (const [operator, opRecords] of byOperator) {
        if (opRecords.length === 0) continue;

        const stations = opRecords.map(toStationContribution);
        const stationBySourceId = new Map(stations.map((s) => [s.sourceId, s]));
        const bbox = computeRecordsBbox(opRecords);
        const defaultColor = operatorColor(operator);

        const preset = {
            id: `osm-${regionId}-${slugify(operator)}`,
            label: operator,
            operator,
            kind: "operator",
            bbox,
            defaultColor,
            source: {
                kind: "osm-pack",
                namespace: `pack:${regionId}`,
            },
            routes: [],
            stations,
        };

        // Attach matching routes and populate station routeIds.
        const matchingLines = linesByOperator.get(operator) || [];
        for (const line of matchingLines) {
            preset.routes.push({
                id: line.id,
                name: line.name,
                color: line.color || preset.defaultColor,
                sourceId: line.sourceId,
                geometry: line.geometry,
            });

            for (const memberId of line.memberStationIds) {
                const station = stationBySourceId.get(memberId);
                if (station) {
                    station.routeIds.push(line.id);
                }
            }
        }

        presets.push(preset);
    }

    // Coverage preset (all stations, no operator filter).
    if (records.length > 0) {
        const allStations = records.map(toStationContribution);
        const allBbox = computeRecordsBbox(records);
        const defaultColor = "#1f6f78";

        presets.push({
            id: `osm-${regionId}-coverage`,
            label: `Other stations (${regionId})`,
            operator: "other",
            kind: "coverage",
            bbox: allBbox,
            defaultColor,
            source: {
                kind: "osm-pack",
                namespace: `pack:${regionId}`,
            },
            routes: [],
            stations: allStations,
        });
    }

    return presets;
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

function operatorColor() {
    // Station fallback color, matching the Japan OSM baseline presets.
    return "#1f6f78";
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

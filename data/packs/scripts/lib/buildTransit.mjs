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

/**
 * Build the transit artifact for a region.
 *
 * @param {object} opts
 * @param {object} opts.region - region config entry
 * @param {string} opts.pbfPath - path to the region PBF
 * @param {string} opts.distDir - dist/<region-id>/ output directory
 * @returns {Promise<{gzPath: string, uncompressed: Buffer, presets: object[]}|null>}
 */
export async function buildTransitArtifact({ region, pbfPath, distDir }) {
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

        // 5. Build per-operator presets with nested stations (matching
        //    the committed transit bundle schema, not manifest summaries).
        const presets = buildPresets(deduped, region.id);

        const totalStations = presets.reduce(
            (sum, p) => sum + p.stations.length,
            0,
        );

        // 6. Build attribution.
        const attribution = {
            text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL).",
            license: "ODbL-1.0",
            url: "https://www.openstreetmap.org/copyright",
        };

        // 7. Build bundle (same schema as committed transit bundles:
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
                `${totalStations} stations, ${presets.length} presets`,
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
 */
function buildPresets(records, regionId) {
    // Map records to station contributions (committed bundle format).
    const toStationContribution = (rec) => ({
        id: `osm:${rec.osmId}`,
        lat: rec.lat,
        lon: rec.lon,
        mergeKey: `osm:${rec.osmId}`,
        name: rec.name,
        // nameEn is not part of TransitStationContribution; omit.
        routeIds: [],
    });

    // Group records by operator.
    const byOperator = new Map();
    for (const rec of records) {
        const op = rec.operator ?? "other";
        if (!byOperator.has(op)) byOperator.set(op, []);
        byOperator.get(op).push(rec);
    }

    const presets = [];

    // Per-operator presets.
    for (const [operator, opRecords] of byOperator) {
        if (opRecords.length === 0) continue;

        const stations = opRecords.map(toStationContribution);
        const bbox = computeRecordsBbox(opRecords);
        const defaultColor = operatorColor(operator);

        presets.push({
            id: `osm:${operatorSlug(operator)}`,
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
        });
    }

    // Coverage preset (all stations, no operator filter).
    if (records.length > 0) {
        const allStations = records.map(toStationContribution);
        const allBbox = computeRecordsBbox(records);
        const defaultColor = "#888888";

        presets.push({
            id: `osm:${regionId}-coverage`,
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

function operatorSlug(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function operatorColor(operator) {
    // Deterministic color from operator name.
    let hash = 0;
    for (let i = 0; i < operator.length; i++) {
        hash = operator.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 60%, 45%)`;
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

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
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..", "..");

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

    const cacheDir = join(distDir, "..", "..", "cache");
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

        // 4. Deduplicate by mergeKey.
        const deduped = dedupeStations(records);

        // 5. Build presets per operator.
        const { presets, stations, routes } = buildPresets(deduped, region.id);

        // 6. Build attribution.
        const attribution = {
            text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL).",
            license: "ODbL-1.0",
            url: "https://www.openstreetmap.org/copyright",
        };

        // 7. Build bundle (same schema as committed transit bundles).
        const generatedAt = new Date().toISOString();
        const bundle = {
            schemaVersion: 1,
            regionId: region.id,
            generatedAt,
            source: region.pbfUrl ?? `packs:${region.id}`,
            attribution,
            stations,
            routes,
            presets,
        };

        const serialized = JSON.stringify(bundle);
        const gzipped = gzipSync(serialized, { level: 9 });
        const gzPath = join(distDir, "transit.json.gz");
        await writeFile(gzPath, gzipped);

        console.log(
            `    transit.json.gz: ${(gzipped.length / 1024).toFixed(1)} KB gz, ` +
                `${stations.length} stations, ${presets.length} presets`,
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
 * Build per-operator presets and a coverage preset from station records.
 */
function buildPresets(records, regionId) {
    // Map stations to bundle format.
    const stations = records.map((rec, i) => ({
        mergeKey: `osm-${rec.osmId}`,
        routeIds: [],
        // Derive color from operator name (simple hash).
        color: operatorColor(rec.operator),
        lat: rec.lat,
        lon: rec.lon,
        name: rec.name,
        nameEn: rec.nameEn,
        railway: rec.railway,
    }));

    // Group by operator.
    const byOperator = new Map();
    for (const st of stations) {
        const op =
            records.find((r) => `osm-${r.osmId}` === st.mergeKey)?.operator ??
            "other";
        if (!byOperator.has(op)) byOperator.set(op, []);
        byOperator.get(op).push(st);
    }

    // Build per-operator presets.
    const presets = [];
    for (const [operator, opStations] of byOperator) {
        if (opStations.length === 0) continue;

        const bbox = computeStationsBbox(opStations);
        presets.push({
            id: `osm-${operatorSlug(operator)}`,
            label: operator,
            kind: "operator",
            bbox,
            stationCount: opStations.length,
            routeCount: 0,
        });
    }

    // Coverage preset (all stations).
    if (stations.length > 0) {
        const allBbox = computeStationsBbox(stations);
        presets.push({
            id: "osm-coverage",
            label: `Other stations (${regionId})`,
            kind: "coverage",
            bbox: allBbox,
            stationCount: stations.length,
            routeCount: 0,
        });
    }

    return { presets, stations, routes: [] };
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

function computeStationsBbox(stations) {
    let west = Infinity,
        south = Infinity,
        east = -Infinity,
        north = -Infinity;
    for (const st of stations) {
        if (st.lon < west) west = st.lon;
        if (st.lon > east) east = st.lon;
        if (st.lat < south) south = st.lat;
        if (st.lat > north) north = st.lat;
    }
    return [west, south, east, north];
}

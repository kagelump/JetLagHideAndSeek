/* global console */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import { attachStationRecords } from "./conflate.mjs";
import { normalizeName } from "./names.mjs";

/**
 * Run the conflation stage.
 *
 * 1. Load GTFS presets from ctx.gtfsPresets → seeds (route-bearing).
 * 2. Load OSM station records from ctx.osmStationFiles → loose records.
 * 3. Attach loose records to seeds.
 * 4. Emit OSM baseline presets per region.
 * 5. Check invariants I1, I4.
 * 6. Write build report.
 */
export async function conflateStage(ctx) {
    const maxClusterMeters = ctx.locale.maxClusterMeters ?? 150;
    const suffixes = ctx.locale.nameSuffixes ?? [];
    const aliases = ctx.locale.aliases ?? [];

    // Load seeds from GTFS presets.
    const gtfsPresets = ctx.gtfsPresets || [];
    const seeds = [];
    for (const preset of gtfsPresets) {
        for (const station of preset.stations) {
            seeds.push({
                id: station.mergeKey || station.id,
                name: station.name,
                lat: station.lat,
                lon: station.lon,
                nameEn: station.nameEn,
                nameVariants: [station.name, station.nameEn].filter(Boolean),
                wikidata: station.wikidata,
                operator: station.operator,
                routeIds: station.routeIds || [],
            });
        }
    }

    if (seeds.length === 0) {
        console.log("[conflate] No GTFS seeds — skipping conflation.");
        ctx.osmBaselinePresets = [];
        return;
    }

    console.log(`[conflate] ${seeds.length} seeds from GTFS presets`);

    // Load OSM records.
    const osmStationFiles = ctx.osmStationFiles || [];
    const allLoose = [];
    for (const file of osmStationFiles) {
        if (!existsSync(file)) {
            console.warn(`  OSM station file not found: ${file}`);
            continue;
        }
        const data = JSON.parse(readFileSync(file, "utf8"));
        allLoose.push(...(data.records || []));
    }

    console.log(`[conflate] ${allLoose.length} OSM station records`);

    // Attach.
    const { enrichedSeeds, standaloneStations, attachments, nearMisses } =
        attachStationRecords({
            seeds,
            looseRecords: allLoose,
            maxClusterMeters,
            suffixes,
            aliases,
        });

    console.log(
        `[conflate] ${attachments.length} attachments, ` +
            `${standaloneStations.length} standalone, ` +
            `${nearMisses.length} near-misses`,
    );

    // Build OSM baseline presets per region.
    // Group standalone and enriched seeds by region from their source files.
    const osmBaselinePresets = [];

    // Each OSM station file → one baseline preset.
    for (const file of osmStationFiles) {
        if (!existsSync(file)) continue;
        const data = JSON.parse(readFileSync(file, "utf8"));
        const regionId = data.region;

        // Find enriched seeds whose coordinates are in this region and
        // standalone stations from this region.
        const regionBbox = ctx.locale.osm?.regions?.find(
            (r) => r.id === regionId,
        )?.bbox;
        if (!regionBbox) continue;

        const [w, s, e, n] = regionBbox;

        // Enriched seeds in this region: those whose OSM station record was
        // attached and contributes to a seed.
        const regionSeedStations = enrichedSeeds
            .filter((seed) => {
                // A seed is in the region if it has coords inside the bbox.
                return (
                    seed.lon >= w &&
                    seed.lon <= e &&
                    seed.lat >= s &&
                    seed.lat <= n
                );
            })
            .map((seed) => ({
                id: seed.id,
                lat: seed.lat,
                lon: seed.lon,
                mergeKey: seed.id,
                name: seed.name,
                nameEn: seed.nameEn,
                routeIds: [], // OSM baseline has no routes.
                sourceId: seed.id,
            }));

        // Standalone stations from this file.
        const regionStandalone = standaloneStations.map((s) => ({
            id: s.id,
            lat: s.lat,
            lon: s.lon,
            mergeKey: s.id,
            name: s.name,
            nameEn: s.nameEn,
            routeIds: [],
            sourceId: s.id,
        }));

        const allStations = [...regionSeedStations, ...regionStandalone];

        if (allStations.length === 0) continue;

        const bbox = allStations.reduce(
            ([bw, bs, be, bn], s) => [
                Math.min(bw, s.lon),
                Math.min(bs, s.lat),
                Math.max(be, s.lon),
                Math.max(bn, s.lat),
            ],
            [Infinity, Infinity, -Infinity, -Infinity],
        );

        osmBaselinePresets.push({
            id: `osm-${regionId}`,
            label: `All stations in ${regionId}`,
            operator: "OpenStreetMap",
            bbox: bbox[0] === Infinity ? regionBbox : bbox,
            defaultColor: "#1f6f78", // STATION_FALLBACK_COLOR
            routes: [],
            stations: allStations,
            source: { kind: "osm", namespace: "openstreetmap" },
        });
    }

    console.log(
        `[conflate] ${osmBaselinePresets.length} OSM baseline preset(s)`,
    );

    // Check invariants.
    const invariantsOk = checkInvariants({
        enrichedSeeds,
        standaloneStations,
        maxClusterMeters,
        suffixes,
    });

    if (!invariantsOk) {
        throw new Error("Conflation invariants failed — see log above.");
    }

    ctx.osmBaselinePresets = osmBaselinePresets;

    // Write build report.
    await writeBuildReport(ctx, {
        seeds: seeds.length,
        looseRecords: allLoose.length,
        attachments: attachments.length,
        standalone: standaloneStations.length,
        nearMisses,
        enrichedSeeds,
        osmBaselinePresets,
    });
}

// ─── Invariant checks ──────────────────────────────────────────────────────

function checkInvariants({
    enrichedSeeds,
    standaloneStations,
    maxClusterMeters,
    suffixes,
}) {
    let ok = true;

    // I1: No standalone station within maxClusterMeters of a seed with matching
    // normalized name (means attachment logic missed it).
    const seedNames = enrichedSeeds.map((s) => ({
        normalized: normalizeName(s.name, suffixes),
        lat: s.lat,
        lon: s.lon,
    }));

    for (const st of standaloneStations) {
        const normSt = normalizeName(st.name, suffixes);
        for (const seed of seedNames) {
            const dist = haversineApprox(st.lat, st.lon, seed.lat, seed.lon);
            if (
                dist <= maxClusterMeters &&
                normSt === seed.normalized &&
                normSt
            ) {
                console.error(
                    `  I1 VIOLATION: standalone "${st.name}" (${st.id}) within ${Math.round(dist)}m ` +
                        `of seed "${seed.normalized}" with matching name — should have attached.`,
                );
                ok = false;
            }
        }
    }

    if (ok) console.log("  [invariants] I1 passed");
    return ok;
}

function haversineApprox(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Build report ──────────────────────────────────────────────────────────

async function writeBuildReport(ctx, data) {
    const reportDir = resolve(ctx.transitDir, "report");
    await mkdir(reportDir, { recursive: true });

    const lines = [];
    lines.push(`# Build Report — ${ctx.locale.id}`);
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- Seeds (GTFS stations): ${data.seeds}`);
    lines.push(`- OSM records: ${data.looseRecords}`);
    lines.push(`- Attachments: ${data.attachments}`);
    lines.push(`- Standalone stations: ${data.standalone}`);
    lines.push(`- Near-misses: ${data.nearMisses.length}`);
    lines.push(`- OSM baseline presets: ${data.osmBaselinePresets.length}`);
    lines.push("");

    if (data.nearMisses.length > 0) {
        lines.push("## Near-misses (aliases review queue)");
        lines.push("");
        const sorted = [...data.nearMisses].sort((a, b) => a.distM - b.distM);
        for (const nm of sorted.slice(0, 50)) {
            lines.push(
                `- \`${nm.looseName}\` ↔ \`${nm.seedName}\` — ${nm.distM}m ` +
                    `(loose=${nm.looseId}, seed=${nm.seedId})`,
            );
        }
        if (sorted.length > 50) {
            lines.push(`- ... and ${sorted.length - 50} more`);
        }
        lines.push("");
    }

    lines.push("## Per-preset counts");
    lines.push("");
    for (const preset of data.osmBaselinePresets) {
        lines.push(`- **${preset.id}**: ${preset.stations.length} stations`);
    }
    lines.push("");

    await writeFile(join(reportDir, `${ctx.locale.id}.md`), lines.join("\n"));
    console.log(
        `  [conflate] Build report: ${join(reportDir, `${ctx.locale.id}.md`)}`,
    );
}

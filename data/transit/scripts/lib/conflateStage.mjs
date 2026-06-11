/* global console */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import { attachStationRecords } from "./conflate.mjs";
import { normalizeName } from "./names.mjs";
import {
    buildOperatorNormalizer,
    splitOperators,
} from "./normalizeOperator.mjs";

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
    // For each region, group standalone OSM stations by operator to create
    // per-operator presets (enriched seeds stay in their GTFS presets).
    const operatorNames = ctx.locale.operatorNames || {};
    const normalizeOp = buildOperatorNormalizer(operatorNames);

    // Build route-based operator inference: if a station is a member of a
    // route relation, it's served by that route's operator, even if the
    // station's own operator tag doesn't list it (common for multi-operator
    // hubs like Shibuya, Shinjuku, etc.).
    /** @type {Map<string, Set<string>>} osmNodeId → set of normalized operators */
    const routeOperatorsByStation = new Map();
    if (ctx.osmRouteLines) {
        for (const line of ctx.osmRouteLines) {
            const lineOp = normalizeOp(line.operator);
            if (!lineOp) continue;
            for (const memberId of line.memberStationIds) {
                if (!routeOperatorsByStation.has(memberId)) {
                    routeOperatorsByStation.set(memberId, new Set());
                }
                routeOperatorsByStation.get(memberId).add(lineOp);
            }
        }
    }
    const osmBaselinePresets = [];

    // Each OSM station file → per-operator presets for that region.
    for (const file of osmStationFiles) {
        if (!existsSync(file)) continue;
        const data = JSON.parse(readFileSync(file, "utf8"));
        const regionId = data.region;

        const regionBbox = ctx.locale.osm?.regions?.find(
            (r) => r.id === regionId,
        )?.bbox;
        if (!regionBbox) continue;

        const [bw, bs, be, bn] = regionBbox;

        // -- Standalone stations in this region (unattached OSM records).
        const regionStandalone = standaloneStations.filter(
            (st) =>
                st.lon >= bw && st.lon <= be && st.lat >= bs && st.lat <= bn,
        );

        if (regionStandalone.length === 0) continue;

        // Group standalone stations by normalized operator.
        /** @type {Map<string, object[]>} operatorName → stations[] */
        const operatorGroups = new Map();
        /** @type {object[]} */
        const noOperatorStations = [];

        for (const station of regionStandalone) {
            const tagOps = splitOperators(station.operator, normalizeOp);
            const routeOps =
                routeOperatorsByStation.get(station.id) || new Set();
            // Merge operator-tag operators with route-inferred operators.
            const operators = [...new Set([...tagOps, ...routeOps])];
            if (operators.length === 0) {
                noOperatorStations.push(station);
            } else {
                for (const op of operators) {
                    if (!operatorGroups.has(op)) {
                        operatorGroups.set(op, []);
                    }
                    operatorGroups.get(op).push(station);
                }
            }
        }

        // -- Also include enriched seeds (GTFS stations with OSM attachments)
        //    in per-operator OSM presets.  Major stations like Shibuya serve
        //    multiple operators — the GTFS seed covers the transit agency
        //    (e.g. Tokyo Metro), but the OSM operator preset (e.g. JR East)
        //    should also include the station so users see full operator
        //    coverage.
        const regionEnriched = enrichedSeeds.filter(
            (seed) =>
                seed.lon >= bw &&
                seed.lon <= be &&
                seed.lat >= bs &&
                seed.lat <= bn &&
                seed.osmOperators &&
                seed.osmOperators.length > 0,
        );

        for (const seed of regionEnriched) {
            // Merge OSM tag operators with route-inferred operators for each
            // OSM source node that was attached to this seed.
            for (const rawOp of seed.osmOperators) {
                const tagOps = splitOperators(rawOp, normalizeOp);
                // Also check route membership for each attached OSM node.
                const routeOps = new Set();
                if (seed.osmSourceIds) {
                    for (const osmId of seed.osmSourceIds) {
                        const ro = routeOperatorsByStation.get(osmId);
                        if (ro) {
                            for (const op of ro) routeOps.add(op);
                        }
                    }
                }
                const ops = [...new Set([...tagOps, ...routeOps])];
                for (const op of ops) {
                    if (!operatorGroups.has(op)) {
                        operatorGroups.set(op, []);
                    }
                    // Pseudo station record: mergeKey uses the GTFS seed id
                    // so getSelectedStations merges this contribution with
                    // the GTFS station at selection time.
                    operatorGroups.get(op).push({
                        id: seed.osmSourceIds?.[0] || seed.id,
                        lat: seed.lat,
                        lon: seed.lon,
                        mergeKey: seed.id,
                        name: seed.name,
                        nameEn: seed.nameEn,
                        operator: op,
                    });
                }
            }
        }

        // -- Create per-operator presets (≥3 stations) and collect leftovers.
        const mainOperatorPresets = [];
        const leftoverStations = [...noOperatorStations];

        for (const [canonicalOperator, stations] of operatorGroups) {
            if (stations.length >= 3) {
                const preset = buildOperatorPreset(
                    regionId,
                    canonicalOperator,
                    stations,
                );
                mainOperatorPresets.push(preset);
            } else {
                leftoverStations.push(...stations);
            }
        }

        // -- Small-operator + no-operator stations → "Other" coverage preset.
        if (leftoverStations.length > 0) {
            const otherPreset = buildOtherPreset(regionId, leftoverStations);
            osmBaselinePresets.push(otherPreset);
        }

        // -- Match osmRouteLines to presets.
        for (const preset of mainOperatorPresets) {
            const presetOpCanonical = normalizeOp(preset.operator);
            if (!presetOpCanonical) continue;

            // Build station id set for quick lookup (memberStationIds are
            // "osm:node:<id>" format; standalone station ids are the same).
            const stationIdSet = new Set(
                preset.stations.map((s) => s.sourceId),
            );

            const matchingRoutes = (ctx.osmRouteLines || []).filter((line) => {
                const lineOp = normalizeOp(line.operator);
                return lineOp === presetOpCanonical;
            });

            for (const line of matchingRoutes) {
                const routeEntry = {
                    id: line.id,
                    name: line.name,
                    color: line.color || preset.defaultColor,
                    sourceId: line.sourceId,
                    geometry: line.geometry,
                };
                preset.routes.push(routeEntry);

                // Add route ID to stations that are members of this route.
                for (const memberId of line.memberStationIds) {
                    if (stationIdSet.has(memberId)) {
                        const station = preset.stations.find(
                            (s) => s.sourceId === memberId,
                        );
                        if (station) {
                            station.routeIds.push(line.id);
                        }
                    }
                }
            }
        }

        // Detect and warn about duplicate preset ids within this region.
        const seenIds = new Set();
        for (const p of mainOperatorPresets) {
            if (seenIds.has(p.id)) {
                console.warn(
                    `  [conflate] DUPLICATE preset id "${p.id}" (operator "${p.operator}") in ${regionId}`,
                );
            } else {
                seenIds.add(p.id);
                osmBaselinePresets.push(p);
            }
        }

        const totalPerOp = mainOperatorPresets.filter(
            (p, i, arr) => arr.findIndex((x) => x.id === p.id) === i,
        ).length;
        const smallOpCount = operatorGroups.size - totalPerOp;
        console.log(
            `  [conflate] ${regionId}: ${totalPerOp} operator preset(s)` +
                (smallOpCount > 0
                    ? `, ${smallOpCount} small operator(s) folded into Other`
                    : "") +
                (leftoverStations.length > 0
                    ? `, ${leftoverStations.length} station(s) in Other`
                    : ""),
        );
    }

    console.log(
        `[conflate] ${osmBaselinePresets.length} OSM baseline preset(s) total`,
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
        osmRouteStats: ctx.osmRouteStats,
    });
}

// ─── OSM baseline preset builder helpers ──────────────────────────────────

/**
 * Slugify a name for use in preset IDs.
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    // Use the slug only if it retains enough of the name to avoid collisions.
    // For names with substantial ASCII content (e.g. "JR East" → "jr-east")
    // the slug is fine.  For names with mostly non-ASCII characters
    // (e.g. "JR東日本" → "jr") the slug is too generic and we append a hash.
    if (slug && slug.length >= 5) return slug;
    // Fallback: djb2 hash so preset ids stay deterministic.
    let hash = 5381;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
    }
    const hashPart = (hash >>> 0).toString(36);
    return slug ? `${slug}-${hashPart}` : `op${hashPart}`;
}

/**
 * Build a per-operator OSM baseline preset.
 *
 * @param {string} regionId
 * @param {string} canonicalOperator - normalized operator name
 * @param {object[]} stations - OSM station records (original format with operator)
 * @returns {object} preset
 */
function buildOperatorPreset(regionId, canonicalOperator, stations) {
    const id = `osm-${regionId}-${slugify(canonicalOperator)}`;
    const bbox = computeBbox(stations);

    const stationContributions = stations.map((s) => ({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        mergeKey: s.mergeKey || s.id,
        name: s.name,
        nameEn: s.nameEn,
        routeIds: [],
        sourceId: s.id,
        operator: canonicalOperator,
    }));

    return {
        id,
        label: canonicalOperator,
        operator: canonicalOperator,
        bbox,
        defaultColor: "#1f6f78", // STATION_FALLBACK_COLOR
        routes: [],
        stations: stationContributions,
        source: { kind: "osm", namespace: "openstreetmap" },
        kind: "operator",
    };
}

/**
 * Build the "Other" coverage preset for small/no-operator stations.
 *
 * @param {string} regionId
 * @param {object[]} stations - leftover OSM stations (no operator or <3 per operator)
 * @returns {object} preset
 */
function buildOtherPreset(regionId, stations) {
    const id = `osm-${regionId}-other`;
    const bbox = computeBbox(stations);

    const stationContributions = stations.map((s) => ({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        mergeKey: s.id,
        name: s.name,
        nameEn: s.nameEn,
        routeIds: [],
        sourceId: s.id,
        operator: s.operator || undefined,
    }));

    return {
        id,
        label: `Other stations in ${regionId}`,
        operator: "OpenStreetMap",
        bbox,
        defaultColor: "#1f6f78", // STATION_FALLBACK_COLOR
        routes: [],
        stations: stationContributions,
        source: { kind: "osm", namespace: "openstreetmap" },
        kind: "coverage",
    };
}

/**
 * Compute the bounding box of an array of { lon, lat } objects.
 * @param {object[]} items - array with lon/lat fields
 * @returns {[number, number, number, number]} [w, s, e, n]
 */
function computeBbox(items) {
    return items.reduce(
        ([bw, bs, be, bn], s) => [
            Math.min(bw, s.lon),
            Math.min(bs, s.lat),
            Math.max(be, s.lon),
            Math.max(bn, s.lat),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
    );
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

    if (data.osmRouteStats) {
        lines.push("## OSM route stats");
        lines.push("");
        lines.push(`- Total relations: ${data.osmRouteStats.totalRelations}`);
        lines.push(`- Lines kept: ${data.osmRouteStats.linesKept}`);
        lines.push(
            `- Lines dropped (GTFS-sourced): ${data.osmRouteStats.linesDroppedGtfs}`,
        );
        lines.push(
            `- Lines too few stations: ${data.osmRouteStats.linesTooFewStations}`,
        );
        lines.push(`- Unresolved stops: ${data.osmRouteStats.unresolvedStops}`);
        lines.push(`- Detected jumps: ${data.osmRouteStats.detectedJumps}`);
        lines.push(`- Repaired stops: ${data.osmRouteStats.repairedStops}`);
        lines.push(
            `- Unrepairable variants: ${data.osmRouteStats.unrepairableVariants}`,
        );
        lines.push(
            `- Ambiguous spatial matches: ${data.osmRouteStats.ambiguousMatches}`,
        );
        lines.push(`- Weak spatial matches: ${data.osmRouteStats.weakMatches}`);
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

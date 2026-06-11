/**
 * Station conflation: attach route-less OSM records to route-bearing seeds.
 *
 * Design decisions (design.md):
 *  - D1: signals = wikidata + normalized name + distance (no stop_area, no
 *    transliteration, no blind tight-distance merge)
 *  - D2: seeds never merge with each other; conflation only attaches
 *    route-less records to seeds
 */

import { buildGrid, gridNeighbors, haversineM } from "./grid.mjs";
import { normalizeName } from "./names.mjs";

// ─── Name matching ─────────────────────────────────────────────────────────

/**
 * True when any normalized variant of `record` matches any normalized
 * variant of `seed`.
 */
function nameVariantsMatch(recordVariants, seedVariants, suffixes) {
    const rSet = new Set(
        recordVariants.map((v) => normalizeName(v, suffixes)).filter(Boolean),
    );
    const sSet = new Set(
        seedVariants.map((v) => normalizeName(v, suffixes)).filter(Boolean),
    );
    for (const rv of rSet) {
        if (sSet.has(rv)) return true;
    }
    return false;
}

// ─── Aliases ───────────────────────────────────────────────────────────────

/**
 * Check aliases from config.
 *
 * @param {object[]} aliases - config aliases array
 * @param {string} looseId - OSM node id
 * @param {string} seedId - seed's canonical id
 * @returns {"force" | "forbid" | null}
 */
function checkAliases(aliases, looseId, seedId) {
    for (const entry of aliases) {
        if (!entry) continue;
        if (entry.attach) {
            const [a, b] = entry.attach;
            if (
                (a === looseId && b === seedId) ||
                (a === seedId && b === looseId)
            ) {
                return "force";
            }
        }
        if (entry.separate) {
            const [a, b] = entry.separate;
            if (
                (a === looseId && b === seedId) ||
                (a === seedId && b === looseId)
            ) {
                return "forbid";
            }
        }
    }
    return null;
}

// ─── Attachments ───────────────────────────────────────────────────────────

/**
 * Attach route-less OSM records to route-bearing seeds.
 *
 * For each loose record, finds candidate seeds within maxClusterMeters.
 * Attaches when: wikidata matches, OR normalized name matches, OR aliases
 * force-attach. Aliases forbid-attach overrides all.
 *
 * A single loose record may attach to multiple seeds (Ōtemachi node → all
 * five per-line seeds).
 *
 * @param {object} opts
 * @param {object[]} opts.seeds - route-bearing station records
 * @param {object[]} opts.looseRecords - route-less OSM records
 * @param {number} opts.maxClusterMeters
 * @param {string[]} opts.suffixes - locale nameSuffixes
 * @param {object[]} opts.aliases - config aliases
 * @returns {{
 *   enrichedSeeds: object[],
 *   standaloneStations: object[],
 *   attachments: object[],
 *   nearMisses: object[]
 * }}
 */
export function attachStationRecords({
    seeds,
    looseRecords,
    maxClusterMeters = 150,
    suffixes = [],
    aliases = [],
}) {
    const cellDeg = maxClusterMeters / 70000; // ~150 m ≈ 0.002 deg
    const grid = buildGrid(seeds, cellDeg);

    const attachments = []; // { looseId, seedIds: string[] }
    const nearMisses = []; // { looseId, seedId, distM, looseName, seedName }
    const unattached = [];

    for (const loose of looseRecords) {
        const neighborIndices = gridNeighbors(
            grid,
            loose.lat,
            loose.lon,
            maxClusterMeters,
        );

        const attachedSeedIds = [];
        let anyForbid = false;

        for (const idx of neighborIndices) {
            const seed = seeds[idx];
            const dist = haversineM(loose.lat, loose.lon, seed.lat, seed.lon);

            // Check aliases first (override).
            const aliasResult = checkAliases(aliases, loose.id, seed.id);
            if (aliasResult === "forbid") {
                anyForbid = true;
                continue;
            }
            if (aliasResult === "force") {
                attachedSeedIds.push(seed.id);
                continue;
            }

            // Signal 1: wikidata match.
            if (
                loose.wikidata &&
                seed.wikidata &&
                loose.wikidata === seed.wikidata
            ) {
                attachedSeedIds.push(seed.id);
                continue;
            }

            // Signal 2: normalized name match.
            const looseVariants = loose.nameVariants ?? [loose.name];
            const seedVariants = seed.nameVariants ?? [seed.name];
            if (nameVariantsMatch(looseVariants, seedVariants, suffixes)) {
                attachedSeedIds.push(seed.id);
                continue;
            }

            // Near-miss: within range but no signal matched.
            nearMisses.push({
                looseId: loose.id,
                seedId: seed.id,
                distM: Math.round(dist),
                looseName: loose.name,
                seedName: seed.name,
            });
        }

        if (anyForbid) {
            unattached.push(loose);
            continue;
        }

        if (attachedSeedIds.length > 0) {
            attachments.push({
                looseId: loose.id,
                seedIds: [...new Set(attachedSeedIds)],
            });
        } else {
            unattached.push(loose);
        }
    }

    // Enrich seeds with contributions from attached loose records.
    const enrichedSeeds = seeds.map((seed) => {
        const contributors = attachments.filter((a) =>
            a.seedIds.includes(seed.id),
        );
        const enriched = { ...seed };
        for (const att of contributors) {
            const loose = looseRecords.find((r) => r.id === att.looseId);
            if (!loose) continue;
            // Contribute nameEn, wikidata, operator, and OSM source id if seed
            // doesn't have them.
            if (!enriched.nameEn && loose.nameEn)
                enriched.nameEn = loose.nameEn;
            if (!enriched.wikidata && loose.wikidata)
                enriched.wikidata = loose.wikidata;
            if (loose.operator) {
                if (!enriched.osmOperators) enriched.osmOperators = [];
                if (!enriched.osmOperators.includes(loose.operator))
                    enriched.osmOperators.push(loose.operator);
            }
            // Track which OSM records contributed to this seed, so we can
            // include the seed in per-operator OSM presets.
            if (!enriched.osmSourceIds) enriched.osmSourceIds = [];
            if (!enriched.osmSourceIds.includes(loose.id))
                enriched.osmSourceIds.push(loose.id);
        }
        return enriched;
    });

    return {
        enrichedSeeds,
        standaloneStations: unattached,
        attachments,
        nearMisses,
    };
}

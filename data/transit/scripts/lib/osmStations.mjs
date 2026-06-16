/**
 * OSM station record mapping and intra-source deduplication.
 *
 * Pure functions — no I/O.  The OSM stage handles osmium invocation and
 * GeoJSONSeq streaming.
 */

import { normalizeName, collectNameVariants } from "./names.mjs";
import { haversineKm } from "../../../lib/geo/index.mjs";

// ─── Canonical OSM identity (mirrors transitIdentity.ts) ─────────────────

/**
 * Format an OSM element id: `osm:<type>:<id>`.
 * Must match the format validated by `isCanonicalTransitStationId` in
 * transitIdentity.ts.
 */
export function createOsmElementId(type, id) {
    const num = typeof id === "number" ? id : parseInt(String(id), 10);
    if (!Number.isFinite(num) || num < 1) {
        throw new Error(`OSM element ids must be positive integers, got ${id}`);
    }
    return `osm:${type}:${num}`;
}

// ─── Record mapping ───────────────────────────────────────────────────────

/**
 * Map a single OSM node GeoJSON feature to a station record.
 *
 * @param {object} feature - GeoJSON Feature with properties.tags (osmium -a type,id export)
 * @param {string} regionId - Geofabrik region id
 * @param {string[]} suffixes - locale nameSuffixes from config
 * @param {{ skippedNoName: number, skippedNoId: number, skippedNonRailway: number }} stats - mutable stats accumulator
 * @param {object} [opts] - options
 * @param {string[]} [opts.acceptModes] - accepted railway/public_transport modes (default: rail-only gate)
 * @returns {object|null} station record or null (skip)
 */
export function mapOsmNode(feature, regionId, suffixes, stats, opts) {
    const props = feature.properties ?? {};
    const tags = props.tags ?? props;
    const name = tags.name;
    if (!name || typeof name !== "string" || name.trim() === "") {
        stats.skippedNoName++;
        return null;
    }

    const id = feature.id ?? props["@id"];
    if (id == null) {
        stats.skippedNoId++;
        return null;
    }

    const geom = feature.geometry;
    if (!geom || geom.type !== "Point") return null;

    const [lon, lat] = geom.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    // Reject non-railway nodes that were pulled in by the broad
    // public_transport=station filter (bus terminals, ferry landings,
    // gondola stations, etc.).  A railway station must carry a railway
    // tag; public_transport=station alone is mode-agnostic.
    // When opts.acceptModes is provided, check against that list instead
    // of the hardcoded railway gate (T17 seam for bus/tram modes).
    const acceptModes = opts?.acceptModes;
    if (acceptModes) {
        // Config-driven mode gate: check railway tag against accepted modes.
        if (!tags.railway || !acceptModes.includes(tags.railway)) {
            stats.skippedNonRailway++;
            return null;
        }
    } else if (!tags.railway) {
        stats.skippedNonRailway++;
        return null;
    }

    const nameVariants = collectNameVariants(tags);
    const normalized = normalizeName(name, suffixes);

    return {
        id: createOsmElementId("node", id),
        lat,
        lon,
        name,
        nameEn: tags["name:en"] || undefined,
        nameVariants,
        normalizedName: normalized,
        wikidata: tags.wikidata || undefined,
        operator: tags.operator || undefined,
        tags: {
            railway: tags.railway || undefined,
            public_transport: tags.public_transport || undefined,
            highspeed: tags.highspeed || undefined,
        },
        region: regionId,
    };
}

// ─── Intra-source dedup ───────────────────────────────────────────────────

/**
 * Completeness score for preferring one record over another in dedup.
 * Higher = more complete.
 */
export function completenessScore(rec) {
    let score = 0;
    if (rec.nameEn) score += 4;
    if (rec.operator) score += 2;
    if (rec.wikidata) score += 1;
    if (rec.tags?.railway === "station") score += 3;
    return score;
}

/**
 * Distance in meters between two [lon, lat] points (approximate).
 * Delegates to the shared haversineKm (returns km) and converts to meters.
 */
function haversineM(a, b) {
    return haversineKm(a, b) * 1000;
}

/**
 * Deduplicate OSM station records within a region.
 *
 * Rules (in priority order):
 * 1. Same `id` → keep first (region-boundary overlap).
 * 2. Same `wikidata` → keep most complete.
 * 3. Same `normalizedName` within `maxDistM` (default 150 m) → keep most complete.
 *
 * @param {object[]} records
 * @param {number} [maxDistM=150]
 * @returns {{ kept: object[], stats: object }}
 */
export function dedupeOsmStations(records, maxDistM = 150) {
    const stats = {
        droppedById: 0,
        droppedByWikidata: 0,
        droppedByNameDist: 0,
    };

    // Dedup by id first.
    const seenIds = new Set();
    const byId = [];
    for (const r of records) {
        if (seenIds.has(r.id)) {
            stats.droppedById++;
            continue;
        }
        seenIds.add(r.id);
        byId.push(r);
    }

    // Dedup by wikidata.
    const wikidataMap = new Map();
    const afterWiki = [];
    for (const r of byId) {
        if (r.wikidata) {
            const existing = wikidataMap.get(r.wikidata);
            if (existing) {
                stats.droppedByWikidata++;
                if (completenessScore(r) > completenessScore(existing)) {
                    wikidataMap.set(r.wikidata, r);
                    // Replace in output.
                    const idx = afterWiki.indexOf(existing);
                    if (idx >= 0) afterWiki[idx] = r;
                }
                continue;
            }
            wikidataMap.set(r.wikidata, r);
        }
        afterWiki.push(r);
    }

    // Dedup by normalized name + distance.
    const kept = [];
    for (const r of afterWiki) {
        if (!r.normalizedName) {
            kept.push(r);
            continue;
        }

        let merged = false;
        for (let i = 0; i < kept.length; i++) {
            const k = kept[i];
            if (!k.normalizedName) continue;
            if (k.normalizedName !== r.normalizedName) continue;

            const dist = haversineM([k.lon, k.lat], [r.lon, r.lat]);
            if (dist <= maxDistM) {
                stats.droppedByNameDist++;
                if (completenessScore(r) > completenessScore(k)) {
                    kept[i] = r;
                }
                merged = true;
                break;
            }
        }
        if (!merged) kept.push(r);
    }

    return { kept, stats };
}

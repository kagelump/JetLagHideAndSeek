import type { MatchingCategory } from "./matchingTypes";

export type OsmElementType = "node" | "way" | "relation";

/** A single ANDed tag condition, e.g. { key: "leisure", value: "park" }. */
export type OsmTagCondition = { key: string; value: string };

/**
 * One selector = a set of ANDed conditions plus the element types to match.
 * A category's selectors are ORed together.
 */
export type OsmSelector = {
    match: OsmTagCondition[];
    /** Defaults to all three types when omitted. */
    types?: OsmElementType[];
};

/**
 * Categories that produce OSM-tag-based point POIs bundleable for offline use.
 *
 * Admin-division categories (admin-1st…admin-4th) are intentionally excluded
 * in Phase 1 — they map to boundary=administrative relations that will be
 * derived from the boundary pipeline later. They fall through to Overpass.
 *
 * transit-line has no OSM tags (osmQueryTags: "") and is handled by the
 * ODPT/transit feature; it is not bundleable.
 */
export const CATEGORY_SELECTORS: Partial<
    Record<MatchingCategory, OsmSelector[]>
> = {
    "commercial-airport": [{ match: [{ key: "aeroway", value: "aerodrome" }] }],
    mountain: [{ match: [{ key: "natural", value: "peak" }] }],
    landmark: [{ match: [{ key: "tourism", value: "attraction" }] }],
    park: [{ match: [{ key: "leisure", value: "park" }] }],
    "amusement-park": [{ match: [{ key: "tourism", value: "theme_park" }] }],
    zoo: [{ match: [{ key: "tourism", value: "zoo" }] }],
    aquarium: [{ match: [{ key: "tourism", value: "aquarium" }] }],
    "golf-course": [{ match: [{ key: "leisure", value: "golf_course" }] }],
    museum: [{ match: [{ key: "tourism", value: "museum" }] }],
    "movie-theater": [{ match: [{ key: "amenity", value: "cinema" }] }],
    hospital: [{ match: [{ key: "amenity", value: "hospital" }] }],
    library: [{ match: [{ key: "amenity", value: "library" }] }],
    "foreign-consulate": [
        { match: [{ key: "diplomatic", value: "consulate" }] },
    ],
    // railway=station already covers station=subway (the latter is a subset).
    "station-name-length": [{ match: [{ key: "railway", value: "station" }] }],
    // admin-1st..4th map to boundary=administrative relations and are intentionally
    // NOT bundled in Phase 1 — see epic "Category set". Keep them OUT of this map so
    // they fall through to Overpass.
};

/** Converts ANDed conditions to an Overpass-QL tag-filter string. */
export function selectorToOverpassTags(conditions: OsmTagCondition[]): string {
    return conditions.map((c) => `["${c.key}"="${c.value}"]`).join("");
}

/**
 * Derives the Overpass-QL `osmQueryTags` string for a category whose selectors
 * form a single ANDed group (every Phase 1 category does). Returns "" when the
 * category is not in the registry or when it requires multiple ORed selectors
 * (caller must keep its special query path — no Phase 1 category does this).
 */
export function deriveOsmQueryTags(category: MatchingCategory): string {
    const selectors = CATEGORY_SELECTORS[category];
    if (!selectors || selectors.length !== 1) return "";
    return selectorToOverpassTags(selectors[0].match);
}

/** True when the category has bundleable OSM POI selectors. */
export function isBundleableCategory(category: MatchingCategory): boolean {
    return Boolean(CATEGORY_SELECTORS[category]);
}

/**
 * Flattens the registry into `osmium tags-filter` arguments, e.g.
 * "leisure=park", "amenity=hospital,cinema,library". Used by the emit script
 * and the pipeline.
 *
 * Groups single-condition selectors by key with comma-joined values; emits
 * multi-condition selectors as separate `key=value` args (osmium ANDs nothing,
 * so multi-condition AND selectors — none in Phase 1 — must be filtered
 * post-hoc).
 */
export function toTagsFilterArgs(): string[] {
    const byKey = new Map<string, Set<string>>();
    for (const selectors of Object.values(CATEGORY_SELECTORS)) {
        for (const sel of selectors ?? []) {
            if (sel.match.length !== 1) continue; // Phase 1 has none; guard anyway.
            const { key, value } = sel.match[0];
            if (!byKey.has(key)) byKey.set(key, new Set());
            byKey.get(key)!.add(value);
        }
    }
    return [...byKey.entries()].map(
        ([key, values]) => `${key}=${[...values].sort().join(",")}`,
    );
}

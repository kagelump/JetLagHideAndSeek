import type { MatchingCategory } from "./matchingTypes";

export type OsmElementType = "node" | "way" | "relation";

/**
 * A single ANDed tag condition, e.g. { key: "leisure", value: "park" }.
 * When `value` is omitted the condition matches any element that has the key
 * set (Overpass exists-style filter `["key"]`).
 */
export type OsmTagCondition = { key: string; value?: string };

/**
 * One selector = a set of ANDed conditions plus the element types to match.
 * A category's selectors are ORed together.
 */
export type OsmSelector = {
    match: OsmTagCondition[];
    /** Negative conditions — elements matching any of these are excluded. */
    exclude?: OsmTagCondition[];
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
    "commercial-airport": [
        {
            match: [{ key: "aeroway", value: "aerodrome" }, { key: "iata" }],
            exclude: [
                { key: "military", value: "airfield" },
                { key: "landuse", value: "military" },
            ],
        },
    ],
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
    "foreign-consulate": [{ match: [{ key: "diplomatic", value: "embassy" }] }],
    // railway=station already covers station=subway (the latter is a subset).
    "station-name-length": [{ match: [{ key: "railway", value: "station" }] }],
    // admin-1st..4th map to boundary=administrative relations and are intentionally
    // NOT bundled in Phase 1 — see epic "Category set". Keep them OUT of this map so
    // they fall through to Overpass.
};

/** Converts ANDed conditions to an Overpass-QL tag-filter string. */
export function selectorToOverpassTags(conditions: OsmTagCondition[]): string {
    return conditions
        .map((c) =>
            c.value !== undefined
                ? `["${c.key}"="${c.value}"]`
                : `["${c.key}"]`,
        )
        .join("");
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
    const sel = selectors[0];
    let tags = selectorToOverpassTags(sel.match);
    for (const cond of sel.exclude ?? []) {
        if (cond.value !== undefined) {
            tags += `["${cond.key}"!="${cond.value}"]`;
        }
    }
    return tags;
}

/** True when the category has bundleable OSM POI selectors. */
export function isBundleableCategory(category: MatchingCategory): boolean {
    return Boolean(CATEGORY_SELECTORS[category]);
}

/** True when the category uses the admin boundary polygon index. */
export function isAdminBoundaryCategory(category: MatchingCategory): boolean {
    return (
        category === "admin-1st" ||
        category === "admin-2nd" ||
        category === "admin-3rd" ||
        category === "admin-4th"
    );
}

/**
 * Flattens the registry into `osmium tags-filter` arguments, e.g.
 * "leisure=park", "amenity=hospital,cinema,library". Used by the emit script
 * and the pipeline.
 *
 * Groups value-bearing conditions by key with comma-joined values across ALL
 * selectors (single- and multi-condition alike). Key-only conditions (e.g.
 * `iata`) are skipped — osmium cannot filter "key exists" as a `key=value`
 * arg; they are applied post-hoc by the reducer.
 *
 * osmium tags-filter ORs its arguments, so emitting every value-bearing
 * condition produces a coarse superset; the reducer then applies the full AND
 * selector (including key-only conditions) to assign each feature to the
 * correct category.
 */
export function toTagsFilterArgs(): string[] {
    const byKey = new Map<string, Set<string>>();
    for (const selectors of Object.values(CATEGORY_SELECTORS)) {
        for (const sel of selectors ?? []) {
            for (const cond of sel.match) {
                if (cond.value === undefined) continue; // key-only → post-hoc only
                if (!byKey.has(cond.key)) byKey.set(cond.key, new Set());
                byKey.get(cond.key)!.add(cond.value);
            }
        }
    }
    return [...byKey.entries()].map(
        ([key, values]) => `${key}=${[...values].sort().join(",")}`,
    );
}

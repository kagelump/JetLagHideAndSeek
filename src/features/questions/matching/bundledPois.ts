import type { Bbox } from "@/shared/geojson";
import type { MatchingCategory, OsmFeature } from "./matchingTypes";
import regionsJson from "../../../../assets/poi/regions.json";

// ─── Types ─────────────────────────────────────────────────────────────────

export type RawCategory = {
    count: number;
    lon: number[];
    lat: number[];
    name: string[];
    osmId: number[];
    osmType: number[];
    nameLength?: number[]; // present only for station-name-length
};

export type RawRegion = {
    schemaVersion: number;
    region: string;
    label: string;
    generatedAt: string;
    bbox: Bbox;
    totalCount: number;
    categories: Partial<Record<MatchingCategory, RawCategory>>;
};

export type RegionMeta = {
    id: string;
    label: string;
    bbox: Bbox;
    /** Total feature count across all categories. */
    totalCount: number;
    file: string;
};

// ─── Module-level state ─────────────────────────────────────────────────

const OSM_TYPES = ["node", "way", "relation"] as const;

/** Parsed regions.json registry (small, eager import). */
const REGIONS: RegionMeta[] = (
    regionsJson as unknown as { regions: RegionMeta[] }
).regions;

/**
 * Injectable thunk registry: regionId → lazy loader function.
 *
 * Production populates this with `require()`-based thunks (one `case` per
 * bundled region). Tests inject fixtures without touching Metro's resolver.
 */
export const regionLoaders = new Map<string, () => RawRegion>();

// ─── Production loader registration ─────────────────────────────────────

// Register bundled regions — add one `case` per region in regions.json.
// The require() path is a literal so Metro can resolve and bundle it lazily.
for (const region of REGIONS) {
    switch (region.id) {
        case "japan-kanto":
            // Lazy thunk: require is not called until first access.
            regionLoaders.set(region.id, () =>
                require("../../../../assets/poi/japan-kanto.json"),
            );
            break;
        // Future regions: add a case here.
        default:
            if (__DEV__) {
                console.warn(
                    `[bundledPois] No loader registered for region "${region.id}" — it will not resolve.`,
                );
            }
    }
}

// ─── Region cache (memoized parsed results) ─────────────────────────────

const regionCache = new Map<string, RawRegion | null>();

function loadRegionRaw(regionId: string): RawRegion | null {
    const cached = regionCache.get(regionId);
    if (cached !== undefined) return cached; // null is a valid cached "not found"

    const loader = regionLoaders.get(regionId);
    if (!loader) {
        regionCache.set(regionId, null);
        return null;
    }

    let raw: RawRegion;
    try {
        raw = loader() as RawRegion;
    } catch {
        regionCache.set(regionId, null);
        return null;
    }

    // Schema version guard — a mismatched asset won't crash the app.
    if (raw.schemaVersion !== 1) {
        if (__DEV__) {
            console.warn(
                `[bundledPois] Region "${regionId}" has unsupported schemaVersion ${raw.schemaVersion} — treating as unavailable.`,
            );
        }
        regionCache.set(regionId, null);
        return null;
    }

    regionCache.set(regionId, raw);
    return raw;
}

// ─── Coverage ────────────────────────────────────────────────────────────

function bboxContainsPoint(b: Bbox, lat: number, lon: number): boolean {
    const [w, s, e, n] = b;
    return lon >= w && lon <= e && lat >= s && lat <= n;
}

function bboxContainsBbox(outer: Bbox, inner: Bbox): boolean {
    return (
        inner[0] >= outer[0] &&
        inner[1] >= outer[1] &&
        inner[2] <= outer[2] &&
        inner[3] <= outer[3]
    );
}

/** Region whose bbox fully contains the query bbox, or null. */
export function regionCoveringBbox(bbox: Bbox): string | null {
    for (const r of REGIONS) {
        if (bboxContainsBbox(r.bbox, bbox)) return r.id;
    }
    return null;
}

/** Region whose bbox contains the point, or null. */
export function regionCoveringPoint(lat: number, lon: number): string | null {
    for (const r of REGIONS) {
        if (bboxContainsPoint(r.bbox, lat, lon)) return r.id;
    }
    return null;
}

// ─── Category accessor ───────────────────────────────────────────────────

const categoryFeatureCache = new Map<string, OsmFeature[]>(); // `${regionId}:${category}`

/**
 * Reconstructs `OsmFeature[]` for a category in a region.
 * Memoized — the same (region, category) reuses the array across cell lookups.
 * Returns an empty array when the region is unavailable or the category has
 * zero features.
 */
export function getBundledCategoryFeatures(
    regionId: string,
    category: MatchingCategory,
): OsmFeature[] {
    const key = `${regionId}:${category}`;
    const hit = categoryFeatureCache.get(key);
    if (hit) return hit;

    const region = loadRegionRaw(regionId);
    const col = region?.categories[category];
    if (!col) {
        categoryFeatureCache.set(key, []);
        return [];
    }

    const out: OsmFeature[] = new Array(col.count);
    for (let i = 0; i < col.count; i++) {
        const f: OsmFeature = {
            lat: col.lat[i],
            lon: col.lon[i],
            name: col.name[i],
            osmId: col.osmId[i],
            osmType: OSM_TYPES[col.osmType[i]] ?? "node",
            tags: {},
        };
        if (col.nameLength) f.nameLength = col.nameLength[i];
        out[i] = f;
    }
    categoryFeatureCache.set(key, out);
    return out;
}

/** Returns the bundle's generatedAt for staleness stamping, or null. */
export function getRegionGeneratedAt(regionId: string): string | null {
    return loadRegionRaw(regionId)?.generatedAt ?? null;
}

// ─── Test support ────────────────────────────────────────────────────────

/** Clears the in-memory region cache and restores module state. Call in tests to reset state. */
export function clearBundledRegionCache(): void {
    regionCache.clear();
    categoryFeatureCache.clear();
    // Empty REGIONS — tests re-register their fixtures via registerTestRegion.
    REGIONS.length = 0;
}

/** Registers a test fixture in the loader map. */
export function registerTestRegion(id: string, raw: RawRegion): void {
    regionLoaders.set(id, () => raw);
    regionCache.delete(id);
    // Also register metadata so coverage functions see the region.
    const existing = REGIONS.findIndex((r) => r.id === id);
    const meta: RegionMeta = {
        id,
        label: raw.label,
        bbox: raw.bbox,
        totalCount: raw.totalCount,
        file: `${id}.json`,
    };
    if (existing >= 0) {
        REGIONS[existing] = meta;
    } else {
        REGIONS.push(meta);
    }
}

/** Removes a test region from metadata and loaders. */
export function unregisterTestRegion(id: string): void {
    regionLoaders.delete(id);
    regionCache.delete(id);
    const idx = REGIONS.findIndex((r) => r.id === id);
    if (idx >= 0) REGIONS.splice(idx, 1);
}

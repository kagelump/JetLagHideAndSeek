import KDBush from "kdbush";
import { around } from "geokdbush";

import { haversineDistanceMeters } from "@/shared/geojson";

import { getBundledCategoryColumns, OSM_TYPES } from "./bundledPois";
import type { RawCategory } from "./bundledPois";
import type { MatchingCategory } from "./matchingTypes";
import type { OsmFeatureWithDistance } from "./osmMatching";

// ─── Constants ────────────────────────────────────────────────────────────

const INDEX_NODE_SIZE = 64;

// ─── Module-level state ──────────────────────────────────────────────────

/** KDBush indices (and null sentinels for empty categories), keyed by `"${regionId}:${category}"`. */
const indexCache = new Map<string, KDBush | null>();

// ─── Cache key ───────────────────────────────────────────────────────────

function indexCacheKey(regionId: string, category: MatchingCategory): string {
    return `${regionId}:${category}`;
}

// ─── Build ────────────────────────────────────────────────────────────────

/**
 * Builds (or retrieves from cache) a KDBush spatial index for a category
 * within a region. The index is built directly from the columnar arrays
 * (`col.lon[i]`, `col.lat[i]`) — no OsmFeature objects are allocated during
 * construction.
 *
 * Returns null when the category is empty or the region is unavailable.
 */
function getOrBuildIndex(
    regionId: string,
    category: MatchingCategory,
): KDBush | null {
    const key = indexCacheKey(regionId, category);
    if (indexCache.has(key)) return indexCache.get(key)!;

    const col = getBundledCategoryColumns(regionId, category);
    if (!col || col.count === 0) {
        // Cache the null sentinel so subsequent queries for this empty
        // category short-circuit instead of re-fetching columns each time.
        indexCache.set(key, null);
        return null;
    }

    const index = new KDBush(col.count, INDEX_NODE_SIZE);
    for (let i = 0; i < col.count; i++) {
        index.add(col.lon[i], col.lat[i]);
    }
    index.finish();

    indexCache.set(key, index);
    return index;
}

// ─── Reconstruction ───────────────────────────────────────────────────────

/**
 * Converts KDBush numeric indices back into full OsmFeatureWithDistance
 * objects. Only the features that match the spatial query are materialized.
 */
function reconstructFromIndices(
    col: RawCategory,
    indices: number[],
    category: MatchingCategory,
    centerLon: number,
    centerLat: number,
): OsmFeatureWithDistance[] {
    const results: OsmFeatureWithDistance[] = new Array(indices.length);

    for (let n = 0; n < indices.length; n++) {
        const i = indices[n];
        const dist = haversineDistanceMeters(
            centerLat,
            centerLon,
            col.lat[i],
            col.lon[i],
        );

        const feature: OsmFeatureWithDistance = {
            lat: col.lat[i],
            lon: col.lon[i],
            name: col.name[i],
            osmId: col.osmId[i],
            osmType: OSM_TYPES[col.osmType[i]] ?? "node",
            tags: {},
            distanceMeters: dist,
        };

        // Optional columns — guard each with existence checks.
        if (col.nameLength) feature.nameLength = col.nameLength[i];
        if (col.iata?.[i]) feature.iata = col.iata[i] ?? undefined;
        if (col.nameEn?.[i]) feature.tags["name:en"] = col.nameEn[i]!;

        results[n] = feature;
    }

    return results;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Queries the spatial index for features within `radiusMeters` of
 * (`lng`, `lat`), sorted by haversine distance ascending.
 *
 * Returns the top `maxResults` candidates. Returns `null` when the spatial
 * index is not available for this region and category — the caller should
 * fall through to Overpass.
 */
export function querySpatialIndex(
    regionId: string,
    category: MatchingCategory,
    lng: number,
    lat: number,
    radiusMeters: number,
    maxResults: number,
): OsmFeatureWithDistance[] | null {
    const t0 = Date.now();
    const index = getOrBuildIndex(regionId, category);
    if (!index) return null; // null = empty category or unavailable region
    const buildMs = Date.now() - t0;

    // geokdbush maxDistance is in kilometres.
    const maxDistanceKm = radiusMeters / 1000;

    const qT0 = Date.now();
    const indices: number[] = around(
        index,
        lng,
        lat,
        maxResults,
        maxDistanceKm,
    ) as number[];
    const queryMs = Date.now() - qT0;

    if (indices.length === 0) {
        return [] as OsmFeatureWithDistance[];
    }

    // Re-fetch columns for reconstruction (the index caches the kd-tree,
    // not the raw columns — they're cheap to re-get via loadRegionRaw cache).
    const col = getBundledCategoryColumns(regionId, category);
    if (!col) return null;

    const rT0 = Date.now();
    const results = reconstructFromIndices(col, indices, category, lng, lat);
    const reconstructMs = Date.now() - rT0;

    if (__DEV__) {
        console.log(
            `[spatialIndex:query] ${category} r=${radiusMeters}m → ${indices.length} indices ` +
                `(build:${buildMs}ms query:${queryMs}ms reconstruct:${reconstructMs}ms)`,
        );
    }

    return results;
}

/** Clears the in-memory spatial index cache. Call in tests or on cache reset. */
export function clearSpatialIndexCache(): void {
    indexCache.clear();
}

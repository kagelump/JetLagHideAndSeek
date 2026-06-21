import { multiPoint } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import {
    haversineDistanceMeters,
    type Bbox,
    type Position,
} from "@/shared/geojson";
import { getGeometryBackend } from "@/shared/geometry/geometryBackend";
import {
    getBundledCategoryColumns,
    regionCoveringBbox,
    regionCoveringPoint,
} from "@/features/questions/matching/bundledPois";
import type { RawCategory } from "@/features/questions/matching/bundledPois";
import type { MatchingCategory } from "@/features/questions/matching/matchingTypes";
import { MEASURING_TO_MATCHING_CATEGORY } from "./measuringCategories";
import type { MeasuringCategory } from "./measuringTypes";
import {
    APP_CONFIG,
    MEASURING_POINT,
    gridDedupCellSize,
} from "@/config/appConfig";
import { createLogger } from "@/shared/logger";

const log = createLogger("pointMeasuring");

export type NearestPoiResult = {
    /** Nearest POI location (GeoJSON [lon, lat]). */
    nearestPoint: Position;
    /** Haversine distance in meters from `center` to `nearestPoint`. */
    distanceMeters: number;
};

// ─── LRU cache: nearest distance ─────────────────────────────────────────────

/** Increment to invalidate all cached distance results when the algorithm changes. */
const POINT_DISTANCE_CACHE_VERSION = 1;

/** Maximum number of cached nearest-distance results. */
const POINT_DISTANCE_CACHE_MAX = MEASURING_POINT.distanceCacheMax;

const distanceCache = new Map<string, NearestPoiResult | null>();

function distanceCacheKey(
    category: MeasuringCategory,
    center: Position,
): string {
    return [
        POINT_DISTANCE_CACHE_VERSION,
        category,
        center[0].toFixed(7),
        center[1].toFixed(7),
    ].join(":");
}

/** Clears the in-memory point-distance cache. Call in tests to reset state. */
export function clearPointDistanceCache(): void {
    distanceCache.clear();
}

// ─── LRU cache: union buffer ─────────────────────────────────────────────────

/** Increment to invalidate all cached buffer results when the algorithm changes. */
const POINT_BUFFER_CACHE_VERSION = 1;

/** Maximum number of cached buffer results. */
const POINT_BUFFER_CACHE_MAX = MEASURING_POINT.bufferCacheMax;

const bufferCache = new Map<string, Feature<Polygon | MultiPolygon> | null>();

function bufferCacheKey(
    category: MeasuringCategory,
    center: Position,
    radiusMeters: number,
): string {
    return [
        POINT_BUFFER_CACHE_VERSION,
        category,
        center[0].toFixed(5),
        center[1].toFixed(5),
        Math.round(radiusMeters / 10) * 10, // 10 m granularity
    ].join(":");
}

/** Clears the in-memory point-buffer cache. Call in tests to reset state. */
export function clearPointBufferCache(): void {
    bufferCache.clear();
}

// ─── Degrees/meters conversion ───────────────────────────────────────────────

const { degPerMeter: DEG_PER_METER } = APP_CONFIG.measuring;

/** Convert meters to degrees longitude at a given latitude. */
function metersToDegLon(meters: number, lat: number): number {
    return meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

/** Convert meters to degrees latitude (constant). */
function metersToDegLat(meters: number): number {
    return meters * DEG_PER_METER;
}

// ─── Bbox pre-filter ─────────────────────────────────────────────────────────

const FALLBACK_MARGIN_DEG = MEASURING_POINT.fallbackMarginM * DEG_PER_METER;

/**
 * Collect indices of points whose (lon, lat) fall inside `queryBbox`.
 * Operates on columnar data directly — no OsmFeature allocation.
 */
function bboxFilterIndices(col: RawCategory, queryBbox: Bbox): number[] {
    const [w, s, e, n] = queryBbox;
    const result: number[] = [];
    for (let i = 0; i < col.count; i++) {
        const lon = col.lon[i];
        const lat = col.lat[i];
        if (lon >= w && lon <= e && lat >= s && lat <= n) {
            result.push(i);
        }
    }
    return result;
}

// ─── Resolve matching category ───────────────────────────────────────────────

function resolveMatchingCategory(
    category: MeasuringCategory,
): MatchingCategory | null {
    return (
        (MEASURING_TO_MATCHING_CATEGORY[category] as
            | MatchingCategory
            | undefined) ?? null
    );
}

// ─── computeNearestPoiDistance ───────────────────────────────────────────────

/**
 * Nearest POI of `category` to `center`, resolved from the bundled spatial
 * data. LRU-cached on (category, center).
 *
 * Returns null when the region is unavailable, the category has no bundle
 * mapping, or no POIs are found.
 */
export function computeNearestPoiDistance(
    center: Position,
    category: MeasuringCategory,
): NearestPoiResult | null {
    const key = distanceCacheKey(category, center);
    if (distanceCache.has(key)) {
        const cached = distanceCache.get(key)!;
        // Promote to most-recently-used.
        distanceCache.delete(key);
        distanceCache.set(key, cached);
        return cached;
    }

    const matchingCategory = resolveMatchingCategory(category);
    if (!matchingCategory) {
        distanceCache.set(key, null);
        return null;
    }

    const regionId = regionCoveringPoint(center[1], center[0]);
    if (!regionId) {
        distanceCache.set(key, null);
        return null;
    }

    const col = getBundledCategoryColumns(regionId, matchingCategory);
    if (!col || col.count === 0) {
        distanceCache.set(key, null);
        return null;
    }

    // Defensive: validate column lengths match count.
    if (col.lon.length !== col.count || col.lat.length !== col.count) {
        if (__DEV__) {
            log.warn(
                `[pointDistance] Column length mismatch for ${regionId}:${matchingCategory}`,
            );
        }
        distanceCache.set(key, null);
        return null;
    }

    let nearestDist = Infinity;
    let nearestIdx = -1;

    for (let i = 0; i < col.count; i++) {
        // Skip invalid coordinates.
        if (!isFinite(col.lon[i]) || !isFinite(col.lat[i])) continue;
        const dist = haversineDistanceMeters(
            center[1],
            center[0],
            col.lat[i],
            col.lon[i],
        );
        if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = i;
        }
    }

    if (nearestIdx < 0) {
        distanceCache.set(key, null);
        return null;
    }

    const result: NearestPoiResult = {
        nearestPoint: [col.lon[nearestIdx], col.lat[nearestIdx]],
        distanceMeters: nearestDist,
    };

    // Evict oldest entry when cache exceeds max size.
    if (distanceCache.size >= POINT_DISTANCE_CACHE_MAX) {
        const oldest = distanceCache.keys().next().value;
        if (oldest !== undefined) distanceCache.delete(oldest);
    }
    distanceCache.set(key, result);

    return result;
}

// ─── computePointUnionBuffer ─────────────────────────────────────────────────

/**
 * Builds the union of `radiusMeters`-circles around every POI of `category`
 * whose circle intersects the play area.
 *
 * Pipeline:
 * 1. Resolve region from playAreaBbox (fallback center).
 * 2. Expand playAreaBbox by radiusMeters → query window.
 * 3. Filter POIs to those within the query window (bbox pre-filter).
 * 4. Grid-dedup surviving points (ε-net).
 * 5. Build MultiPoint and buffer with @turf/buffer (JSTS).
 *
 * Returns null when no region covers the area, or no POIs survive filtering.
 * LRU-cached on (category, center, radiusMeters).
 */
export function computePointUnionBuffer(
    center: Position,
    category: MeasuringCategory,
    radiusMeters: number,
    playAreaBbox: Bbox | undefined,
): Feature<Polygon | MultiPolygon> | null {
    if (radiusMeters <= 0) return null;

    const key = bufferCacheKey(category, center, radiusMeters);
    if (bufferCache.has(key)) {
        const cached = bufferCache.get(key)!;
        // Promote to most-recently-used.
        bufferCache.delete(key);
        bufferCache.set(key, cached);
        return cached;
    }

    const matchingCategory = resolveMatchingCategory(category);
    if (!matchingCategory) {
        bufferCache.set(key, null);
        return null;
    }

    // Resolve region — prefer covering the play area, fall back to center.
    const regionId =
        (playAreaBbox ? regionCoveringBbox(playAreaBbox) : null) ??
        regionCoveringPoint(center[1], center[0]);
    if (!regionId) {
        bufferCache.set(key, null);
        return null;
    }

    const col = getBundledCategoryColumns(regionId, matchingCategory);
    if (!col || col.count === 0) {
        bufferCache.set(key, null);
        return null;
    }

    // Defensive: validate column lengths.
    if (col.lon.length !== col.count || col.lat.length !== col.count) {
        if (__DEV__) {
            log.warn(
                `[pointBuffer] Column length mismatch for ${regionId}:${matchingCategory}`,
            );
        }
        bufferCache.set(key, null);
        return null;
    }

    // -- 1. Build query window --------------------------------------------------

    let queryBbox: Bbox;

    if (playAreaBbox) {
        const midLat = (playAreaBbox[1] + playAreaBbox[3]) / 2;
        queryBbox = [
            playAreaBbox[0] - metersToDegLon(radiusMeters, midLat),
            playAreaBbox[1] - metersToDegLat(radiusMeters),
            playAreaBbox[2] + metersToDegLon(radiusMeters, midLat),
            playAreaBbox[3] + metersToDegLat(radiusMeters),
        ];
    } else {
        queryBbox = [
            center[0] - FALLBACK_MARGIN_DEG,
            center[1] - FALLBACK_MARGIN_DEG,
            center[0] + FALLBACK_MARGIN_DEG,
            center[1] + FALLBACK_MARGIN_DEG,
        ];
    }

    // -- 2. Bbox pre-filter -----------------------------------------------------

    const survivingIndices = bboxFilterIndices(col, queryBbox);

    if (survivingIndices.length === 0) {
        bufferCache.set(key, null);
        return null;
    }

    log.debug(
        `[pointBuffer] ${survivingIndices.length} / ${col.count} POIs in query window`,
    );

    // -- 3. Grid-dedup -----------------------------------------------------------

    const cellSizeM = gridDedupCellSize(radiusMeters);

    // Extract column subset for dedup.
    const subsetLon = survivingIndices.map((i) => col.lon[i]);
    const subsetLat = survivingIndices.map((i) => col.lat[i]);
    const subsetCount = survivingIndices.length;

    const dedupKeep = new Set<number>();
    const midLat =
        subsetLat.length > 0
            ? subsetLat.reduce((a, b) => a + b, 0) / subsetLat.length
            : 35;
    const cellLonDeg = metersToDegLon(cellSizeM, midLat);
    const cellLatDeg = metersToDegLat(cellSizeM);
    const seen = new Set<string>();

    for (let i = 0; i < subsetCount; i++) {
        const gridX = Math.round(subsetLon[i] / cellLonDeg);
        const gridY = Math.round(subsetLat[i] / cellLatDeg);
        const gridKey = `${gridX}:${gridY}`;
        if (!seen.has(gridKey)) {
            seen.add(gridKey);
            dedupKeep.add(i);
        }
    }

    const dedupedCount = dedupKeep.size;

    log.debug(
        `[pointBuffer] grid-dedup (ε=${cellSizeM.toFixed(0)}m): ` +
            `${subsetCount} → ${dedupedCount} points`,
    );

    // -- 4. Build MultiPoint -----------------------------------------------------

    const pts: Position[] = [];
    for (let i = 0; i < subsetCount; i++) {
        if (!dedupKeep.has(i)) continue;
        const lon = subsetLon[i];
        const lat = subsetLat[i];
        // Defensive: skip invalid coordinates.
        if (!isFinite(lon) || !isFinite(lat)) continue;
        pts.push([lon, lat]);
    }

    if (pts.length === 0) {
        bufferCache.set(key, null);
        return null;
    }

    let mp;
    try {
        mp = multiPoint(pts);
    } catch (err) {
        log.warn(`[pointBuffer] multiPoint failed:`, err);
        bufferCache.set(key, null);
        return null;
    }

    // -- 5. Buffer ---------------------------------------------------------------

    const t0 = performance.now();
    let result;
    try {
        result = getGeometryBackend().bufferMeters(
            mp,
            radiusMeters,
            8, // Low circle resolution; union smooths the result.
        );
    } catch (err) {
        log.warn(
            `[pointBuffer] [${getGeometryBackend().name}] buffer failed:`,
            err,
        );
        bufferCache.set(key, null);
        return null;
    }
    const bufferMs = performance.now() - t0;

    if (!result) {
        log.debug(
            `[pointBuffer] [${getGeometryBackend().name}] buffer returned null`,
        );
        bufferCache.set(key, null);
        return null;
    }

    log.debug(
        `[pointBuffer] buffer done: ${result.geometry.type} ` +
            `in ${bufferMs.toFixed(0)}ms (${pts.length} points, r=${radiusMeters}m)`,
    );

    // Evict oldest entry when cache exceeds max size.
    if (bufferCache.size >= POINT_BUFFER_CACHE_MAX) {
        const oldest = bufferCache.keys().next().value;
        if (oldest !== undefined) bufferCache.delete(oldest);
    }
    bufferCache.set(key, result);

    return result;
}

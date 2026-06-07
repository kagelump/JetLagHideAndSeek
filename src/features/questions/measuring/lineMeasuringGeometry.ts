import nearestPointOnLine from "@turf/nearest-point-on-line";
import buffer from "@turf/buffer";
import { multiLineString, point } from "@turf/helpers";

import {
    bboxIntersects,
    haversineDistanceMeters,
    type Bbox,
    type Position,
} from "@/shared/geojson";
import type { Feature, MultiLineString, Polygon, MultiPolygon } from "geojson";
import type { MeasuringCategory } from "./measuringTypes";
import { getLineBundle } from "./lineBundleLoader";

export type NearestPointResult = {
    /** Nearest point on the line/edge (GeoJSON [lon, lat]). */
    nearestPoint: Position;
    /** Haversine distance in meters from `center` to `nearestPoint`. */
    distanceMeters: number;
};

// --- LRU cache ----------------------------------------------------------------

/** Increment to invalidate all cached results when the algorithm changes. */
const LINE_DISTANCE_CACHE_VERSION = 1;

/** Maximum number of cached nearest-point results. */
const LINE_DISTANCE_CACHE_MAX = 100;

/**
 * LRU cache keyed on (version, category, center). Two questions with the same
 * center share a hit -- the result depends solely on center + category.
 */
const distanceCache = new Map<string, NearestPointResult | null>();

function cacheKey(category: MeasuringCategory, center: Position): string {
    return [
        LINE_DISTANCE_CACHE_VERSION,
        category,
        center[0].toFixed(7),
        center[1].toFixed(7),
    ].join(":");
}

/** Clears the in-memory line-distance cache. Call in tests to reset state. */
export function clearLineDistanceCache(): void {
    distanceCache.clear();
}

// --- Query margin -------------------------------------------------------------

/** 50 km query window covers any plausible seeker distance. */
const MARGIN_METERS = 50_000;

/** Approximate degrees per meter at mid-latitudes (1 deg ~ 111,320 m). */
const DEG_PER_METER = 1 / 111_320;

/** Convert meters to degrees longitude at a given latitude. */
function metersToDegLon(meters: number, lat: number): number {
    return meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

/** Convert meters to degrees latitude (constant). */
function metersToDegLat(meters: number): number {
    return meters * DEG_PER_METER;
}

/** Approximate great-circle length of a LineString in meters. */
function lineLengthMeters(coords: Position[]): number {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += haversineDistanceMeters(
            coords[i][1],
            coords[i][0],
            coords[i + 1][1],
            coords[i + 1][0],
        );
    }
    return total;
}

// --- Line buffer cache --------------------------------------------------------

/** Increment to invalidate all cached buffer results when the algorithm changes. */
const LINE_BUFFER_CACHE_VERSION = 2;

/** Maximum number of cached buffer results. */
const LINE_BUFFER_CACHE_MAX = 50;

/**
 * LRU cache keyed on (version, category, center, radiusMeters).
 */
const bufferCache = new Map<string, Feature<Polygon | MultiPolygon> | null>();

function bufferCacheKey(
    category: MeasuringCategory,
    center: Position,
    radiusMeters: number,
): string {
    return [
        LINE_BUFFER_CACHE_VERSION,
        category,
        center[0].toFixed(5),
        center[1].toFixed(5),
        Math.round(radiusMeters / 10) * 10, // 10 m granularity
    ].join(":");
}

/** Clears the in-memory line-buffer cache. Call in tests to reset state. */
export function clearLineBufferCache(): void {
    bufferCache.clear();
}

// --- Line buffer --------------------------------------------------------------

/** Fallback margin (25 km) when no play-area bbox is available. */
const FALLBACK_MARGIN_DEG = 25_000 * DEG_PER_METER;

/**
 * Builds a buffer polygon around line features near the play area.
 *
 * Pipeline:
 * 1. Expand playAreaBbox by radiusMeters -> query window (or fall back to
 *    center +/- 25 km if no play area).
 * 2. Filter line features to those intersecting the query window.
 * 3. Drop features shorter than a threshold relative to the buffer radius.
 * 4. Merge surviving lines into a MultiLineString and buffer with
 *    @turf/buffer (JSTS). The mask builder clips the result to the play
 *    area, so no pre-clipping or simplification is needed.
 */
export function computeLineBuffer(
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

    const fc = getLineBundle(category);
    if (!fc || fc.features.length === 0) {
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

    // -- 2. Filter features by bbox intersection --------------------------------

    const surviving: Feature[] = [];
    for (const f of fc.features) {
        if (!bboxIntersects(featureBbox(f), queryBbox)) continue;
        surviving.push(f);
    }

    if (surviving.length === 0) {
        bufferCache.set(key, null);
        return null;
    }

    // -- 3. Collect coordinates, drop short features ----------------------------

    const minFeatureLenM = Math.min(radiusMeters * 0.1, 500);

    const lines: Position[][] = [];
    let droppedShort = 0;
    for (const f of surviving) {
        if (f.geometry.type === "LineString") {
            const coords = f.geometry.coordinates as Position[];
            if (lineLengthMeters(coords) < minFeatureLenM) {
                droppedShort++;
                continue;
            }
            lines.push(coords);
        } else {
            const mlCoords = (f.geometry as MultiLineString).coordinates;
            let totalLen = 0;
            for (const line of mlCoords) {
                totalLen += lineLengthMeters(line as Position[]);
            }
            if (totalLen < minFeatureLenM) {
                droppedShort++;
                continue;
            }
            for (const line of mlCoords) {
                if ((line as Position[]).length >= 2) {
                    lines.push(line as Position[]);
                }
            }
        }
    }

    if (droppedShort > 0) {
        console.log(
            `[lineBuffer] dropped ${droppedShort} short features (< ${minFeatureLenM.toFixed(0)}m)`,
        );
    }

    console.log(
        `[lineBuffer] ${surviving.length} features in query window, ` +
            `${lines.length} line segments`,
    );

    if (lines.length === 0) {
        bufferCache.set(key, null);
        return null;
    }

    // -- 4. Buffer ---------------------------------------------------------------

    const merged = multiLineString(lines);
    const result = buffer(merged, radiusMeters, {
        units: "meters",
    }) as Feature<Polygon | MultiPolygon>;

    if (!result) {
        console.log(`[lineBuffer] buffer returned undefined`);
        bufferCache.set(key, null);
        return null;
    }

    console.log(`[lineBuffer] done -- ${result.geometry.type}`);

    // Evict oldest entry when cache exceeds max size.
    if (bufferCache.size >= LINE_BUFFER_CACHE_MAX) {
        const oldest = bufferCache.keys().next().value;
        if (oldest !== undefined) bufferCache.delete(oldest);
    }
    bufferCache.set(key, result);

    return result;
}

// --- Bbox helpers -------------------------------------------------------------

function featureBbox(f: Feature): Bbox {
    if (f.bbox) return f.bbox as Bbox;
    return computeBboxFromCoords(f.geometry);
}

/** Fallback bbox computation for features without a pre-computed bbox. */
function computeBboxFromCoords(geometry: Feature["geometry"]): Bbox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const walk = (c: unknown) => {
        if (typeof (c as number[])?.[0] === "number") {
            const arr = c as number[];
            if (arr[0] < minX) minX = arr[0];
            if (arr[0] > maxX) maxX = arr[0];
            if (arr[1] < minY) minY = arr[1];
            if (arr[1] > maxY) maxY = arr[1];
        } else if (Array.isArray(c)) {
            for (const item of c) walk(item);
        }
    };
    // All bundle features are LineString or MultiLineString, which have coords.
    const coords = (geometry as { coordinates: unknown }).coordinates;
    walk(coords);
    return [minX, minY, maxX, maxY];
}

// --- Main algorithm -----------------------------------------------------------

/**
 * Nearest point on bundled line/polygon geometry for a center + category.
 * Bbox-pre-filters features around the center, then runs
 * `@turf/nearest-point-on-line` on the merged MultiLineString. LRU-cached
 * on (category, center). Returns null for empty bundles or no surviving features.
 */
export function computeLineDistance(
    center: Position,
    category: MeasuringCategory,
): NearestPointResult | null {
    const key = cacheKey(category, center);
    if (distanceCache.has(key)) {
        const cached = distanceCache.get(key)!;
        // Promote to most-recently-used.
        distanceCache.delete(key);
        distanceCache.set(key, cached);
        return cached;
    }

    const fc = getLineBundle(category);
    if (!fc || fc.features.length === 0) {
        distanceCache.set(key, null);
        return null;
    }

    const marginDeg = MARGIN_METERS * DEG_PER_METER;
    const queryBbox: Bbox = [
        center[0] - marginDeg,
        center[1] - marginDeg,
        center[0] + marginDeg,
        center[1] + marginDeg,
    ];

    // Collect surviving LineString coordinate arrays.
    const lines: Position[][] = [];
    for (const f of fc.features) {
        if (!bboxIntersects(featureBbox(f), queryBbox)) continue;
        if (f.geometry.type === "LineString") {
            lines.push(f.geometry.coordinates as Position[]);
        } else {
            // MultiLineString
            for (const seg of (f.geometry as MultiLineString).coordinates) {
                lines.push(seg as Position[]);
            }
        }
    }

    if (lines.length === 0) {
        distanceCache.set(key, null);
        return null;
    }

    const snapped = nearestPointOnLine(multiLineString(lines), point(center));
    const nearestPoint = snapped.geometry.coordinates as Position;
    const distanceMeters = haversineDistanceMeters(
        center[1],
        center[0],
        nearestPoint[1],
        nearestPoint[0],
    );

    const result: NearestPointResult = { nearestPoint, distanceMeters };

    // Evict oldest entry when cache exceeds max size.
    if (distanceCache.size >= LINE_DISTANCE_CACHE_MAX) {
        const oldest = distanceCache.keys().next().value;
        if (oldest !== undefined) distanceCache.delete(oldest);
    }
    distanceCache.set(key, result);

    return result;
}

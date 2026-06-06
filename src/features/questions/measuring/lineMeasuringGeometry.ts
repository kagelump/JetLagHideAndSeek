import nearestPointOnLine from "@turf/nearest-point-on-line";
import { multiLineString, point } from "@turf/helpers";

import {
    bboxIntersects,
    haversineDistanceMeters,
    type Bbox,
    type Position,
} from "@/shared/geojson";
import type { Feature, MultiLineString } from "geojson";
import type { MeasuringCategory } from "./measuringTypes";
import { getLineBundle } from "./lineBundleLoader";

export type NearestPointResult = {
    /** Nearest point on the line/edge (GeoJSON [lon, lat]). */
    nearestPoint: Position;
    /** Haversine distance in meters from `center` to `nearestPoint`. */
    distanceMeters: number;
};

// ─── LRU cache ───────────────────────────────────────────────────────────────

/** Increment to invalidate all cached results when the algorithm changes. */
const LINE_DISTANCE_CACHE_VERSION = 1;

/** Maximum number of cached nearest-point results. */
const LINE_DISTANCE_CACHE_MAX = 100;

/**
 * LRU cache keyed on (version, category, center). Two questions with the same
 * center share a hit — the result depends solely on center + category.
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

// ─── Query margin ────────────────────────────────────────────────────────────

/** 50 km query window covers any plausible seeker distance. */
const MARGIN_METERS = 50_000;

/** Approximate degrees per meter at mid-latitudes (1° ≈ 111,320 m). */
const DEG_PER_METER = 1 / 111_320;

// ─── Bbox helpers ────────────────────────────────────────────────────────────

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

// ─── Main algorithm ──────────────────────────────────────────────────────────

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

import { bboxIntersects, type Bbox, type Position } from "@/shared/geojson";
import type {
    Feature,
    LineString,
    MultiLineString,
    Polygon,
    MultiPolygon,
} from "geojson";
import type { MeasuringCategory } from "./measuringTypes";
import { getLineBundleSources } from "./lineBundleLoader";
import { MEASURING_LINE } from "@/config/appConfig";
import {
    computeLineDistance,
    metersToDegLon,
    metersToDegLat,
    DEG_PER_METER,
    featureBbox,
    featureToRings,
} from "./lineDistanceComputation";

/** Feature type that includes both line and polygon geometry. */
export type LineOrPolygonFeature = Feature<
    LineString | MultiLineString | Polygon | MultiPolygon
>;

export type { NearestPointResult } from "./lineDistanceComputation";

// ─── Central line computation ──────────────────────────────────────────

/**
 * Result of one central line-category computation. `windowFeatures` is
 * the single source from which both the mask buffer and the visible
 * reference line are derived.
 */
export type LineCategoryComputation = {
    nearestPoint: Position;
    distanceMeters: number;
    /** Bundle features intersecting the play-area ± max(distance, MIN_MARGIN)
     *  window. The single source for both mask and reference line. */
    windowFeatures: LineOrPolygonFeature[];
};

// ─── Window feature selection ──────────────────────────────────────────

/**
 * Returns bundle features whose bbox intersects the play-area bbox expanded
 * by `marginM` metres. Falls back to center ± 25 km when no play area.
 */
export function selectWindowFeatures(
    category: MeasuringCategory,
    playAreaBbox: Bbox | undefined,
    center: Position,
    marginM: number,
): LineOrPolygonFeature[] {
    const tLoad0 = performance.now();
    const bundles = getLineBundleSources(category);
    const tLoadMs = performance.now() - tLoad0;
    if (bundles.length === 0) return [];

    let queryBbox: Bbox;

    if (playAreaBbox) {
        const midLat = (playAreaBbox[1] + playAreaBbox[3]) / 2;
        queryBbox = [
            playAreaBbox[0] - metersToDegLon(marginM, midLat),
            playAreaBbox[1] - metersToDegLat(marginM),
            playAreaBbox[2] + metersToDegLon(marginM, midLat),
            playAreaBbox[3] + metersToDegLat(marginM),
        ];
    } else {
        const marginDeg = marginM * DEG_PER_METER;
        queryBbox = [
            center[0] - marginDeg,
            center[1] - marginDeg,
            center[0] + marginDeg,
            center[1] + marginDeg,
        ];
    }

    const tIter0 = performance.now();
    const result: LineOrPolygonFeature[] = [];
    let totalFeatures = 0;
    for (const fc of bundles) {
        totalFeatures += fc.features.length;
        for (const f of fc.features) {
            if (bboxIntersects(featureBbox(f as Feature), queryBbox)) {
                result.push(f as LineOrPolygonFeature);
            }
        }
    }
    const tIterMs = performance.now() - tIter0;
    console.log(
        `[selectWindow] bundle load: ${tLoadMs.toFixed(0)}ms, ` +
            `bbox scan ${totalFeatures} features → ${result.length} hits ` +
            `in ${tIterMs.toFixed(0)}ms`,
    );
    return result;
}

// ─── Buffer-scoped feature filter ──────────────────────────────────────

/**
 * Filters `windowFeatures` to only those whose bbox intersects the play-area
 * bbox expanded by `marginMeters`. This re-scopes the wide nearest-search
 * window (50 km) to the buffer radius so the budget loop never sees features
 * that cannot contribute to the buffer inside the play area.
 */
export function filterFeaturesByBboxMargin(
    features: LineOrPolygonFeature[],
    bbox: Bbox,
    marginMeters: number,
): LineOrPolygonFeature[] {
    if (features.length === 0) return [];
    const midLat = (bbox[1] + bbox[3]) / 2;
    const marginLon = metersToDegLon(marginMeters, midLat);
    const marginLat = metersToDegLat(marginMeters);
    const expandedBbox: Bbox = [
        bbox[0] - marginLon,
        bbox[1] - marginLat,
        bbox[2] + marginLon,
        bbox[3] + marginLat,
    ];
    return features.filter((f) => bboxIntersects(featureBbox(f), expandedBbox));
}

// ─── computeLineCategory cache ─────────────────────────────────────────

/** Increment to invalidate all cached line-category results. */
const LINE_CATEGORY_CACHE_VERSION = 2;

const categoryCache = new Map<string, LineCategoryComputation | null>();

function categoryCacheKey(
    category: MeasuringCategory,
    center: Position,
    bbox: Bbox | undefined,
): string {
    return [
        LINE_CATEGORY_CACHE_VERSION,
        category,
        center[0].toFixed(6),
        center[1].toFixed(6),
        bbox ? bbox.map((v) => v.toFixed(4)).join(",") : "no-bbox",
    ].join(":");
}

/** Clears the in-memory line-category cache. Call in tests to reset state. */
export function clearLineCategoryCache(): void {
    categoryCache.clear();
}

// ─── Central function ──────────────────────────────────────────────────

/**
 * Computes the nearest point, distance, and windowed feature set for a
 * line-category measuring question in one call. The returned
 * `windowFeatures` are the single source for both `computeLineBuffer` and
 * the clipped reference line.
 *
 * Cached on (category, center, playAreaBbox).
 */
export function computeLineCategory(
    center: Position,
    category: MeasuringCategory,
    playAreaBbox: Bbox | undefined,
): LineCategoryComputation | null {
    const key = categoryCacheKey(category, center, playAreaBbox);
    if (categoryCache.has(key)) {
        const cached = categoryCache.get(key)!;
        // Promote to most-recently-used.
        categoryCache.delete(key);
        categoryCache.set(key, cached);
        return cached;
    }

    const distance = computeLineDistance(center, category);
    if (!distance || distance.distanceMeters <= 0) {
        categoryCache.set(key, null);
        return null;
    }

    const marginM = Math.max(
        distance.distanceMeters,
        MEASURING_LINE.minWindowMarginM,
    );
    const tWindow0 = performance.now();
    const windowFeatures = selectWindowFeatures(
        category,
        playAreaBbox,
        center,
        marginM,
    );
    const tWindowMs = performance.now() - tWindow0;
    console.log(
        `[lineCategory] selectWindowFeatures: ${windowFeatures.length} features ` +
            `in window (margin=${marginM.toFixed(0)}m) in ${tWindowMs.toFixed(0)}ms`,
    );

    const result: LineCategoryComputation = {
        nearestPoint: distance.nearestPoint,
        distanceMeters: distance.distanceMeters,
        windowFeatures,
    };

    // Evict oldest entry when cache exceeds max size.
    if (categoryCache.size >= MEASURING_LINE.categoryCacheMax) {
        const oldest = categoryCache.keys().next().value;
        if (oldest !== undefined) categoryCache.delete(oldest);
    }
    categoryCache.set(key, result);

    return result;
}

// ─── Feature conversion ────────────────────────────────────────────────

/**
 * Converts polygon features in a mixed array to their boundary LineString
 * features for reference-line rendering. Line features pass through unchanged.
 */
export function polygonFeaturesToLineFeatures(
    features: LineOrPolygonFeature[],
): Feature<LineString | MultiLineString>[] {
    const result: Feature<LineString | MultiLineString>[] = [];
    for (const f of features) {
        const geom = f.geometry;
        if (geom.type === "LineString" || geom.type === "MultiLineString") {
            result.push(f as Feature<LineString | MultiLineString>);
            continue;
        }
        // Polygon → boundary LineString(s).
        const rings = featureToRings(f);
        if (rings.length === 1) {
            result.push({
                type: "Feature",
                properties: { ...f.properties },
                geometry: {
                    type: "LineString",
                    coordinates: rings[0],
                },
            });
        } else if (rings.length > 1) {
            result.push({
                type: "Feature",
                properties: { ...f.properties },
                geometry: {
                    type: "MultiLineString",
                    coordinates: rings,
                },
            });
        }
    }
    return result;
}

// ─── Re-exports for backward compatibility ─────────────────────────────

export {
    computeLineDistance,
    clearLineDistanceCache,
    featureToRings,
} from "./lineDistanceComputation";
export {
    applyBufferBudget,
    computeLineBuffer,
    computeLineBufferCached,
    clearLineBufferCache,
} from "./lineBufferComputation";
export {
    getDilatedPlayArea,
    clearDilatedBoundaryCache,
    makeClippedLineCacheKey,
    getClippedLineFeaturesCached,
    clearClippedLineCache,
    clipLineFeaturesToPlayArea,
} from "./lineClipping";

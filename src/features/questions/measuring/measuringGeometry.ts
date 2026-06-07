import circle from "@turf/circle";
import type {
    Feature,
    LineString,
    MultiPolygon,
    Point as GeoPoint,
    Polygon,
} from "geojson";

import type { QuestionState } from "@/features/questions/questionTypes";
import type { Bbox } from "@/shared/geojson";
import { isLineMeasuringCategory } from "./measuringCategories";
import {
    computeLineBuffer,
    computeLineDistance,
} from "./lineMeasuringGeometry";
import type { MeasuringRenderState } from "./measuringTypes";

// ─── Circle fragment cache ──────────────────────────────────────────────────

/** Increment to invalidate all cached circles when the algorithm changes. */
const MEASURING_FRAGMENT_VERSION = 1;

/** Fixed step count for Turf circle generation. */
const MEASURING_CIRCLE_STEPS = 32;

/** Maximum number of cached circle fragments. */
const MEASURING_CIRCLE_CACHE_MAX = 200;

/**
 * Per-question circle fragment cache. Keyed by geometry parameters so that
 * the same circle can be reused across questions with identical target POI
 * and distance.
 *
 * Map insertion order is used as an LRU: re-inserted entries are promoted
 * to most-recently-used, and the oldest entry is evicted when the cache
 * exceeds MEASURING_CIRCLE_CACHE_MAX.
 */
const circleCache = new Map<string, Feature<Polygon | MultiPolygon>>();

function measuringCircleKey(
    osmId: number,
    osmType: string,
    seekerDistanceMeters: number,
): string {
    return [
        MEASURING_FRAGMENT_VERSION,
        osmId,
        osmType,
        seekerDistanceMeters,
        MEASURING_CIRCLE_STEPS,
    ].join(":");
}

function getMeasuringCircle(
    osmId: number,
    osmType: string,
    lon: number,
    lat: number,
    seekerDistanceMeters: number,
): Feature<Polygon | MultiPolygon> {
    const key = measuringCircleKey(osmId, osmType, seekerDistanceMeters);
    const cached = circleCache.get(key);
    if (cached) {
        // Promote to most-recently-used.
        circleCache.delete(key);
        circleCache.set(key, cached);
        return cached;
    }

    const radiusKm = seekerDistanceMeters / 1000;
    const feature = circle([lon, lat], radiusKm, {
        steps: MEASURING_CIRCLE_STEPS,
        units: "kilometers",
    });

    // Evict oldest entry when cache exceeds max size.
    if (circleCache.size >= MEASURING_CIRCLE_CACHE_MAX) {
        const oldest = circleCache.keys().next().value;
        if (oldest !== undefined) circleCache.delete(oldest);
    }
    circleCache.set(key, feature);

    return feature;
}

/** Clears the in-memory measuring circle fragment cache. Call in tests to reset state. */
export function clearMeasuringCircleCache(): void {
    circleCache.clear();
}

// ─── Render state ───────────────────────────────────────────────────────────

export function buildMeasuringRenderState(
    questions: QuestionState[],
    playAreaBbox: Bbox | undefined,
): MeasuringRenderState {
    const measuring = questions.filter(
        (q): q is Extract<QuestionState, { type: "measuring" }> =>
            q.type === "measuring",
    );

    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const missFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const connectors: Feature<LineString>[] = [];
    const markers: Feature<GeoPoint>[] = [];

    for (const q of measuring) {
        if (isLineMeasuringCategory(q.category)) {
            // Derive on render — nothing is read from the question except center.
            const result = computeLineDistance(q.center, q.category);
            if (!result || result.distanceMeters <= 0) continue;

            // Always show the auto-picked target, answered or not.
            connectors.push({
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [q.center, result.nearestPoint],
                },
            });
            markers.push({
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Point",
                    coordinates: result.nearestPoint,
                },
            });

            // Buffer the line at the seeker's distance so the mask covers
            // all points within range of ANY point on the line, not just
            // the single nearest point.
            if (q.answer === "positive" || q.answer === "negative") {
                console.log(
                    `[measuringGeometry] computing line buffer for ${q.category} answer=${q.answer} dist=${result.distanceMeters}m`,
                );
                const buf = computeLineBuffer(
                    q.center,
                    q.category,
                    result.distanceMeters,
                    playAreaBbox,
                );
                if (buf) {
                    console.log(
                        `[measuringGeometry] line buffer ready — ${buf.geometry.type}`,
                    );
                    (q.answer === "positive" ? hitFeatures : missFeatures).push(
                        buf,
                    );
                } else {
                    console.log(
                        `[measuringGeometry] line buffer returned null`,
                    );
                }
            }
            continue;
        } else {
            // Point category: selected POI + stored distance.
            if (
                q.selectedOsmId === null ||
                !q.seekerDistanceMeters ||
                q.seekerDistanceMeters <= 0
            )
                continue;
            const target = q.candidates.find(
                (c) =>
                    c.osmId === q.selectedOsmId &&
                    c.osmType === q.selectedOsmType,
            );
            if (!target) continue;

            // Use LRU-cached circle for point-category questions.
            const circ = getMeasuringCircle(
                target.osmId,
                target.osmType,
                target.lon,
                target.lat,
                q.seekerDistanceMeters,
            );
            if (q.answer === "positive") {
                hitFeatures.push(circ);
            } else if (q.answer === "negative") {
                missFeatures.push(circ);
            }
            continue;
        }
    }

    return {
        hitMaskFeatures: { features: hitFeatures, type: "FeatureCollection" },
        missMaskFeatures: {
            features: missFeatures,
            type: "FeatureCollection",
        },
        nearestPointConnectors: {
            features: connectors,
            type: "FeatureCollection",
        },
        nearestPointMarkers: { features: markers, type: "FeatureCollection" },
    };
}

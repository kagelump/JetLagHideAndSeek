import circle from "@turf/circle";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import type { QuestionState } from "@/features/questions/questionTypes";
import type { MeasuringQuestion, MeasuringRenderState } from "./measuringTypes";

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
): MeasuringRenderState {
    const measuringQuestions = questions.filter(
        (q): q is MeasuringQuestion =>
            q.type === "measuring" &&
            q.selectedOsmId !== null &&
            q.seekerDistanceMeters !== null &&
            q.seekerDistanceMeters > 0,
    );

    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const missFeatures: Feature<Polygon | MultiPolygon>[] = [];

    for (const q of measuringQuestions) {
        const target = q.candidates.find(
            (c) =>
                c.osmId === q.selectedOsmId && c.osmType === q.selectedOsmType,
        );
        if (!target) continue;

        // Circle CENTER is the target POI, not q.center.
        const circ = getMeasuringCircle(
            target.osmId,
            target.osmType,
            target.lon,
            target.lat,
            q.seekerDistanceMeters!,
        );

        if (q.answer === "positive") {
            // Closer → hider is inside the circle
            hitFeatures.push(circ);
        } else if (q.answer === "negative") {
            // Farther → hider is outside the circle
            missFeatures.push(circ);
        }
    }

    return {
        hitMaskFeatures: { features: hitFeatures, type: "FeatureCollection" },
        missMaskFeatures: {
            features: missFeatures,
            type: "FeatureCollection",
        },
    };
}

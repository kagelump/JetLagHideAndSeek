import circle from "@turf/circle";
import type { Feature, Polygon } from "geojson";

import type { TransitStation } from "@/features/hidingZone/hidingZoneTypes";
import { type Position, haversineDistanceMeters } from "@/shared/geojson";
import type { QuestionState } from "@/features/questions/questionTypes";
import { RADAR } from "@/config/appConfig";
export { fromMeters, toMeters } from "@/shared/distanceUnits";

import type {
    NearestStationInfo,
    RadarQuestion,
    RadarQuestionFeatureCollection,
    RadarQuestionFeatureProperties,
    RadarQuestionRenderState,
} from "./radarTypes";

// ─── Circle fragment cache ──────────────────────────────────────────────────

/** Increment to invalidate all cached circles when the algorithm changes. */
const RADAR_FRAGMENT_VERSION = 1;

/** Fixed step count for Turf circle generation. */
const RADAR_CIRCLE_STEPS = RADAR.circleSteps;

/** Maximum number of cached circle fragments. */
const RADAR_CIRCLE_CACHE_MAX = RADAR.circleCacheMax;

/**
 * Per-question circle fragment cache. Keyed by question identity, geometry
 * parameters, and answer state so that a question appearing in both outline
 * and hit/miss/preview collections only generates one Turf circle.
 *
 * Map insertion order is used as an LRU: re-inserted entries are promoted
 * to most-recently-used, and the oldest entry is evicted when the cache
 * exceeds RADAR_CIRCLE_CACHE_MAX.
 */
const circleCache = new Map<
    string,
    Feature<Polygon, RadarQuestionFeatureProperties>
>();

/**
 * Returns a deterministic cache key for a radar question's circle fragment.
 * Keyed by geometry parameters only (center, distance, steps) so that the
 * same circle can be reused across hit / miss / preview / outline collections.
 */
function radarCircleKey(question: RadarQuestion): string {
    return [
        RADAR_FRAGMENT_VERSION,
        question.id,
        question.center[0].toFixed(7),
        question.center[1].toFixed(7),
        question.distanceMeters,
        RADAR_CIRCLE_STEPS,
    ].join(":");
}

/**
 * Returns a Turf circle polygon for a radar question, reusing a cached
 * fragment when one exists for the same (id, center, distance, steps,
 * answer) tuple.
 */
function getRadarCircle(
    question: RadarQuestion,
): Feature<Polygon, RadarQuestionFeatureProperties> {
    const key = radarCircleKey(question);
    const cached = circleCache.get(key);
    if (cached) {
        // Promote to most-recently-used.
        circleCache.delete(key);
        circleCache.set(key, cached);
        return cached;
    }

    const feature = circle(question.center, question.distanceMeters / 1000, {
        properties: {
            distanceMeters: question.distanceMeters,
            id: question.id,
        },
        steps: RADAR_CIRCLE_STEPS,
        units: "kilometers",
    });

    // Evict oldest entry when cache exceeds max size.
    if (circleCache.size >= RADAR_CIRCLE_CACHE_MAX) {
        const oldest = circleCache.keys().next().value;
        if (oldest !== undefined) circleCache.delete(oldest);
    }
    circleCache.set(key, feature);

    return feature;
}

/** Clears the in-memory radar circle fragment cache. Call in tests to reset state. */
export function clearRadarCircleCache(): void {
    circleCache.clear();
}

// ─── Render state ───────────────────────────────────────────────────────────

export function buildRadarQuestionRenderState(
    questions: QuestionState[],
): RadarQuestionRenderState {
    const radarQuestions = questions.filter(
        (question): question is RadarQuestion => question.type === "radar",
    );

    return {
        hitMaskFeatures: buildRadarQuestionFeatureCollection(
            radarQuestions.filter((question) => question.answer === "positive"),
        ),
        missMaskFeatures: buildRadarQuestionFeatureCollection(
            radarQuestions.filter((question) => question.answer === "negative"),
        ),
        outlineFeatures: buildRadarQuestionFeatureCollection(radarQuestions),
        previewFeatures: buildRadarQuestionFeatureCollection(
            radarQuestions.filter(
                (question) => question.answer === "unanswered",
            ),
        ),
    };
}

export function buildRadarQuestionFeatureCollection(
    questions: RadarQuestion[],
): RadarQuestionFeatureCollection {
    return {
        features: questions.map((question) => getRadarCircle(question)),
        type: "FeatureCollection",
    };
}

// ─── Station helpers ────────────────────────────────────────────────────────

export function findNearestStation(
    center: Position,
    stations: TransitStation[],
): NearestStationInfo {
    if (stations.length === 0) return null;

    let nearest: NearestStationInfo = null;
    for (const station of stations) {
        const distanceMeters = getDistanceMeters(center, [
            station.lon,
            station.lat,
        ]);
        if (!nearest || distanceMeters < nearest.distanceMeters) {
            nearest = { distanceMeters, station };
        }
    }
    return nearest;
}

export function formatStationDistance(distanceMeters: number): string {
    if (distanceMeters < 1000) return `${Math.round(distanceMeters)} meters`;
    return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function getDistanceMeters(a: Position, b: Position): number {
    const [lonA, latA] = a;
    const [lonB, latB] = b;
    return haversineDistanceMeters(latA, lonA, latB, lonB);
}

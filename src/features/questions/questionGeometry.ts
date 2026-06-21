import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

import { buildMeasuringRenderState } from "@/features/questions/measuring/measuringGeometry";
import { buildTentaclesRenderState } from "@/features/questions/tentacles/tentaclesGeometry";
import { buildThermometerRenderState } from "@/features/questions/thermometer/thermometerGeometry";
import type { Bbox } from "@/shared/geojson";
import type { QuestionMapRenderState } from "@/features/questions/radar/radarTypes";
import { buildRadarQuestionRenderState } from "@/features/questions/radar/radarGeometry";
import type { QuestionState } from "@/features/questions/questionTypes";
import type { TransitStation } from "@/features/hidingZone/hidingZoneTypes";
import { buildTransitLineMaskFeatures } from "@/features/questions/transitLine/transitLineQuestion";
import { EMPTY_MEASURING_RENDER_STATE } from "@/features/questions/measuring/measuringTypes";
import { EMPTY_TENTACLES_RENDER_STATE } from "@/features/questions/tentacles/tentaclesTypes";
import { EMPTY_THERMOMETER_RENDER_STATE } from "@/features/questions/thermometer/thermometerTypes";
import { useDeferredComputation } from "@/shared/useDeferredComputation";
import {
    useHidingZoneDerived,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { useQuestions } from "@/state/questionStore";
import { buildOsmMatchingRenderState } from "./matching/osmMatchingGeometry";
import { useEnsureMeasuringBundles } from "./measuring/useEnsureMeasuringBundles";
import { createLogger } from "@/shared/logger";

const log = createLogger("questionGeometry");

export function buildQuestionMapRenderState(
    questions: QuestionState[],
    stations: TransitStation[],
    radiusMeters: number,
    playAreaBbox: Bbox,
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): QuestionMapRenderState {
    const radar = buildRadarQuestionRenderState(questions);
    const osmMatching = buildOsmMatchingRenderState(
        questions,
        playAreaBbox,
        playAreaBoundary,
    );
    const matchingQuestions = questions.filter(
        (question): question is Extract<QuestionState, { type: "matching" }> =>
            question.type === "matching" && question.lineId !== null,
    );
    const hitLine =
        matchingQuestions.find((question) => question.answer === "positive") ??
        null;
    const missLine =
        matchingQuestions.find((question) => question.answer === "negative") ??
        null;

    const tentacles = buildTentaclesRenderState(
        questions,
        playAreaBbox,
        playAreaBoundary,
    );

    return {
        measuring: buildMeasuringRenderState(
            questions,
            playAreaBbox,
            playAreaBoundary,
        ),
        osmMatching,
        radar,
        radarAreaFeatures: radar.previewFeatures,
        tentacles,
        thermometer: buildThermometerRenderState(questions, playAreaBoundary),
        transitLine: {
            hitMaskFeatures: buildTransitLineMaskFeatures(
                stations,
                hitLine?.lineId ?? null,
                radiusMeters,
            ),
            missMaskFeatures: buildTransitLineMaskFeatures(
                stations,
                missLine?.lineId ?? null,
                radiusMeters,
            ),
        },
        voronoiOutlineFeatures: {
            type: "FeatureCollection",
            features: [
                ...osmMatching.voronoiOutlineFeatures.features,
                ...tentacles.voronoiOutlineFeatures.features,
            ],
        },
    };
}

/** Fresh, mutable empty FeatureCollection, typed to its usage context. */
const emptyFc = <T>(): T => ({ type: "FeatureCollection", features: [] }) as T;

/**
 * Empty render state shown before the first deferred computation resolves
 * (see {@link useQuestionMapRenderState}). Every sub-collection is empty, so
 * downstream mask/overlay builders produce nothing until real geometry lands.
 */
export const EMPTY_QUESTION_MAP_RENDER_STATE: QuestionMapRenderState = {
    measuring: EMPTY_MEASURING_RENDER_STATE,
    osmMatching: {
        hitMaskFeatures: emptyFc(),
        missMaskFeatures: emptyFc(),
        poiFeatures: emptyFc(),
        voronoiOutlineFeatures: emptyFc(),
    },
    radar: {
        hitMaskFeatures: emptyFc(),
        missMaskFeatures: emptyFc(),
        outlineFeatures: emptyFc(),
        previewFeatures: emptyFc(),
    },
    radarAreaFeatures: emptyFc(),
    tentacles: EMPTY_TENTACLES_RENDER_STATE,
    thermometer: EMPTY_THERMOMETER_RENDER_STATE,
    transitLine: {
        hitMaskFeatures: emptyFc(),
        missMaskFeatures: emptyFc(),
    },
    voronoiOutlineFeatures: emptyFc(),
};

// ---------------------------------------------------------------------------
// Module-level LRU cache
// ---------------------------------------------------------------------------
//
// Shared across the (up to three) independent callers of
// useQuestionMapRenderState (NativeMap, useStationElimination,
// useEliminationPercentage). The first caller to resolve a given input key
// caches the result; the others hit the cache synchronously instead of each
// re-running the heavy GEOS work. Mirrors the LRU pattern in
// useStationElimination.ts.

const MAX_RENDER_STATE_CACHE = 12;
const renderStateCache = new Map<string, QuestionMapRenderState>();

function getCachedRenderState(key: string): QuestionMapRenderState | null {
    const hit = renderStateCache.get(key);
    if (!hit) return null;
    // Promote to LRU tail.
    renderStateCache.delete(key);
    renderStateCache.set(key, hit);
    return hit;
}

function putCachedRenderState(
    key: string,
    value: QuestionMapRenderState,
): void {
    if (renderStateCache.size >= MAX_RENDER_STATE_CACHE) {
        const oldest = renderStateCache.keys().next().value;
        if (oldest !== undefined) renderStateCache.delete(oldest);
    }
    renderStateCache.set(key, value);
}

/** Test seam — clears the module-level render-state cache. */
export function clearQuestionMapRenderStateCache(): void {
    renderStateCache.clear();
}

/**
 * Synchronous cache probe for the render-state LRU. Callers that build render
 * states outside the deferred path (e.g. `useQuestionElimination`) should
 * check this first — on a miss they should skip the synchronous computation
 * so the deferred path can populate the cache without blocking render.
 */
export function getQuestionMapRenderStateCacheEntry(
    key: string,
): QuestionMapRenderState | null {
    return getCachedRenderState(key);
}

export { buildRenderStateKey };

function buildRenderStateKey(
    questions: QuestionState[],
    stations: TransitStation[],
    radiusMeters: number,
    bbox: Bbox,
    osmId: string | number | null,
    measuringRevision: number,
): string {
    const n = stations.length;
    const stationSig =
        n === 0
            ? "0"
            : `${n}:${stations[0].id}:${stations[Math.floor(n / 2)].id}:${stations[n - 1].id}`;
    return [
        String(osmId),
        bbox.join(","),
        radiusMeters,
        stationSig,
        measuringRevision,
        JSON.stringify(questions),
    ].join("|");
}

export type UseQuestionMapRenderStateResult = {
    renderState: QuestionMapRenderState;
    /** True while a fresh render state is being computed off the render path. */
    isComputing: boolean;
};

/**
 * Returns the question map render state plus a loading flag.
 *
 * The heavy geometry (body-of-water dissolve, eligibility masks) is computed
 * **off the synchronous render path** via {@link useDeferredComputation} so the
 * UI can paint a loading indicator first instead of freezing. The previous
 * render state stays visible while recomputing; `isComputing` drives the
 * loading affordances (map pill, header shimmer, inline spinners).
 */
export function useQuestionMapRenderState(): UseQuestionMapRenderStateResult {
    const questions = useQuestions();
    const { radiusMeters } = useHidingZoneState();
    const { selectedStations } = useHidingZoneDerived();
    const { playArea } = usePlayArea();

    const measuringQuestions = questions.filter(
        (q): q is Extract<QuestionState, { type: "measuring" }> =>
            q.type === "measuring",
    );
    const measuringRevision = useEnsureMeasuringBundles(measuringQuestions);

    const key = useMemo(
        () =>
            buildRenderStateKey(
                questions,
                selectedStations,
                radiusMeters,
                playArea.bbox,
                playArea.osmId,
                measuringRevision,
            ),
        [
            questions,
            selectedStations,
            radiusMeters,
            playArea.bbox,
            playArea.osmId,
            measuringRevision,
        ],
    );

    const compute = useCallback(() => {
        // Dedupe across the parallel callers: the first to run caches the
        // result, so the others' deferred callbacks short-circuit here.
        const hit = getCachedRenderState(key);
        if (hit) return hit;

        const measuringQs = questions.filter((q) => q.type === "measuring");
        if (measuringQs.length > 0) {
            log.debug(
                `building render state for ${measuringQs.length} measuring question(s) ` +
                    `[${measuringQs.map((q) => `${(q as any).category}=${q.answer}`).join(", ")}]`,
            );
        }
        return buildQuestionMapRenderState(
            questions,
            selectedStations,
            radiusMeters,
            playArea.bbox,
            playArea.boundary as FeatureCollection<Polygon | MultiPolygon>,
        );
        // `key` captures all the real inputs; depending on it keeps the closure
        // fresh without re-listing every primitive.
    }, [key]);

    const { value, isComputing } = useDeferredComputation(key, compute, {
        initial: EMPTY_QUESTION_MAP_RENDER_STATE,
        getCached: getCachedRenderState,
        putCached: putCachedRenderState,
    });

    // Log state transitions so we can see whether isComputing ever flips to true
    // before the compute blocks the JS thread.
    const prevComputingRef = useRef(isComputing);
    useEffect(() => {
        if (prevComputingRef.current !== isComputing) {
            log.debug(
                `isComputing ${prevComputingRef.current} → ${isComputing} ` +
                    `(featureCount=${value.radar.hitMaskFeatures.features.length})`,
            );
            prevComputingRef.current = isComputing;
        }
    }, [isComputing, value.radar.hitMaskFeatures.features.length]);

    return { renderState: value, isComputing };
}

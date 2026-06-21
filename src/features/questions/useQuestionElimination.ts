import { useMemo } from "react";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

import {
    eligibleArea,
    questionContributionPercent,
    zoneBaselineArea,
    zoneEliminationPercent,
} from "@/features/map/eliminationMath";
import {
    buildQuestionMapRenderState,
    buildRenderStateKey,
    getQuestionMapRenderStateCacheEntry,
    useQuestionMapRenderState,
} from "@/features/questions/questionGeometry";
import type { QuestionState } from "@/features/questions/questionTypes";
import { useEnsureMeasuringBundles } from "@/features/questions/measuring/useEnsureMeasuringBundles";
import {
    useHidingZoneDerived,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { useQuestions } from "@/state/questionStore";

export type QuestionElimination = {
    /** Total % of the hiding zone eliminated by all questions (matches hero). */
    totalPct: number;
    /**
     * Percentage points of that total contributed by THIS question, under
     * strict question ordering — its marginal over the cumulative state of every
     * earlier question. Independent per question (two thermometers differ).
     */
    byThisPct: number;
};

/**
 * Elimination stats for a single question sheet: the running total (identical to
 * the hero stat) plus this question's own strict-ordering contribution. See
 * `eliminationMath.ts` for the math.
 *
 * Pass `liveOverride` to substitute an in-progress edit of a question (e.g. the
 * live pin positions during a thermometer drag) so the stats update in real time
 * before the change is committed to the store.
 */
export function useQuestionElimination(
    questionId: string,
    liveOverride?: QuestionState | null,
): QuestionElimination | null {
    const { playArea } = usePlayArea();
    const { zoneFeatures, activeZoneFeatures, selectedStations } =
        useHidingZoneDerived();
    const { radiusMeters } = useHidingZoneState();
    const questions = useQuestions();
    const { renderState: committedRenderState } = useQuestionMapRenderState();

    // Track measuring bundle load revision so cache keys include it.
    const measuringQuestions = questions.filter(
        (q): q is Extract<QuestionState, { type: "measuring" }> =>
            q.type === "measuring",
    );
    const measuringRevision = useEnsureMeasuringBundles(measuringQuestions);

    return useMemo(() => {
        if (!playArea.boundary || zoneFeatures.features.length === 0)
            return null;

        const boundary = playArea.boundary as FeatureCollection<
            Polygon | MultiPolygon
        >;

        // Denominator: full hiding zone (unchanged — baseline area).
        const zoneArea = zoneBaselineArea(boundary, zoneFeatures);
        if (zoneArea <= 0) return null;

        const effectiveQuestions = liveOverride
            ? questions.map((q) =>
                  q.id === liveOverride.id ? liveOverride : q,
              )
            : questions;

        const buildRenderStateKeyFor = (subset: QuestionState[]) =>
            buildRenderStateKey(
                subset,
                selectedStations,
                radiusMeters,
                playArea.bbox,
                playArea.osmId,
                measuringRevision,
            );

        const buildOrGetCached = (
            subset: QuestionState[],
        ): ReturnType<typeof buildQuestionMapRenderState> | null => {
            const key = buildRenderStateKeyFor(subset);
            const cached = getQuestionMapRenderStateCacheEntry(key);
            if (cached) return cached;
            // Cache miss — don't build synchronously. The shared deferred
            // computation (useQuestionMapRenderState) will populate this
            // cache entry; return null to signal "not yet available."
            return null;
        };

        // Total: all questions. When not overriding, reuse the shared
        // (memoized) committed render state so this matches the hero stat
        // exactly. When overriding (thermometer drag), build synchronously
        // — those categories don't trigger heavy line-distance compute.
        //
        // Numerator: activeZoneFeatures (excludes manually eliminated
        // stations) so manual elimination counts toward the total but is NOT
        // attributed to any single question — it telescopes to the
        // question-eliminated portion only.
        const fullRenderState = liveOverride
            ? buildQuestionMapRenderState(
                  effectiveQuestions,
                  selectedStations,
                  radiusMeters,
                  playArea.bbox,
                  boundary,
              )
            : committedRenderState;
        const totalPct = zoneEliminationPercent(
            eligibleArea(boundary, activeZoneFeatures, fullRenderState),
            zoneArea,
        );

        const index = effectiveQuestions.findIndex((q) => q.id === questionId);
        if (index < 0) return { totalPct, byThisPct: 0 };

        // Strict ordering: this question's marginal over every earlier
        // question. When not overriding, only compute when both subset render
        // states are already cached by the deferred path; otherwise skip so we
        // don't block the render thread on a synchronous computeLineDistance
        // call. When overriding (thermometer drag), build synchronously since
        // the live positions make the cache miss anyway and the geometry is
        // cheap (no line-distance bundles).
        let eligibleBefore: number;
        let eligibleAfter: number;

        if (liveOverride) {
            const buildRenderState = (subset: QuestionState[]) =>
                buildQuestionMapRenderState(
                    subset,
                    selectedStations,
                    radiusMeters,
                    playArea.bbox,
                    boundary,
                );
            eligibleBefore = eligibleArea(
                boundary,
                activeZoneFeatures,
                buildRenderState(effectiveQuestions.slice(0, index)),
            );
            eligibleAfter = eligibleArea(
                boundary,
                activeZoneFeatures,
                buildRenderState(effectiveQuestions.slice(0, index + 1)),
            );
        } else {
            const beforeState = buildOrGetCached(
                effectiveQuestions.slice(0, index),
            );
            const afterState = buildOrGetCached(
                effectiveQuestions.slice(0, index + 1),
            );

            if (!beforeState || !afterState) {
                // Cache not yet populated — the deferred computation is still
                // running. Return the total with a zero contribution; the next
                // render will recompute when the cache is warm.
                return { totalPct, byThisPct: 0 };
            }

            eligibleBefore = eligibleArea(
                boundary,
                activeZoneFeatures,
                beforeState,
            );
            eligibleAfter = eligibleArea(
                boundary,
                activeZoneFeatures,
                afterState,
            );
        }

        return {
            totalPct,
            byThisPct: questionContributionPercent(
                eligibleBefore,
                eligibleAfter,
                zoneArea,
            ),
        };
    }, [
        questionId,
        liveOverride,
        questions,
        committedRenderState,
        playArea.boundary,
        playArea.bbox,
        playArea.osmId,
        zoneFeatures,
        activeZoneFeatures,
        selectedStations,
        radiusMeters,
        measuringRevision,
    ]);
}

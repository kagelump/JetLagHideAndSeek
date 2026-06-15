import { useMemo } from "react";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

import {
    eligibleArea,
    featureCollectionArea,
    questionContributionPercent,
    zoneEliminationPercent,
} from "@/features/map/eliminationMath";
import {
    buildQuestionMapRenderState,
    useQuestionMapRenderState,
} from "@/features/questions/questionGeometry";
import type { QuestionState } from "@/features/questions/questionTypes";
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
    const { zoneFeatures, selectedStations } = useHidingZoneDerived();
    const { radiusMeters } = useHidingZoneState();
    const questions = useQuestions();
    const committedRenderState = useQuestionMapRenderState();

    return useMemo(() => {
        if (!playArea.boundary || zoneFeatures.features.length === 0)
            return null;

        const zoneArea = featureCollectionArea(zoneFeatures as any);
        if (zoneArea <= 0) return null;

        const boundary = playArea.boundary as FeatureCollection<
            Polygon | MultiPolygon
        >;

        const effectiveQuestions = liveOverride
            ? questions.map((q) =>
                  q.id === liveOverride.id ? liveOverride : q,
              )
            : questions;

        const buildRenderState = (subset: QuestionState[]) =>
            buildQuestionMapRenderState(
                subset,
                selectedStations,
                radiusMeters,
                playArea.bbox,
                boundary,
            );

        // Total: all questions. When not overriding, reuse the shared (memoized)
        // committed render state so this matches the hero stat exactly.
        const fullRenderState = liveOverride
            ? buildRenderState(effectiveQuestions)
            : committedRenderState;
        const totalPct = zoneEliminationPercent(
            eligibleArea(boundary as any, zoneFeatures as any, fullRenderState),
            zoneArea,
        );

        const index = effectiveQuestions.findIndex((q) => q.id === questionId);
        if (index < 0) return { totalPct, byThisPct: 0 };

        // Strict ordering: this question's marginal over every earlier question.
        const eligibleBefore = eligibleArea(
            boundary as any,
            zoneFeatures as any,
            buildRenderState(effectiveQuestions.slice(0, index)),
        );
        const eligibleAfter = eligibleArea(
            boundary as any,
            zoneFeatures as any,
            buildRenderState(effectiveQuestions.slice(0, index + 1)),
        );

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
        zoneFeatures,
        selectedStations,
        radiusMeters,
    ]);
}

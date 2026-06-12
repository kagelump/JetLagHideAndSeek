import { useMemo } from "react";
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
import {
    useHidingZoneDerived,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { useQuestions } from "@/state/questionStore";
import { buildOsmMatchingRenderState } from "./matching/osmMatchingGeometry";
import { useEnsureMeasuringBundles } from "./measuring/useEnsureMeasuringBundles";

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

export function useQuestionMapRenderState(): QuestionMapRenderState {
    const questions = useQuestions();
    const { radiusMeters } = useHidingZoneState();
    const { selectedStations } = useHidingZoneDerived();
    const { playArea } = usePlayArea();

    const measuringQuestions = questions.filter(
        (q): q is Extract<QuestionState, { type: "measuring" }> =>
            q.type === "measuring",
    );
    const measuringRevision = useEnsureMeasuringBundles(measuringQuestions);

    return useMemo(() => {
        const measuringQs = questions.filter((q) => q.type === "measuring");
        if (measuringQs.length > 0) {
            console.log(
                `[questionGeometry] building render state for ${measuringQs.length} measuring question(s) ` +
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
    }, [
        questions,
        selectedStations,
        radiusMeters,
        playArea.bbox,
        playArea.boundary,
        measuringRevision,
    ]);
}

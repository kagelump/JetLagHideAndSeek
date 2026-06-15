import { useMemo } from "react";

import type { GeoJsonFeatureCollection } from "@/features/map/geojsonTypes";
import { buildCombinedEligibilityMask } from "@/features/map/maskBuilder";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";
import { buildHalfPlane } from "@/features/questions/thermometer/thermometerGeometry";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import { useHidingZoneDerived } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { useQuestions } from "@/state/questionStore";
import { geomAreaM2 } from "@/shared/geometry/parityMetrics";
import type { Bbox } from "@/shared/geojson";
import type { Position } from "@/shared/geojson";

export function useThermometerElimination(): number | null {
    const { playArea } = usePlayArea();
    const { zoneFeatures } = useHidingZoneDerived();
    const questionMapRenderState = useQuestionMapRenderState();
    const questions = useQuestions();
    const thermometerQ = questions.find(
        (q): q is ThermometerQuestion => q.type === "thermometer",
    );

    return useMemo(() => {
        if (
            !thermometerQ ||
            !playArea.boundary ||
            zoneFeatures.features.length === 0
        ) {
            return null;
        }
        const { answer, previousPosition, currentPosition } = thermometerQ;
        if (
            (answer !== "positive" && answer !== "negative") ||
            !previousPosition ||
            !currentPosition
        ) {
            return null;
        }

        return computeThermometerElimination(
            previousPosition,
            currentPosition,
            answer,
            playArea.boundary as import("geojson").FeatureCollection<
                import("geojson").Polygon | import("geojson").MultiPolygon
            >,
            playArea.bbox,
            zoneFeatures as any,
            questionMapRenderState,
        );
    }, [
        thermometerQ,
        playArea.boundary,
        playArea.bbox,
        zoneFeatures,
        questionMapRenderState,
    ]);
}

export function computeThermometerElimination(
    p1: Position,
    p2: Position,
    answer: "positive" | "negative",
    boundary: import("geojson").FeatureCollection<
        import("geojson").Polygon | import("geojson").MultiPolygon
    >,
    bbox: Bbox,
    zoneFeatures: GeoJsonFeatureCollection,
    questionMapRenderState: ReturnType<typeof useQuestionMapRenderState>,
): number | null {
    const zoneArea = featureCollectionArea(zoneFeatures);
    if (zoneArea <= 0) return null;

    // Non-thermometer masks (same as NativeMap minus thermometer).
    const required = [
        zoneFeatures,
        ...asSep(questionMapRenderState.radar.hitMaskFeatures as any),
        questionMapRenderState.transitLine.hitMaskFeatures as any,
        ...asSep(questionMapRenderState.osmMatching.hitMaskFeatures as any),
        ...asSep(questionMapRenderState.tentacles.hitMaskFeatures as any),
        ...asSep(questionMapRenderState.measuring.hitMaskFeatures as any),
    ];
    const excluded = [
        questionMapRenderState.radar.missMaskFeatures as any,
        questionMapRenderState.transitLine.missMaskFeatures as any,
        questionMapRenderState.osmMatching.missMaskFeatures as any,
        ...asSep(questionMapRenderState.tentacles.missMaskFeatures as any),
        ...asSep(questionMapRenderState.measuring.missMaskFeatures as any),
    ];

    // Baseline: mask without the thermometer answer.
    const baselineMask = buildCombinedEligibilityMask(
        boundary as any,
        required,
        excluded,
    );
    const baselineArea = featureCollectionArea(baselineMask as any);
    if (baselineArea <= 0) return null;

    // Add the thermometer half-plane.
    const halfPlane = buildHalfPlane(p1, p2, answer, boundary, bbox);
    const withThermometerMask = buildCombinedEligibilityMask(
        boundary as any,
        [...required, ...asSep(halfPlane as any)],
        excluded,
    );
    const withThermometerArea = featureCollectionArea(
        withThermometerMask as any,
    );

    const eliminated = 1 - withThermometerArea / baselineArea;
    return Math.max(0, Math.min(100, Math.round(eliminated * 100)));
}

function asSep(fc: GeoJsonFeatureCollection): GeoJsonFeatureCollection[] {
    if (fc.features.length === 0) return [];
    return fc.features.map((feature: any) => ({
        features: [feature],
        type: "FeatureCollection" as const,
    }));
}

function featureCollectionArea(fc: GeoJsonFeatureCollection): number {
    let total = 0;
    for (const feature of fc.features) {
        if (!feature?.geometry) continue;
        const { type } = feature.geometry;
        if (type === "Polygon" || type === "MultiPolygon") {
            total += geomAreaM2(feature.geometry as any);
        }
    }
    return total;
}

import { useMemo } from "react";

import { buildCombinedEligibilityMask } from "@/features/map/maskBuilder";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";
import { useHidingZoneDerived } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { geomAreaM2 } from "@/shared/geometry/parityMetrics";
import type { GeoJsonFeatureCollection } from "@/features/map/geojsonTypes";

export function useEliminationPercentage(): number | null {
    const { playArea } = usePlayArea();
    const { zoneFeatures } = useHidingZoneDerived();
    const questionMapRenderState = useQuestionMapRenderState();

    return useMemo(() => {
        if (!playArea.boundary || zoneFeatures.features.length === 0)
            return null;

        const zoneArea = featureCollectionArea(zoneFeatures as any);
        if (zoneArea <= 0) return null;

        const mask = buildCombinedEligibilityMask(
            playArea.boundary as any,
            [
                zoneFeatures as any,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.radar.hitMaskFeatures as any,
                ),
                questionMapRenderState.transitLine.hitMaskFeatures as any,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.osmMatching.hitMaskFeatures as any,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.thermometer.hitMaskFeatures as any,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.tentacles.hitMaskFeatures as any,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.measuring.hitMaskFeatures as any,
                ),
            ],
            [
                questionMapRenderState.radar.missMaskFeatures as any,
                questionMapRenderState.transitLine.missMaskFeatures as any,
                questionMapRenderState.osmMatching.missMaskFeatures as any,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.tentacles.missMaskFeatures as any,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.measuring.missMaskFeatures as any,
                ),
            ],
        );

        const playAreaArea = featureCollectionArea(playArea.boundary as any);
        const maskArea = featureCollectionArea(mask);
        return zoneEliminationPercent(playAreaArea, maskArea, zoneArea);
    }, [playArea.boundary, zoneFeatures, questionMapRenderState]);
}

/**
 * Convert mask geometry areas into the "% of the hiding zone eliminated" stat.
 *
 * `buildCombinedEligibilityMask` returns the INELIGIBLE region of the entire
 * play area (the grey-out layer), not the eligible region. The eligible area is
 * always a subset of the hiding zone (the zone is a required constraint), so we
 * derive it as `playArea − mask`, then express elimination as the fraction of
 * the zone that is no longer eligible. Result is clamped to [0, 100] and
 * rounded to a whole percent.
 */
export function zoneEliminationPercent(
    playAreaArea: number,
    maskArea: number,
    zoneArea: number,
): number {
    if (zoneArea <= 0) return 0;
    const eligibleArea = Math.max(0, playAreaArea - maskArea);
    const eliminated = 1 - eligibleArea / zoneArea;
    return Math.max(0, Math.min(100, Math.round(eliminated * 100)));
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

function asSeparateMaskConstraints(
    fc: GeoJsonFeatureCollection,
): GeoJsonFeatureCollection[] {
    if (fc.features.length === 0) return [];
    return fc.features.map((feature: any) => ({
        features: [feature],
        type: "FeatureCollection" as const,
    }));
}

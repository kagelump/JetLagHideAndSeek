import { useMemo } from "react";

import {
    eligibleArea,
    zoneBaselineArea,
    zoneEliminationPercent,
} from "@/features/map/eliminationMath";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";
import { useHidingZoneDerived } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";

export type EliminationPercentageResult = {
    /** Eliminated percentage of the hiding zone, or null when not computable. */
    value: number | null;
    /** True while the underlying render state is being recomputed. */
    isComputing: boolean;
};

export function useEliminationPercentage(): EliminationPercentageResult {
    const { playArea } = usePlayArea();
    const { zoneFeatures, activeZoneFeatures } = useHidingZoneDerived();
    const { renderState: questionMapRenderState, isComputing } =
        useQuestionMapRenderState();

    const value = useMemo(() => {
        if (!playArea.boundary || zoneFeatures.features.length === 0)
            return null;

        // Denominator: full hiding zone (unchanged — baseline area).
        const zoneArea = zoneBaselineArea(playArea.boundary, zoneFeatures);
        if (zoneArea <= 0) return null;

        // Numerator: active zone (excludes manually eliminated stations),
        // so manual elimination raises the hero elimination percentage.
        return zoneEliminationPercent(
            eligibleArea(
                playArea.boundary,
                activeZoneFeatures,
                questionMapRenderState,
            ),
            zoneArea,
        );
    }, [
        playArea.boundary,
        zoneFeatures,
        activeZoneFeatures,
        questionMapRenderState,
    ]);

    return { value, isComputing };
}

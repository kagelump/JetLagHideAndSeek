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
    const { zoneFeatures } = useHidingZoneDerived();
    const { renderState: questionMapRenderState, isComputing } =
        useQuestionMapRenderState();

    const value = useMemo(() => {
        if (!playArea.boundary || zoneFeatures.features.length === 0)
            return null;

        const zoneArea = zoneBaselineArea(playArea.boundary, zoneFeatures);
        if (zoneArea <= 0) return null;

        return zoneEliminationPercent(
            eligibleArea(
                playArea.boundary,
                zoneFeatures,
                questionMapRenderState,
            ),
            zoneArea,
        );
    }, [playArea.boundary, zoneFeatures, questionMapRenderState]);

    return { value, isComputing };
}

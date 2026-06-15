import { useMemo } from "react";

import {
    eligibleArea,
    featureCollectionArea,
    zoneEliminationPercent,
} from "@/features/map/eliminationMath";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";
import { useHidingZoneDerived } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";

export function useEliminationPercentage(): number | null {
    const { playArea } = usePlayArea();
    const { zoneFeatures } = useHidingZoneDerived();
    const questionMapRenderState = useQuestionMapRenderState();

    return useMemo(() => {
        if (!playArea.boundary || zoneFeatures.features.length === 0)
            return null;

        const zoneArea = featureCollectionArea(zoneFeatures as any);
        if (zoneArea <= 0) return null;

        return zoneEliminationPercent(
            eligibleArea(
                playArea.boundary as any,
                zoneFeatures as any,
                questionMapRenderState,
            ),
            zoneArea,
        );
    }, [playArea.boundary, zoneFeatures, questionMapRenderState]);
}

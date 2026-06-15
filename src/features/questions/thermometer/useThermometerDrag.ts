import { useCallback, useMemo, useState } from "react";

import { haversineDistanceMeters } from "@/shared/geojson";
import type { Position } from "@/shared/geojson";
import type { ThermometerDragState } from "@/features/questions/thermometer/ThermometerDragContext";

export function useThermometerDrag() {
    const [liveCoords, setLiveCoords] = useState<{
        p1: Position;
        p2: Position;
    } | null>(null);

    const handleDragUpdate = useCallback(
        (update: { p1: Position; p2: Position } | null) => {
            setLiveCoords(update);
        },
        [],
    );

    const dragState: ThermometerDragState = useMemo(() => {
        if (!liveCoords) return null;
        const { p1, p2 } = liveCoords;
        return {
            distanceMeters: haversineDistanceMeters(p1[1], p1[0], p2[1], p2[0]),
            p1,
            p2,
        };
    }, [liveCoords]);

    return { dragState, handleDragUpdate };
}

import type {
    HidingZoneDataSourceInputs,
    HidingZoneRuntimeData,
} from "@/lib/context";
import { canonicalize } from "@/lib/wire";
import type { StationCircle } from "@/maps/api";
import type { TransitGraph } from "@/maps/geo-utils";

export function buildHidingZoneRuntimeData(
    stationCircles: StationCircle[],
    transitGraph: TransitGraph | null,
    sourceInputs: HidingZoneDataSourceInputs,
): HidingZoneRuntimeData {
    return {
        v: 1,
        stationCircles: structuredClone(stationCircles),
        transitGraph: structuredClone(transitGraph),
        sourceInputs: structuredClone(sourceInputs),
    };
}

export function sourceInputsMatch(
    a: HidingZoneDataSourceInputs,
    b: HidingZoneDataSourceInputs,
) {
    return canonicalize(a) === canonicalize(b);
}

export function parseHidingZoneRuntimeData(
    value: unknown,
): HidingZoneRuntimeData | null {
    if (!value || typeof value !== "object") return null;
    const data = value as Partial<HidingZoneRuntimeData>;
    if (data.v !== 1) return null;
    if (!Array.isArray(data.stationCircles)) return null;
    if (!data.sourceInputs || typeof data.sourceInputs !== "object") {
        return null;
    }
    return {
        v: 1,
        stationCircles: data.stationCircles as StationCircle[],
        transitGraph: (data.transitGraph ?? null) as TransitGraph | null,
        sourceInputs: data.sourceInputs as HidingZoneDataSourceInputs,
    };
}

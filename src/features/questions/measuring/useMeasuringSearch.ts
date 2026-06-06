import type { MatchingCategory } from "@/features/questions/matching/matchingTypes";
import { useMatchingSearch } from "@/features/questions/matching/useMatchingSearch";
import { useHidingZoneState } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { MEASURING_TO_MATCHING_CATEGORY } from "./measuringCategories";
import type { MeasuringCategory } from "./measuringTypes";

/**
 * Shared hook for measuring-question feature search. Maps MeasuringCategory to
 * the underlying MatchingCategory and delegates to `useMatchingSearch` so every
 * measuring screen gets abort control, debounce, loading/error state, and
 * fetch-debug recording for free.
 *
 * Returns the same contract as `useMatchingSearch`:
 * `{ isLoading, error, performSearch }`.
 */
export function useMeasuringSearch(
    category: MeasuringCategory,
    center: [number, number],
) {
    const { radiusMeters: stationRadiusMeters } = useHidingZoneState();
    const { playArea } = usePlayArea();

    const matchingCategory = MEASURING_TO_MATCHING_CATEGORY[category] as
        | MatchingCategory
        | undefined;

    // Categories without a matching counterpart (the 5 line/polygon deferred
    // categories) fall through to a no-op state. The UI filters these out so
    // this path is only hit in tests or during category transitions.
    const effectiveCategory: MatchingCategory = matchingCategory ?? "park";

    const isUnbounded = category === "commercial-airport";

    return useMatchingSearch(
        effectiveCategory,
        center,
        stationRadiusMeters,
        playArea.bbox,
        { unbounded: isUnbounded },
    );
}

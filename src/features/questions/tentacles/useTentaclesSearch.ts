import { useCallback } from "react";

import { haversineDistanceMeters } from "@/shared/geojson";
import type { Position } from "@/shared/geojson";
import { useHidingZoneDerived } from "@/state/hidingZoneStore";
import type { MatchingCategory } from "@/features/questions/matching/matchingTypes";
import { useMatchingSearch } from "@/features/questions/matching/useMatchingSearch";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";
import type { TentaclesCategory } from "./tentaclesTypes";

/** Maps TentaclesCategory → MatchingCategory. transit-line has no OSM match. */
const TENTACLES_TO_MATCHING: Partial<
    Record<TentaclesCategory, MatchingCategory>
> = {
    museum: "museum",
    library: "library",
    "movie-theater": "movie-theater",
    hospital: "hospital",
    zoo: "zoo",
    aquarium: "aquarium",
    "amusement-park": "amusement-park",
};

type UseTentaclesSearchOptions = {
    category: TentaclesCategory;
    center: Position;
    distanceMeters: number;
};

type UseTentaclesSearchResult = {
    isLoading: boolean;
    error: string | null;
    /**
     * Execute a search for the configured category + center + radius.
     * Returns in-radius OsmFeature[] or null if superseded / errored.
     */
    performSearch: () => Promise<
        (OsmFeature & { distanceMeters: number })[] | null
    >;
};

/**
 * Search hook for Tentacles questions. Delegates to useMatchingSearch for
 * OSM-backed categories and does station-point filtering for transit-line.
 *
 * Always filters results to within `distanceMeters` of `center`.
 */
export function useTentaclesSearch({
    category,
    center,
    distanceMeters,
}: UseTentaclesSearchOptions): UseTentaclesSearchResult {
    const matchingCategory = TENTACLES_TO_MATCHING[category] ?? null;

    // For transit-line: get station positions from hiding zones.
    const { selectedStations } = useHidingZoneDerived();

    // Use matching search for OSM-backed categories.
    const matchingSearch = useMatchingSearch(
        (matchingCategory ?? "museum") as MatchingCategory, // dummy when null
        center,
        distanceMeters,
        null, // playAreaBbox — let the search work unbounded
        { unbounded: true },
    );

    const performSearch = useCallback(async () => {
        if (matchingCategory) {
            // OSM-backed category: delegate to useMatchingSearch.
            const result = await matchingSearch.performSearch();
            if (result === null) return null;

            const inRadius = result.candidates
                .map((c) => {
                    const dist = haversineDistanceMeters(
                        center[1],
                        center[0],
                        c.lat,
                        c.lon,
                    );
                    return { ...c, distanceMeters: dist };
                })
                .filter((c) => c.distanceMeters <= distanceMeters)
                .sort((a, b) => a.distanceMeters - b.distanceMeters);

            return inRadius;
        }

        // transit-line: use station points (GTFS, not OSM).
        // Deduplicate by station id (a station may appear on multiple lines).
        const seen = new Set<string>();
        const uniqueStations = selectedStations.filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            const dist = haversineDistanceMeters(
                center[1],
                center[0],
                s.lat,
                s.lon,
            );
            return dist <= distanceMeters;
        });

        const candidates = uniqueStations.map((s, index) => ({
            lat: s.lat,
            lon: s.lon,
            name: s.name,
            osmId: index + 1,
            osmType: "node" as const,
            tags: { railway: "station", name: s.name },
            distanceMeters: haversineDistanceMeters(
                center[1],
                center[0],
                s.lat,
                s.lon,
            ),
        }));

        candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
        return candidates;
    }, [
        matchingCategory,
        matchingSearch,
        center,
        distanceMeters,
        selectedStations,
    ]);

    return {
        isLoading: matchingCategory ? matchingSearch.isLoading : false,
        error: matchingCategory ? matchingSearch.error : null,
        performSearch,
    };
}

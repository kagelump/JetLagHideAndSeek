import type { Bbox, Position } from "@/shared/geojson";
import { haversineDistanceMeters } from "@/shared/geojson";

import type { MatchingCategory } from "./matchingTypes";
import {
    findMatchingFeaturesWithCellCache,
    type OsmMatchingCacheSource,
} from "./osmMatchingCache";
import type { OsmFeatureWithDistance } from "./osmMatching";

/** Hard safety cap to prevent infinite-radius searches (200 km). */
const PROGRESSIVE_MAX_RADIUS_METERS = 200_000;

/**
 * Minimum initial search radius to guard against very small / zero station radii.
 */
const MIN_INITIAL_RADIUS_METERS = 1_200;

/**
 * Upper bound for maxCandidates so that rankMatchingFeatures returns all features
 * without practical truncation. The progressive loop needs the true total count
 * to decide whether to expand the radius.
 */
const UNCAPPED_CANDIDATES = 999;

export type ProgressiveSearchResult = {
    candidates: OsmFeatureWithDistance[];
    source: OsmMatchingCacheSource;
    /** The final radius (meters) at which the search stopped. */
    searchRadiusMeters: number;
};

/**
 * Returns true when every corner of `bbox` is within `radiusMeters` of the
 * search center. If the farthest corner is covered, all interior points of
 * the convex bounding box are also covered by the circular search region.
 */
export function searchCoversBbox(
    centerLon: number,
    centerLat: number,
    radiusMeters: number,
    bbox: Bbox,
): boolean {
    const [west, south, east, north] = bbox;
    const corners: [number, number][] = [
        [south, west],
        [south, east],
        [north, west],
        [north, east],
    ];
    for (const [lat, lon] of corners) {
        const dist = haversineDistanceMeters(centerLat, centerLon, lat, lon);
        if (dist > radiusMeters) return false;
    }
    return true;
}

/**
 * Progressively expands the search radius starting at `stationRadiusMeters * 2`,
 * doubling each iteration until the search circle encompasses the entire play
 * area, more than 10 candidates are found, or a hard 200 km cap is reached.
 *
 * Each iteration reuses cells cached by prior iterations; only newly-covered
 * outer cells incur a network or bundle fetch.
 */
export async function searchMatchingFeaturesProgressive(
    category: MatchingCategory,
    center: Position,
    stationRadiusMeters: number,
    playAreaBbox: Bbox | null,
    options?: {
        forceRefresh?: boolean;
        signal?: AbortSignal;
    },
): Promise<ProgressiveSearchResult> {
    const [lon, lat] = center;
    let currentRadius = Math.max(
        stationRadiusMeters * 2,
        MIN_INITIAL_RADIUS_METERS,
    );

    while (true) {
        const effectiveRadius = Math.min(
            currentRadius,
            PROGRESSIVE_MAX_RADIUS_METERS,
        );

        const result = await findMatchingFeaturesWithCellCache(
            category,
            center,
            {
                requestedRadiusMeters: effectiveRadius,
                maxCandidates: UNCAPPED_CANDIDATES,
                forceRefresh: options?.forceRefresh,
                signal: options?.signal,
            },
        );

        // Honour abort signals between iterations.
        if (options?.signal?.aborted) {
            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            throw abortError;
        }

        // Scope candidates to the current search radius so the stop
        // condition and the returned set honour the requested disk rather
        // than the full grid-cell contents.
        const inRadius = result.candidates.filter(
            (c) => c.distanceMeters <= effectiveRadius,
        );

        // Stop if the search disk now covers the entire play area.
        if (
            playAreaBbox !== null &&
            searchCoversBbox(lon, lat, effectiveRadius, playAreaBbox)
        ) {
            return {
                candidates: inRadius,
                source: result.source,
                searchRadiusMeters: effectiveRadius,
            };
        }

        // Stop if we have more than 10 in-radius candidates — the search
        // area is already dense enough for a good matching question.
        if (inRadius.length > 10) {
            return {
                candidates: inRadius,
                source: result.source,
                searchRadiusMeters: effectiveRadius,
            };
        }

        // Stop at the hard cap to prevent runaway expansion.
        if (effectiveRadius >= PROGRESSIVE_MAX_RADIUS_METERS) {
            return {
                candidates: inRadius,
                source: result.source,
                searchRadiusMeters: effectiveRadius,
            };
        }

        currentRadius *= 2;
    }
}

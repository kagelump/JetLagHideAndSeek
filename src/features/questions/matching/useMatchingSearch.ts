import { useCallback, useEffect, useRef, useState } from "react";

import type { Bbox, Position } from "@/shared/geojson";
import type { MatchingCategory } from "./matchingTypes";
import {
    searchMatchingFeaturesProgressive,
    type ProgressiveSearchResult,
} from "./progressiveSearch";
import { useReportFetchDebug } from "./fetchDebug";

const OVERPASS_ERROR_MESSAGE =
    "Unable to search. Check your connection and try again.";

type UseMatchingSearchOptions = {
    /** When true, skip the play-area encompass stop condition so the
     * search can find POIs outside the play area (e.g. airports). */
    unbounded?: boolean;
};

type UseMatchingSearchResult = {
    isLoading: boolean;
    error: string | null;
    /**
     * Execute a search immediately. Pass `forceRefresh = true` to discard
     * cached cells and re-fetch everything. Returns the search result or
     * null if the request was superseded or aborted.
     *
     * Automatically records fetch-debug info so the centralized footer
     * renders without any extra work from the screen.
     */
    performSearch: (
        forceRefresh?: boolean,
    ) => Promise<ProgressiveSearchResult | null>;
};

/**
 * Shared hook for matching-question feature search. Encapsulates abort
 * control, debounce, loading/error state, and fetch-debug recording so
 * every screen that fetches through it gets the debug footer for free.
 *
 * The canonical fetch path — screens should use this instead of calling
 * `searchMatchingFeaturesProgressive` or lower-level fetchers directly.
 */
export function useMatchingSearch(
    category: MatchingCategory,
    center: Position,
    stationRadiusMeters: number,
    playAreaBbox: Bbox | null,
    options?: UseMatchingSearchOptions,
): UseMatchingSearchResult {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reportDebug = useReportFetchDebug();
    const searchGenerationRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    const performSearch = useCallback(
        async (forceRefresh = false) => {
            // Cancel any in-flight request before starting a new one.
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            const generation = ++searchGenerationRef.current;
            console.log(
                `[search] performSearch #${generation} category=${category} forceRefresh=${forceRefresh} unbounded=${options?.unbounded ?? false}`,
            );
            setIsLoading(true);
            setError(null);
            reportDebug({
                totalCount: 0,
                origins: {},
                durationMs: 0,
                status: "loading",
                at: Date.now(),
            });

            try {
                const t0 = Date.now();
                const result = await searchMatchingFeaturesProgressive(
                    category,
                    center,
                    stationRadiusMeters,
                    playAreaBbox,
                    {
                        forceRefresh,
                        signal: abortController.signal,
                        unbounded: options?.unbounded,
                    },
                );
                console.log(
                    `[search] performSearch #${generation} done in ${Date.now() - t0}ms — ${result.candidates.length} candidates, source=${result.source}`,
                );

                // Ignore stale responses from earlier searches.
                if (generation !== searchGenerationRef.current) {
                    console.log(
                        `[search] performSearch #${generation} discarded (stale, current=#${searchGenerationRef.current})`,
                    );
                    return null;
                }

                // Record fetch-debug info so the centralized footer renders.
                if (result.debug) {
                    reportDebug(result.debug);
                }

                return result;
            } catch (err) {
                // Silently ignore aborted requests — a newer search is in flight.
                if (err instanceof Error && err.name === "AbortError") {
                    console.log(
                        `[search] performSearch #${generation} aborted`,
                    );
                    return null;
                }
                console.error(
                    `[search] performSearch #${generation} error:`,
                    err,
                );
                if (generation === searchGenerationRef.current) {
                    setError(OVERPASS_ERROR_MESSAGE);
                    reportDebug({
                        totalCount: 0,
                        origins: {},
                        durationMs: 0,
                        status: "error",
                        at: Date.now(),
                    });
                }
                return null;
            } finally {
                if (generation === searchGenerationRef.current) {
                    setIsLoading(false);
                    console.log(
                        `[search] performSearch #${generation} setIsLoading(false)`,
                    );
                } else {
                    console.log(
                        `[search] performSearch #${generation} skipped setIsLoading(false) — current gen=#${searchGenerationRef.current}`,
                    );
                }
            }
        },
        [
            category,
            center,
            stationRadiusMeters,
            playAreaBbox,
            options?.unbounded,
            reportDebug,
        ],
    );

    // Clean up in-flight requests on unmount.
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
        };
    }, []);

    return { isLoading, error, performSearch };
}

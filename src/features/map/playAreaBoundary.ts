import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";

import type { GeoJsonFeatureCollection } from "./geojsonTypes";
import {
    defaultPlayArea,
    type PlayArea,
    type PlayAreaCacheSource,
} from "./playArea";
export {
    buildPlayAreaFromBoundary,
    buildPlayAreaFromOverpass,
} from "./playAreaBoundaryConversion";
import {
    buildPlayAreaFromBoundary,
    buildPlayAreaFromOverpass,
} from "./playAreaBoundaryConversion";
import { NETWORK } from "@/config/appConfig";
import { BOUNDARY_CACHE_TTL_MS, queryClient } from "@/state/queryClient";
import {
    findBoundaryRelation,
    getBoundaryPolygon,
} from "@/features/offline/boundaryStore";
import { multiPolygonCoordsToGeoJSON } from "@/features/offline/deltaDecode";

// Re-export for consumers that need the constant.
export { BOUNDARY_CACHE_TTL_MS } from "@/state/queryClient";

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const CACHE_PREFIX = "play-area-boundary:";

export type LoadedPlayArea = {
    cacheSource: PlayAreaCacheSource;
    playArea: PlayArea;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function parseRelationId(value: string): number | null {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;

    const relationId = Number(trimmed);
    if (!Number.isSafeInteger(relationId) || relationId <= 0) return null;

    return relationId;
}

export function isBundledPlayAreaId(relationId: number): boolean {
    return relationId === defaultPlayArea.osmId;
}

// ---------------------------------------------------------------------------
// Network fetch (pure — no caching)
// ---------------------------------------------------------------------------

export async function fetchPlayAreaBoundary(
    relationId: number,
    signal?: AbortSignal,
): Promise<PlayArea> {
    const query = `[out:json][timeout:60];relation(${relationId});out geom qt;`;
    const url = `${OVERPASS_API}?data=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
        signal,
        headers: NETWORK.overpassHeaders,
    });

    if (!response.ok) {
        throw new Error(`Overpass API error ${response.status}`);
    }

    const overpassJson = await response.json();
    return buildPlayAreaFromOverpass(relationId, overpassJson);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlayAreaBoundary(relationId: number | null) {
    return useQuery({
        queryKey: ["play-area-boundary", relationId],
        queryFn: ({ signal }) => fetchPlayAreaBoundary(relationId!, signal),
        enabled: relationId != null && !isBundledPlayAreaId(relationId),
        staleTime: BOUNDARY_CACHE_TTL_MS,
        initialData:
            relationId != null
                ? (getBundledPlayArea(relationId) ?? undefined)
                : undefined,
    });
}

// ---------------------------------------------------------------------------
// Programmatic access (for stores / persistence)
// ---------------------------------------------------------------------------

/**
 * Load a play area by relation ID. Resolution order:
 * 1. Bundled Tokyo placeholder
 * 2. Memory cache (React Query)
 * 3. AsyncStorage cache
 * 4. Installed packs (NEW — offline)
 * 5. Overpass fetch (live)
 */
export async function loadPlayAreaByRelationId(
    relationId: number,
): Promise<LoadedPlayArea> {
    // 1. Bundled boundaries resolve instantly.
    const bundled = getBundledPlayArea(relationId);
    if (bundled) {
        return { cacheSource: "bundled", playArea: bundled };
    }

    // 2. Check React Query cache.
    const wasCached = queryClient.getQueryData<PlayArea>([
        "play-area-boundary",
        relationId,
    ]);

    // 3. Check AsyncStorage cache.
    if (!wasCached) {
        const persisted = await readPersistedBoundary(relationId);
        if (persisted) {
            queryClient.setQueryData(
                ["play-area-boundary", relationId],
                persisted,
            );
            return { cacheSource: "persisted", playArea: persisted };
        }
    }

    // 4. Check installed packs (offline!).
    const packMatch = findBoundaryRelation(relationId);
    if (packMatch) {
        const coords = await getBoundaryPolygon(packMatch.packId, relationId);
        if (coords && coords.length > 0) {
            const geometry = multiPolygonCoordsToGeoJSON(coords);
            const label = packMatch.entry.nameEn ?? packMatch.entry.name;

            // Build a GeoJSON FeatureCollection for the conversion helper.
            const boundary: GeoJsonFeatureCollection = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry,
                        properties: {
                            osmId: relationId,
                            name: label,
                        },
                    },
                ],
            };

            const playArea = buildPlayAreaFromBoundary(relationId, boundary);

            // Cache in AsyncStorage for subsequent loads.
            await ensurePlayAreaBoundaryCached(playArea);

            return { cacheSource: "bundled", playArea };
        }
    }

    // 5. Fall back to Overpass (live).
    const playArea = await queryClient.fetchQuery<PlayArea>({
        queryKey: ["play-area-boundary", relationId],
        queryFn: ({ signal }) => fetchPlayAreaBoundary(relationId, signal),
        staleTime: BOUNDARY_CACHE_TTL_MS,
        // Surface errors immediately for programmatic callers (the store
        // manages its own loading/error state). Components using the
        // usePlayAreaBoundary hook still get the default retry behavior.
        retry: false,
    });

    return {
        cacheSource: wasCached ? "memory" : "fetched",
        playArea,
    };
}

/**
 * Resolve a relation ID from the cache without triggering a fetch. Returns
 * null when the boundary is not cached. Checks bundled, memory, persisted,
 * and installed packs. Used by app-state restoration to check whether a
 * boundary reference can be resolved offline.
 */
export async function loadCachedPlayAreaByRelationId(
    relationId: number,
): Promise<LoadedPlayArea | null> {
    const bundled = getBundledPlayArea(relationId);
    if (bundled) {
        return { cacheSource: "bundled", playArea: bundled };
    }

    // Check the in-memory query cache first (rehydrated by the persister).
    const cached = queryClient.getQueryData<PlayArea>([
        "play-area-boundary",
        relationId,
    ]);
    if (cached) {
        return { cacheSource: "memory", playArea: cached };
    }

    // Fall back to a direct AsyncStorage read — the persister may not have
    // rehydrated yet during app-startup restoration, so this guarantees the
    // boundary is resolvable without a network call.
    const persisted = await readPersistedBoundary(relationId);
    if (persisted) {
        queryClient.setQueryData(["play-area-boundary", relationId], persisted);
        return { cacheSource: "persisted", playArea: persisted };
    }

    // Check installed packs — can resolve boundaries fully offline.
    const packMatch = findBoundaryRelation(relationId);
    if (packMatch) {
        const coords = await getBoundaryPolygon(packMatch.packId, relationId);
        if (coords && coords.length > 0) {
            const geometry = multiPolygonCoordsToGeoJSON(coords);
            const label = packMatch.entry.nameEn ?? packMatch.entry.name;
            const boundary: GeoJsonFeatureCollection = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry,
                        properties: {
                            osmId: relationId,
                            name: label,
                        },
                    },
                ],
            };
            const playArea = buildPlayAreaFromBoundary(relationId, boundary);
            await ensurePlayAreaBoundaryCached(playArea);
            return { cacheSource: "bundled", playArea };
        }
    }

    return null;
}

/**
 * Ensure a boundary is durably cached so that app-state restore can resolve
 * it offline after a restart.
 *
 * Two independent writes are made:
 * 1. Query cache — so the persister picks it up immediately.
 * 2. Direct AsyncStorage write — a durable backstop that survives gc eviction.
 *    The query cache entry is garbage-collected after gcTime (default 30 min)
 *    when no observer is mounted. If the gc fires and the persister re-saves
 *    the blob without this entry, the direct key is the only offline copy.
 *
 * Both writes are first-writer-wins: an existing entry in either layer is
 * preserved so a background-refreshed fresher copy is never overwritten.
 */
export async function ensurePlayAreaBoundaryCached(playArea: PlayArea) {
    if (isBundledPlayAreaId(playArea.osmId)) return;

    // Query cache: write only if absent (preserve a fresher in-memory copy).
    const existing = queryClient.getQueryData<PlayArea>([
        "play-area-boundary",
        playArea.osmId,
    ]);
    if (!existing) {
        queryClient.setQueryData(
            ["play-area-boundary", playArea.osmId],
            playArea,
        );
    }

    // AsyncStorage: write only if the disk key is absent. This is independent
    // of the query-cache state so gc eviction cannot remove the only durable copy.
    try {
        const diskKey = getBoundaryCacheKey(playArea.osmId);
        const onDisk = await AsyncStorage.getItem(diskKey);
        if (!onDisk) {
            await AsyncStorage.setItem(
                diskKey,
                JSON.stringify(existing ?? playArea),
            );
        }
    } catch {
        // AsyncStorage may not be available — ignore.
    }
}

// ---------------------------------------------------------------------------
// Legacy cache-key cleanup
// ---------------------------------------------------------------------------

/**
 * Remove pre-migration boundary cache entries written by the hand-rolled cache
 * (format: `{cachedAt, playArea}`). Plain PlayArea entries written by the new
 * durable backstop are left untouched so they survive gc eviction.
 */
export async function cleanOrphanedBoundaryKeys(): Promise<void> {
    try {
        const keys = await AsyncStorage.getAllKeys();
        for (const key of keys) {
            if (!key.startsWith(CACHE_PREFIX)) continue;

            try {
                const raw = await AsyncStorage.getItem(key);
                if (!raw) continue;

                const parsed = JSON.parse(raw) as unknown;
                // Pre-migration entries are envelopes with a `cachedAt` field.
                // Plain PlayArea objects (new durable-backstop format) are kept.
                if (isRecord(parsed) && "cachedAt" in parsed) {
                    await AsyncStorage.removeItem(key);
                }
            } catch {
                // Corrupted — remove.
                await AsyncStorage.removeItem(key);
            }
        }
    } catch {
        // AsyncStorage may not be available — ignore.
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getBundledPlayArea(relationId: number): PlayArea | null {
    return relationId === defaultPlayArea.osmId ? defaultPlayArea : null;
}

async function readPersistedBoundary(
    relationId: number,
): Promise<PlayArea | null> {
    const cacheKey = getBoundaryCacheKey(relationId);
    try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as unknown;

        // Handle both legacy {cachedAt, playArea} envelopes and plain PlayArea.
        const playArea =
            isRecord(parsed) && "playArea" in parsed
                ? (parsed as { playArea: unknown }).playArea
                : parsed;

        if (!isPlayArea(playArea, relationId)) {
            await AsyncStorage.removeItem(cacheKey);
            return null;
        }
        return playArea;
    } catch {
        await AsyncStorage.removeItem(cacheKey);
        return null;
    }
}

function isPlayArea(value: unknown, relationId: number): value is PlayArea {
    if (!isRecord(value)) return false;
    return (
        value.osmId === relationId &&
        value.osmType === "R" &&
        typeof value.label === "string" &&
        isNumberTuple(value.bbox, 4) &&
        isNumberTuple(value.center, 2) &&
        isRecord(value.boundary) &&
        value.boundary.type === "FeatureCollection" &&
        Array.isArray(value.boundary.features)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberTuple(value: unknown, length: number): boolean {
    return (
        Array.isArray(value) &&
        value.length === length &&
        value.every((part) => typeof part === "number" && Number.isFinite(part))
    );
}

function getBoundaryCacheKey(relationId: number): string {
    return `${CACHE_PREFIX}${relationId}`;
}

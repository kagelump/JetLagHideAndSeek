import _ from "lodash";
import { toast } from "react-toastify";

import {
    CasHttpError,
    deleteOverpassIndexMapping,
    getBlobInNamespace,
    getOverpassIndexMapping,
} from "@/lib/cas";
import {
    casServerEffectiveUrl,
    casServerStatus,
    clearOverpassRequestIndex,
    getOverpassRequestIndexEntry,
    invalidateOverpassRequestIndexEntry,
    upsertOverpassRequestIndex,
} from "@/lib/context";
import { decompress } from "@/lib/utils";

import { CacheType } from "./types";

const determineQuestionCache = _.memoize(() => caches.open(CacheType.CACHE));
const determineZoneCache = _.memoize(() => caches.open(CacheType.ZONE_CACHE));
const determinePermanentCache = _.memoize(() =>
    caches.open(CacheType.PERMANENT_CACHE),
);

const inFlightFetches = new Map<string, Promise<Response>>();

export const determineCache = async (cacheType: CacheType) => {
    switch (cacheType) {
        case CacheType.CACHE:
            return await determineQuestionCache();
        case CacheType.ZONE_CACHE:
            return await determineZoneCache();
        case CacheType.PERMANENT_CACHE:
            return await determinePermanentCache();
    }
};

export const cacheFetch = async (
    url: string,
    loadingText?: string,
    cacheType: CacheType = CacheType.CACHE,
    options?: {
        cacheKeyUrl?: string;
        skipCacheRead?: boolean;
    },
) => {
    const cacheKeyUrl = options?.cacheKeyUrl ?? url;
    try {
        const cache = await determineCache(cacheType);

        if (!options?.skipCacheRead) {
            const cachedResponse = await cache.match(cacheKeyUrl);
            if (cachedResponse) {
                if (!cachedResponse.ok) {
                    await cache.delete(cacheKeyUrl);
                } else {
                    return cachedResponse.clone();
                }
            }
        }

        const inflightKey = `${cacheType}:${cacheKeyUrl}`;
        const existingFetch = inFlightFetches.get(inflightKey);
        if (existingFetch) {
            const response = await existingFetch;
            return response.clone();
        }

        const fetchAndMaybeCache = async () => {
            const response = await fetch(url);
            if (response.ok) {
                await cache.put(cacheKeyUrl, response.clone());
            } else {
                await cache.delete(cacheKeyUrl);
            }
            return response;
        };

        const fetchPromise = fetchAndMaybeCache();
        inFlightFetches.set(inflightKey, fetchPromise);

        try {
            const response = await (loadingText
                ? toast.promise(fetchPromise, {
                      pending: loadingText,
                  })
                : fetchPromise);

            return response.clone();
        } finally {
            inFlightFetches.delete(inflightKey);
        }
    } catch (e) {
        console.log(e); // Probably a caches not supported error

        const fallbackFetch = fetch(url);
        return loadingText
            ? await toast.promise(fallbackFetch, {
                  pending: loadingText,
              })
            : await fallbackFetch;
    }
};

const OVERPASS_INDEX_VERSION_TAG = "overpass-hybrid-v1";

const buildCasBackedResponse = async (
    requestHash: string,
    sid: string,
    cacheWriteUrl: string,
    cacheType: CacheType,
): Promise<Response | null> => {
    const base = casServerEffectiveUrl.get();
    if (!base || casServerStatus.get() !== "available") return null;
    try {
        const compressed = await getBlobInNamespace(base, "overpass", sid);
        const payload = await decompress(compressed);
        const cache = await determineCache(cacheType);
        const response = new Response(payload, {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
        await cache.put(cacheWriteUrl, response.clone());
        return response;
    } catch (error) {
        if (error instanceof CasHttpError && error.status === 404) {
            invalidateOverpassRequestIndexEntry(requestHash);
            try {
                await deleteOverpassIndexMapping(base, requestHash);
            } catch {
                // Non-fatal: still continue with cold network fetch.
            }
        }
        return null;
    }
};

export const hybridOverpassFetch = async ({
    primaryUrl,
    requestHash,
    loadingText,
    cacheType,
    ttlMs,
}: {
    primaryUrl: string;
    requestHash: string;
    loadingText?: string;
    cacheType: CacheType;
    ttlMs: number;
}): Promise<Response | null> => {
    const cache = await determineCache(cacheType);
    const cachedResponse = await cache.match(primaryUrl);
    if (cachedResponse) {
        if (!cachedResponse.ok) {
            await cache.delete(primaryUrl);
        } else {
            return cachedResponse.clone();
        }
    }

    const now = Date.now();
    const base = casServerEffectiveUrl.get();
    let sidFromServer: string | null = null;
    if (base && casServerStatus.get() === "available") {
        try {
            const serverEntry = await getOverpassIndexMapping(base, requestHash);
            if (serverEntry && serverEntry.expiresAt > now) {
                sidFromServer = serverEntry.sid;
                upsertOverpassRequestIndex(requestHash, {
                    sid: serverEntry.sid,
                    cachedAt: serverEntry.cachedAt,
                    expiresAt: serverEntry.expiresAt,
                    source: "cas",
                });
            }
        } catch {
            // Non-fatal: local index/network fallback below.
        }
    }

    const localEntry = getOverpassRequestIndexEntry(requestHash, now);
    const sid = sidFromServer ?? localEntry?.sid ?? null;
    if (sid) {
        const casResponse = await buildCasBackedResponse(
            requestHash,
            sid,
            primaryUrl,
            cacheType,
        );
        if (casResponse) {
            upsertOverpassRequestIndex(requestHash, {
                sid,
                cachedAt: now,
                expiresAt: now + ttlMs,
                source: sidFromServer ? "cas" : "local",
            });
            return casResponse;
        }
    }

    return await cacheFetch(primaryUrl, loadingText, cacheType, {
        cacheKeyUrl: primaryUrl,
        skipCacheRead: true,
    });
};

export const OVERPASS_HYBRID_VERSION_TAG = OVERPASS_INDEX_VERSION_TAG;

export const clearCache = async (cacheType: CacheType = CacheType.CACHE) => {
    try {
        const cache = await determineCache(cacheType);
        await cache.keys().then((keys) => {
            keys.forEach((key) => {
                cache.delete(key);
            });
        });
        clearOverpassRequestIndex();
    } catch (e) {
        console.log(e); // Probably a caches not supported error
    }
};

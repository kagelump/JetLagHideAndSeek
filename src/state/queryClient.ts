import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";

/** 30 days — boundary data changes very rarely. */
// Infinity tells TanStack Query "never stale by time" and avoids a 30-day
// setTimeout that overflows Node's 32-bit signed integer timer (~24.8 days).
// Boundary data is refreshed by explicit user action, not a clock.
export const BOUNDARY_CACHE_TTL_MS = Infinity;

/**
 * Bump this string whenever the dehydration policy or serialised query shape
 * changes in a way that would make a previously-persisted cache invalid.
 * Mismatched busters cause `persistQueryClientRestore` to discard the entire
 * cache so stale data (e.g. pending queries from the older, buggier dehydrator)
 * is not rehydrated.
 */
const PERSISTER_BUSTER = "v1";

const IS_TEST =
    typeof process !== "undefined" &&
    (process.env.NODE_ENV === "test" ||
        process.env.JEST_WORKER_ID !== undefined);

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: IS_TEST ? 0 : 2,
            staleTime: 5 * 60 * 1000,
            gcTime: 30 * 60 * 1000,
            refetchOnWindowFocus: false, // not meaningful on RN
        },
    },
});

const asyncStoragePersister = createAsyncStoragePersister({
    storage: AsyncStorage,
    key: "REACT_QUERY_OFFLINE_CACHE",
});

let persisterRestorePromise: Promise<void> | null = null;
let persisterUnsubscribe: (() => void) | null = null;

/** Set up persister once. Returns the restore promise so consumers can await
 *  rehydration before reading from the query cache (e.g. during app-state
 *  restore). Safe to call multiple times — only the first call takes effect. */
export function setupPersister(): Promise<void> {
    if (persisterRestorePromise) return persisterRestorePromise;

    const [unsubscribe, promise] = persistQueryClient({
        queryClient,
        persister: asyncStoragePersister,
        maxAge: BOUNDARY_CACHE_TTL_MS,
        buster: PERSISTER_BUSTER,
        dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
                // Only persist queries that finished successfully — pending
                // queries whose network request fails after dehydration
                // produce the "dehydrated as pending ended up rejecting"
                // error and are re-fetched on every launch, wasting a
                // network call and spamming the console.
                if (query.state.status !== "success") return false;
                const key = query.queryKey;
                return (
                    key[0] === "play-area-boundary" || key[0] === "osm-matching"
                );
            },
        },
    });

    persisterUnsubscribe = unsubscribe;
    persisterRestorePromise = promise;
    return promise;
}

/**
 * Unsubscribes the persister from the query cache and cancels its throttle
 * timer. Safe to call when no persister is active. Primarily used in test
 * teardown to prevent the persister's 1s throttle timer from keeping the
 * Jest worker alive.
 */
export function teardownPersister(): void {
    persisterUnsubscribe?.();
    persisterUnsubscribe = null;
    persisterRestorePromise = null;
}

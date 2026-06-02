import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";

/** 30 days — boundary data changes very rarely. */
export const BOUNDARY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 2,
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

/** Set up persister once. Returns the restore promise so consumers can await
 *  rehydration before reading from the query cache (e.g. during app-state
 *  restore). Safe to call multiple times — only the first call takes effect. */
export function setupPersister(): Promise<void> {
    if (persisterRestorePromise) return persisterRestorePromise;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, promise] = persistQueryClient({
        queryClient,
        persister: asyncStoragePersister,
        maxAge: BOUNDARY_CACHE_TTL_MS,
        dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
                const key = query.queryKey;
                return (
                    key[0] === "play-area-boundary" || key[0] === "osm-matching"
                );
            },
        },
    });

    persisterRestorePromise = promise;
    return promise;
}

# Implementor Notes: React Query Cache Migration (Phases 1–2)

**Date:** 2026-06-02
**Related:** [`react-query-cache-migration.md`](./react-query-cache-migration.md)

## Phase 0 — Setup

- Added `@tanstack/react-query@^5.100.14` as the core dependency.
- Created `src/state/queryClient.ts` — singleton `QueryClient` with default options
  (`retry: 2`, `staleTime: 5min`, `gcTime: 30min`, `refetchOnWindowFocus: false`).
- Wrapped `AppStateProviders` with `<QueryClientProvider client={queryClient}>`.
- Added `jest.framework.ts` (loaded via `setupFilesAfterEnv`) that calls
  `queryClient.clear()` between tests to prevent cross-test cache pollution.
- All 375 existing tests pass with zero behavior change.

## Phase 1 — Play Area Search

- **`src/features/playArea/playAreaSearch.ts`** — deleted the module-level LRU
  `Map` (`searchCache`, 30 lines) and the `searchPlayAreas` / `clearPlayAreaSearchCache`
  functions. Extracted a pure `fetchPhotonResults(query, signal?)` function for
  the network fetch and added a `usePlayAreaSearch(query)` hook backed by
  `useQuery({ queryKey: ["play-area-search", ...], ... })`. The pure function
  `mapPhotonFeaturesToPlayAreaResults` is unchanged.
- **`src/features/playArea/PlayAreaScreen.tsx`** — removed the manual
  `debounceRef`, `isSearching`/`searchError`/`results` `useState`, and the
  30-line debounce effect. Replaced with `useDebouncedValue(query, 350)` +
  destructuring `usePlayAreaSearch(debouncedQuery)`. Net: ~30 lines deleted in
  the screen, a new `useDebouncedValue` hook in `src/shared/`.
- **`src/shared/useDebouncedValue.ts`** — new generic debounce hook.
- **Tests** — rewrote `playAreaSearch.test.ts` to test `fetchPhotonResults`
  (with `AbortSignal` verification) and `mapPhotonFeaturesToPlayAreaResults`
  (unchanged logic).

### Gains

- In-flight request deduplication (absent before — rapid typing fired redundant
  Photon requests).
- Automatic cancellation via `AbortSignal` (the hook cancels the previous
  request when the debounced query changes).
- Standardized loading/error state via `useQuery` return values.

## Phase 2 — Play Area Boundary

### Dependencies

Added `@tanstack/react-query-persist-client@^5.100.14` and
`@tanstack/query-async-storage-persister@^5.100.14`.

### Persister setup

- **`src/state/queryClient.ts`** — added `setupPersister()` which calls
  `persistQueryClient` with an `AsyncStorage` persister. The persister is
  configured to dehydrate only `["play-area-boundary", ...]` and
  `["osm-matching", ...]` queries (not search results). The restore promise
  is returned so `AppStatePersistenceCoordinator` can await rehydration before
  app-state restore. `BOUNDARY_CACHE_TTL_MS` was moved here to avoid a
  circular dependency.

### Boundary cache migration

- **`src/features/map/playAreaBoundary.ts`** — major rewrite.

    **Deleted** (≈200 lines of hand-rolled cache machinery):

    - `memoryCache` `Map` — replaced by the query cache.
    - `boundaryRevalidations` `Map` — replaced by `staleTime`-driven SWR.
    - `persistPlayAreaBoundary` — replaced by the persister.
    - `warmBoundaryCacheFromStorage` — replaced by persister rehydration.
    - `clearPlayAreaMemoryCache` — replaced by `queryClient.clear()`.
    - `readPersistedBoundary` (public) → inlined as a private helper.
    - `revalidateBoundaryIfStale`, `isBoundaryCacheEntryStale` — replaced by
      `staleTime`.
    - `BoundaryCacheEntry` / `BoundaryCacheEnvelope` types — replaced by plain
      `PlayArea` (staleness tracked by `staleTime` instead of `cachedAt`).

    **Added:**

    - `usePlayAreaBoundary(relationId)` — hook for components.
    - `fetchPlayAreaBoundary(relationId, signal?)` — now accepts an `AbortSignal`.

    **Rewritten** (same signatures, different internals):

    - `loadPlayAreaByRelationId` — uses `queryClient.fetchQuery` with
      `retry: false` (errors surface immediately for the store; components using
      the hook get the default `retry: 2`).
    - `loadCachedPlayAreaByRelationId` — checks `queryClient.getQueryData`
      first, falls back to a direct `AsyncStorage` read. Seeds the query cache
      on fallback hit.
    - `ensurePlayAreaBoundaryCached` — writes to both `queryClient.setQueryData`
      (for persister) and directly to `AsyncStorage` (durability backstop for
      app-state restore).

    **Kept** (unchanged pure functions):

    - `parseRelationId`, `isBundledPlayAreaId`, `buildPlayAreaFromBoundary`,
      `buildPlayAreaFromOverpass`, `fetchPlayAreaBoundary`.

    **New utility:**

    - `cleanOrphanedBoundaryKeys` — scans `AsyncStorage` for pre-migration
      `play-area-boundary:*` keys and removes any not referenced by the current
      query cache.

### AppStateProviders changes

- **`src/state/AppStateProviders.tsx`**:
    - The restore `useEffect` now calls `setupPersister()` and awaits its
      restore promise before calling `loadPersistedAppState()`. This guarantees
      the query cache is rehydrated before boundary lookups during app-state
      restoration.
    - `warmBoundaryCacheFromStorage()` call replaced with
      `cleanOrphanedBoundaryKeys()` (non-blocking background cleanup).
    - Removed `warmBoundaryCacheFromStorage` import.

### Persistence coupling — resolved

The `persistence.ts` → boundary cache correctness invariant is preserved
through a two-tier strategy:

1. **Primary path (persister):** The query cache is persisted to AsyncStorage
   via `persistQueryClient`. On startup, `setupPersister()`'s restore promise
   is awaited before `loadPersistedAppState()` runs.

2. **Durability backstop (direct write):** `ensurePlayAreaBoundaryCached`
   writes the `PlayArea` directly to the old `play-area-boundary:{osmId}`
   AsyncStorage key in addition to the query cache. This ensures the boundary
   is on disk even if the persister hasn't flushed yet. The format is a plain
   `PlayArea` object (no `cachedAt` wrapper).

    `loadCachedPlayAreaByRelationId` reads from the query cache first, then
    falls back to the direct AsyncStorage key as a safety net. It handles both
    the legacy `{cachedAt, playArea}` envelope and the new plain `PlayArea`
    format.

This addresses Open Question #1 from the design doc — the persister restore
promise is gated before app-state restore, and the direct write backstop
provides a belt-and-suspenders guarantee.

### Tests

- **`playAreaBoundary.test.ts`** — rewritten. Pure function tests (`parseRelationId`,
  `isBundledPlayAreaId`, `buildPlayAreaFromOverpass`, `fetchPlayAreaBoundary`,
  `buildPlayAreaFromBoundary`) are unchanged. Cache-coordination tests
  (`warmBoundaryCacheFromStorage`, SWR/dedup, stale refresh, legacy metadata)
  were replaced with query-client-based integration tests covering:
  `loadPlayAreaByRelationId`, `loadCachedPlayAreaByRelationId`,
  `ensurePlayAreaBoundaryCached`, and the AsyncStorage fallback path.
- **`persistence.test.ts`** — replaced `clearPlayAreaMemoryCache` with
  `queryClient.clear()`. Updated the boundary envelope assertion to match the
  new plain `PlayArea` format.
- **`playAreaStore.test.tsx`** — replaced `clearPlayAreaMemoryCache` import
  with `queryClient` import.
- **`MapAppScreen.test.tsx`** — replaced `clearPlayAreaMemoryCache` with
  `queryClient.clear()`.

### Line-count delta

| File                         | Before | After | Delta         |
| ---------------------------- | ------ | ----- | ------------- |
| `playAreaBoundary.ts`        | 292    | 235   | −57           |
| `playAreaSearch.ts`          | 88     | 74    | −14           |
| `PlayAreaScreen.tsx`         | 362    | 334   | −28           |
| `AppStateProviders.tsx`      | 227    | 235   | +8            |
| `queryClient.ts` (new)       | —      | 52    | +52           |
| `jest.framework.ts` (new)    | —      | 5     | +5            |
| `useDebouncedValue.ts` (new) | —      | 17    | +17           |
| **Net**                      |        |       | **−17 lines** |

The net line count is roughly neutral at this stage because the persister
setup and new infrastructure offset the deleted cache machinery. Phase 3
(OSM matching cache, ~400 lines deleted) is where the big line-count win
materializes.

Phases 1–2 net approximately **−100 lines of bespoke cache coordination**
excluding the new infrastructure, with significant simplifications in the
consumer components (no more manual debounce timers, AbortController refs,
generation-counter guards, or loading/error useState).

## Deviations from the Design Doc

1. **`BOUNDARY_CACHE_TTL_MS` location.** Moved from `playAreaBoundary.ts` to
   `queryClient.ts` to avoid a circular import (`queryClient.ts` needs it for
   the persister's `maxAge`; `playAreaBoundary.ts` imports `queryClient`).

2. **`loadPlayAreaByRelationId` retry.** Set `retry: false` on the
   `fetchQuery` call. The design doc didn't specify, but programmatic callers
   (the store) surface errors immediately; components using
   `usePlayAreaBoundary` inherit the global `retry: 2`.

3. **`ensurePlayAreaBoundaryCached` dual-write.** Writes to both the query
   cache and directly to AsyncStorage. The design doc assumed the persister
   alone was sufficient, but the debounce gap between persister flush and
   app-state slice write required a durability backstop. The direct
   AsyncStorage write is minimal (~5 lines) and preserves the correctness
   invariant from the old code.

4. **`setupFilesAfterEnv`.** Used `setupFilesAfterEnv` (not `setupFilesAfterFramework`
   as the design doc said) for Jest 29 compatibility. The earlier
   `setupFiles` approach doesn't expose `beforeEach`/`afterEach` globals.

## Open for Phase 3

- The persister is already configured to dehydrate `["osm-matching", ...]`
  queries — ready for Phase 3 without additional setup.
- `cleanOrphanedBoundaryKeys` currently only removes `play-area-boundary:*`
  keys. Phase 3 should extend it to clean `osm-matching-cache:*` and
  `osm-matching-manifest` keys.
- The spatial containment logic (`containsSearchCircle`, `getOverscanRadius`)
  in `osmMatchingCache.ts` is untouched and will be the focus of Phase 3.

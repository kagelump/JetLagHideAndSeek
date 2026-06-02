# Code Review: Audit Items #3, #4, #5

Date: 2026-06-02
Commit: `b1a97a922f009b07cabe26fb14d0ffd8ab0e2897`
Reviewer: Claude (medium effort, 9 angles × Phase 2 verify × Phase 3 sweep)

Related: [map-performance-audit-2026-06-01](./map-performance-audit-2026-06-01.md),
[perf-implementation-report-2026-06-02](./perf-implementation-report-2026-06-02.md)

---

## Why `pnpm perf:test` did not move

The perf numbers are flat because **Finding 1 is the root cause**: `findMatchingFeaturesWithCellCache` was never wired to `OsmMatchingQuestionDetailScreen`. The screen still calls `findMatchingFeaturesWithCache`. All of the new cell-cache code is dead at runtime.

---

## Findings

Ranked most-severe first. Each entry states the broken invariant, the exact location, the failure scenario, and the fix with tests to add.

---

### F1 — Cell cache never called in production (Critical)

**File:** [`src/features/questions/matching/OsmMatchingQuestionDetailScreen.tsx:14`](../src/features/questions/matching/OsmMatchingQuestionDetailScreen.tsx)

**Current code:**

```ts
import {
    findMatchingFeaturesWithCache,
    type OsmMatchingCacheSource,
} from "./osmMatchingCache";
// ...
const result = await findMatchingFeaturesWithCache(   // line 62
```

`findMatchingFeaturesWithCellCache` has zero callers in `src/`. All cell cache infrastructure — `fetchAndStoreCell`, `cellMemoryLru`, `cellManifestMutex`, `cellInflight`, `deduplicateFeatures`, `clearOsmMatchingCellMemoryCache` — is unreachable from any user action. The intended performance improvement from audit item #4 is not delivered.

**Fix:** In `OsmMatchingQuestionDetailScreen.tsx`, replace the import and the call:

```ts
// Before
import { findMatchingFeaturesWithCache, ... } from "./osmMatchingCache";
// line 62:
const result = await findMatchingFeaturesWithCache(category, center, { ... });

// After
import { findMatchingFeaturesWithCellCache, ... } from "./osmMatchingCache";
// line 62:
const result = await findMatchingFeaturesWithCellCache(category, center, { ... });
```

The options shape is identical between the two functions. The `OsmMatchingFeaturesResult` return type is the same. No other changes are needed in the screen.

**Tests to add:**

- Integration test (or update existing `osmMatchingCache.test.ts`) that confirms `OsmMatchingQuestionDetailScreen` resolves candidates through the cell cache path. The simplest approach is to check that `clearOsmMatchingCellMemoryCache` + a render produces a `findMatchingFeaturesWithCellCache` call rather than `findMatchingFeaturesWithCache`. Alternatively, assert that `findMatchingFeaturesWithCache` is not imported by the screen (import graph assertion).

---

### F2 — CELL_LRU_MAX=20 too small for default search radius (Critical)

**File:** [`src/features/questions/matching/osmMatchingCache.ts:454`](../src/features/questions/matching/osmMatchingCache.ts)

**Current code:**

```ts
const CELL_LRU_MAX = 20; // line 454
```

`DEFAULT_SEARCH_RADIUS_METERS = 50_000` (50 km) at latitude 35° (Tokyo) requires **99 grid cells** to cover the search bounding square:

| Parameter | Value                                 |
| --------- | ------------------------------------- |
| `dLat`    | `50000 / 111320 ≈ 0.449°`             |
| `dLon`    | `50000 / (111320 × cos 35°) ≈ 0.548°` |
| Lat cells | `floor(2 × 0.449 / 0.1) + 1 = 9`      |
| Lon cells | `floor(2 × 0.548 / 0.1) + 1 = 11`     |
| Total     | **99 cells**                          |

When all 99 cells are written via `cellMemorySet` after a cold fetch, the `while (cellMemoryLru.size > CELL_LRU_MAX)` loop evicts 79 of them immediately. A repeat search at the same location finds 79 cells absent from memory and falls through to disk or network every time. The in-memory fast path is functionally absent for the default radius.

**Fix:** Raise `CELL_LRU_MAX` to at least 2× the typical cell count. A value of `200` covers the default radius at any mid-latitude with headroom for one additional nearby search:

```ts
// Before
const CELL_LRU_MAX = 20;

// After
const CELL_LRU_MAX = 200;
```

**Tests to add:**

- Assert that after a cold `findMatchingFeaturesWithCellCache` call with `requestedRadiusMeters: 50_000`, a repeat call at the same center returns `source: "memory"` for all cells (i.e., no network calls are made). This test will fail with `CELL_LRU_MAX=20` and pass with `CELL_LRU_MAX=200`.

---

### F3 — Promise.all on missing cells has no error isolation (Critical)

**File:** [`src/features/questions/matching/osmMatchingCache.ts:930–941`](../src/features/questions/matching/osmMatchingCache.ts)

**Current code:**

```ts
// line 930
const fetchPromises = missingCells.map((cellId) => {
    const cellKey = makeCellCacheKey(category, cellId);
    const bbox = cellBbox(cellId);
    return fetchAndStoreCell(cellKey, category, cellId, bbox, options?.signal);
});
const fetchedFeatures = (await Promise.all(fetchPromises)).flat(); // line 941
```

`fetchAndStoreCell` has no `.catch()` handler. If any one of the parallel cell fetches fails (Overpass HTTP 429, 504, network timeout, or AbortError), `Promise.all` rejects immediately. The `await` throws, and:

- All features already collected in `allFeatures` (from cached cells) are discarded.
- All successfully-completed sibling cell fetches are discarded.
- The caller of `findMatchingFeaturesWithCellCache` receives an unhandled rejection with no candidates at all.

The same defect exists in the `forceRefresh` path at line 861.

**Fix:** Switch to `Promise.allSettled` and collect only the fulfilled results:

```ts
// lines 930-941 replacement
const fetchPromises = missingCells.map((cellId) => {
    const cellKey = makeCellCacheKey(category, cellId);
    const bbox = cellBbox(cellId);
    return fetchAndStoreCell(cellKey, category, cellId, bbox, options?.signal);
});
const settled = await Promise.allSettled(fetchPromises);
const fetchedFeatures = settled
    .filter(
        (r): r is PromiseFulfilledResult<OsmFeature[]> =>
            r.status === "fulfilled",
    )
    .flatMap((r) => r.value);
```

Apply the same change to the `forceRefresh` path (around line 861). When all cells reject (complete network failure), `fetchedFeatures` is empty and `allFeatures` still contributes cached results, which is preferable to a rejection that shows no results at all.

**Tests to add:**

- Mock one cell's fetch to reject with a network error; assert that `findMatchingFeaturesWithCellCache` resolves (not rejects) and returns candidates from the cells that did succeed plus cached cells.
- Mock all cells to reject; assert it resolves with an empty candidates array (not a rejection).
- Mock one cell to reject with `AbortError`; assert the others still contribute.

---

### F4 — persistCellEntry awaits full manifest mutex chain, blocking Promise.all for N sequential writes (Critical)

**File:** [`src/features/questions/matching/osmMatchingCache.ts:559–580`](../src/features/questions/matching/osmMatchingCache.ts)

**Current code:**

```ts
async function persistCellEntry(key, entry): Promise<void> {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(entry)); // line 555
    } catch {
        /* ... */
    }
    cellManifestMutex = cellManifestMutex // line 559 — extend chain
        .then(async () => {
            const manifest = await loadCellManifest();
            // ... upsert row ...
            await saveCellManifest(manifest);
        })
        .catch(() => {
            /* ... */
        });
    await cellManifestMutex; // line 580 — await FULL chain
}
```

When 99 missing cells complete their network fetches in parallel, all 99 call `persistCellEntry` from their `fetchAndStoreCell.then()` callbacks. Each call:

1. Appends one link to `cellManifestMutex`.
2. Awaits the **entire chain** (all 99 links), not just its own link.

This serializes all 99 manifest writes end-to-end. `Promise.all(fetchPromises)` cannot resolve until the final `await cellManifestMutex` in the last call completes. The foreground search path is blocked for `~99 × AsyncStorage-write-latency`.

The identical pattern exists in the circle-based `persistEntry` function, but that function is called once per search (not 99 times), so the impact is negligible there.

**Fix:** Fire-and-forget the manifest mutation from the foreground path. The manifest write is a best-effort background operation — the foreground caller only needs the features, not the manifest row:

```ts
async function persistCellEntry(
    key: string,
    entry: OsmMatchingCellEntry,
): Promise<void> {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(entry));
    } catch {
        // Storage may be unavailable.
    }
    // Fire-and-forget: extend the mutex chain but do not await it here.
    // The manifest write is best-effort; the in-memory cache is already updated
    // by cellMemorySet before this function is called.
    cellManifestMutex = cellManifestMutex
        .then(async () => {
            const manifest = await loadCellManifest();
            const row: OsmMatchingCellManifestRow = {
                key,
                category: entry.category,
                cellIndex: entry.cellIndex,
                fetchedAt: entry.fetchedAt,
                featureCount: entry.features.length,
            };
            const idx = manifest.rows.findIndex((r) => r.key === key);
            if (idx >= 0) {
                manifest.rows[idx] = row;
            } else {
                manifest.rows.push(row);
            }
            await saveCellManifest(manifest);
        })
        .catch(() => {});
    // Do NOT await cellManifestMutex here.
}
```

The cell data is written to AsyncStorage synchronously (line 555 `await setItem`) before this function returns, so a cold restart can still load the entry from disk even without a manifest row. The manifest row catches up on the next tick after the chain drains.

**Tests to add:**

- Confirm that after a 99-cell cold fetch, `findMatchingFeaturesWithCellCache` resolves in a reasonable time (not waiting for 99 sequential manifest writes). Can be tested by measuring elapsed time or by asserting the promise resolves before `saveCellManifest` is called 99 times.
- Confirm the manifest eventually contains all 99 rows after the background chain completes (use `await cellManifestMutex` in the test to drain the chain before asserting).

---

### F5 — Stale cached features win over fresh network features in deduplication (Moderate)

**File:** [`src/features/questions/matching/osmMatchingCache.ts:944`](../src/features/questions/matching/osmMatchingCache.ts)

**Current code:**

```ts
const merged = deduplicateFeatures([...allFeatures, ...fetchedFeatures]); // line 944
```

`allFeatures` collects features from cached cells (which may be stale — up to 90 days old). `fetchedFeatures` collects fresh network results. `deduplicateFeatures` keeps the **first occurrence** of each `(osmType, osmId)` pair. Since `allFeatures` comes first, the stale copy wins for any OSM feature that appears in both.

This is not a corner case: Overpass bbox queries return any way or relation that physically intersects the bbox, not just those whose centroid falls inside. A large OSM feature (park, road segment, building) straddling a 0.1° cell boundary is returned in both the stale cell's original response and the fresh fetch for the adjacent missing cell. The caller silently receives the stale name/tag for that feature with no indication the data is outdated.

**Fix:** Place fresh features first in the spread so they win deduplication:

```ts
// Before
const merged = deduplicateFeatures([...allFeatures, ...fetchedFeatures]);

// After — fresh network data takes precedence over stale cached data at boundaries
const merged = deduplicateFeatures([...fetchedFeatures, ...allFeatures]);
```

**Tests to add:**

- Set up two adjacent cells: cell A in memory with a stale feature F (name="Old Name"), cell B missing from cache. Fixture for cell B returns the same feature with name="New Name". Assert that `findMatchingFeaturesWithCellCache` returns "New Name" (the fresh copy) rather than "Old Name" (the stale copy).

---

### F6 — anyStale signal discarded in partial-fetch path (Moderate)

**File:** [`src/features/questions/matching/osmMatchingCache.ts:948`](../src/features/questions/matching/osmMatchingCache.ts)

**Current code:**

```ts
// line 920-927 (all-cached path) correctly uses anyStale:
if (missingCells.length === 0) {
    const deduped = deduplicateFeatures(allFeatures);
    return {
        candidates: rankMatchingFeatures(deduped, center, maxCandidates),
        source: anyStale ? "stale" : overallSource, // ✓ correct
    };
}
// line 946-949 (partial-fetch path) ignores anyStale:
return {
    candidates: rankMatchingFeatures(merged, center, maxCandidates),
    source: "network", // ✗ anyStale is ignored
};
```

When some cells are stale in memory and one cell is missing (a common scenario after a partial cache warm), `anyStale=true` triggers background revalidation but the returned `source` is `"network"`. Any caller checking `source === "stale"` to display a "data may be outdated" indicator will never see it in the partial-fetch path, even though the majority of the returned features came from stale cache entries.

**Fix:**

```ts
// After
return {
    candidates: rankMatchingFeatures(merged, center, maxCandidates),
    source: anyStale ? "stale" : "network",
};
```

Note: if a caller needs to distinguish "network + stale" from "pure stale", a new source value `"stale_network"` could be added to `OsmMatchingCellSource`, but fixing the existing `"stale"` emission is sufficient for the current UI use case.

**Tests to add:**

- Set up N-1 stale cached cells and 1 missing cell. Assert returned `source === "stale"`.
- Set up N fresh cached cells and 1 missing cell. Assert returned `source === "network"`.

---

### F7 — cache-partial-fetch perf scenario measures full cache hit, not partial fetch (Low — benchmark reliability)

**File:** [`perf/scenarios/matching.mts:463–491`](../perf/scenarios/matching.mts)

**Current code (abridged):**

```ts
{
    name: "matching-bbox-cell/cache-partial-fetch",
    iterations: 15,
    // no setup: clearOsmMatchingCellMemoryCache ← missing
    run: async () => {
        // Prime with 1 km radius
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 1000,
        });
        // Larger search — cells from 1 km prime are subset
        const result = await findMatchingFeaturesWithCellCache(
            "hospital", tokyoCenter, { requestedRadiusMeters: 50_000 },
        );
        ...
    },
    warmups: 3,
},
```

After the 3 warmup iterations, `cellMemoryLru` holds all 99 cells for the 50 km search (assuming F2 is fixed). The 15 measured iterations find 0 missing cells and never exercise the network-fetch path. `transport.calls()` is 0 for every measured sample. The benchmark title "partial-fetch" is misleading — it measures the all-cached path after the first run.

**Fix:** Add a `setup` function and move the cache priming into `setup` so the measured `run()` always starts with only the 1 km cells cached:

```ts
{
    name: "matching-bbox-cell/cache-partial-fetch",
    iterations: 15,
    setup: async () => {
        clearOsmMatchingCellMemoryCache();
        installFixtureFetch(hospitalCapture);
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 1000,
        });
    },
    run: async () => {
        const transport = installFixtureFetch(hospitalCapture);
        const result = await findMatchingFeaturesWithCellCache(
            "hospital", tokyoCenter, { requestedRadiusMeters: 50_000 },
        );
        return {
            metrics: {
                candidates: result.candidates.length,
                networkIntents: transport.calls(),
            },
            output: result,
        };
    },
    warmups: 3,
},
```

(Adjust if the perf harness `setup` runs once before all iterations or once per iteration — the intent is once per iteration so each run begins from the partially-warm state.)

---

### F8 — cache-hit-merge: fetch not restored in try/finally, oldFetch captures fixture stub (Low — benchmark reliability)

**File:** [`perf/scenarios/matching.mts:434–461`](../perf/scenarios/matching.mts)

**Current code:**

```ts
run: async () => {
    const transport = installFixtureFetch(hospitalCapture);   // (A) installs fixture fetch
    await findMatchingFeaturesWithCellCache(...);              // prime
    const oldFetch = globalThis.fetch;                        // (B) captures fixture fetch, not real fetch
    const noop = () => { throw new Error("unexpected network call"); };
    globalThis.fetch = noop as ...;
    const result = await findMatchingFeaturesWithCellCache(...); // if this throws →
    globalThis.fetch = oldFetch;                              // ← never reached on throw
    ...
},
```

Two bugs:

1. **No try/finally**: If `findMatchingFeaturesWithCellCache` throws (e.g., after F2 is fixed and `movedTokyoCenter` crosses a cell boundary and the noop fires), `globalThis.fetch = oldFetch` is never reached. Every subsequent scenario in the process receives an exception on any fetch attempt.

2. **oldFetch captures the fixture stub**: `(B)` runs after `(A)`, so `oldFetch` is `installFixtureFetch(hospitalCapture)`'s version of `fetch`, not the real `globalThis.fetch`. After the scenario, `globalThis.fetch = oldFetch` "restores" to the fixture stub rather than the real fetch.

**Fix:**

```ts
run: async () => {
    const transport = installFixtureFetch(hospitalCapture);
    const realFetch = globalThis.fetch;               // capture BEFORE installFixtureFetch
    // ... but installFixtureFetch already ran above. So:
    // Option: save real fetch before calling installFixtureFetch, or
    // add a teardown argument.
    //
    // Simplest fix: use try/finally to guarantee restore, and rely on
    // the no-network setup being per-iteration via clearOsmMatchingCellMemoryCache in setup.
    //
    // Alternatively, restructure so the noop guard is in setup, or add a
    // clearOsmMatchingCellMemoryCache call at the top of run() and
    // re-prime within a try/finally:
    try {
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        const noop = () => { throw new Error("unexpected network call"); };
        globalThis.fetch = noop as unknown as typeof globalThis.fetch;
        const result = await findMatchingFeaturesWithCellCache(
            "hospital", movedTokyoCenter, { requestedRadiusMeters: 5000 },
        );
        return {
            metrics: { candidates: result.candidates.length, networkIntents: transport.calls() },
            output: result,
        };
    } finally {
        globalThis.fetch = transport.realFetch ?? transport; // restore whatever installFixtureFetch saved
    }
},
```

The exact shape depends on what `installFixtureFetch` returns — if it doesn't expose the original fetch, add a `teardown` function to the scenario that restores it, or save `globalThis.fetch` before calling `installFixtureFetch`.

---

### F9 — clearOsmMatchingCellMemoryCache races with in-flight persistCellEntry (Low — test teardown)

**File:** [`src/features/questions/matching/osmMatchingCache.ts:953–958`](../src/features/questions/matching/osmMatchingCache.ts)

**Current code:**

```ts
export function clearOsmMatchingCellMemoryCache(): void {
    cellMemoryLru.clear();
    cellInflight.clear();
    cellManifestCache = null;
    cellManifestMutex = Promise.resolve(); // line 957 — resets to a new chain
}
```

Any `persistCellEntry` call already mid-flight awaits the **old** `cellManifestMutex`. After `clearOsmMatchingCellMemoryCache` resets it to a new `Promise.resolve()`, a new `persistCellEntry` starts on the new chain concurrently with the still-running old chain. Both calls then:

1. See `cellManifestCache = null` (reset by clear).
2. Call `loadCellManifest()` → both load an empty manifest from storage.
3. Both append their row.
4. Both call `saveCellManifest()` — last writer discards the other's row.

This race is most visible in tests that call `clearOsmMatchingCellMemoryCache()` immediately after a search that triggered a write.

**Fix:** Drain the existing chain before resetting it:

```ts
export async function clearOsmMatchingCellMemoryCache(): Promise<void> {
    cellMemoryLru.clear();
    cellInflight.clear();
    cellManifestCache = null;
    await cellManifestMutex; // drain any in-flight manifest write
    cellManifestMutex = Promise.resolve();
}
```

If the synchronous signature must be preserved for callers that don't await it (e.g., perf `setup` functions), document that the clear is best-effort for in-flight writes, or switch all test teardowns to `await clearOsmMatchingCellMemoryCache()`.

**Tests to add:**

- Trigger a write (cell fetch), immediately call `clearOsmMatchingCellMemoryCache()`, then trigger another write for a different cell. Assert both cells appear in the manifest after the chain drains. (Confirms no rows are lost to the race.)

---

## Summary table

| #   | File                                  | Line    | Severity     | Root cause                                   | Fix                                           |
| --- | ------------------------------------- | ------- | ------------ | -------------------------------------------- | --------------------------------------------- |
| F1  | `OsmMatchingQuestionDetailScreen.tsx` | 15      | **Critical** | Wrong function imported                      | Swap to `findMatchingFeaturesWithCellCache`   |
| F2  | `osmMatchingCache.ts`                 | 454     | **Critical** | `CELL_LRU_MAX=20` vs 99 cells                | Raise to `200`                                |
| F3  | `osmMatchingCache.ts`                 | 930–941 | **Critical** | `Promise.all` no error isolation             | Switch to `Promise.allSettled`                |
| F4  | `osmMatchingCache.ts`                 | 559–580 | **Critical** | `await cellManifestMutex` blocks Promise.all | Remove the `await` (fire-and-forget manifest) |
| F5  | `osmMatchingCache.ts`                 | 944     | Moderate     | Stale features win in dedup                  | Reverse spread order                          |
| F6  | `osmMatchingCache.ts`                 | 948     | Moderate     | `anyStale` ignored in network path           | Emit `"stale"` when `anyStale` is true        |
| F7  | `perf/scenarios/matching.mts`         | 463     | Low          | No LRU clear between iterations              | Add `setup: clearOsmMatchingCellMemoryCache`  |
| F8  | `perf/scenarios/matching.mts`         | 434     | Low          | No try/finally for fetch restore             | Wrap in try/finally                           |
| F9  | `osmMatchingCache.ts`                 | 953     | Low          | Clear races with in-flight write             | Drain mutex before reset                      |

F1–F4 must all be fixed before re-running `pnpm perf:test` for a meaningful measurement of #4. Fix F2 first (it's one line), then F1 (wires the code up), then F3 and F4 (correctness and performance of the newly-reachable path). Fix F5–F6 after you have a working end-to-end measurement. Fix F7–F9 to make the benchmark trustworthy.

## What the perf test should show after fixes

With F1–F4 fixed, re-run:

```bash
pnpm perf:test -- --scenario matching-bbox-cell
```

Expected improvement vs the prototype scenarios:

| Scenario               | Before (prototype timings) | Expected after                           |
| ---------------------- | -------------------------- | ---------------------------------------- |
| `cache-hit-merge` cold | N/A (dead code)            | ~0.09 ms (merge + filter only)           |
| `cache-partial-fetch`  | N/A                        | Cell count delta × ~1 ms per missed cell |
| `cells-for-search`     | 0.00 ms                    | 0.00 ms (unchanged)                      |

The 1 km repeat perf scenario should show `source: "memory"` for all cells once F2 is fixed. The 50 km cold scenario will still require ~99 Overpass bbox requests and will be slower than the circle-based overscan approach for first-time searches; the value of the grid approach is in _repeat_ searches where cells are reused across different center positions.

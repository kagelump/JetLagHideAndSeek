# Task 05 — Cache Integration

**Epic:** [Bundled Offline POIs](epic.md)
**Phase:** 1 (MVP)
**Status:** Not started
**Depends on:** 04 (`resolveBboxFeatures`)
**Blocks:** 07 (region packs build on this path)

## Objective

Make the cell cache resolve features through `resolveBboxFeatures` (local-or-Overpass)
instead of calling Overpass directly, and stamp locally-served cells with the bundle's
`generatedAt` so the existing 90-day stale-while-revalidate path refreshes them from
Overpass when the device is online. Behavior must be **identical** to today when no bundle
covers the area.

## Context — exact call sites

In [`src/features/questions/matching/osmMatchingCache.ts`](../../../src/features/questions/matching/osmMatchingCache.ts):

- `fetchAndStoreCell` (`:626`) calls `fetchAndParseOverpassBboxFeatures(category, s,w,n,e, signal)`
  (`:636`) and writes a cell entry with `fetchedAt: Date.now()` (`:656`).
- `cellRevalidateInBackground` (`:588`) calls the same Overpass fn (`:595`) and updates
  `fetchedAt: Date.now()` (`:606`).
- `OsmMatchingCellEntry` (`:75`) has `fetchedAt: number` and `features: OsmFeature[]`.
- `isCellStale` (`:469`) compares `Date.now() - fetchedAt` against `MATCHING_CACHE_TTL_MS`
  (90 days, `:24`).
- `OsmMatchingCacheSource` (`:64`) is `"memory" | "disk" | "stale" | "network"`.

The cell flow: `findMatchingFeaturesWithCellCache` (`:828`) computes `neededCells`
(`cellsForSearch`), serves cached cells from memory/disk, and fetches missing cells via
`fetchAndStoreCell` (`:943`). Merged features are deduped + ranked. **Leave that
orchestration as-is** — only change how a single cell's features are obtained and stamped.

## Files to modify

- `src/features/questions/matching/osmMatchingCache.ts`
- `src/features/questions/matching/__tests__/osmMatchingCache.test.ts`

## Implementation

### 1. Stamp local cells so SWR works correctly

A locally-served cell should NOT immediately look stale (it would trigger a needless
Overpass revalidation on every query) but SHOULD eventually refresh. Stamp it with the
bundle's `generatedAt`:

- Convert `generatedAt` (ISO string) to epoch ms: `Date.parse(generatedAt)`.
- A fresh bundle (built today) → `fetchedAt ≈ now` → not stale → pure offline serve.
- A bundle older than 90 days (app not updated in a quarter) → stale → background Overpass
  revalidation when online, serving the bundled data immediately meanwhile. Exactly the
  desired behavior, for free.

### 2. Rewrite `fetchAndStoreCell`

Replace the direct Overpass call with the resolver and stamp accordingly:

```ts
import { resolveBboxFeatures } from "./featureSource";

async function fetchAndStoreCell(key, category, cellId, bbox, signal?) {
    const existing = cellInflight.get(key);
    if (existing) return existing;

    const request = resolveBboxFeatures(category, bbox, signal) // bbox is {south,west,north,east}
        .then(async (resolved) => {
            const fetchedAt =
                resolved.source === "local" && resolved.generatedAt
                    ? Date.parse(resolved.generatedAt) || Date.now()
                    : Date.now();
            const entry: OsmMatchingCellEntry = {
                schemaVersion: CELL_SCHEMA_VERSION,
                category,
                cellIndex: cellId,
                bbox: {
                    south: bbox.south,
                    west: bbox.west,
                    north: bbox.north,
                    east: bbox.east,
                },
                fetchedAt,
                features: resolved.features,
            };
            cellMemorySet(key, entry);
            // Persist Overpass results; skip disk write for local cells (see note).
            if (resolved.source !== "local") {
                await persistCellEntry(key, entry);
            }
            return resolved.features;
        })
        .finally(() => cellInflight.delete(key));

    cellInflight.set(key, request);
    return request;
}
```

> **Skip-persist for local cells:** local cell data already lives in the app bundle, so
> writing it to AsyncStorage duplicates it and bloats storage. Keep it in the in-memory
> LRU (`cellMemorySet`) but skip `persistCellEntry`. Trade-off: a cold start re-reads from
> the bundle (cheap) instead of disk. If you prefer uniform persistence, persist anyway —
> but the default recommendation is skip. Document whichever you choose.

`bbox` here is the cell's `{south,west,north,east}` object — `resolveBboxFeatures` accepts
exactly that shape (task 04 `BboxObj`). No conversion needed at this call site.

### 3. Rewrite `cellRevalidateInBackground`

```ts
function cellRevalidateInBackground(key, entry) {
    if (cellInflight.has(key)) return;
    const bbox = cellBbox(entry.cellIndex); // {south,west,north,east}
    const request = resolveBboxFeatures(entry.category, bbox)
        .then(async (resolved) => {
            const fetchedAt =
                resolved.source === "local" && resolved.generatedAt
                    ? Date.parse(resolved.generatedAt) || Date.now()
                    : Date.now();
            const updated = {
                ...entry,
                features: resolved.features,
                fetchedAt,
            };
            cellMemorySet(key, updated);
            if (resolved.source !== "local")
                await persistCellEntry(key, updated);
            return resolved.features;
        })
        .catch((err) => {
            console.warn(
                "[osmMatchingCache] cell background revalidation failed:",
                err,
            );
            return entry.features;
        })
        .finally(() => cellInflight.delete(key));
    cellInflight.set(key, request);
}
```

> Note: when a cell is locally covered, revalidation re-resolves to local data and just
> re-stamps with the same `generatedAt` — effectively a no-op that keeps it non-stale.
> That's fine and cheap.

### 4. (Optional) surface a `"bundled"` source for telemetry/UI

`OsmMatchingQuestionDetailScreen` shows `cacheSource`. If you want to show users that a
result came from bundled offline data, add `"bundled"` to `OsmMatchingCacheSource` and set
the cell-cache `source` accordingly when **all** served cells were local. This is optional
polish; the merge logic in `findMatchingFeaturesWithCellCache` already computes a source.
If you skip it, local results report as `"network"` (harmless). Keep this change minimal
and additive if done.

### 5. Leave the legacy circle path alone

`fetchAndStore` (`:405`) and `revalidateInBackground` (`:366`) back the non-cell
`findMatchingFeaturesWithCache` (`:699`), which the UI does **not** call. Leave them on
Overpass for Phase 1 (note in a comment). Optionally add a `resolveRadiusFeatures` sibling
later if that path is revived.

## Edge cases

- **`Date.parse` failure** (malformed `generatedAt`) → falls back to `Date.now()` (shown
  above). A local cell then looks fresh, which is acceptable.
- **Mixed cells** (some local, some Overpass) across a search disk that straddles the
  region edge: each cell is resolved independently; merge + dedup (`deduplicateFeatures`,
  `:674`) already handles overlap. Verify a test covers this.
- **`forceRefresh`**: the force path (`:851`) calls `fetchAndStoreCell` for every needed
  cell. With local coverage it re-resolves to local data (no network) — correct; "refresh"
  of bundled data is a no-op until the device is online and the cell is persisted+stale.
  Confirm no infinite-loop or unhandled rejection.
- **Abort during force-refresh**: existing `cellInflight.delete` semantics (`:856`) are
  preserved since the resolver forwards `signal`.

## Testing

Extend `osmMatchingCache.test.ts`. The suite already mocks Overpass; now also mock
`./featureSource` (or `./bundledPois`) to simulate coverage.

- **No coverage (regression):** with `resolveBboxFeatures` mocked to delegate to Overpass,
  all existing cell-cache tests pass unchanged (dedup, SWR, in-flight, force-refresh).
- **Full local coverage:** mock the resolver to return `{source:"local", generatedAt: <recent ISO>}`.
  Assert:
    - `findMatchingFeaturesWithCellCache` returns ranked local candidates with **no Overpass
      call** (spy on `fetchAndParseOverpassBboxFeatures` → 0 calls).
    - Cell entries are stamped with the bundle time (not `Date.now()`); `isCellStale` is
      false for a recent bundle.
    - `persistCellEntry`/AsyncStorage `setItem` is **not** called for local cells (if you
      chose skip-persist).
- **Stale bundle:** mock `generatedAt` older than 90 days → result still returns
  immediately from local data, and a background revalidation is triggered (Overpass spy
  called once) — i.e. `source` includes `"stale"`.
- **Edge straddle:** mock the resolver to return local for some cells and Overpass for
  others; assert merged candidates include both and are deduped.

## Acceptance criteria

- [ ] With a covering bundle, a matching query resolves with **zero** Overpass requests.
- [ ] Local cells are stamped with the bundle's `generatedAt`; fresh bundles are not
      treated as stale.
- [ ] A >90-day-old bundle serves immediately and triggers background Overpass refresh.
- [ ] With no bundle, all existing `osmMatchingCache.test.ts` tests pass unchanged.
- [ ] `pnpm check` + `pnpm test` pass.

## Out of scope

- Downloaded region packs (task 07) — they reuse this exact path once their region is
  registered in `bundledPois` coverage.
- Attribution UI (task 06).

# T3 — Measuring artifacts + lazy app loader

## Context

Measuring questions need line/polygon bundles per category (`coastline`,
`body-of-water`, `admin-1st-border`, `admin-2nd-border`, `high-speed-rail`).
Today these are Japan-wide committed files in `assets/measuring/`, loaded by
literal `require()` in `src/features/questions/measuring/lineBundleLoader.ts`
— one `LineBundle` per category, with an `extractBbox`.

Two jobs here:

1. **Pipeline**: emit per-region measuring artifacts through the T1 scaffold.
2. **App**: teach `lineBundleLoader` to combine bundled Japan data with
   installed pack files — read lazily from the filesystem, **never** parsed
   at app start (a body-of-water bundle is ~25 MB raw; see design.md →
   "Loading").

Read first: `lineBundleLoader.ts`, `data/geofabrik/scripts/extract-measuring-bundles.mjs`,
and how `lineMeasuringGeometry.ts` consumes `getLineBundle` (it window-selects
features by bbox, so multiple regions' features in one bundle is fine).

## What to build

### 1. Pipeline: `measuring` artifact builder

Replace the T1 stub. **T2b already did the hard part**: the extraction
helpers (post-filters, dissolve, stitching, validation) live in
`data/geofabrik/scripts/lib/` as importable functions with a golden-output
test. This task composes them for an arbitrary region PBF + bbox — it
should not need to touch the helpers' internals. (`pnpm data:measuring`
keeps working; if you do have to change a helper, T2b's golden test is the
referee.)

- Output: `dist/<region-id>/measuring-<category>.json.gz`, one per category
  **that has features in this region** — schema identical to the committed
  bundles (`schemaVersion`, `category`, `generatedAt`, `source`,
  `extractBbox`, `features`).
- Skip empty categories (landlocked region → no `coastline` artifact) and
  record what was emitted in `meta.json` → `categories.measuring`.
- Category filters: the existing defaults are already country-generic —
  e.g. the HSR post-filter accepts `highspeed=yes` OR `service=high_speed`
  OR `maxspeed ≥ 200` (`postFilters.mjs` after T2b) — so most regions need
  **no** override. `regions.yaml` gains an optional per-region escape
  hatch:

    ```yaml
    measuringOverrides:
        high-speed-rail:
            osmiumFilter: "w/railway=rail" # rarely needed; defaults from config.yaml
            postFilter: high-speed # named predicate, not inline code
        body-of-water:
            enabled: false # drop a category for this region entirely
    ```

    Overrides reference the named filters/predicates that already exist; new
    predicates are added in `postFilters.mjs` with tests, never inline in
    YAML.

- Apply the same simplification budget the Japan extractor uses; pack-lint
  gains a size warning at >10 MB gz per artifact (warn, don't fail).

### 2. App: pack-aware lazy bundle resolution

Extend `lineBundleLoader.ts`:

```ts
// New: registry of installed measuring sources (set by regionPacks install)
export function registerMeasuringSource(
    packId: string,
    category: MeasuringCategory,
    path: string, // FS path to the UNCOMPRESSED .json under Document/packs/<packId>/
): void;
export function unregisterMeasuringSources(packId: string): void;
```

`getLineBundle(category)` becomes async-compatible **without breaking its
sync callers**: keep the sync function returning what's already cached, and
add `loadLineBundle(category): Promise<LineBundle | null>` that:

1. Starts from the bundled `require()` bundle (if that category is bundled).
2. Reads + parses each registered pack file for the category (expo
   `File.text()`), and merges: `features` concatenated, `extractBbox`
   unioned, `source` joined.
3. Caches the merged result in the existing `cache` map (so the sync
   `getLineBundle` returns it from then on).

Then hoist the async load above the sync geometry. The call chain is:

```
NativeMap
  → useQuestionMapRenderState()          // src/features/questions/questionGeometry.ts (useMemo)
    → buildMeasuringRenderState()        // sync
      → computeLineCategory()            // sync
        → getLineBundle()                // sync, cache-only after this task
```

The hoist point is `useQuestionMapRenderState`, with this exact pattern:

1. Add a hook `useEnsureMeasuringBundles(questions)` (new file
   `src/features/questions/measuring/useEnsureMeasuringBundles.ts`): an
   effect that collects the line categories of current measuring questions,
   calls `loadLineBundle(category)` for each not-yet-cached one, and bumps a
   local `revision` counter state when a load completes. Return `revision`.
2. In `useQuestionMapRenderState`, call the hook and add `revision` to the
   `useMemo` dependency array. First render with an uncached pack-only
   category: `getLineBundle` returns null → `computeLineCategory` returns
   null → that question renders nothing (this null path already exists).
   When the load completes, `revision` bumps, the memo recomputes, geometry
   appears.
3. `MeasuringQuestionDetailScreen` additionally fires
   `loadLineBundle(category)` on category selection so the bundle is
   usually warm before the map ever asks.

Geometry functions stay 100% sync. Do not make `buildMeasuringRenderState`
or anything below it async.

Memory rule: parse on first use per category, keep the existing per-category
cache, and **do not** add measuring files to `loadInstalledPacks` startup
parsing.

Note: this task only defines `registerMeasuringSource`; nothing calls it
until T5 wires the installer. Drive it from tests for now (and the existing
`__setLineBundleForTest` seam stays for geometry tests).

## How to test

Pipeline (`node --test`): fixture PBF with a known coastline way → assert
the artifact's schema and that features fall inside `extractBbox`; assert an
empty category emits no file and no `meta` entry.

App (Jest):

- Register a temp-file measuring source + a bundled category; assert
  `loadLineBundle` merges features and the sync `getLineBundle` returns the
  cached merge afterwards.
- Assert `unregisterMeasuringSources` evicts the cache entry (next load
  re-merges without the pack).
- Mock `expo-file-system` the same way `regionPacks` tests do — extend
  `jest.setup.ts` mocks if needed; don't create ad-hoc per-test mocks.
- A measuring-geometry smoke test: with a pack-only category registered,
  `buildMeasuringRenderState` produces a connector to the pack-sourced line.
- `useEnsureMeasuringBundles` (renderHook): a measuring question with an
  uncached category triggers exactly one `loadLineBundle` call and bumps
  `revision` on completion; already-cached categories trigger none.

Manual: `pnpm data:pack -- --region europe-netherlands` → inspect
`measuring-coastline` in the data viewer (the NL coastline is recognizable
at a glance).

## Out of scope

- The installer calling `registerMeasuringSource` (T5). Catalog/publish
  (T4). Boundary polygons (T6 — `admin-*-border` measuring artifacts here
  are line bundles only, same as today's committed ones).

## Done when

- NL measuring artifacts build + lint clean; viewer eyeball passes.
- `getLineBundle`/`loadLineBundle` merge bundled + registered sources
  lazily; no startup parsing; all Jest suites green.
- `pnpm data:measuring` committed output unchanged (or regenerated + explained).
- `pnpm test` + `pnpm check` green.

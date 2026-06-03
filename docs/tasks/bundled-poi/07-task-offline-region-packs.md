# Task 07 — On-Demand Region Packs (Phase 2)

**Epic:** [Bundled Offline POIs](epic.md)
**Phase:** 2 (scale)
**Status:** In progress — all sub-deliverables implemented and verified (pipeline, runtime, UI, tests, native prebuild); CDN hosting deferred (out of scope). Remaining: on-device end-to-end test (install a pack, restart app, verify matching resolves locally).
**Depends on:** 01–06 — **Phase 1 is shipped** (branch `bundled-offline-pois`). The registry,
pipeline (`buildColumnar`/`runBundleStage`), loader (`bundledPois.ts`), seam
(`resolveBboxFeatures`), and cache integration all exist; this task builds on them.
**Blocks:** —

## Objective

Extend offline POIs beyond the in-binary bundle to **downloadable region packs**, so the
app can cover all of Japan and, eventually, worldwide without shipping all data in the
binary. A pack is the same columnar JSON as task 02, served gzipped, downloaded on demand,
persisted to the device, and registered with the same coverage/loader machinery so the
task 04 seam serves it transparently.

This is the scale-out path. Do not start it until Phase 1 (Kantō bundled) is shipped and
validated.

## Phase 1 baseline (reuse, don't rebuild)

Phase 1 already shipped the machinery this task extends. Verify against the code (branch
`bundled-offline-pois`), but as built:

- **The registry is already dynamic.** `bundledPois.ts` exposes `regionLoaders`
  (`Map<string, () => RawRegion>`) and a `REGIONS: RegionMeta[]` coverage list, with
  `registerTestRegion(id, raw)` / `unregisterTestRegion(id)` already adding/removing both.
  It is **not** a hard-coded switch — packs register through this same mechanism.
  Generalize the `*TestRegion` helpers into a public `registerRegion`/`unregisterRegion`
  (or a pack-specific sibling) rather than refactoring from scratch.
- **Memoization + guards exist.** `loadRegionRaw` memoizes via `regionCache`,
  `getBundledCategoryFeatures` via `categoryFeatureCache` (both cleared by
  `clearBundledRegionCache`), and there is a `schemaVersion !== 1` reject guard. Packs get
  all of this for free.
- **The reducer exists.** `data/geofabrik/scripts/poiReducer.mjs` exports `buildColumnar` /
  `computeStats`; `fetch-geofabrik.mjs` `runBundleStage` writes the per-region `.json` +
  stats. Pack `.gz` emission extends this stage — no new reducer.
- **The seam is coverage-driven and validated.** `resolveBboxFeatures` dispatches on
  `regionCoveringBbox`; Phase 1 proved a region is served with **zero** changes to
  `featureSource.ts` / `osmMatchingCache.ts` once registered.

### ⚠️ Blocker to resolve first: the loader is synchronous

`loadRegionRaw` is **sync** (`(): RawRegion | null`) and `regionLoaders` holds **sync**
thunks (`() => RawRegion`) because Phase 1 loads via Metro `require()`. Downloaded packs
live on the filesystem and `expo-file-system` reads are **async** — a sync thunk cannot
call `readAsStringAsync`. Pick one:

- **Recommended:** inflate + parse the pack into memory **once at install/registration**
  and register a sync thunk returning the parsed object (`() => parsed`). Keeps the entire
  Phase 1 loader path unchanged; pack stays resident (evict on `removePack`).
- **Alternative:** make `loadRegionRaw` async and propagate up through
  `getBundledCategoryFeatures` → `localBboxFeatures` → `resolveBboxFeatures` (already
  `async`). More invasive; only if packs are too large to hold in memory.

## Context — why this is separate from Phase 1

- Phase 1 bundles one region as plain JSON via Metro `require` (zero new deps).
- Worldwide is ~50–150 MB gzipped (epic estimate) — far too large for the binary. It must
  be downloaded per region, compressed, and stored on the filesystem.
- That requires filesystem + decompression at runtime: **`expo-file-system`** (read/write
  the document dir) and **`fflate`** (already a dependency — used elsewhere) to inflate
  gzip. `expo-asset` is only needed if any packs ship in the binary as `.gz` assets.
- The app now uses **TanStack Query** for async server state (search + boundary caches were
  migrated; see [`../react-query-cache-migration.md`](../react-query-cache-migration.md)).
  Model pack downloads as a mutation + the pack registry as a query, consistent with that.
- There is an existing caution about offline packs while using `tile.openstreetmap.org`
  ([`src/features/map/mapTileCache.ts:9`](../../../src/features/map/mapTileCache.ts)) — that
  concerns **tiles**, not POI data, but mirror its respectful-usage mindset (host packs on
  your own CDN, not Geofabrik directly, for repeated downloads).

## Sub-deliverables

### A. Pipeline: emit gzipped packs + a pack manifest

Extend task 02's stage:

- For every region in `config.yaml` (not just the bundled one), emit
  `<distDir>/poi/<regionId>.json.gz` (gzip -9 via `node:zlib`).
- Emit a **hosted manifest** `poi/packs.json`:
    ```json
    {
        "schemaVersion": 1,
        "generatedAt": "2026-06-03T00:00:00Z",
        "packs": [
            {
                "id": "japan-kansai",
                "label": "Kansai, Japan",
                "bbox": [134.0, 33.4, 136.5, 35.8],
                "totalCount": 41000,
                "url": "https://<cdn>/poi/japan-kansai.json.gz",
                "bytes": 980000,
                "sha256": "…"
            }
        ]
    }
    ```
- Add a CI size-budget check: fail if any pack exceeds a configured budget (e.g. 8 MB gz).

> **Reuse, don't duplicate:** `runBundleStage` / `buildColumnar` / `computeStats` already
> produce the per-region columnar object and gzip size. Add `.gz` _writing_ (the bundle
> stage currently only sizes it for stats) for the non-bundled regions.
>
> **Pack outputs are build artifacts, not committed.** Write them to a dir (e.g.
> `data/geofabrik/dist/poi/`) that is in **both** `.gitignore` and `.prettierignore` —
> Phase 1 learned the hard way that `prettier`/`jest` don't read `.gitignore` and crash on
> large generated files. (Contrast with Phase 1's `assets/poi/`, which **is** committed
> because it ships in the binary.)
>
> **DX:** fold pack emission into the existing `pnpm data:poi` flow (or a sibling
> `data:poi:packs`) — keep the "one command regenerates everything" property, don't add an
> unrelated top-level command.

### B. Runtime: download, verify, persist, inflate

`src/features/questions/matching/regionPacks.ts`:

- `fetchPackManifest()` — GET `poi/packs.json` (TanStack Query, long `staleTime`).
- `downloadPack(packId)` — `expo-file-system` download of the `.gz` to the document dir
  (`${documentDirectory}poi/<id>.json.gz`), verify `sha256` + `bytes`, then inflate with
  `fflate.gunzipSync` (or async) and write `<id>.json`. A mutation; expose progress.
- `listInstalledPacks()` — scan the document dir / a small index file for installed packs.
- `removePack(packId)` — delete files + deregister (eviction / storage management).
- Persist an **installed-pack index** (AsyncStorage or a JSON file) recording id, bbox,
  generatedAt, path.

### C. Wire installed packs into coverage + loading

The registry is **already dynamic** (see [Phase 1 baseline](#phase-1-baseline-reuse-dont-rebuild)) —
do not rebuild it. Instead:

- On app start, read the installed-pack index and **register** each pack into
  `regionLoaders` + `REGIONS` (generalize `registerTestRegion`). Per the sync-loader
  blocker above, register a thunk over an in-memory parsed pack (inflate at install).
- `regionCoveringBbox` / `regionCoveringPoint` already iterate `REGIONS`, so registered
  packs become covered automatically. `regionCoveringBbox` returns the **first** match →
  make precedence deterministic (see Coverage overlap).
- The `schemaVersion` guard and memoization caches already apply to registered packs.

Because `resolveBboxFeatures` dispatches purely on coverage, **no change to
`featureSource.ts` or `osmMatchingCache.ts` is needed** — Phase 1 validated this.

### D. UI: pack management

- A "Offline data" screen (likely under Settings, task 06's neighborhood): list available
  packs from the manifest, show installed/size/build-date, download/remove buttons with
  progress, and total storage used.
- Optional: prompt to download the relevant pack when a play area is set in an un-bundled,
  available region (detect via `regionCoveringPoint` returning null but the manifest having
  a covering bbox).

## Files (indicative)

**Create:**

- `src/features/questions/matching/regionPacks.ts` + tests
- `src/features/sheet/OfflineDataScreen.tsx` (or section) + tests
- Pipeline: extend `fetch-geofabrik.mjs` / a new `scripts/build-poi-packs.mjs`

**Modify:**

- `src/features/questions/matching/bundledPois.ts` — generalize `registerTestRegion`/
  `unregisterTestRegion` into a public `registerRegion`/`unregisterRegion`; resolve the
  sync-loader blocker (above).
- `package.json` — add `expo-file-system` (**native dep → run `expo prebuild` + rebuild per
  AGENTS "Native Build Rules"**); fold pack emission into the `data:poi` flow.
- `config.yaml` — add the target regions (currently only `japan-kanto`).
- `.gitignore` + `.prettierignore` — ignore the pack output dir (`data/geofabrik/dist/`).

## Edge cases

- **Partial/corrupt download** — verify `sha256` + byte length before inflating; on
  mismatch, delete and surface a retry. Never register a half-written pack.
- **Schema version drift** — a pack built against an older `schemaVersion` than the app
  expects must be rejected (prompt re-download). Version the pack and check on load.
- **Storage pressure** — `removePack` for eviction; show total usage; consider an LRU over
  packs if many are installed.
- **Offline during download** — the mutation fails gracefully; the bundled region still
  works.
- **Coverage overlap** — bundled Kantō vs a downloaded Japan-wide pack: `regionCoveringBbox`
  returns the **first** matching region in `REGIONS`, so precedence = registration/sort
  order. Make it deterministic (e.g. sort `REGIONS` smallest-bbox-first, or prefer newer
  `generatedAt`); overlaps are also deduped at merge by `deduplicateFeatures`.
- **Inflate cost** — gunzip of a multi-MB pack on the JS thread can jank; inflate once at
  install time (write the plain `.json`), not on every load. Consider chunked/async inflate
  for large packs.

## Testing

- `regionPacks.ts`: mock `expo-file-system` + `fflate`; test download → verify → inflate →
  register; test sha mismatch rejection; test removal/eviction; test schema-version reject.
- Dynamic registry: a region becomes "covered" after registration; reverts after removal.
  Reuse the existing `registerTestRegion`/`unregisterTestRegion` + `clearBundledRegionCache`
  helpers and the `bundledPois.test.ts` / `featureSource.test.ts` patterns.
- Integration: with a downloaded pack registered, `resolveBboxFeatures` serves it locally
  (no Overpass) — reuse task 04/05 tests with a filesystem-backed region.
- Pipeline: pack manifest has correct `bytes`/`sha256`; size-budget guard fails on an
  oversized pack.

## Acceptance criteria

- [ ] `pnpm data:geofabrik:packs` emits `<region>.json.gz` for all configured regions + a
      `packs.json` manifest with hashes and sizes.
- [ ] In-app: a user can download a region pack; afterward, matching queries in that region
      resolve offline with zero Overpass calls.
- [ ] Packs can be removed and storage is reclaimed.
- [ ] Corrupt/oversized/old-schema packs are rejected safely.
- [ ] No change to `featureSource.ts` or `osmMatchingCache.ts` (coverage-driven — validated in Phase 1).
- [ ] `pnpm check` + `pnpm test` pass.

## Out of scope

- Hosting/CDN infrastructure (ops decision; the pipeline just emits artifacts + manifest).
- Delta/incremental pack updates (full re-download per release is acceptable initially).
- Basemap/vector tile offline support (separate concern; see `mapTileCache.ts`).

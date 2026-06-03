# Task 07 — On-Demand Region Packs (Phase 2)

**Epic:** [Bundled Offline POIs](epic.md)
**Phase:** 2 (scale)
**Status:** Not started
**Depends on:** 01–05 (registry, pipeline, loader, seam, cache integration)
**Blocks:** —

## Objective

Extend offline POIs beyond the in-binary bundle to **downloadable region packs**, so the
app can cover all of Japan and, eventually, worldwide without shipping all data in the
binary. A pack is the same columnar JSON as task 02, served gzipped, downloaded on demand,
persisted to the device, and registered with the same coverage/loader machinery so the
task 04 seam serves it transparently.

This is the scale-out path. Do not start it until Phase 1 (Kantō bundled) is shipped and
validated.

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

Refactor task 03's `bundledPois.ts` so the region registry is **dynamic**:

- Replace the static `regions.json` + `switch` with a registry that merges:
    1. in-binary bundled regions (Phase 1), and
    2. installed downloaded packs (from the installed-pack index).
- `loadRegionRaw(regionId)` must load downloaded packs from the filesystem
  (`FileSystem.readAsStringAsync` → `JSON.parse`), still **lazily** and memoized.
- `regionCoveringBbox` / `regionCoveringPoint` consider both sources.

Because task 04's `resolveBboxFeatures` already dispatches on coverage, **no change to the
seam or the cache is needed** — once a pack is installed and registered, its region is
served locally automatically.

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

- `src/features/questions/matching/bundledPois.ts` — dynamic registry (downloaded + bundled)
- `package.json` — add `expo-file-system`; add `data:geofabrik:packs` script
- `config.yaml` — ensure all target regions are listed

## Edge cases

- **Partial/corrupt download** — verify `sha256` + byte length before inflating; on
  mismatch, delete and surface a retry. Never register a half-written pack.
- **Schema version drift** — a pack built against an older `schemaVersion` than the app
  expects must be rejected (prompt re-download). Version the pack and check on load.
- **Storage pressure** — `removePack` for eviction; show total usage; consider an LRU over
  packs if many are installed.
- **Offline during download** — the mutation fails gracefully; the bundled region still
  works.
- **Coverage overlap** — bundled Kantō vs a downloaded Japan-wide pack: prefer the more
  specific / fresher source, or dedup at merge (`deduplicateFeatures` already runs in the
  cell cache). Define a deterministic precedence (e.g. installed pack > bundled if newer
  `generatedAt`).
- **Inflate cost** — gunzip of a multi-MB pack on the JS thread can jank; inflate once at
  install time (write the plain `.json`), not on every load. Consider chunked/async inflate
  for large packs.

## Testing

- `regionPacks.ts`: mock `expo-file-system` + `fflate`; test download → verify → inflate →
  register; test sha mismatch rejection; test removal/eviction; test schema-version reject.
- Dynamic registry: a region becomes "covered" after a pack is registered; coverage reverts
  after removal.
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
- [ ] No change required to `featureSource.ts` or `osmMatchingCache.ts` (coverage-driven).
- [ ] `pnpm check` + `pnpm test` pass.

## Out of scope

- Hosting/CDN infrastructure (ops decision; the pipeline just emits artifacts + manifest).
- Delta/incremental pack updates (full re-download per release is acceptable initially).
- Basemap/vector tile offline support (separate concern; see `mapTileCache.ts`).

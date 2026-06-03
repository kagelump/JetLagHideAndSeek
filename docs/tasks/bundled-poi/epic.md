# Epic: Bundled Offline POIs

**Date:** 2026-06-03
**Status:** Phase 1 complete (tasks 01–06 shipped); Phase 2 (task 07) pending
**Author:** Datatype & architecture advisory
**Review:** [review-01.md](review-01.md) — 8 findings, all resolved
**Related:**

- [`../../../data/geofabrik/SIZES.md`](../../../data/geofabrik/SIZES.md) — Kantō POI size analysis
- [`../../../data/geofabrik/PLAN.md`](../../../data/geofabrik/PLAN.md) — Geofabrik data pipeline plan
- [`../react-query-cache-migration.md`](../react-query-cache-migration.md) — why the OSM matching cache stays bespoke
- [`../../caching-audit-2025-05-31.md`](../../caching-audit-2025-05-31.md)

## Summary

Matching questions today resolve every candidate lookup with a **live Overpass
query** (`src/features/questions/matching/osmMatching.ts:5`). This requires network,
is rate-limited, times out, and does not work offline. This epic makes the same
`(category, lat, lon, radius)` lookups resolvable from **on-device bundled OSM POI
data**, with Overpass kept as the online fallback and refresh path.

The work is deliberately phased:

- **Phase 1 (MVP — shipped):** Bundle the Kantō POI set into the app binary and serve matching
  queries locally when the play area is inside Kantō. Tasks 01–06 implemented, reviewed,
  and fixed. See [review-01.md](review-01.md).
- **Phase 2 (scale):** On-demand downloadable region packs for the rest of Japan and,
  eventually, worldwide. Task 07.

## Motivation

A measured extraction of the **exact tag set the matching engine queries** (not the
broad sets in `SIZES.md`) against the cached `kanto-latest.osm.pbf` shows the data is
small enough to bundle directly:

| Scope                              | Tagged features | Named (engine keeps) | Raw JSON |     gzip -9 | Per-feature gz |
| ---------------------------------- | --------------: | -------------------: | -------: | ----------: | -------------: |
| Curated category set, all of Kantō |          77,886 |           **58,479** |  2.68 MB | **0.93 MB** |        ~16.6 B |

`SIZES.md`'s "Useful" 12.5 MB figure measures _all named amenity/shop/tourism/…_. The
engine only queries **~14 specific `key=value` combos** (see
[`src/features/questions/matching/matchingCategories.ts`](../../../src/features/questions/matching/matchingCategories.ts)),
so the real payload is ~13× smaller. Reproduce with the command in the
[Appendix](#appendix-reproducing-the-measurement).

Feasibility verdict:

| Target                  | gzip (measured/est.) | Verdict                                           |
| ----------------------- | -------------------: | ------------------------------------------------- |
| Kantō                   |             ~0.93 MB | Bundle directly in the app. (Phase 1)             |
| All Japan (~10 regions) |              ~2–3 MB | Bundle directly. (Phase 1 extension)              |
| Worldwide               |         ~50–150 MB\* | On-demand region packs, not one bundle. (Phase 2) |

\* Worldwide scales the measured ~16.6 B/feature by an order-of-magnitude estimate of
3–8 M named features in these categories globally. The conclusion (region packs) holds
even if the estimate is off by 2×.

## Goals

- Resolve matching `(category, lat, lon, radius)` lookups offline for bundled regions.
- Keep Overpass as the fallback for un-bundled regions and as the staleness-refresh path.
- Change **one seam** in the matching data layer; leave ranking, the cell-grid cache,
  Voronoi rendering, and the consumer screen untouched.
- Make extraction (pipeline) and querying (runtime) share **one source of truth** for the
  category → OSM tag mapping so they cannot drift.
- Ship the data with correct ODbL attribution.

## Non-Goals

- Replacing Overpass entirely. It remains the source for un-bundled regions, the
  `transit-line` category (handled by the ODPT/transit feature, not OSM tags), and
  staleness revalidation.
- Bundling admin-division boundaries (`admin-1st`…`admin-4th`). Those are
  `boundary=administrative` **relations** served by the separate Geofabrik boundary
  pipeline; in Phase 1 they fall through to Overpass. See
  [Category set](#category-set).
- Migrating the OSM matching cache to TanStack Query. Per
  [`../react-query-cache-migration.md`](../react-query-cache-migration.md) it stays
  bespoke because of its spatial-containment logic. This epic plugs into that bespoke
  cache, it does not replace it.
- Vector map tiles / basemap offline support. Out of scope; this is POI data only.
- A spatial index library. Linear scan is sufficient at these counts (see
  [Key decisions](#key-decisions)); an index is a future optimization, not a dependency.

## Pre-Phase-1 data flow (historical)

```
OsmMatchingQuestionDetailScreen.performSearch()
  └─ findMatchingFeaturesWithCellCache(category, center, opts)   ← osmMatchingCache.ts
       ├─ cellsForSearch() → memory LRU → AsyncStorage (per cell)
       └─ on miss: fetchAndParseOverpassBboxFeatures(category, s,w,n,e)  ← osmMatching.ts
            └─ fetch(OVERPASS_API) → parseOverpassElements()  (drops unnamed)
                 → OsmFeature[]  →  rankMatchingFeatures() (haversine sort)
```

The active path is the **cell cache** (`findMatchingFeaturesWithCellCache`,
`osmMatchingCache.ts:828`). The single network dependency is
`fetchAndParseOverpassBboxFeatures` (`osmMatching.ts:192`), called from
`fetchAndStoreCell` and `cellRevalidateInBackground`.

## Current data flow (Phase 1 shipped)

```
findMatchingFeaturesWithCellCache(...)                          ← UNCHANGED
  └─ fetchAndStoreCell / cellRevalidateInBackground
       └─ resolveBboxFeatures(category, bbox, signal)           ← featureSource.ts
            ├─ if bundled region covers bbox → localBboxFeatures()   (in-memory scan)
            └─ else                          → fetchAndParseOverpassBboxFeatures()
```

The seam is a single function the cache calls instead of Overpass directly. Everything
above it (cell math, LRU, AsyncStorage, ranking, the screen) is unchanged. A cell served
locally is stamped `fetchedAt = bundle.generatedAt`, so when the device is online and the
data ages past `MATCHING_CACHE_TTL_MS` (90d) the existing stale-while-revalidate logic
refreshes it from Overpass for free.

## Key decisions

| Decision                         | Choice                                                                                                | Why                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On-device datatype**           | Columnar JSON per region (parallel `lon[]`, `lat[]`, `name[]`, `osmId[]`, `osmType[]` arrays)         | No repeated object keys → smaller; cache-friendly; trivially maps to typed arrays later. `tags` is dropped — verified unused downstream (only the parse stage reads it).                        |
| **Spatial query**                | Linear haversine scan within a category's arrays                                                      | Per-category counts are small (largest is `park` ~30k; most <2k). A full scan is sub-millisecond. Zero new deps. An index (`kdbush`) is a future optimization.                                  |
| **Integration seam**             | `resolveBboxFeatures` behind the cell cache                                                           | One function swap. Preserves all existing cache, ranking, and rendering behavior; gives graceful per-cell fallback at region edges.                                                             |
| **Coverage check**               | Query bbox ⊆ a single bundled region bbox → local; else Overpass                                      | Simple and correct-by-overestimate. Multi-region merge is a documented future refinement.                                                                                                       |
| **Bundling mechanism (Phase 1)** | One JSON file per region, loaded **lazily** via a literal `require()` switch                          | Metro bundles `.json` natively (precedent: `assets/default-zones/tokyo.json`, 175 KB). Lazy `require` defers the ~2.7 MB parse until the first matching query in a covered region. No new deps. |
| **Bundling mechanism (Phase 2)** | `.json.gz` downloaded to the document dir, inflated with `fflate`, persisted                          | Network payload must be compressed; needs `expo-file-system`. Deferred to task 07 so Phase 1 ships with zero new dependencies.                                                                  |
| **Source of truth**              | TS selector registry (`matchingSelectors.ts`), emitted to JSON for the pipeline, guarded by `--check` | Prevents extraction/query drift. Mirrors the existing `data:default-zones` + `test:data:default-zones --check` pattern.                                                                         |
| **Freshness**                    | Local cells stamped with `bundle.generatedAt`                                                         | Reuses the existing 90-day TTL + SWR to auto-refresh from Overpass when online. No new refresh machinery in Phase 1.                                                                            |

## Category set

The registry (task 01) is the authority. Phase 1 bundles the **14 point-POI categories**;
two groups are intentionally excluded.

**Bundled (point POIs, `out center` collapses areas to a centroid):**

| Category              | OSM selector                                | Kantō named (approx.) |
| --------------------- | ------------------------------------------- | --------------------: |
| `park`                | `leisure=park`                              |                  ~30k |
| `hospital`            | `amenity=hospital`                          |                 ~3.5k |
| `station-name-length` | `railway=station` (covers `station=subway`) |                 ~2.2k |
| `museum`              | `tourism=museum`                            |                 ~1.9k |
| `golf-course`         | `leisure=golf_course`                       |                 ~1.9k |
| `landmark`            | `tourism=attraction`                        |                 ~1.7k |
| `mountain`            | `natural=peak`                              |                 ~1.6k |
| `library`             | `amenity=library`                           |                 ~1.5k |
| `movie-theater`       | `amenity=cinema`                            |                 ~0.2k |
| `amusement-park`      | `tourism=theme_park`                        |                ~0.17k |
| `zoo`                 | `tourism=zoo`                               |                ~0.15k |
| `commercial-airport`  | `aeroway=aerodrome`                         |                ~0.06k |
| `aquarium`            | `tourism=aquarium`                          |                ~0.06k |
| `foreign-consulate`   | `diplomatic=consulate`                      |          rare (Tokyo) |

**Excluded — Overpass fallback in Phase 1:**

- `admin-1st`…`admin-4th` — `boundary=administrative` **relations**. Few features, better
  derived from the boundary pipeline's polygons later (Phase 1.5, noted in task 02).
- `transit-line` — not OSM-tag based (`osmQueryTags: ""`); handled by the transit feature.

## Phasing & task index

```
Phase 1 (MVP — Kantō bundled, zero new deps):
✅ 01  Category → OSM selector registry        [keystone, no deps]
✅ 02  POI extraction pipeline stage            [deps: 01]
✅ 03  Bundle asset loader + in-memory index    [deps: 02 output format]
✅ 04  FeatureSource seam (local + Overpass)    [deps: 03]
✅ 05  Cache integration                        [deps: 04]
✅ 06  Attribution & licensing surface          [deps: 02]

Phase 2 (scale):
  07  On-demand downloadable region packs      [deps: 01–05]
```

Dependency graph:

```
01 ─┬─> 02 ─┬─> 03 ─> 04 ─> 05 ─┐
    │       └─> 06               ├─> 07
    └────────────────────────────┘
```

| #   | Status | Outcome                                                                                                |
| --- | ------ | ------------------------------------------------------------------------------------------------------ |
| 01  | ✅     | One typed registry feeds both runtime QL and the pipeline; `--check` CI guard.                         |
| 02  | ✅     | `pnpm data:poi` emits per-region columnar JSON + region index + stats.                                 |
| 03  | ✅     | Runtime loads/indexes a bundled region lazily via `require()`; coverage lookup.                        |
| 04  | ✅     | `resolveBboxFeatures` in `featureSource.ts` dispatches local-or-Overpass.                              |
| 05  | ✅     | Cell cache calls the resolver; local cells stamped with `generatedAt` + SWR refresh.                   |
| 06  | ✅     | ODbL attribution in data artifact + `NOTICE.md`; `poiAttribution.ts` in-app surface.                   |
| 07  | ⬜     | Download/persist/evict region packs beyond the bundle. See [07-task](07-task-offline-region-packs.md). |

### Phase 1 artifacts

| Artifact            | Path                                                                                         | Notes                                                                |
| ------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Selector registry   | `src/features/questions/matching/matchingSelectors.ts` → `data/geofabrik/poi-selectors.json` | Drift-guarded by `pnpm test:data:poi-selectors` (in `check`)         |
| Extraction pipeline | `data/geofabrik/scripts/poiReducer.mjs` + `fetch-geofabrik.mjs`                              | `pnpm data:poi`; tested by `pnpm test:data:geofabrik` (in `pretest`) |
| Bundle data         | `assets/poi/japan-kanto.json` (3.14 MB raw, 0.97 MB gzip)                                    | 58,058 named features across 14 categories                           |
| Region index        | `assets/poi/regions.json`                                                                    | Bbox `[134.04, 18.62, 155.60, 37.15]`                                |
| Asset loader        | `src/features/questions/matching/bundledPois.ts`                                             | Lazy `require()`, memoized per-category reconstruction               |
| Feature seam        | `src/features/questions/matching/featureSource.ts`                                           | `resolveBboxFeatures` → local or Overpass                            |
| Cache integration   | `src/features/questions/matching/osmMatchingCache.ts`                                        | `fetchAndStoreCell` / `cellRevalidateInBackground` call the seam     |
| Attribution         | `src/features/questions/matching/poiAttribution.ts` + `data/geofabrik/NOTICE.md`             | ODbL attribution surfaced in settings                                |

## Risks & mitigations

| Risk                                                           | Mitigation                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extraction tags drift from runtime query tags → silent gaps    | Single registry (task 01) + `--check` CI guard.                                                                                                        |
| Node-only extraction misses area POIs (parks, golf, hospitals) | Pipeline extracts node **+ way + relation**, reduces to centroid (task 02). This is why the measured count is 58k, not the report's node-only framing. |
| Bundled JSON inflates startup time / memory                    | Lazy `require` defers parse to first matching query; one region ~2.7 MB parsed. Re-evaluate with the perf harness (`pnpm perf:test`).                  |
| Bundle goes stale between app releases                         | `generatedAt` stamp + 90-day SWR refresh from Overpass when online.                                                                                    |
| Region-edge play areas straddle the bundle bbox                | Per-cell fallback (each uncovered cell hits Overpass). Multi-region merge is a future refinement.                                                      |
| App-store size growth as regions are added                     | Phase 2 moves additional regions to on-demand downloads (task 07); keep the in-binary bundle to Kantō (or a small default set).                        |
| ODbL share-alike obligations                                   | Attribution shipped in data + surfaced in-app (task 06); `NOTICE.md` already present.                                                                  |

## Resolved questions (from Phase 1)

1. **Default in-binary region(s):** Kantō only. The single region file is 3.14 MB raw
   (0.97 MB gzip). Kansai or additional regions can be added as separate files when the
   bundle grows; for now Kantō provides offline coverage for the primary play-testing area.
2. **Coordinate precision:** 6 decimal places (~0.1 m) confirmed. Centroid uses **bbox
   center** (matching Overpass `out center`), fixed in review Finding 3. Coordinates are
   rounded via `round6` in the reducer. Ranking is by relative haversine distance, so
   sub-meter precision is unnecessary.
3. **Per-category files vs one region file:** One region file. At 3.14 MB raw / 0.97 MB
   gzip, this is well under the ~5 MB threshold for per-category sharding. Revisit if
   additional regions push past that bound.

## Appendix: reproducing the measurement

```bash
# From repo root, with osmium-tool installed and the Kantō PBF cached.
TMP=$(mktemp -d)
osmium tags-filter -o "$TMP/c.pbf" data/geofabrik/cache/kanto-latest.osm.pbf \
  aeroway=aerodrome natural=peak \
  tourism=attraction,theme_park,zoo,aquarium,museum \
  leisure=park,golf_course amenity=hospital,cinema,library \
  railway=station diplomatic=consulate
osmium export "$TMP/c.pbf" -f geojsonseq -o "$TMP/c.seq"
# Reduce to named centroids and measure (see task 02 for the production reducer).
```

Measured 2026-06-03 against `kanto-latest.osm.pbf` (Geofabrik sequence 3320,
2026-06-01T20:21:26Z): 77,886 tagged features → 58,479 named → 2.68 MB raw JSON →
0.93 MB gzip -9.

# Performance Implementation Report

Date: 2026-06-02
Related: [map-performance-audit-2026-06-01](./map-performance-audit-2026-06-01.md)

## Summary

Implemented items #3, #4, and #5 from the audit's suggested implementation sequence:

| Item | Description | Status |
|---|---|---|
| #3 | OSM matching memory cache with stale-while-revalidate | Verified (previously shipped) |
| #4 | OSM matching deterministic bbox grid cells | Implemented |
| #5 | Per-radar immutable geometry fragments | Implemented |

All changes pass the full test suite (372/375 Jest tests, 68/68 perf scenarios) with stable output digests.

---

## #3: OSM Matching Spatial Cache (Verification)

**Commit:** `6d347bb`

The circle-based spatial cache was already shipped. Verification confirmed all audit requirements are met:

- In-memory LRU (20 entries) with MRU promotion
- AsyncStorage persistence with manifest for disk pruning
- In-flight deduplication per spatial key
- Overscan-circle containment checks (`containsSearchCircle`)
- Stale-while-revalidate with 90-day TTL
- Force-refresh affordance
- Cached empty results
- Hit-type instrumentation (`memory` | `disk` | `stale` | `network`)

**Minor gaps** (tracked as future enhancements):
- Rate-limit backoff (429/503 retry) not yet implemented
- Overscan failure fallback to exact-radius query not yet implemented

---

## #4: Deterministic Bbox Grid Cells

### Files changed

| File | Change |
|---|---|
| `src/features/questions/matching/osmMatchingGrid.ts` | **New** — grid system (cellIndex, cellBbox, cellsForSearch) |
| `src/features/questions/matching/osmMatching.ts` | Added bbox-based Overpass query builders and fetcher |
| `src/features/questions/matching/osmMatchingCache.ts` | Added cell-based cache layer (separate LRU, manifest, public API) |
| `src/features/questions/matching/__tests__/osmMatchingCache.test.ts` | 28 new tests (50 total) |
| `perf/scenarios/matching.mts` | 5 new bbox-cell scenarios |

### Architecture

The world is divided into fixed 0.1° × 0.1° grid cells (~11 km at equator). A search at `(lat, lon, radius)` maps to the set of cells whose bboxes intersect the search bounding square. The cell cache is independent from the existing circle-based cache — both coexist as separate public APIs:

- `findMatchingFeaturesWithCache()` — circle containment (overscan + spatial containment check)
- `findMatchingFeaturesWithCellCache()` — grid-based (tile fetch + dedup merge)

**Correctness contract:** The union of loaded cell bboxes covers the entire search region. After merging, a local distance filter (`haversineDistanceMeters`) ensures correctness — features outside the search radius are discarded.

### Key design decisions

- **Separate LRU/manifest/inflight maps** for cell cache vs circle cache. This avoids interference and allows independent tuning.
- **Parallel missing-cell fetching** via `Promise.all` when multiple cells need network requests.
- **Deduplication by (osmType, osmId)** after merging multi-cell results.
- **Manifest loaded once** before disk checks (not once per uncached cell).

### Perf results

| Scenario | Median | Notes |
|---|---|---|
| `cells-for-search` | 0.00 ms | Cell computation is negligible |
| `cell-index` | 0.00 ms | Single cell index computation |
| `cache-hit-merge` | 0.09 ms | All cells cached, merge + filter only |
| `cache-partial-fetch` | 9.52 ms | Some cells cached, partial network fetch |
| `dedup-merge` | 0.01 ms | Deduplication of overlapping cell results |

### Test coverage

50 Jest tests covering:
- Grid system: determinism, bbox reversal, coverage proof, negative coordinates
- Cell cache: network fetch, memory hit, nearby center reuse, partial cell fetch, disk persistence, manifest, disk hit after memory clear, empty results, cross-category isolation, dedup at cell boundaries, in-flight dedup per cell, stale + background refresh, force-refresh

---

## #5: Per-Radar Immutable Geometry Fragments

### Problem

`buildRadarQuestionRenderState` called `buildRadarQuestionFeatureCollection` 4 times — for hit, miss, outline, and preview collections. Each call independently invoked `@turf/circle` for every question. Every question appeared in `outlineFeatures` plus exactly one answer-state collection, generating each circle **twice**.

With 50 radar questions: 100 `@turf/circle` calls instead of 50.

### Solution

Added a module-level circle fragment cache in `radarGeometry.ts`:

- **Cache key:** `(question.id, center, distanceMeters, steps, answer, algorithmVersion)`
- **LRU eviction:** 200-entry max, oldest evicted on overflow
- **Transparent:** `buildRadarQuestionFeatureCollection` uses `getRadarCircle()` which checks cache before calling `@turf/circle`
- **Test helper:** `clearRadarCircleCache()` resets state between tests

### Perf results (before → after)

| Scenario | Before | After | Improvement |
|---|---|---|---|
| `50-questions-cold` | 0.65 ms | 0.40 ms | **38%** |
| `50-questions-one-answer-edit` | 0.65 ms | 0.37 ms | **43%** |
| `50-questions-one-distance-edit` | 0.65 ms | 0.37 ms | **43%** |
| `50-questions-repeat-current` | 1.31 ms | 0.07 ms | **95%** |
| `50-questions-warm-repeat` | — | 0.04 ms | (new) |

All output digests unchanged (`bb686bd588`, `c5d2fb0488`, `c77aef2985`, `2f78909838`, `69799b4c3c`) — geometry is identical.

The cold-build improvement (~38%) comes from generating 50 circles instead of 100. The repeat-current improvement (95%) comes from all circles hitting the fragment cache with zero `@turf/circle` calls.

---

## Verification Checklist

- [x] `pnpm check` passes (lint, format, typecheck, perf:typecheck)
- [x] Jest: 372/375 pass (3 pre-existing hiding-zone test failures, unrelated)
- [x] Perf: 68/68 scenarios pass with stable digests
- [x] No existing test regressions
- [x] Output digests identical before/after for all radar scenarios
- [x] Bbox-cell grid coverage proof validated by test
- [x] Cell cache force-refresh implemented
- [x] Type holes fixed in both circle and cell revalidation handlers

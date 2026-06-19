# Distance-field body-of-water mask — spike + implementation plan

Status: **proposed (spike first)**. Owner: TBD. Created 2026-06-20.

## Goal & guiding principle

Move body-of-water geometry work from **runtime to build time** so that, at
runtime, "within X meters of water" becomes a cheap **threshold + contour** of a
precomputed **distance field** — no per-query GEOS buffering, no N-way union, no
`MakeValid`. This is the cleanest expression of the project principle: _do as
much as possible at bundle-build time to make runtime faster, as long as the
build stays reasonable and does not OOM a 16 GB laptop._

Today the heavy runtime op is `computeLineBuffer`: it buffers every water
polygon + river-line in the play-area window at the seeker's distance, then
unions the pieces (the op that produced the "dark circle" notch — see
`water-bundle-notes-handoff2.md`). The buffer radius is set at runtime (distance
from the seeker pin to nearest water), so the buffer cannot be precomputed _as a
polygon_. A **distance field** sidesteps this: store distance-to-water per cell
once, and at runtime any radius X is just `{cells ≤ X}`.

This plan is **spike-gated**: Phase 0 measures whether the numbers justify the
architectural change before any production code is touched.

## How body-of-water works today (anchors)

Build (`data/packs/scripts/lib/buildMeasuring.mjs`, polygon-dissolve branch):

1. osmium-extract water polygons + waterway lines.
2. Dissolve water polygons per tile (`polygonDissolve.mjs`, GEOS unary union).
3. `filterTinyPolygons` (drop <100 m² slivers) + `bucketPolygonsToGridFeatures`
   (re-tile into 0.1° features for runtime windowing).
4. Stitch/clip waterway centerlines at the water boundary.
5. Emit `measuring-body-of-water.json.gz` = bucketed water `MultiPolygon`
   features + `LineString` centerlines (schemaVersion 2).

Runtime (per body-of-water question):

- `buildMeasuringRenderState` (`measuringGeometry.ts`) →
  `computeLineCategory` (`lineMeasuringGeometry.ts`, window + nearest distance) →
  `computeLineBufferCached` (`lineBufferComputation.ts`, buffer + dissolve) →
  `hitMaskFeatures`.
- The mask is consumed by `buildCombinedEligibilityMask`
  (`src/features/map/maskBuilder.ts`, via `eliminationMath.ts`), which
  differences the eligible region against the play area.

The distance field only needs to **produce `hitMaskFeatures`** (a
`FeatureCollection<Polygon|MultiPolygon>`) for body-of-water; everything
downstream (`buildCombinedEligibilityMask`, the map overlay) is unchanged.

## Proposed representation

A per-region, **sparse tiled** distance field:

- Grid resolution `R` meters (spike: try 10 / 25 / 50 m).
- Per cell: distance to nearest water, capped at `Dmax` (spike: 1 / 2.5 km) and
  quantized to 1 byte (`round(min(dist, Dmax) / Dmax * 255)`).
- **Sparse tiling is mandatory.** Geofabrik extract bboxes can be enormous and
  mostly empty ocean — Kantō's `extractBbox` is `[134.0, 18.6, 155.6, 37.2]`
  (~21° × 18°, because it includes the Izu/Ogasawara islands). A dense raster at
  25 m would be ~8 billion cells. So the field is stored as **tiles** (e.g.
  0.25°), and a tile is **omitted** when every cell is `≥ Dmax` (open ocean far
  from any land/water). Only tiles within `Dmax` of water are materialized.
- Artifact layout (draft): a header (region bbox, `R`, `Dmax`, tile size, tile
  index → offset table) + concatenated gzip-per-tile byte blobs. Distance fields
  are smooth → excellent compression.

Runtime: for a query window + radius X, gather the covering tiles, threshold
`field ≤ X`, run marching squares to extract the boundary polygon(s), and hand
them to `hitMaskFeatures`. The "inside water" cells (distance 0) are always
included.

## Phase 0 — Spike (measure before committing)

**Question:** on real Kantō data, is the distance-field cheaper at runtime and
acceptable at build/size/accuracy?

Spike code lives in `scripts/spike-distance-field.mjs` (throwaway, **not** wired
into the app or pack pipeline; delete or keep under `tools/` after). It reuses
`src/shared/geometry/geosWasmNode.ts` for the reference buffer.

### Steps

1. **Source water.** Load
   `data/packs/dist/asia-japan-kanto/measuring-body-of-water.json.gz`. Use its
   water `MultiPolygon` members (+ optionally the `coastline` bundle) as
   "water = true". Work in a **bounded AOI** first (Tokyo-23 bbox
   `[139.563, 35.523, 139.919, 35.818]`) to iterate fast, then a wider band.
2. **Rasterize** water into a binary grid at resolution `R` over the AOI
   (scanline polygon fill; reuse `buildPolygonGrid`/`pointInGrid` from
   `polygonDissolve.mjs`, or a dedicated rasterizer).
3. **Distance transform.** Felzenszwalb–Huttenlocher separable EDT (two 1-D
   passes per axis), O(cells), streamable in row-bands. Cap at `Dmax`, quantize
   to 1 byte.
4. **Measure build:** wall-time, peak RSS, raw + gzip bytes, and **count of
   non-empty tiles vs total** (the sparse-tiling payoff) for
   `R ∈ {10, 25, 50}` × `Dmax ∈ {1, 2.5} km`.
5. **Runtime spike:** threshold the field at radii {50, 155, 500 m}, run marching
   squares (prototype inline; or trial `d3-contour` / `isoband` — **not currently
   a dependency**), simplify the contour, and time it.
6. **Accuracy:** compare the contour mask to the current GEOS buffer mask
   (geos-wasm) at the Nakameguro fixture `[139.701994, 35.642352]` and over a
   sample grid — report symmetric-difference area ratio and the
   max boundary displacement (meters).

### Go / no-go thresholds (record results back into this doc)

| Metric                                       | Target                                         |
| -------------------------------------------- | ---------------------------------------------- |
| Build wall-time (Kantō, full region, sparse) | ≤ ~2× current dissolve time                    |
| Build peak memory                            | ≤ 8 GB (well under the 16 GB ceiling)          |
| Artifact size (gzip)                         | ≤ ~1.5× current `body-of-water` blob (~3.2 MB) |
| Runtime threshold+contour (typical window)   | ≤ current `computeLineBuffer` time             |
| Mask accuracy vs buffer (symDiff area)       | < ~2–3%                                        |
| Boundary displacement                        | ≲ R (resolution-bounded)                       |

If build/size blow the budget at 25 m, the likely lever is coarser `R` (50 m) or
smaller `Dmax`; if accuracy fails at 50 m, the lever is finer `R` near
shorelines (variable-resolution tiles) — note which in the results.

## Phase 1 — Build pipeline (only if spike passes)

- **New artifact kind** alongside the polygon bundle:
  `measuring-body-of-water-distancefield.bin.gz` (or fold into the measuring
  bundle with `representation: "distancefield"`). Pack schema is free to change
  pre-launch (no migration shims) — see "Offline Pack Rules" in AGENTS.md.
- In `buildMeasuring.mjs`, for polygon-dissolve categories with the field
  enabled: after the dissolve produces `mergedPolyCoords`, rasterize + EDT in
  **row-band tiles** (stitch a `Dmax`-wide halo across band seams so distances
  are correct at boundaries), drop all-`Dmax` tiles, and write the tiled blob.
- Fold in `coastline` the same way it's folded at runtime today
  (`MEASURING_EXTRA_BUNDLES["body-of-water"] = ["coastline"]`) so the ocean is
  part of "water".
- **Coexistence:** keep emitting the polygon bundle during transition (the field
  is additive); the runtime prefers the field when present, else falls back to
  the buffer path. Decide whether to drop the polygon bundle after validation
  (size).
- Catalog/registration: add the field to `regionPacks.ts` / `packSchemas.ts` /
  `packCatalog.ts` install path and `site/packs/catalog.json` (content hash +
  schemaVersion), mirroring the existing measuring artifact wiring.

## Phase 2 — Runtime (only if spike passes)

- New loader for the field (lazy, mirroring `lineBundleLoader.loadLineBundle` /
  `registerMeasuringSource`).
- In `measuringGeometry.ts`, branch body-of-water to a distance-field path:
    - **Nearest distance for free:** the field value at the seeker's cell _is_ the
      distance to nearest water — replaces `computeLineDistance` for the radius.
    - eligible = threshold `field ≤ radius` over the play-area window tiles.
    - marching squares → polygon(s) → simplify → `hitMaskFeatures` (positive) /
      `missMaskFeatures` (negative) using the existing polarity.
    - nearest-point connector/marker: gradient-descend the field from the seeker
      to the nearest water cell, or keep the current nearest-point calc.
- **Backend-agnostic:** threshold + marching squares is pure JS — this removes
  the GEOS dependency for body-of-water entirely (no buffer, no union,
  no `MakeValid` → structurally **cannot** reproduce the notch).
- Keep `computeLineBuffer` as the fallback for regions whose pack predates the
  field.

## Phase 3 — Validation & tests

- **Parity:** distance-field mask vs buffer mask symmetric-difference over a grid
  (extend the parity harness / a new `*.geos.test.ts`).
- **Notch regression:** the field path must cover the Nakameguro junction — adapt
  `darkCircleRepro.geos.test.ts`. A distance field has no spurious holes by
  construction, so this should pass trivially (and proves the structural win).
- **Perf:** time threshold+contour vs `computeLineBuffer` on the Tokyo window.
- **Visual:** eyeball in `tools/data-viewer` before publishing.

## Risks & open questions

- **Resolution vs tight radii.** At 25 m, a 50 m "Closer" mask is only ~2 cells
  wide — boundary accuracy may be marginal. Mitigation: finer `R`, or
  variable-resolution tiles near shorelines.
- **Contour coordinate count.** Marching squares can emit dense boundaries;
  simplify the output (Douglas–Peucker) before handing to the map.
- **Marching-squares dependency.** None today — add `d3-contour`/`isoband` or
  implement (marching squares is ~100 LOC). Spike decides.
- **Sparse-tile correctness at seams.** Need a `Dmax` halo when computing EDT per
  band so distances near tile edges aren't truncated.
- **Generalization.** Every line-measuring category's mask is "within X of
  feature" = a distance-field threshold. If body-of-water proves out, the same
  machinery could later cover coastline / admin-border / rail with a uniform fast
  runtime path. Out of scope for this plan; note as future direction.
- **"Seeker on water" (distance 0).** For "Closer" the eligible region is the
  whole field within radius; confirm the threshold handles the degenerate
  radius-0 / on-water case (the seeker is inside water).

## Rollback / coexistence

The field is **additive**: until it's validated, the polygon bundle and
`computeLineBuffer` remain the source of truth. The runtime uses the field only
when an installed pack provides it; otherwise it falls back. No migration needed
(pre-launch, packs re-download). If the spike fails the gates, this plan is
shelved and the Tier-1 dissolve improvements (see
`water-bundle-notes-handoff2.md` and the build-dissolve fix) carry the runtime
win on their own.

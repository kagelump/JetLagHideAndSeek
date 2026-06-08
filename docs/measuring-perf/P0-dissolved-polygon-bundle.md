# P0 — Bundle `body-of-water` as dissolved polygons

**Status:** ready (after P1 lands as a safety net) · **Priority:** highest
quality ceiling for `body-of-water` · **Risk:** medium (bundle + runtime) ·
**Quality cost:** adjacent water bodies merge (desirable for a distance mask)

## Problem

`body-of-water` is generated with `geometry: "polygon-to-ring"` in
`data/geofabrik/scripts/extract-measuring-bundles.mjs` — **every** water polygon
(every pond, basin, river bank) becomes one outer-ring LineString. Result:
`assets/measuring/body-of-water.json` is **11.5 MB / 45,566 features /
207k coords**, two orders of magnitude denser than any other measuring bundle.

At runtime the buffer must offset + union ~1,533 of those rings, which softlocks
(see [`../measuring_perf_audit.md`](../measuring_perf_audit.md) Issue 2). P1
_caps_ that work; **P0 removes it** by precomputing the merge once, offline.

Buffering an outer **ring** (a line) is also subtly wrong semantics: it produces
a band straddling the shoreline rather than "within d of the water body
(interior included)." Dissolved polygons fix that too.

## Why a dissolved polygon, not just an index

A spatial index speeds up _finding_ the ~1,533 features; it does nothing to
reduce how many must be buffered. The freeze is the buffer/union, so the only
bundle-time artifact that removes it is **pre-merged geometry**. We compute the
union once at extraction time and ship a handful of `MultiPolygon`s instead of
1,533 rings. (Index is P2, and addresses the separate nearest-point scan.)

> **Scope:** this applies to `body-of-water` only — it is the one _area_
> category. `coastline` and the admin borders are genuinely _lines_ (you measure
> distance to a coast/border line), so they stay `polygon-to-ring`/`pass`. Any
> future area category (e.g. "forest") would follow this same pattern.

## Goal

- Ship `body-of-water` as a small set of dissolved `Polygon`/`MultiPolygon`
  features (target: a few hundred KB, ≤ ~50 polygons after dissolve+tiling).
- Adapt the runtime line path to consume polygon geometry for both the buffer
  (offset the polygons directly) and the nearest-point/connector (distance to
  the polygon boundary, or 0 if the seeker is inside water).
- Keep the mask visually equivalent or better; keep the reference-line and
  connector affordances working.

## Design

### 1. Extraction (build-time)

In `extract-measuring-bundles.mjs`:

- Add a geometry mode `"polygon-dissolve"` and assign it to `body-of-water`
  (replacing `"polygon-to-ring"`).
- For that mode: collect the input polygons, **dissolve** them
  (`polyclip-ts` `union` of all polygon coordinate arrays — the repo already
  uses it; `@turf/union` is also available but slower). To avoid one giant
  multipolygon, **tile** the dissolve into a coarse grid (e.g. 0.25° cells) and
  union within each cell, with cells overlapping by a small ε so adjacent tiles
  don't leave seams. Emit one feature per non-empty tile.
- Each emitted feature: `geometry: Polygon | MultiPolygon`, a precomputed
  `bbox`, `properties: {}`. Keep the same simplify pass (tolerance already
  ~55 m) applied to rings before/after dissolve.
- Keep `schemaVersion`, `category`, `generatedAt`, `source`, `extractBbox`.

Bump the bundle `schemaVersion` so the loader and any drift checks notice.

### 2. Bundle type + loader

In `lineBundleLoader.ts`, widen the feature type:

```ts
type LineBundleFeature = Feature<
    LineString | MultiLineString | Polygon | MultiPolygon
>;
```

The `require()` path for `body-of-water` is unchanged (same filename).

### 3. Runtime line path

Two functions need to accept polygon geometry. Add a tiny normalizer that, for a
polygon feature, yields its boundary ring(s) as `Position[][]` (outer + holes —
holes matter for distance so a seeker inside a lake-with-island still measures to
the nearest edge). Reuse `@turf/polygon-to-line` or hand-roll
(coordinates[0..n]).

- **`computeLineDistance`** (and the `selectWindowFeatures` collector): when a
  feature is a polygon, (a) if `booleanPointInPolygon(center, feature)` →
  `distanceMeters = 0` (seeker is on/in water; treat as distance 0, the
  connector collapses), else (b) run `nearestPointOnLine` against the boundary
  ring(s). The bbox prefilter is unchanged.
- **`computeLineBuffer`**: branch on geometry type — for polygons, collect the
  `Polygon`/`MultiPolygon` and buffer those directly (one offset per polygon over
  the dissolved set), instead of building a `multiLineString`. Buffering a
  dissolved polygon set is the cheap operation that replaces the 1,533-segment
  line buffer.
- **Reference line / clip**: `clipLineFeaturesToPlayArea` is line-oriented. For
  the polygon category, convert each polygon to its boundary line(s) _before_
  clipping so the on-map reference geometry stays a line (the shoreline). Do this
  conversion in `measuringGeometry.ts` where `windowFeatures` is consumed for
  `lineFeatures`, so the clip helper keeps its current contract.

Keep P1's budget logic — even dissolved, a dense tile could exceed it; the budget
is the backstop.

## Implementation steps

1. Extract: add `"polygon-dissolve"` mode + tiled dissolve in
   `extract-measuring-bundles.mjs`; point `body-of-water` at it; bump
   `schemaVersion`.
2. Update the data-script unit test
   (`extract-measuring-bundles.test.mjs`) for the new mode (see Testing).
3. Regenerate: `pnpm data:measuring`; verify the new
   `assets/measuring/body-of-water.json` size + feature count; `git add` it.
4. Widen `LineBundleFeature` in `lineBundleLoader.ts`.
5. Add the polygon-boundary normalizer + branch `computeLineDistance`,
   `selectWindowFeatures`, and `computeLineBuffer` on geometry type.
6. In `measuringGeometry.ts`, convert polygon window features to boundary lines
   before the existing `clipLineFeaturesToPlayArea` call.
7. Bump `LINE_DISTANCE_CACHE_VERSION`, `LINE_CATEGORY_CACHE_VERSION`, and
   `LINE_BUFFER_CACHE_VERSION`.

## Testing

> **Two test layers:** (a) the **extract script** uses `node:test`
> (`data/geofabrik/scripts/extract-measuring-bundles.test.mjs`, run via
> `node --test ...` or `pnpm pretest`); (b) the **runtime** uses jest
> (`src/features/questions/measuring/__tests__/`). Do both.

### A. Extract-script tests (`node:test`)

Add cases to `extract-measuring-bundles.test.mjs`:

1. **Dissolve merges overlapping polygons.** Feed two overlapping squares
   through the `polygon-dissolve` path; assert the output is a single
   Polygon/MultiPolygon whose area ≈ the union area (not the sum), and that it
   has no self-overlap.
2. **Tiling produces overlapping-safe seams.** Feed two polygons straddling a
   tile boundary; assert the dissolved output, when unioned across tiles, has no
   gap at the seam (sample a point on the shared edge → inside).
3. **Output features are valid polygons with bbox.** Every emitted feature has
   `geometry.type` in `{Polygon, MultiPolygon}`, a 4-number `bbox`, and rings
   that close (first coord === last coord).

Run: `node --test data/geofabrik/scripts/extract-measuring-bundles.test.mjs`

### B. Bundle artifact assertions (cheap guard)

Add a tiny jest test (or extend an existing data test) that `require()`s the real
regenerated bundle and asserts the **new shape**:

```ts
const b = require("../../../../../assets/measuring/body-of-water.json");
expect(b.features.length).toBeLessThan(2000); // was 45,566
expect(["Polygon", "MultiPolygon"]).toContain(b.features[0].geometry.type);
expect(b.features.every((f) => Array.isArray(f.bbox))).toBe(true);
```

This fails loudly if someone ships the old ring bundle.

### C. Runtime jest tests

In `lineMeasuringGeometry.test.ts`, add a `describe("polygon body-of-water")`:

1. **Distance: seeker outside water snaps to the shoreline.** Inject a polygon
   bundle (square lake) via `__setLineBundleForTest("body-of-water", ...)` with a
   `Polygon` feature. Center outside the square. Assert
   `computeLineDistance(...).nearestPoint` lies on a square edge and
   `distanceMeters > 0`.
2. **Distance: seeker inside water → distance 0.** Center inside the square.
   Assert `distanceMeters === 0` (or `< 1`). Confirm the function does not throw.
3. **Buffer accepts polygon features.** `computeLineBuffer([polygonFeature],
1000)` returns a non-null `Polygon|MultiPolygon` and runs in < 100 ms for a
   handful of polygons.
4. **Buffer is cheap on the real bundle (the softlock guard).** Same smoke test
   as P1's, but now the input is dissolved polygons — assert
   `< 300 ms` (tighter than P1's 1.5 s because the work is gone, not capped).
5. **Reference line stays a line.** Through `buildMeasuringRenderState` with a
   play-area boundary, assert `lineFeatures.features[*].geometry.type` is
   `LineString`/`MultiLineString` (the shoreline), not a polygon.

> Use the existing `makeSquarePlayArea` / `PLAY_AREA_BBOX` helpers in that test
> file for the boundary.

### D. Visual / equivalence check

`buildMeasuringRenderState` test: for the same seeker + answer, assert the new
polygon-based `hitMaskFeatures` covers the same play-area cells as a reference
snapshot (compare bbox + a few `booleanPointInPolygon` samples just inside/
outside the expected band). Quality intent: equal-or-better coverage, no
shoreline-only band.

### Commands

```bash
node --test data/geofabrik/scripts/extract-measuring-bundles.test.mjs   # A
pnpm data:measuring && git add assets/measuring/body-of-water.json      # regen + commit
pnpm test -- lineMeasuringGeometry                                      # C
pnpm test -- measuringGeometry                                          # D
pnpm typecheck && pnpm check
```

### Manual device check

Same as P1's manual check, plus: confirm the **interior** of a large water body
(e.g. Tokyo Bay edge) is covered by the positive mask, not just a shoreline
band.

## Acceptance criteria

- [ ] Regenerated `body-of-water.json` < ~1 MB and < 2,000 polygon features.
- [ ] `computeLineBuffer` on the real bundle returns in < 300 ms.
- [ ] Seeker-inside-water returns distance 0 without throwing.
- [ ] Reference line renders as the shoreline (LineString), clipped to play area.
- [ ] Mask coverage equal-or-better vs. the ring version (no shoreline-only band).
- [ ] All cache versions bumped; `pnpm test`, `pnpm check`, and the node:test
      suite pass.

## Rollback

Two parts: revert the runtime branch **and** restore the old ring bundle
(`git checkout <prev> -- assets/measuring/body-of-water.json`) — they must move
together because the runtime branches on geometry type. Ship P1 first so a
rollback still can't softlock.
</content>

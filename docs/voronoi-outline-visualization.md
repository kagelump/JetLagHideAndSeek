# Plan: Voronoi Polygon Outline Visualization for Candidate POIs

## Context

When playing a candidate-based POI question, the map shows candidate dots (white
circles with black outlines for unselected, red for selected). For `matching`
questions the Voronoi diagram of these candidates is **already computed**
(`@turf/voronoi` in `matchingVoronoi.ts`) but only used for the dark eligibility
mask overlay — the Voronoi cell boundaries are never visually rendered. The user
wants faint Voronoi polygon outlines so players can see the cell boundaries
around each candidate dot.

The feature must be a **generic, reusable visualization**: matching consumes it
now, and **`tentacles` ("Draw 4, pick 2", `usesMovableAnchor: true`,
`implemented: false` in `tentacles/tentaclesConfig.ts`) is the next candidate-based
question type** and will reuse it. The design below makes "add tentacles outlines"
a two-line change, not a refactor.

## Architecture

The existing dataflow:

```
question state → buildQuestionMapRenderState() → QuestionMapRenderState
  → { osmMatching: OsmMatchingRenderState, radar, transitLine }
  → NativeMap renders OsmMatchingLayers (POI dots) + CombinedInsideMaskLayer (masks)
```

The change adds a parallel path. Each candidate-based builder, where it already
has the bbox-clipped Voronoi cells, additionally clips those cells to the play
area **boundary polygon** and returns them as outline features. The top-level
render state **aggregates** outline features from every contributing question
type into one collection, rendered by a single generic layer component.

```
  → OsmMatchingRenderState { ..., voronoiOutlineFeatures }          // per-type, computed where cells live
  → QuestionMapRenderState { ..., voronoiOutlineFeatures }          // NEW top-level AGGREGATE (merge of all types)
  → NativeMap renders ONE <VoronoiOutlineLayers> (faint polygon lines)  // NEW component, single instance
```

This mirrors the existing `radarAreaFeatures: radar.previewFeatures` lift in
`questionGeometry.ts` (a sub-state field surfaced at the top level for
rendering), except the top-level field is a _merge_ of multiple contributors.

The masks continue to use bbox-clipped cells (unchanged), because
`buildCombinedEligibilityMask` already does `difference(playAreaPolygons, …)`,
so the eligibility mask is inherently confined to the play area. Clipping the
mask cells too would be redundant and riskier.

## Reusability contract

A question type opts into Voronoi outlines by satisfying this contract — there
is **no new component instance and no new map source per type**:

1. Its render-state builder returns `voronoiOutlineFeatures:
FeatureCollection<Polygon | MultiPolygon>` (built via the shared
   `clipCellsToPlayArea` util, where its candidate Voronoi cells already exist).
2. `buildQuestionMapRenderState` concatenates that collection into the single
   top-level `voronoiOutlineFeatures`.
3. Rendering is unchanged: the one `<VoronoiOutlineLayers>` instance already
   draws the aggregate.

Because there is exactly **one** `VoronoiOutlineLayers` instance fed by the
aggregate, its map source id (`"voronoi-outlines"`) can be a fixed literal with
no collision risk — the reuse mechanism is aggregation, not multiple component
instances. (Adding per-type component instances with a shared hardcoded source
id would break MapLibre source registration; the aggregate avoids that.)

**Tentacles plug-in (when `implemented` flips true):** add
`voronoiOutlineFeatures` to `TentaclesRenderState`, build it in the tentacles
geometry builder from its candidate cells via `clipCellsToPlayArea`, and add one
line in `buildQuestionMapRenderState` to merge it into the top-level field. No
changes to `VoronoiOutlineLayers`, `NativeMap`, or `clipVoronoiCells.ts`.

## Steps

### Step 1: Create `src/features/questions/clipVoronoiCells.ts`

**New file.** A generic, question-type-agnostic utility to clip Voronoi cells
(bbox-clipped by `@turf/voronoi`) to the play area boundary polygon. No
matching/tentacles-specific imports.

**Exports:**

- `clipCellsToPlayArea(cells, boundary)` — clips each cell to the boundary using
  `polyclip-ts` `intersection`, returns `FeatureCollection<Polygon |
MultiPolygon>` with original cell properties (e.g. `osmKey`) preserved.

Why `polyclip-ts` directly (not `@turf/intersect`): it's already a dependency,
avoids GeoJSON serialize/deserialize overhead, and the `unionPolygons` helper in
`shared/geojson.ts` plus `maskBuilder.ts` already follow this pattern.

**Implementation notes:**

- **Hoist boundary extraction:** convert `boundary` to polygon coordinates
  **once** before the loop (like `getPolygons` in `maskBuilder.ts`), then clip
  each cell against that single multipolygon geom. Do not re-extract per cell.
- **Type bridging:** `cells` are `geojson`-package types (`Polygon`); `boundary`
  is the app's `GeoJsonFeatureCollection` (custom `Position = [number, number]`,
  looser geometry). Both feed `polyclip-ts` via `as Geom` casts — consistent
  with the existing casts in `maskBuilder.ts` and `shared/geojson.ts`. Type the
  `boundary` parameter as the generic `FeatureCollection<Polygon | MultiPolygon>`
  (already imported in `matchingTypes.ts`) and cast at the polyclip boundary,
  rather than importing the map-layer `GeoJsonFeatureCollection` type into the
  questions feature.
- **Wrap polyclip output** exactly like `unionPolygons`: `intersection` returns
  `Position[][][]` (multipolygon); `length === 0` → drop, `length === 1` →
  `Polygon`, else `MultiPolygon`.
- **Caching:** LRU `Map` (max 20) keyed on **object identity of both inputs**:
  one sequential id per `cells` FeatureCollection and one per `boundary`, via two
  `WeakMap`s, combined into the key. `computeVoronoiCells` already returns a
  stable collection reference per `(candidates, bbox)`, and `playArea.boundary`
  is stable until the play area changes, so collection-level identity is
  sufficient — **do not** reproduce `maskBuilder`'s per-feature id machinery.
  This is what makes editing question B not re-clip question A's cells.

**Edge cases (and what the util must do):**

- Empty `cells` → empty output.
- Empty/zero-polygon `boundary` → empty output (guard before clipping).
- Cell whose site lies **outside** the boundary (candidates come from the bbox,
  not the irregular boundary, so this happens) → intersection is empty → **drop
  that cell**, do not emit a degenerate feature.
- Cell partially outside → properly clipped (may split into a `MultiPolygon`).
- Cell fully inside → returned geometrically equivalent. Note: `polyclip-ts` may
  re-node, reorder rings, or shift the start vertex, so this is **not** a
  coordinate-identity guarantee (see Step 7 for how to test it).
- Boundary with holes → handled correctly by `polyclip-ts`. (This is about the
  play-area boundary polygon itself having holes — not the world-mask holes used
  by `buildPlayAreaMask`.)

### Step 2: Modify `src/features/questions/matching/matchingTypes.ts`

Add `voronoiOutlineFeatures` to `OsmMatchingRenderState` (computed locally,
where the cells live):

```ts
export type OsmMatchingRenderState = {
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    poiFeatures: FeatureCollection<
        Point,
        { isSelected: boolean; name: string; osmId: number }
    >;
    voronoiOutlineFeatures: FeatureCollection<Polygon | MultiPolygon>; // NEW
};
```

### Step 3: Modify `src/features/questions/radar/radarTypes.ts`

Add the **top-level aggregate** field to `QuestionMapRenderState`:

```ts
export type QuestionMapRenderState = {
    osmMatching: OsmMatchingRenderState;
    radar: RadarQuestionRenderState;
    radarAreaFeatures: RadarQuestionFeatureCollection;
    transitLine: { ... };
    voronoiOutlineFeatures: FeatureCollection<Polygon | MultiPolygon>;  // NEW: merged across question types
};
```

### Step 4: Modify `src/features/questions/matching/osmMatchingGeometry.ts`

1. Import `clipCellsToPlayArea`.
2. Add a `playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>` parameter
   to `buildOsmMatchingRenderState`.
3. After `computeVoronoiCells()` in the question loop, call
   `clipCellsToPlayArea(cells, playAreaBoundary)` and aggregate the resulting
   features across all matching questions.
4. Return `voronoiOutlineFeatures` in the result (empty collection for the
   early-return / no-questions path).
5. Masks and POI features unchanged.

### Step 5: Modify `src/features/questions/questionGeometry.ts`

1. Add a `playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>` parameter
   to `buildQuestionMapRenderState`.
2. Pass it to `buildOsmMatchingRenderState(questions, playAreaBbox, playAreaBoundary)`.
3. Build the top-level aggregate by concatenating each contributor's outline
   features (currently just matching; tentacles later):

    ```ts
    const osmMatching = buildOsmMatchingRenderState(
        questions,
        playAreaBbox,
        playAreaBoundary,
    );
    // ...
    return {
        osmMatching,
        // ...
        voronoiOutlineFeatures: {
            type: "FeatureCollection",
            features: [
                ...osmMatching.voronoiOutlineFeatures.features,
                // ...tentacles.voronoiOutlineFeatures.features  (future)
            ],
        },
    };
    ```

4. Update `useQuestionMapRenderState`: pass `playArea.boundary` and add it to the
   `useMemo` deps.

### Step 6: Create `src/features/map/VoronoiOutlineLayers.tsx`

**New file.** Generic map layer component with no matching/tentacles-specific
dependencies, modeled on the existing radar outline layer in
`RadarQuestionLayers.tsx`.

```tsx
type VoronoiOutlineLayersProps = {
    voronoiOutlineFeatures: FeatureCollection<Polygon | MultiPolygon>;
    visible: boolean;
};
```

Renders an `MLShapeSource` (id: `"voronoi-outlines"` — safe as a fixed literal
because there is exactly one instance) with an `MLLineLayer` child:

- Start from `lineColor: "#666666"`, `lineOpacity: 0.25`, `lineWidth: 1`, but
  treat these as **provisional** — the radar outline uses opacity `0.8` /
  width `2`, and `0.25`/`1` over the dimmed inside mask (`fillOpacity 0.35`,
  `#07111f`) may be too faint to read. Validate and likely bump during the
  on-device manual check.
- Uses the same "always render ShapeSource, swap to empty when `!visible`"
  pattern as `OsmMatchingLayers` (prevents MapLibre source re-registration
  failures during gestures).

### Step 7: Modify `src/features/map/NativeMap.tsx`

1. Import `VoronoiOutlineLayers`.
2. Add a **single** instance to the layer stack **after** the mask layers and
   `OsmMatchingLayers`, fed by the top-level aggregate:
   `<VoronoiOutlineLayers voronoiOutlineFeatures={questionMapRenderState.voronoiOutlineFeatures} visible={isQuestionDetailRoute} />`.
   The reason it goes last is so outlines render **above the dark masks** (so
   they're visible); position relative to the POI dots is immaterial because
   Voronoi edges lie equidistant between sites and essentially never cross the
   dots.

### Step 8: Create `src/features/questions/__tests__/clipVoronoiCells.test.ts`

Test the clipping utility with **robust** assertions (avoid coordinate-identity
checks, which are flaky against `polyclip-ts` re-noding):

- Empty cells → empty output.
- Empty/zero-polygon boundary → empty output.
- Cell fully inside boundary → preserved: assert **area is approximately equal**,
  feature count, and that `osmKey` (and other props) survive — not exact
  coordinates.
- Cell partially outside → clipped: assert resulting area `<` original area and
  `> 0`.
- Cell whose site is fully outside the boundary → **dropped** (not present in
  output).
- Cache returns the same object ref for the same `(cells, boundary)` input refs.

### Step 9: Update existing tests

- **`osmMatchingGeometry.test.ts`**: add the `playAreaBoundary` arg to every
  `buildOsmMatchingRenderState` call (use `defaultPlayArea.boundary`), and add
  assertions for `voronoiOutlineFeatures`.
- **`questionGeometry.test.ts`**: add the `playAreaBoundary` arg to every
  `buildQuestionMapRenderState` call, and assert the top-level
  `voronoiOutlineFeatures` aggregate is populated for a candidate-based question.
- **`OsmMatchingLayers.test.tsx`**: add `voronoiOutlineFeatures: { features: [],
type: "FeatureCollection" }` to **both** literal mock states (`mockOsmMatching`
  and `emptyState`) or `pnpm typecheck` fails.
- **`NativeMap.test.tsx`**: renders the real tree (it does not mock the render
  hook), so the new `voronoi-outlines` source appears automatically. Verify it
  has no source/layer **count** assertions that the addition would break; adjust
  if needed.

### Step 10: Create `src/features/map/__tests__/VoronoiOutlineLayers.test.tsx`

Following `OsmMatchingLayers.test.tsx` patterns:

- Renders shape source with outlines when visible.
- Renders `MLLineLayer` with the expected style props.
- Keeps source mounted with empty features.
- Clears features when not visible.

## Performance

Clipping adds **O(N) polygon intersections** against the (possibly large)
boundary multipolygon, run synchronously inside the `useQuestionMapRenderState`
`useMemo`. The existing mask path does only **one** `difference` against the
boundary, so this is strictly more work; for dense categories (parks, museums,
stations across Tokyo 23 wards) the first compute on answer/selection/play-area
change can hitch a frame. Given the active map perf audit:

- **Measure first** with a realistic candidate count before optimizing.
- Already mitigated by: hoisting boundary extraction (Step 1) and the
  identity-keyed cache (re-renders and unrelated question edits are free).
- If measurement shows a problem, a cheap safe filter is to skip cells whose
  bbox does not intersect the boundary bbox (drops far-outside cells without a
  `polyclip` call). Do **not** attempt a "fully inside → skip" fast path; a
  correct containment test against an irregular boundary is not cheap.

Trade-off considered and rejected: rendering bbox-clipped outlines _below_ the
outside mask to "clip for free." The outside mask is semi-transparent
(`fillOpacity 0.58`), so overflow lines would bleed through dimmed rather than
disappear — geometry clipping gives the clean result the feature needs.

## Verification

1. `pnpm test` — all existing tests pass with updated mock states.
2. `pnpm typecheck` — no new type errors.
3. Manual: launch app with a matching POI question, verify faint gray polygon
   outlines around candidate dots, clipped to the play area boundary; confirm the
   chosen `lineOpacity`/`lineWidth` are actually legible over the inside mask.
4. Manual: switch to a non-candidate question (e.g. radar) → outlines disappear.
5. Manual/perf: on a dense category, confirm answering/selecting does not cause a
   visible hitch.

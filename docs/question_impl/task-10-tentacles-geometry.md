# Task 10: Tentacles Geometry

**Depends on**: Task 01
**Audience**: senior / careful. Two-stage clipping + Voronoi; reuse the existing
clipper rather than hand-writing polyclip.

## What it computes

Tentacles constrains the hider to the **Voronoi cell of the named POI, clipped to
the seeker's radius circle** (and the play area). Same Voronoi mechanism as
Matching, but only over POIs inside the radius.

## Key reuse insight (don't hand-write polyclip)

`clipCellsToPlayArea(cells, boundary)` (`clipVoronoiCells.ts`) clips a
`FeatureCollection<Polygon>` to **any** `FeatureCollection<Polygon | MultiPolygon>`
boundary, with bbox pre-filtering and LRU caching. A `@turf/circle` result is a
64-gon `Polygon`, i.e. a perfectly valid boundary. **Clip to the radius circle by
passing the circle (wrapped in a one-feature FeatureCollection) as the
`boundary`.** No new polyclip code, no new helper for the happy path.

> If you need to clip an already-`Polygon | MultiPolygon` collection again (e.g.
> radius ∩ play-area for outlines), generalize `clipCellsToPlayArea`'s input
> generic to accept `Polygon | MultiPolygon` cells, or add a thin
> `clipCellsToBoundary`. Keep `osmKey`/properties flowing through (the function's
> `<P>` generic already preserves them).

## How Matching orders things (mirror it)

In `osmMatchingGeometry.ts`, masks are built from the **raw** Voronoi `cells`
(not the play-area-clipped ones); only the **outlines** are clipped to the play
area. The downstream `combinedInsideMask` applies the play-area constraint to the
masks. Tentacles differs in one way: the **radius** constraint is *essential* (the
hider must be within the radius), so Tentacles masks must be built from cells
**clipped to the radius circle**.

## Algorithm (per Tentacles question)

```typescript
import { circle } from "@turf/circle";
import { point } from "@turf/helpers";
import { haversineDistanceMeters } from "@/shared/geojson";
import { computeVoronoiCells, makeOsmKey } from "@/features/questions/matching/matchingVoronoi";
import { clipCellsToPlayArea } from "@/features/questions/clipVoronoiCells";
```

1. `radiusCircle = circle(q.center, q.distanceMeters / 1000, { units: "kilometers" })`.
2. **Filter candidates to within `distanceMeters`** of `q.center` using
   `haversineDistanceMeters`. POIs outside the radius are excluded from the
   Voronoi entirely (tighter cells; they'd be clipped away anyway).
3. `cells = computeVoronoiCells(filtered, playAreaBbox)` — same as Matching.
   (Remember `@turf/voronoi` may emit `undefined` entries; `computeVoronoiCells`
   already filters them — do not iterate raw voronoi output.)
4. `clippedToRadius = clipCellsToPlayArea(cells, { type: "FeatureCollection", features: [radiusCircle] })`.
   This enforces the radius constraint and preserves each cell's `osmKey`.
5. **Outlines** (always shown): clip `cells` to the play area for rendering, and
   intersect with the radius visually via the `radiusOutlineFeature`. Push the
   clipped cell features into `voronoiOutlineFeatures`.
6. **Answered** (`answer === "positive"` and `selectedOsmId !== null`):
   - `selectedKey = makeOsmKey(q.selectedOsmType, q.selectedOsmId)`
   - `hitMaskFeatures` = `clippedToRadius.features.filter(f => f.properties.osmKey === selectedKey)`
   - `missMaskFeatures` = `clippedToRadius.features.filter(f => f.properties.osmKey !== selectedKey)`
   (A direct `osmKey` filter is correct and avoids needing
   `buildOsmMatchingHitMask`, whose `FeatureCollection<Polygon>`-only signature
   doesn't accept the `Polygon | MultiPolygon` clipped cells.)
7. `poiFeatures` from the **filtered** candidates (in-radius only), each with
   `{ isSelected, name, osmId }` like Matching.
8. `radiusOutlineFeature = radiusCircle`.

Unanswered: no hit/miss; populate `voronoiOutlineFeatures`, `poiFeatures`,
`radiusOutlineFeature`.

LRU-cache the per-question result keyed on
`(center, distanceMeters, candidate identity, selectedKey, boundary identity)`.

## Files to Create

### `src/features/questions/tentacles/tentaclesCategories.ts`

```typescript
export type TentaclesCategoryConfig = {
    category: TentaclesCategory;
    distanceOption: TentaclesDistanceOption;
    osmQueryTags: string;
    title: string;
};

export const tentaclesCategoryConfigs: TentaclesCategoryConfig[] = [
    { category: "museum",        distanceOption: "2km",  osmQueryTags: deriveOsmQueryTags("museum"),        title: "Museum" },
    { category: "library",       distanceOption: "2km",  osmQueryTags: deriveOsmQueryTags("library"),       title: "Library" },
    { category: "movie-theater", distanceOption: "2km",  osmQueryTags: deriveOsmQueryTags("movie-theater"), title: "Movie Theater" },
    { category: "hospital",      distanceOption: "2km",  osmQueryTags: deriveOsmQueryTags("hospital"),      title: "Hospital" },
    { category: "transit-line",  distanceOption: "25km", osmQueryTags: "",                                   title: "Metro Line" },
    { category: "zoo",           distanceOption: "25km", osmQueryTags: deriveOsmQueryTags("zoo"),            title: "Zoo" },
    { category: "aquarium",      distanceOption: "25km", osmQueryTags: deriveOsmQueryTags("aquarium"),       title: "Aquarium" },
    { category: "amusement-park",distanceOption: "25km", osmQueryTags: deriveOsmQueryTags("amusement-park"), title: "Amusement Park" },
];

export function getTentaclesCategoryConfig(category: TentaclesCategory) {
    return tentaclesCategoryConfigs.find((c) => c.category === category);
}
```

No new OSM selectors and **no `pnpm data:poi` run** are required — all categories
reuse existing matching tags. `transit-line` uses station points (see Task 11),
not route-line geometry; the Voronoi is over station points.

### `src/features/questions/tentacles/tentaclesGeometry.ts`

```typescript
export function buildTentaclesRenderState(
    questions: QuestionState[],
    playAreaBbox: Bbox,
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): TentaclesRenderState
```

Implements the algorithm above.

## Files to Modify

### `src/features/questions/questionGeometry.ts`

```diff
-import { EMPTY_TENTACLES_RENDER_STATE } from "./tentacles/tentaclesTypes";
+import { buildTentaclesRenderState } from "./tentacles/tentaclesGeometry";
...
-    tentacles: EMPTY_TENTACLES_RENDER_STATE,
+    const tentacles = buildTentaclesRenderState(questions, playAreaBbox, playAreaBoundary);
     return {
         ...
+        tentacles,
         voronoiOutlineFeatures: {
             type: "FeatureCollection",
             features: [
                 ...osmMatching.voronoiOutlineFeatures.features,
+                ...tentacles.voronoiOutlineFeatures.features,
             ],
         },
     };
```

Both `playAreaBbox` and `playAreaBoundary` are already parameters.

## Test plan (write first)

`src/features/questions/tentacles/__tests__/tentaclesGeometry.test.ts`

- **Answered**: the selected POI's radius-clipped Voronoi cell is in
  `hitMaskFeatures`; the remaining in-radius cells are in `missMaskFeatures`.
- **Hit cell is within the radius**: assert no `hitMaskFeatures` vertex lies
  outside the radius circle (sample a point known to be outside the radius but
  inside the unclipped cell, and assert it's not covered).
- **Unanswered**: no hit/miss; `voronoiOutlineFeatures` + `radiusOutlineFeature`
  populated.
- **POI outside radius**: excluded from the Voronoi and from `poiFeatures`.
- **Empty candidates**: empty render state returned gracefully.
- **`radiusOutlineFeature`** is centered on `q.center` with
  `q.distanceMeters / 1000` km radius.
- **Caching**: identical inputs reuse the cached result.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test` pass
- Selected POI's clipped cell highlighted; other in-radius cells darkened
- Cells are correctly clipped to the radius circle (no overflow)
- `transit-line` works over station points
- No regressions to Radar / Matching / Measuring

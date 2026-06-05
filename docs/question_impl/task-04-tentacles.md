# Task 04: Tentacles Question

**Depends on**: Task 01

Implement the Tentacles question end-to-end: Voronoi-in-radius geometry, radius circle overlay, and detail screen.

## Background

The Tentacles question asks: "Of all the ___ within ___ of me, which are you closest to? You must also be within ___."

The seeker:
1. Pins their position on the map.
2. Picks a category. The search radius is determined by the category (2 km or 25 km).
3. Finds all POIs of that category within the radius.
4. Asks the hider which of those POIs the hider is closest to.
5. The hider must also be within the same radius of the seeker.

The resulting constraint is: the hider is in the **Voronoi cell of the named POI, clipped to the seeker's radius circle**.

This is the same Voronoi mechanism as Matching, but restricted to POIs inside a circle. Two stages of clipping: (1) clip each Voronoi cell to the seeker's radius circle, (2) clip the result to the play-area boundary.

## Categories

All 8 categories reuse existing matching infrastructure:

| Category key | Distance group | Matching selector |
|---|---|---|
| `museum` | 2 km | `deriveOsmQueryTags("museum")` |
| `library` | 2 km | `deriveOsmQueryTags("library")` |
| `movie-theater` | 2 km | `deriveOsmQueryTags("movie-theater")` |
| `hospital` | 2 km | `deriveOsmQueryTags("hospital")` |
| `transit-line` | 25 km | station points (same as matching transit-line) |
| `zoo` | 25 km | `deriveOsmQueryTags("zoo")` |
| `aquarium` | 25 km | `deriveOsmQueryTags("aquarium")` |
| `amusement-park` | 25 km | `deriveOsmQueryTags("amusement-park")` |

No new OSM selectors are needed. No `pnpm data:poi` run required for this task.

**`transit-line` note:** Use station point locations (same as matching's transit-line path) filtered to the seeker's radius. No route-line geometry needed; the Voronoi is over station points.

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
    // 2 km group
    { category: "museum",        distanceOption: "2km",  osmQueryTags: deriveOsmQueryTags("museum"),        title: "Museum" },
    { category: "library",       distanceOption: "2km",  osmQueryTags: deriveOsmQueryTags("library"),       title: "Library" },
    { category: "movie-theater", distanceOption: "2km",  osmQueryTags: deriveOsmQueryTags("movie-theater"), title: "Movie Theater" },
    { category: "hospital",      distanceOption: "2km",  osmQueryTags: deriveOsmQueryTags("hospital"),      title: "Hospital" },
    // 25 km group
    { category: "transit-line",  distanceOption: "25km", osmQueryTags: "",                                   title: "Metro Line" },
    { category: "zoo",           distanceOption: "25km", osmQueryTags: deriveOsmQueryTags("zoo"),            title: "Zoo" },
    { category: "aquarium",      distanceOption: "25km", osmQueryTags: deriveOsmQueryTags("aquarium"),       title: "Aquarium" },
    { category: "amusement-park",distanceOption: "25km", osmQueryTags: deriveOsmQueryTags("amusement-park"), title: "Amusement Park" },
];

export function getTentaclesCategoryConfig(
    category: TentaclesCategory,
): TentaclesCategoryConfig | undefined {
    return tentaclesCategoryConfigs.find(c => c.category === category);
}
```

### `src/features/questions/tentacles/tentaclesGeometry.ts`

```typescript
import { circle } from "@turf/circle";
import { point } from "@turf/helpers";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { Bbox } from "@/shared/geojson";
import type { QuestionState } from "@/features/questions/questionTypes";
import {
    computeVoronoiCells,
    buildOsmMatchingHitMask,
    makeOsmKey,
} from "@/features/questions/matching/matchingVoronoi";
import { clipCellsToPlayArea } from "@/features/questions/clipVoronoiCells";
import type { TentaclesRenderState } from "./tentaclesTypes";

export function buildTentaclesRenderState(
    questions: QuestionState[],
    playAreaBbox: Bbox,
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): TentaclesRenderState { ... }
```

**Algorithm for each Tentacles question:**

1. `const radiusCircle = circle(q.center, q.distanceMeters / 1000, { units: "kilometers" })`
2. `const cells = computeVoronoiCells(q.candidates, playAreaBbox)` — same as Matching
3. For each Voronoi cell, clip to `radiusCircle` via `polyclip-ts` (intersection)
4. For each clipped cell, clip to `playAreaBoundary` via `clipCellsToPlayArea`
5. Collect outline features (always shown as cell borders)
6. If `q.answer === "positive"` and `q.selectedOsmId !== null`:
   - `selectedKey = makeOsmKey(q.selectedOsmType, q.selectedOsmId)`
   - `hitMask = buildOsmMatchingHitMask(clippedCells, selectedKey)` → `hitMaskFeatures`
   - All other clipped cells → `missMaskFeatures`
7. Build `poiFeatures` from `q.candidates` filtered to those within `distanceMeters` of `q.center`
8. `radiusOutlineFeature = radiusCircle`

**Candidate filtering:** Only POIs within `distanceMeters` of `center` should appear. Filter `q.candidates` using `@turf/distance` before building the Voronoi. POIs outside the radius should be excluded from the Voronoi computation entirely — their cells would extend beyond the radius circle anyway and be clipped away, but excluding them up front keeps the Voronoi tighter.

### `src/features/questions/tentacles/useTentaclesSearch.ts`

```typescript
export function useTentaclesSearch(
    center: Position,
    category: TentaclesCategory,
    distanceMeters: number,
): { candidates: OsmFeature[]; isLoading: boolean; error: string | null }
```

Delegates to the existing `findMatchingFeaturesWithIndex` / `useMatchingSearch` infrastructure with the appropriate OSM tags for the given Tentacles category. Filters results to within `distanceMeters` of `center` using `@turf/distance` before returning.

For `transit-line`, use the same station-lookup path as `TransitLineQuestionDetailScreen`.

### `src/features/questions/tentacles/TentaclesQuestionDetailScreen.tsx`

See UX section below.

### `src/features/questions/tentacles/__tests__/tentaclesGeometry.test.ts`

Test cases:
- Answered question: selected POI's clipped Voronoi cell is in `hitMaskFeatures`; remaining cells are in `missMaskFeatures`.
- Unanswered question: no hit/miss features; `voronoiOutlineFeatures` and `radiusOutlineFeature` are populated.
- POI outside radius: excluded from Voronoi computation; not in `poiFeatures`.
- Empty candidates: empty render state returned gracefully.
- `radiusOutlineFeature` is centered on `q.center` with `q.distanceMeters / 1000` km radius.

## Files to Modify

### `src/features/questions/questionGeometry.ts`

Replace the `EMPTY_TENTACLES_RENDER_STATE` stub. Tentacles needs `playAreaBbox` and `playAreaBoundary`, both already available:

```diff
-import { EMPTY_TENTACLES_RENDER_STATE } from "./tentacles/tentaclesTypes";
+import { buildTentaclesRenderState } from "./tentacles/tentaclesGeometry";

-    tentacles: EMPTY_TENTACLES_RENDER_STATE,
+    const tentacles = buildTentaclesRenderState(questions, playAreaBbox, playAreaBoundary);
     ...
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

### `src/features/map/NativeMap.tsx`

Add a `TentaclesRadiusLayer` component that renders `tentacles.radiusOutlineFeature` as a dashed `LineLayer`:

```typescript
// Style: dashed outline, color distinct from radar fill, width 2
// lineDasharray: [4, 2]
// color: e.g., #FF8C00 (orange) — distinct from radar blue/red
```

The layer is visible when the active route is `question-detail`. When `radiusOutlineFeature` is null (no Tentacles question with a center set), the source is empty and nothing renders.

The `TentaclesRadiusLayer` should appear between the Voronoi outline layer and the POI marker layer in the MapLibre layer stack. Follow the existing conservative layer ordering (shapes before markers).

## Detail Screen UX

```
┌──────────────────────────────────────┐
│  Category                            │
│  2 km                                │
│  ┌─────────────────────────────────┐ │
│  │   ● Museum       ← selected     │ │
│  │   ○ Library                     │ │
│  │   ○ Movie Theater               │ │
│  │   ○ Hospital                    │ │
│  └─────────────────────────────────┘ │
│  25 km                               │
│  ┌─────────────────────────────────┐ │
│  │   ○ Metro Line                  │ │
│  │   ○ Zoo                         │ │
│  │   ○ Aquarium                    │ │
│  │   ○ Amusement Park              │ │
│  └─────────────────────────────────┘ │
│                                      │
│  My Position  [Use GPS]  [Drag pin]  │
│  35.6762° N, 139.6503° E             │
│  Searching within 2 km               │
│                                      │
│  Nearest Museums (within 2 km)       │
│  ┌─────────────────────────────────┐ │
│  │   ○ Tokyo National Museum  0.8km│ │
│  │   ★ Edo-Tokyo Museum       1.1km│ │  ← which POI hider named
│  │   ○ Mori Art Museum        1.6km│ │
│  └─────────────────────────────────┘ │
│                                      │
│  Hider is closest to:                │
│  Edo-Tokyo Museum  ✓                 │
│                           [ Reset ]  │
└──────────────────────────────────────┘
```

**Behavior details:**

- **Category picker**: two sections ("2 km" / "25 km"). Selecting a category automatically sets `distanceOption` and `distanceMeters` (no separate distance toggle).
- **Position pin**: `QuestionLocationSelector` (same as Radar). Moving the pin re-runs the POI search filtered to the new radius.
- **Radius indicator**: subtitle under position shows "Searching within 2 km" (or 25 km). On the map, `TentaclesRadiusLayer` renders the dashed circle.
- **Candidate list**: POIs within the radius, sorted by distance from `center`. Only these POIs participate in the Voronoi; the map shows their cells as outlines.
- **Selection**: tapping a candidate records `selectedOsmId` / `selectedOsmType` and sets `answer = "positive"`. Unlike Matching, there is no Closer/Farther toggle — the question is answered by naming the POI.
- **Reset**: clears selection and sets `answer = "unanswered"`.

## Acceptance Criteria

- `pnpm typecheck` and `pnpm test` pass
- Creating a Tentacles question and selecting a category/POI shows the radius circle and Voronoi outlines on the map
- Selecting a POI shows its Voronoi cell (clipped to the radius) highlighted; other cells darkened
- The dashed radius circle appears on the map at the seeker's position
- Moving the pin updates the candidate list and the map
- `transit-line` category works using station points
- No regressions to Radar, Matching, or Measuring

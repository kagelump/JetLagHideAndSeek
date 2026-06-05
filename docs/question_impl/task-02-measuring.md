# Task 02: Measuring Question

**Depends on**: Task 01

Implement the Measuring question end-to-end: 13 point-based categories, draggable seeker-position pin, auto-computed distance to selected POI, circle overlay on the map.

## Background

The Measuring question asks: "Compared to me, are you closer to or farther from ___?"

The seeker:
1. Pins their own position on the map.
2. The app finds nearby POIs of the selected category and ranks them by distance from the pin.
3. The seeker identifies which POI is their nearest (the one closest to their pin).
4. The seeker asks the hider whether the hider is closer or farther to that same POI.
5. The app draws a circle centered on the target POI with radius = seeker's computed distance. If the answer is "Closer" the hider is inside the circle; if "Farther" they are outside.

The seeker's position (`center`) is the search anchor; the **circle center is the target POI's position** (not `center`). This is the key geometric difference from Radar, where the circle is also centered on `center`.

## Categories

### Implemented in this task (13)

| Category key | Section | OSM selector source |
|---|---|---|
| `commercial-airport` | Transit | reuse `deriveOsmQueryTags("commercial-airport")` |
| `rail-station` | Transit | **new** – `["railway"="station"]` |
| `mountain` | Natural | reuse `deriveOsmQueryTags("mountain")` |
| `park` | Natural | reuse `deriveOsmQueryTags("park")` |
| `amusement-park` | Places of Interest | reuse |
| `zoo` | Places of Interest | reuse |
| `aquarium` | Places of Interest | reuse |
| `golf-course` | Places of Interest | reuse |
| `museum` | Places of Interest | reuse |
| `movie-theater` | Places of Interest | reuse |
| `hospital` | Public Utilities | reuse |
| `library` | Public Utilities | reuse |
| `foreign-consulate` | Public Utilities | reuse |

### Deferred (5) — see task-05

`high-speed-rail`, `coastline`, `body-of-water`, `admin-1st-border`, `admin-2nd-border`

These appear in `MeasuringCategory` and `measuringCategories` but are marked `implemented: false` in their category config and filtered out of the detail screen's picker.

## Files to Create

### `src/features/questions/measuring/measuringCategories.ts`

Model after `matchingCategories.ts`. Each entry has `{ category, section, title, implemented, osmQueryTags }`. For the 12 categories that overlap with Matching, call `deriveOsmQueryTags(matchingKey)`. For `rail-station`, call `deriveOsmQueryTags("rail-station")` after adding that key to `matchingSelectors.ts`.

```typescript
export type MeasuringCategorySection =
    | "Transit"
    | "Border"
    | "Natural"
    | "Places of Interest"
    | "Public Utilities";

export type MeasuringCategoryConfig = {
    category: MeasuringCategory;
    implemented: boolean;
    osmQueryTags: string;
    section: MeasuringCategorySection;
    title: string;
};

export const measuringCategories: MeasuringCategoryConfig[] = [ ... ];
```

The exported list keeps all 18 entries. The detail screen filters with `.filter(c => c.implemented)`.

### `src/features/questions/measuring/measuringGeometry.ts`

```typescript
import { circle } from "@turf/circle";
import { distance } from "@turf/distance";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { QuestionState } from "@/features/questions/questionTypes";
import type { MeasuringRenderState } from "./measuringTypes";

export function buildMeasuringRenderState(
    questions: QuestionState[],
): MeasuringRenderState {
    const measuringQuestions = questions.filter(
        (q): q is Extract<QuestionState, { type: "measuring" }> =>
            q.type === "measuring" &&
            q.selectedOsmId !== null &&
            q.seekerDistanceMeters !== null &&
            q.seekerDistanceMeters > 0,
    );

    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const missFeatures: Feature<Polygon | MultiPolygon>[] = [];

    for (const q of measuringQuestions) {
        const target = q.candidates.find(
            c => c.osmId === q.selectedOsmId && c.osmType === q.selectedOsmType,
        );
        if (!target) continue;

        const radiusKm = q.seekerDistanceMeters / 1000;
        const circ = circle([target.lon, target.lat], radiusKm, { units: "kilometers" });

        if (q.answer === "positive") {
            hitFeatures.push(circ);   // closer → hider inside circle → darken outside
        } else if (q.answer === "negative") {
            missFeatures.push(circ);  // farther → hider outside circle → darken inside
        }
    }

    return {
        hitMaskFeatures: { features: hitFeatures, type: "FeatureCollection" },
        missMaskFeatures: { features: missFeatures, type: "FeatureCollection" },
    };
}
```

Use LRU caching (same pattern as `radarGeometry.ts`) keyed on `(osmId, osmType, seekerDistanceMeters)` to avoid rebuilding circles on every render.

### `src/features/questions/measuring/useMeasuringSearch.ts`

A thin wrapper that accepts `(center: Position, category: MeasuringCategory)` and delegates to the existing `useMatchingSearch` or `findMatchingFeaturesWithIndex` infrastructure. The category is mapped to an OSM selector via `measuringCategories`. Returns `{ candidates, isLoading, error }`.

### `src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx`

See UX section below.

### `src/features/questions/measuring/__tests__/measuringGeometry.test.ts`

Test cases:
- Closer answer: circle at target POI position with seeker's distance as radius; feature is in `hitMaskFeatures`.
- Farther answer: same circle in `missMaskFeatures`.
- Unanswered question: neither hit nor miss mask features.
- Missing selection (selectedOsmId null): question skipped.
- Circle center is the target POI's position, not the seeker's `center`.

## Files to Modify

### `src/features/questions/matching/matchingSelectors.ts`

Add a `rail-station` entry to `CATEGORY_SELECTORS`:

```typescript
"rail-station": {
    osmTags: `["railway"="station"]`,
    // ... other fields matching existing pattern
},
```

After this change, run:
```bash
pnpm data:poi
git add assets/poi data/geofabrik/poi-selectors.json
```

Commit the regenerated artifacts. `pnpm check` must pass (registry drift guard).

### `src/features/questions/questionGeometry.ts`

Replace the `EMPTY_MEASURING_RENDER_STATE` stub:

```diff
-import { EMPTY_MEASURING_RENDER_STATE } from "./measuring/measuringTypes";
+import { buildMeasuringRenderState } from "./measuring/measuringGeometry";

 export function buildQuestionMapRenderState(...): QuestionMapRenderState {
-    measuring: EMPTY_MEASURING_RENDER_STATE,
+    measuring: buildMeasuringRenderState(questions),
```

## Detail Screen UX

```
┌──────────────────────────────────────┐
│  Category                            │
│  ┌─────────────────────────────────┐ │
│  │ Transit                         │ │
│  │   ○ Airport                     │ │
│  │   ● Rail Station   ← selected   │ │
│  │ Natural                         │ │
│  │   ○ Mountain                    │ │
│  │   ...                           │ │
│  └─────────────────────────────────┘ │
│                                      │
│  My Position  [Use GPS]  [Drag pin]  │
│  35.6762° N, 139.6503° E             │
│                                      │
│  Nearest Rail Stations               │
│  ┌─────────────────────────────────┐ │
│  │ ★ Shinjuku Station   1.2 km     │ │  ← selected target
│  │   Shibuya Station    2.1 km     │ │
│  │   Harajuku Station   2.8 km     │ │
│  └─────────────────────────────────┘ │
│                                      │
│  My distance to Shinjuku: 1.2 km     │
│  [m]  [km]  [mi]                     │
│                                      │
│  Answer                              │
│  [ Closer ]  [ Farther ]  [ Reset ]  │
└──────────────────────────────────────┘
```

**Behavior details:**

- **Category picker**: sectioned list. Deferred categories (5) are hidden. Same visual style as matching category picker.
- **Position pin**: `QuestionLocationSelector` component (same as Radar/Matching). Defaults to current GPS on question creation; draggable. Moving the pin re-runs the POI search and recomputes distances. Updates `MeasuringQuestion.center`.
- **Candidate list**: POIs returned from the search, sorted ascending by distance from `center`. Shows name and distance. Tapping a candidate sets `selectedOsmId` / `selectedOsmType` and auto-computes `seekerDistanceMeters = distance(center, [candidate.lon, candidate.lat])`.
- **Distance display**: read-only, derived from `seekerDistanceMeters` converted to the selected unit. Unit toggle (`m` / `km` / `mi`) updates `seekerDistanceUnit` and reformats the display; it does **not** change the stored meters value.
- **Answer selector**: `QuestionAnswerSelector` with "Closer" / "Farther". Disabled until a POI is selected.

## Acceptance Criteria

- `pnpm typecheck` and `pnpm test` pass
- `pnpm check` passes (registry drift guard catches any selector mismatch)
- Creating a Measuring question and selecting a category/POI shows the correct circle on the map
- "Closer" answer darkens outside the circle; "Farther" darkens inside
- Moving the pin updates the candidate list and the distance display
- Rail Station POIs appear in the candidate list (bundled POI data refreshed)
- No regressions to Radar or Matching

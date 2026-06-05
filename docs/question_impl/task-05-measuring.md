# Task 05: Measuring Question (point categories)

**Depends on**: Task 01, Task 02
**Audience**: intern-friendly (mirrors Matching), provided the corrected search
contract and distance helper below are followed.

Implement the Measuring question end-to-end for the **13 point-based
categories**: draggable seeker-position pin, auto-computed distance to the
selected POI, and a circle overlay centered on that POI. The 5 line/polygon
categories are Task 06; this task hides them.

## Background & product intent

Measuring is a **planning tool**. The seeker compares their own nearest POI to
the hider's nearest POI of the same category. Intended phrasing, surfaced in the
UI:

> "I'm **1.2 km** from my nearest **movie theater**. Are you closer or farther
> from yours?"

Flow:

1. Seeker pins their position (`center`, the search anchor).
2. App finds nearby POIs of the chosen category, ranked by distance from the pin.
3. Seeker selects their nearest POI (the target).
4. App auto-computes `seekerDistanceMeters = haversine(center, target)`.
5. Seeker asks the hider closer/farther; on answer, the app draws a circle
   **centered on the target POI** (not on `center`) with that radius. "Closer" ⇒
   hider inside; "Farther" ⇒ hider outside.

The key geometric difference from Radar: the circle center is the **target POI**,
not the seeker's pin.

## Categories

### Implemented here (13)

| Category key | Section | OSM selector source |
|---|---|---|
| `commercial-airport` | Transit | `deriveOsmQueryTags("commercial-airport")` |
| `rail-station` | Transit | **new selector** — needs Task 07 (or live Overpass) |
| `mountain` | Natural | `deriveOsmQueryTags("mountain")` |
| `park` | Natural | `deriveOsmQueryTags("park")` |
| `amusement-park` | Places of Interest | reuse |
| `zoo` | Places of Interest | reuse |
| `aquarium` | Places of Interest | reuse |
| `golf-course` | Places of Interest | reuse |
| `museum` | Places of Interest | reuse |
| `movie-theater` | Places of Interest | reuse |
| `hospital` | Public Utilities | reuse |
| `library` | Public Utilities | reuse |
| `foreign-consulate` | Public Utilities | reuse |

### Hidden here (5) — Task 06

`high-speed-rail`, `coastline`, `body-of-water`, `admin-1st-border`,
`admin-2nd-border`. They stay in `MeasuringCategory` and `measuringCategories`
but are `implemented: false` and filtered out of the picker.

### `rail-station` data dependency

`rail-station` needs a new OSM selector + regenerated bundle (Task 07). `pnpm
data:poi` requires the ~450 MB Geofabrik PBF, which CI and most sandboxed agents
cannot run (see `AGENTS.md`). **Do not block this task on it.** Options:

- Land Task 07 first (someone with the PBF regenerates and commits the bundle).
- Or ship `rail-station` for v1 via the **live Overpass fallback path** (no
  bundle): `findMatchingFeaturesWithIndex` already falls back to Overpass for
  non-bundleable categories. Mark `rail-station` non-bundleable until Task 07
  lands. Either way, the other 12 categories work immediately.

## Test plan (write first)

### `src/features/questions/measuring/__tests__/measuringGeometry.test.ts` (new)

Build questions with hand-placed `center`, `candidates`, `selectedOsm*`,
`seekerDistanceMeters`, `answer`:

- **Closer**: a circle centered at the **target POI** position with radius
  `seekerDistanceMeters` appears in `hitMaskFeatures`; `missMaskFeatures` empty.
- **Farther**: the same circle appears in `missMaskFeatures`; `hitMaskFeatures`
  empty.
- **Circle center assertion**: the circle's center is the target POI's
  `[lon, lat]`, **not** the seeker's `center`. (Place them clearly apart and
  assert the centroid.)
- **Unanswered**: neither hit nor miss features.
- **Missing selection** (`selectedOsmId === null`): question skipped.
- **Zero/negative distance**: question skipped (guard
  `seekerDistanceMeters > 0`).
- **Caching**: building twice with identical inputs returns referentially-cached
  circles (assert the LRU behavior like `radarGeometry` tests do).

### `src/features/questions/measuring/__tests__/measuringCategories.test.ts` (new)

- `measuringCategories` has all 18 entries.
- Exactly 13 have `implemented: true`; the 5 line/polygon categories are
  `implemented: false`.
- Each implemented category resolves to a non-empty `osmQueryTags`.

### Detail screen test — `__tests__/MeasuringQuestionDetailScreen.test.tsx` (new)

Mirror `OsmMatchingQuestionDetailScreen.test.tsx` (search is mocked in
`jest.setup.ts`). Assert:

- Selecting a candidate sets `selectedOsmId/Type` and computes
  `seekerDistanceMeters` via the haversine helper.
- The unit toggle reformats the displayed distance without changing the stored
  meters.
- The answer selector is disabled until a POI is selected.
- The helper phrasing line renders the selected category and distance.

## Implementation

### `src/features/questions/measuring/measuringCategories.ts` (new)

```typescript
export type MeasuringCategorySection =
    | "Transit" | "Border" | "Natural"
    | "Places of Interest" | "Public Utilities";

export type MeasuringCategoryConfig = {
    category: MeasuringCategory;
    implemented: boolean;
    osmQueryTags: string;
    section: MeasuringCategorySection;
    title: string;
};

export const measuringCategories: MeasuringCategoryConfig[] = [ /* 18 entries */ ];
```

For the 12 categories shared with Matching, call `deriveOsmQueryTags(matchingKey)`.
For `rail-station`, call `deriveOsmQueryTags("rail-station")` once Task 07 adds
that key to `matchingSelectors.ts` (or supply the literal `["railway"="station"]`
tag and route through Overpass until then). The exported list keeps all 18; the
detail screen filters with `.filter(c => c.implemented)`.

### `src/features/questions/measuring/measuringGeometry.ts` (new)

```typescript
import { circle } from "@turf/circle";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { haversineDistanceMeters } from "@/shared/geojson";
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
            (c) => c.osmId === q.selectedOsmId && c.osmType === q.selectedOsmType,
        );
        if (!target) continue;

        const radiusKm = q.seekerDistanceMeters / 1000;
        // circle CENTER is the target POI, not q.center.
        const circ = circle([target.lon, target.lat], radiusKm, { units: "kilometers" });

        if (q.answer === "positive") hitFeatures.push(circ);   // closer → inside
        else if (q.answer === "negative") missFeatures.push(circ); // farther → outside
    }

    return {
        hitMaskFeatures: { features: hitFeatures, type: "FeatureCollection" },
        missMaskFeatures: { features: missFeatures, type: "FeatureCollection" },
    };
}
```

Add an LRU circle cache keyed on `(osmId, osmType, seekerDistanceMeters)` using
the `Map`-insertion-order pattern from `radarGeometry.ts`.

> Distance: use `haversineDistanceMeters(lat1, lon1, lat2, lon2)` everywhere.
> `@turf/distance` is **not** installed.

### `src/features/questions/measuring/useMeasuringSearch.ts` (new)

Follow the **real** `useMatchingSearch` contract (see epic "Search contract"):
accept `(category: MeasuringCategory, center: Position)`, map the category to its
matching selector/tags, and return `{ isLoading, error, performSearch }`. It does
**not** return `candidates` — the detail screen calls `performSearch()` and
writes results back via `updateQuestion`. For categories that exist in
`MatchingCategory`, delegate directly; for `rail-station`, pass the appropriate
tags/non-bundleable flag.

### `src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx` (new)

See the UX section. Reuse `QuestionLocationSelector` (coordinate summary +
"Set to My Location"); the actual pin drag is handled by the map via
`updateQuestionCenter` (already widened in Task 01). On candidate selection,
compute and store `seekerDistanceMeters` with the haversine helper.

### `src/features/questions/questionGeometry.ts` (modify)

```diff
-import { EMPTY_MEASURING_RENDER_STATE } from "./measuring/measuringTypes";
+import { buildMeasuringRenderState } from "./measuring/measuringGeometry";
...
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
│  │ Natural ...                     │ │
│  └─────────────────────────────────┘ │
│  My Position  [Set to My Location]   │
│  35.67620, 139.65030   (drag pin)    │
│                                      │
│  Nearest Rail Stations               │
│  ┌─────────────────────────────────┐ │
│  │ ★ Shinjuku Station   1.2 km     │ │  ← selected target
│  │   Shibuya Station    2.1 km     │ │
│  │   Harajuku Station   2.8 km     │ │
│  └─────────────────────────────────┘ │
│                                      │
│  "I'm 1.2 km from my nearest rail    │
│   station. Are you closer or farther │
│   from yours?"                       │
│  [m]  [km]  [mi]                     │
│                                      │
│  Answer  [ Closer ] [ Farther ] [Reset]│
└──────────────────────────────────────┘
```

- **Category picker**: sectioned list, deferred categories hidden, same visual
  style as the matching picker.
- **Position pin**: defaults to GPS on creation; draggable. Moving it re-runs the
  search and recomputes distances (invalidate candidates on center change, same
  pattern as `OsmMatchingQuestionDetailScreen`).
- **Candidate list**: search results sorted ascending by distance from `center`.
  Tapping sets `selectedOsmId/Type` and auto-computes `seekerDistanceMeters`.
- **Planning phrasing line**: render the exact "I'm X from my nearest Y…"
  sentence using the selected category title and converted distance.
- **Distance unit toggle** (`m`/`km`/`mi`): updates `seekerDistanceUnit` and the
  displayed value only; never mutates stored meters.
- **Answer selector**: `QuestionAnswerSelector` "Closer"/"Farther"; disabled
  until a POI is selected.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test`, `pnpm check` pass
- Creating a Measuring question, picking a category + POI, draws a circle
  centered on the **target POI**
- "Closer" darkens outside the circle; "Farther" darkens inside
- Moving the pin updates the candidate list and distance
- The 12 reuse categories work immediately; `rail-station` works via Task 07
  bundle or the live Overpass fallback
- Serialization round-trip is **owned by Task 03** — do not claim it here until
  Task 03 has landed measuring wire support
- No regressions to Radar or Matching

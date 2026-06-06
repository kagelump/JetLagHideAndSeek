# Task 01: Foundation

**Depends on**: nothing
**Audience**: intern-friendly (mechanical), but read the "Store integration"
section carefully — it covers breakages the original draft missed.

Wire up the type system, registry, dispatch, **and store integration** so all
three new question types are recognized throughout the codebase. After this task
`pnpm typecheck` and `pnpm test` pass with stub placeholder screens. No geometry
or search is implemented yet.

> ⚠️ The original draft of this task claimed a green typecheck after only editing
> the type unions. That is wrong: `createDefaultQuestion` is a non-exhaustive
> `switch` and `updateQuestionCenter` is type-gated to radar/matching. Adding the
> new types to `ImplementedQuestionType` _breaks the build_ until the Store
> integration section is also done. Treat that section as mandatory.

## Test plan (write first)

Add/extend these before touching implementation. They should fail first.

### `src/state/__tests__/questionStore.test.tsx` (extend)

- `createQuestion("measuring", { center, category: "rail-station" })` returns a
  well-formed `MeasuringQuestion` with `answer: "unanswered"`, `candidates: []`,
  `selectedOsmId: null`, the given category, and the given center.
- `createQuestion("thermometer", { center })` returns a `ThermometerQuestion`
  with `previousPosition` and `currentPosition` both set to `center` (or the
  documented offset — see Task 09; for Task 01 co-located is acceptable).
- `createQuestion("tentacles", { center, category: "museum" })` returns a
  `TentaclesQuestion` with `distanceOption: "2km"`, `distanceMeters: 2000`,
  `answer: "unanswered"`, `selectedOsmId: null`.
- `updateQuestionCenter(measuringQuestion, newCenter)` returns a question whose
  `center` changed (currently it no-ops for non radar/matching — this assertion
  fails until the guard is widened).
- `updateQuestionCenter(tentaclesQuestion, newCenter)` likewise updates center.
- `updateQuestionCenter(thermometerQuestion, newCenter)` should **not** change
  anything (Thermometer has no single `center`; it uses two explicit pins). Assert
  it returns the question unchanged.

### `src/features/questions/__tests__/questionRegistry.test.ts` (extend)

- `implementedQuestionTypes` contains all five types once the three configs are
  flipped to `implemented: true`.
- `questionDefinitions.measuring.implemented === true` (and thermometer,
  tentacles).

### Exhaustiveness guard (compile-time, no runtime test needed)

Add a `default` branch to `createDefaultQuestion` that does
`assertNever(type)` (a `(value: never) => never` helper). This converts "forgot a
case" into a typecheck error instead of an `undefined` return. If `@/shared`
has no `assertNever`, add one in `src/shared/assertNever.ts` with a tiny test.

## Files to Create

### `src/features/questions/measuring/measuringTypes.ts`

```typescript
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type {
    BaseQuestion,
    QuestionAnswer,
} from "@/features/questions/coreTypes";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";
import type { DistanceUnit } from "@/shared/distanceUnits";
import type { Position } from "@/shared/geojson";

export type MeasuringCategory =
    // Transit
    | "commercial-airport"
    | "high-speed-rail" // line-distance – see task-06
    | "rail-station"
    // Border
    | "admin-1st-border" // polygon-edge distance – see task-06
    | "admin-2nd-border" // polygon-edge distance – see task-06
    // Natural
    | "body-of-water" // polygon-edge distance – see task-06
    | "coastline" // line-distance – see task-06
    | "mountain"
    | "park"
    // Places of Interest
    | "amusement-park"
    | "zoo"
    | "aquarium"
    | "golf-course"
    | "museum"
    | "movie-theater"
    // Public Utilities
    | "hospital"
    | "library"
    | "foreign-consulate";

export type MeasuringQuestion = BaseQuestion & {
    type: "measuring";
    answer: QuestionAnswer;
    category: MeasuringCategory;
    /** Seeker's position – used as the search anchor to find nearby POIs. */
    center: Position;
    candidates: OsmFeature[];
    selectedOsmId: number | null;
    selectedOsmType: "node" | "way" | "relation" | null;
    /**
     * Seeker's auto-computed distance from center to the selected POI.
     * null when no POI is selected yet.
     */
    seekerDistanceMeters: number | null;
    seekerDistanceUnit: DistanceUnit;
};

export type MeasuringRenderState = {
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>; // closer
    missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>; // farther
};

export const EMPTY_MEASURING_RENDER_STATE: MeasuringRenderState = {
    hitMaskFeatures: { features: [], type: "FeatureCollection" },
    missMaskFeatures: { features: [], type: "FeatureCollection" },
};
```

### `src/features/questions/thermometer/thermometerTypes.ts`

```typescript
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiPolygon,
    Polygon,
} from "geojson";
import type {
    BaseQuestion,
    QuestionAnswer,
} from "@/features/questions/coreTypes";
import type { Position } from "@/shared/geojson";

export type ThermometerQuestion = BaseQuestion & {
    type: "thermometer";
    answer: QuestionAnswer; // positive = hotter, negative = colder
    /** Seeker's position before travel. null until set by the user. */
    previousPosition: Position | null;
    /** Seeker's position after travel. null until set by the user. */
    currentPosition: Position | null;
};

export type ThermometerRenderState = {
    /** Half-plane where the hider must be, clipped to the play area. */
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    /**
     * Preview features shown while editing:
     * – travel segment line (P1 → P2)
     * – three range-ring circles from P1 at 1 km, 5 km, and 15 km
     * Each feature carries a `role` property (see Task 08).
     */
    previewFeatures: FeatureCollection<LineString | Polygon>;
};

export const EMPTY_THERMOMETER_RENDER_STATE: ThermometerRenderState = {
    hitMaskFeatures: { features: [], type: "FeatureCollection" },
    previewFeatures: { features: [], type: "FeatureCollection" },
};
```

### `src/features/questions/tentacles/tentaclesTypes.ts`

```typescript
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";
import type { BaseQuestion } from "@/features/questions/coreTypes";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";
import type { Position } from "@/shared/geojson";

export type TentaclesCategory =
    // 2 km group
    | "museum"
    | "library"
    | "movie-theater"
    | "hospital"
    // 25 km group
    | "transit-line"
    | "zoo"
    | "aquarium"
    | "amusement-park";

export type TentaclesDistanceOption = "2km" | "25km";

export const tentaclesCategoryDistance: Record<
    TentaclesCategory,
    TentaclesDistanceOption
> = {
    museum: "2km",
    library: "2km",
    "movie-theater": "2km",
    hospital: "2km",
    "transit-line": "25km",
    zoo: "25km",
    aquarium: "25km",
    "amusement-park": "25km",
};

export const tentaclesDistanceMeters: Record<TentaclesDistanceOption, number> =
    {
        "2km": 2000,
        "25km": 25000,
    };

export type TentaclesQuestion = BaseQuestion & {
    type: "tentacles";
    /**
     * The answer to a Tentacles question is the *named POI* the hider is
     * closest to, represented by `selectedOsmId` / `selectedOsmType` /
     * `selectedName`. The legacy `answer` status field is retained only so
     * generic store/list code can ask "is this answered?" — it is
     * "unanswered" until a POI is chosen, then "positive". There is no
     * meaningful "negative". See Task 02 (answer model).
     */
    answer: "unanswered" | "positive";
    candidates: OsmFeature[];
    category: TentaclesCategory;
    /** Seeker's position – center of the radius search. */
    center: Position;
    distanceMeters: number;
    distanceOption: TentaclesDistanceOption;
    selectedOsmId: number | null;
    selectedOsmType: "node" | "way" | "relation" | null;
    /** Display name of the selected POI; the human-readable answer. */
    selectedName: string | null;
};

export type TentaclesRenderState = {
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    poiFeatures: FeatureCollection<
        Point,
        { isSelected: boolean; name: string; osmId: number }
    >;
    /** The seeker's radius circle, shown as an outline layer. null when no center set. */
    radiusOutlineFeature: Feature<Polygon> | null;
    voronoiOutlineFeatures: FeatureCollection<Polygon | MultiPolygon>;
};

export const EMPTY_TENTACLES_RENDER_STATE: TentaclesRenderState = {
    hitMaskFeatures: { features: [], type: "FeatureCollection" },
    missMaskFeatures: { features: [], type: "FeatureCollection" },
    poiFeatures: { features: [], type: "FeatureCollection" },
    radiusOutlineFeature: null,
    voronoiOutlineFeatures: { features: [], type: "FeatureCollection" },
};
```

> Note: `selectedName` is added to `TentaclesQuestion` so the answer is
> self-describing without a candidate lookup. Task 02 formalizes the
> POI-answer model; Task 11 populates `selectedName` on selection.

### Stub detail screens

Create three placeholders (identical structure), each returning
`<Text>Not yet implemented</Text>` in a `<View>`:

- `src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx`
- `src/features/questions/thermometer/ThermometerQuestionDetailScreen.tsx`
- `src/features/questions/tentacles/TentaclesQuestionDetailScreen.tsx`

These are replaced in Tasks 05 / 09 / 11.

## Files to Modify

### `src/features/questions/coreTypes.ts`

```diff
-export type ImplementedQuestionType = "radar" | "matching";
+export type ImplementedQuestionType =
+    | "radar" | "matching" | "measuring" | "thermometer" | "tentacles";
```

`QuestionType` already lists all five — no change needed there.

### `src/features/questions/questionTypes.ts`

Add imports and extend the union with the three new question types
(`MeasuringQuestion`, `ThermometerQuestion`, `TentaclesQuestion`).

### `src/features/questions/radar/radarTypes.ts`

Import the three new render-state types and add `measuring`, `tentacles`,
`thermometer` keys to `QuestionMapRenderState`.

### `src/features/questions/questionGeometry.ts`

For this task, populate the three new keys with the `EMPTY_*_RENDER_STATE`
constants (real builders arrive in Tasks 05/08/10). Keep `voronoiOutlineFeatures`
as-is for now.

### Config flips

In `measuringConfig.ts`, `thermometerConfig.ts`, `tentaclesConfig.ts`:

- `implemented: false → true`
- Fix answer labels:
    - Measuring: `positive: "Closer"`, `negative: "Farther"`
    - Thermometer: `positive: "Hotter"`, `negative: "Colder"` (currently "Warmer")
    - Tentacles: labels become irrelevant once Task 02 introduces the POI answer
      model. For Task 01, set `positive: "Answered"`, `negative: "—"` as a
      placeholder and leave a `// TODO(task-02): poi answer model` comment.
- `summary`: return a real string. For Task 01 a minimal summary keyed off
  stored fields is fine (e.g. `"Measuring: ${category}"`); richer summaries land
  with each type's UI task.

> `implementedQuestionTypes` is **derived** from the config `implemented` flags
> (`questionRegistry.ts` filters `questionDefinitions` by `implemented`). Flipping
> the three flags is sufficient — there is no hardcoded array to edit. (The
> original draft's "if hardcoded, update it" instruction was stale.)

### `src/features/questions/QuestionDetailScreen.tsx`

Add dispatch branches for `measuring` / `thermometer` / `tentacles` before the
fallback, each rendering the corresponding stub screen.

### `src/features/questions/AddQuestionScreen.tsx`

`AddQuestionScreen` currently hardcodes one `Pressable` per type (no
`implemented`-driven loop). Add three rows following the existing Radar/Matching
pattern. Each row's `onPress`:

- **Thermometer**: `createQuestion("thermometer", { center: gpsOrPlayAreaCenter })`,
  then navigate to `question-detail`.
- **Measuring / Tentacles**: `createQuestion(type, { center, category: <first implemented category> })`,
  then navigate to `question-detail`. The category picker lives in the detail
  screen (Tasks 05 / 11).

### Store integration — **mandatory, this is where the build breaks**

`src/state/questionStore.tsx`:

1. **Widen the create signature.** `createQuestion` / `createDefaultQuestion`
   currently accept `options: { center; category?: MatchingCategory }`. Change
   `category` to `MatchingCategory | MeasuringCategory | TentaclesCategory`
   (or a generic `string` narrowed per case). The new cases need their category.

2. **Add `createDefaultQuestion` cases** for `measuring`, `thermometer`,
   `tentacles`, each returning the fully-initialized shape (see the test plan for
   the expected fields). Add a `default: assertNever(type)` branch so future
   gaps fail at compile time.

3. **Widen `updateQuestionCenter`.** Change the guard so `measuring` and
   `tentacles` (both of which carry a single `center`) are updated, while
   `radar` and `matching` keep working. `thermometer` has no single `center` —
   it must remain a no-op (Thermometer pins are updated by dedicated helpers in
   Task 09). The simplest correct form is an allow-list:
   `if (!["radar", "matching", "measuring", "tentacles"].includes(question.type)) return question;`

## Acceptance Criteria

- `pnpm typecheck` passes (exhaustiveness guard in place)
- `pnpm test` passes (the Task 01 test-plan cases are green)
- The three new question types appear in `AddQuestionScreen`
- Creating and opening each type shows the stub "Not yet implemented" screen
- Dragging is not wired yet, but `updateQuestionCenter` unit tests prove
  measuring/tentacles centers update and thermometer does not
- No regressions to Radar or Matching

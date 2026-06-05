# Task 01: Foundation

Wire up the type system, registry, and dispatch so all three new question types are recognized throughout the codebase. After this task `pnpm typecheck` passes with stub placeholder screens. No geometry or search is implemented yet.

## Files to Create

### `src/features/questions/measuring/measuringTypes.ts`

```typescript
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { BaseQuestion, QuestionAnswer } from "@/features/questions/coreTypes";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";
import type { DistanceUnit } from "@/shared/distanceUnits";
import type { Position } from "@/shared/geojson";

export type MeasuringCategory =
    // Transit
    | "commercial-airport"
    | "high-speed-rail"    // deferred – see task-05
    | "rail-station"
    // Border
    | "admin-1st-border"   // deferred – see task-05
    | "admin-2nd-border"   // deferred – see task-05
    // Natural
    | "body-of-water"      // deferred – see task-05
    | "coastline"          // deferred – see task-05
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
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;   // closer
    missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;  // farther
};

export const EMPTY_MEASURING_RENDER_STATE: MeasuringRenderState = {
    hitMaskFeatures: { features: [], type: "FeatureCollection" },
    missMaskFeatures: { features: [], type: "FeatureCollection" },
};
```

### `src/features/questions/thermometer/thermometerTypes.ts`

```typescript
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson";
import type { BaseQuestion, QuestionAnswer } from "@/features/questions/coreTypes";
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
     * Preview features shown while unanswered:
     * – travel segment line (P1 → P2)
     * – three range-ring circles from P1 at 1 km, 5 km, and 15 km
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
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { BaseQuestion, QuestionAnswer } from "@/features/questions/coreTypes";
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

export const tentaclesCategoryDistance: Record<TentaclesCategory, TentaclesDistanceOption> = {
    "museum":        "2km",
    "library":       "2km",
    "movie-theater": "2km",
    "hospital":      "2km",
    "transit-line":  "25km",
    "zoo":           "25km",
    "aquarium":      "25km",
    "amusement-park":"25km",
};

export const tentaclesDistanceMeters: Record<TentaclesDistanceOption, number> = {
    "2km":  2000,
    "25km": 25000,
};

export type TentaclesQuestion = BaseQuestion & {
    type: "tentacles";
    /**
     * "unanswered" until the seeker records which POI the hider named.
     * "positive" once selectedOsmId is set.
     * "negative" is unused for Tentacles.
     */
    answer: QuestionAnswer;
    candidates: OsmFeature[];
    category: TentaclesCategory;
    /** Seeker's position – center of the radius search. */
    center: Position;
    distanceMeters: number;
    distanceOption: TentaclesDistanceOption;
    selectedOsmId: number | null;
    selectedOsmType: "node" | "way" | "relation" | null;
};

export type TentaclesRenderState = {
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    poiFeatures: FeatureCollection<Point, { isSelected: boolean; name: string; osmId: number }>;
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

### Stub detail screens

Create three placeholder files (identical structure):

- `src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx`
- `src/features/questions/thermometer/ThermometerQuestionDetailScreen.tsx`
- `src/features/questions/tentacles/TentaclesQuestionDetailScreen.tsx`

Each returns a simple `<Text>Not yet implemented</Text>` wrapped in a `<View>`. These are replaced in Tasks 02–04.

## Files to Modify

### `src/features/questions/coreTypes.ts`

```diff
-export type ImplementedQuestionType = "radar" | "matching";
+export type ImplementedQuestionType =
+    | "radar"
+    | "matching"
+    | "measuring"
+    | "thermometer"
+    | "tentacles";
```

### `src/features/questions/questionTypes.ts`

Add imports and extend the union:

```diff
+import type { MeasuringQuestion } from "./measuring/measuringTypes";
+import type { ThermometerQuestion } from "./thermometer/thermometerTypes";
+import type { TentaclesQuestion } from "./tentacles/tentaclesTypes";

-export type QuestionState = RadarQuestion | MatchingQuestion;
+export type QuestionState =
+    | RadarQuestion
+    | MatchingQuestion
+    | MeasuringQuestion
+    | ThermometerQuestion
+    | TentaclesQuestion;
```

### `src/features/questions/radar/radarTypes.ts`

Import the new render state types and extend `QuestionMapRenderState`:

```diff
+import type { MeasuringRenderState } from "@/features/questions/measuring/measuringTypes";
+import type { ThermometerRenderState } from "@/features/questions/thermometer/thermometerTypes";
+import type { TentaclesRenderState } from "@/features/questions/tentacles/tentaclesTypes";

 export type QuestionMapRenderState = {
+    measuring: MeasuringRenderState;
     osmMatching: OsmMatchingRenderState;
     radar: RadarQuestionRenderState;
     radarAreaFeatures: RadarQuestionFeatureCollection;
+    tentacles: TentaclesRenderState;
+    thermometer: ThermometerRenderState;
     transitLine: {
         hitMaskFeatures: TransitLineQuestionFeatureCollection;
         missMaskFeatures: TransitLineQuestionFeatureCollection;
     };
     voronoiOutlineFeatures: FeatureCollection<Polygon | MultiPolygon>;
 };
```

### `src/features/questions/questionGeometry.ts`

Import empty render states and stub out the new builders:

```diff
+import {
+    EMPTY_MEASURING_RENDER_STATE,
+} from "./measuring/measuringTypes";
+import {
+    EMPTY_THERMOMETER_RENDER_STATE,
+} from "./thermometer/thermometerTypes";
+import {
+    EMPTY_TENTACLES_RENDER_STATE,
+} from "./tentacles/tentaclesTypes";

 export function buildQuestionMapRenderState(...): QuestionMapRenderState {
     const radar = buildRadarQuestionRenderState(questions);
     const osmMatching = buildOsmMatchingRenderState(...);
     // ... transitLine logic ...
     return {
+        measuring: EMPTY_MEASURING_RENDER_STATE,   // TODO task-02
+        osmMatching,
         radar,
         radarAreaFeatures: radar.previewFeatures,
+        tentacles: EMPTY_TENTACLES_RENDER_STATE,   // TODO task-04
+        thermometer: EMPTY_THERMOMETER_RENDER_STATE, // TODO task-03
         transitLine: { ... },
         voronoiOutlineFeatures: { ... },
     };
 }
```

### `src/features/questions/measuring/measuringConfig.ts`

```diff
-implemented: false,
+implemented: true,
 answerLabels: {
-    negative: "Miss",
-    positive: "Hit",
+    negative: "Farther",
+    positive: "Closer",
 },
-mapBehavior: { usesMovableAnchor: false },
+mapBehavior: { usesMovableAnchor: true },
```

Update `summary` to return something like `"Measuring: ${categoryTitle}, ${answerLabel}"`.

### `src/features/questions/thermometer/thermometerConfig.ts`

```diff
-implemented: false,
+implemented: true,
 answerLabels: {
     negative: "Colder",
-    positive: "Warmer",
+    positive: "Hotter",
 },
```

Update `summary` to return something like `"Thermometer: ${computedDistanceLabel}, ${answerLabel}"` where `computedDistanceLabel` comes from the stored positions (e.g., "3.2 km traveled").

`usesMovableAnchor` stays `false` — Thermometer uses a bespoke two-pin model (see Task 03).

### `src/features/questions/tentacles/tentaclesConfig.ts`

```diff
-implemented: false,
+implemented: true,
 answerLabels: {
-    negative: "Miss",
-    positive: "Hit",
+    negative: "—",
+    positive: "Answered",
 },
```

Update `summary` to return `"Tentacles: ${categoryTitle} (${distanceOption}), ${selectedName ?? 'Unanswered'}"`.

### `src/features/questions/questionRegistry.ts`

If `implementedQuestionTypes` is a hardcoded array rather than derived from the config `implemented` flags, update it:

```diff
-export const implementedQuestionTypes: ImplementedQuestionType[] = ["radar", "matching"];
+export const implementedQuestionTypes: ImplementedQuestionType[] = [
+    "radar",
+    "matching",
+    "measuring",
+    "thermometer",
+    "tentacles",
+];
```

### `src/features/questions/QuestionDetailScreen.tsx`

Add dispatch branches before the "Not yet implemented" fallback:

```diff
+} else if (question.type === "measuring") {
+    return <MeasuringQuestionDetailScreen question={question} />;
+} else if (question.type === "thermometer") {
+    return <ThermometerQuestionDetailScreen question={question} />;
+} else if (question.type === "tentacles") {
+    return <TentaclesQuestionDetailScreen question={question} />;
 } else {
     return <Text>Not yet implemented</Text>;
 }
```

### `src/features/questions/AddQuestionScreen.tsx`

Add the three new question types to the visible list. The creation flow details (especially for Measuring and Tentacles, which need a category selected before creation) are finalized in Tasks 02 and 04. For this task, adding them to the list with a temporary "navigate to detail with a default state" creation action is acceptable.

**Thermometer creation**: create a `ThermometerQuestion` with both positions `null` and navigate to `question-detail`. The detail screen (Task 03) handles position setup.

**Measuring / Tentacles creation**: navigate to their detail screens; the category picker lives inside the detail screen (Tasks 02 and 04). Create with a placeholder category (first in list) that the user changes in the detail screen.

## Acceptance Criteria

- `pnpm typecheck` passes
- `pnpm test` passes (no new tests required yet)
- The three new question types appear in `AddQuestionScreen`
- Creating and opening each type shows the stub "Not yet implemented" screen
- No regressions to Radar or Matching

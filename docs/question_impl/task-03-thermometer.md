# Task 03: Thermometer Question

**Depends on**: Task 01

Implement the Thermometer question end-to-end: perpendicular-bisector half-plane geometry, dual-draggable-pin detail screen with range rings, and a preview layer for the travel segment.

## Background

The Thermometer question asks: "I've just traveled at least [Distance]. Am I hotter or colder?"

The seeker records two positions: **P1** (before travel) and **P2** (after travel). They ask the hider if the seeker's movement brought them closer to ("hotter") or farther from ("colder") the hider's position.

**Geometric interpretation:**

The perpendicular bisector of segment P1 → P2 divides the plane into two half-planes:

- **H₂**: points closer to P2 (the seeker moved *toward* these)
- **H₁**: points closer to P1 (the seeker moved *away from* these)

| Answer | Meaning | Hider is in | Map effect |
|---|---|---|---|
| Hotter (positive) | Moved closer to hider | H₂ | Darken H₁ (outside H₂) |
| Colder (negative) | Moved farther from hider | H₁ | Darken H₂ (outside H₁) |

Both cases produce a single polygon (the valid half-plane, clipped to the play area) that goes into `hitMaskFeatures`. `missMaskFeatures` is always empty for Thermometer — the "where the hider isn't" is the complement of the valid half-plane, which the renderer handles automatically by darkening outside the `hitMaskFeatures` shape.

**On distance options:** The game card specifies a minimum travel distance (1 cm on the physical map, 5 cm, or 15 km). In the app this is informational only — it is not a user-selectable toggle. The actual geometry derives entirely from the two pin positions. Range rings from P1 at 1 km, 5 km, and 15 km are shown as visual guides to help the seeker confirm they have traveled far enough.

## Files to Create

### `src/features/questions/thermometer/thermometerGeometry.ts`

#### Half-plane computation

```typescript
import { circle } from "@turf/circle";
import { lineString } from "@turf/helpers";
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson";
import type { Position } from "@/shared/geojson";
import type { QuestionState } from "@/features/questions/questionTypes";
import type { ThermometerRenderState } from "./thermometerTypes";

const MIN_TRAVEL_METERS = 100; // skip degenerate questions where P1 ≈ P2

export function buildThermometerRenderState(
    questions: QuestionState[],
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): ThermometerRenderState { ... }
```

**Half-plane polygon construction** (inside `buildThermometerRenderState`):

1. Convert P1 and P2 from `[lon, lat]` to Cartesian-approximate coordinates for midpoint/normal computation. Use `@turf/midpoint` for the bisector point M and `@turf/bearing` for the P1→P2 bearing.
2. The bisector passes through M and is perpendicular to P1→P2 (bearing + 90°).
3. Construct a large rectangle on the "valid" side of the bisector (extending well beyond the play-area bbox — use the bbox diagonal × 2 as a safe buffer).
4. Intersect the rectangle with the play-area boundary polygon using `polyclip-ts` (already used by `clipVoronoiCells.ts`).
5. Return the clipped polygon as a GeoJSON `Feature<Polygon | MultiPolygon>`.

**Answer routing:**
- `positive` (hotter): valid half-plane is H₂ (P2 side) → put in `hitMaskFeatures`
- `negative` (colder): valid half-plane is H₁ (P1 side) → put in `hitMaskFeatures`
- `unanswered`: no mask features; populate `previewFeatures` only

**Preview features** (always computed when both positions are set):

```typescript
function buildThermometerPreviewFeatures(
    p1: Position,
    p2: Position,
): FeatureCollection<LineString | Polygon> {
    const travelLine = lineString([p1, p2]);
    const ring1km  = circle(p1, 1,  { units: "kilometers" });
    const ring5km  = circle(p1, 5,  { units: "kilometers" });
    const ring15km = circle(p1, 15, { units: "kilometers" });
    return {
        type: "FeatureCollection",
        features: [travelLine, ring1km, ring5km, ring15km],
    };
}
```

The rings and the line are rendered differently via feature properties (add a `role: "travel-line" | "ring-1km" | "ring-5km" | "ring-15km"` property).

### `src/features/questions/thermometer/__tests__/thermometerGeometry.test.ts`

Test cases:
- Hotter: valid half-plane is on the P2 side of the bisector.
- Colder: valid half-plane is on the P1 side of the bisector.
- Perpendicular bisector is correctly perpendicular to the travel vector.
- Degenerate case: P1 = P2 or travel < MIN_TRAVEL_METERS → question skipped, empty render state.
- Unanswered: no hit mask features, preview features present (line + 3 rings).
- Null positions: question skipped gracefully.
- Cardinal directions: N-S travel → bisector runs E-W; E-W travel → bisector runs N-S.

### `src/features/questions/thermometer/ThermometerQuestionDetailScreen.tsx`

See UX section below.

## Files to Modify

### `src/features/questions/questionGeometry.ts`

Replace the `EMPTY_THERMOMETER_RENDER_STATE` stub. Thermometer needs `playAreaBoundary` for clipping, which is already available in `buildQuestionMapRenderState`:

```diff
-import { EMPTY_THERMOMETER_RENDER_STATE } from "./thermometer/thermometerTypes";
+import { buildThermometerRenderState } from "./thermometer/thermometerGeometry";

 export function buildQuestionMapRenderState(
     questions,
     stations,
     radiusMeters,
     playAreaBbox,
     playAreaBoundary,
 ): QuestionMapRenderState {
-    thermometer: EMPTY_THERMOMETER_RENDER_STATE,
+    thermometer: buildThermometerRenderState(questions, playAreaBoundary),
```

### `src/features/map/NativeMap.tsx`

Add a `ThermometerPreviewLayer` component that renders `thermometer.previewFeatures`:

- **Travel line** (`role === "travel-line"`): thin solid `LineLayer`, muted color (e.g., `#888888`), width 2.
- **Range rings** (`role === "ring-1km" | "ring-5km" | "ring-15km"`): dashed `LineLayer`, same muted color, width 1. Use a `LineLayer` with `lineDasharray` rather than a `FillLayer` so the rings don't obscure the map.

The preview layer is visible only when the active route is `question-detail` (same visibility rule as `OsmMatchingLayers` / `VoronoiOutlineLayers`).

Thermometer `hitMaskFeatures` feed into the existing `combinedInsideMask` — no additional fill layers needed.

## Detail Screen UX

The Thermometer detail screen manages two pins, P1 (start) and P2 (end), and an answer selector.

```
┌──────────────────────────────────────┐
│  ┌─────────────────────────────────┐ │
│  │           MAP                   │ │
│  │  P1 ●─────────────────● P2      │ │
│  │     ○ (1km)                     │ │
│  │       ○○ (5km)                  │ │
│  │           ○○○○○ (15km)          │ │
│  └─────────────────────────────────┘ │
│                                      │
│  Start (P1)                          │
│  35.6762° N, 139.6503° E  [Set GPS]  │
│                                      │
│  End (P2)                            │
│  35.6890° N, 139.7016° E  [Set GPS]  │
│                                      │
│  Distance traveled: 4.3 km           │
│                                      │
│  Answer                              │
│  [ Hotter ]  [ Colder ]  [ Reset ]   │
└──────────────────────────────────────┘
```

**Two-pin model:**

- Both P1 and P2 are draggable map pins, following the same `draggablePinPosition` infrastructure used by Radar/Matching for their single pin.
- The detail screen tracks an `activePin: "start" | "end"` toggle (shown as two labeled tabs or radio buttons above the map). The active pin responds to drag events; the inactive pin stays fixed.
- Tapping "Set GPS" for either pin sets that pin to the current GPS location.
- The map shows the range rings from P1 at 1 km, 5 km, and 15 km (dashed circles rendered by `ThermometerPreviewLayer`) and the travel segment line connecting P1 and P2.

**Creation:** A new Thermometer question is created with `previousPosition = currentGPS` and `currentPosition = currentGPS`. Both pins start co-located at the seeker's current position; the user drags P2 to the post-travel position.

**Distance display:** Computed via `@turf/distance(p1, p2)` and shown in km (or the app's preferred unit). Updates live as pins move.

**Answer selector:** Same `QuestionAnswerSelector` component, `"Hotter"` / `"Colder"`. The bisector overlay appears as soon as both pins are set and an answer is selected.

**Degenerate state:** If `distance(P1, P2) < 100 m`, show an inline warning "Positions are too close to compute a valid result" and disable the answer selector.

## Acceptance Criteria

- `pnpm typecheck` and `pnpm test` pass
- Range rings appear from P1 at 1 km, 5 km, and 15 km while editing
- Travel line is drawn between P1 and P2
- "Hotter" answer darkens the P1-side half-plane (correct half eliminated)
- "Colder" answer darkens the P2-side half-plane
- Dragging either pin updates the overlay live
- Degenerate state (P1 ≈ P2) shows warning and disables answer
- No regressions to Radar or Matching

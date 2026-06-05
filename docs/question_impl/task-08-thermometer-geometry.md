# Task 08: Thermometer Geometry

**Depends on**: Task 01
**Audience**: senior / careful. This is a pure function with a subtle
correctness surface (it is easy to put the half-plane on the wrong side). Build
it strictly test-first — the failing assertions are the spec.

## What it computes

Given P1 (`previousPosition`) and P2 (`currentPosition`), the perpendicular
bisector of segment P1→P2 splits the plane:

- **H₂** = points closer to P2 (the seeker moved *toward* them)
- **H₁** = points closer to P1 (the seeker moved *away from* them)

| Answer | Meaning | Valid half-plane (where the hider is) → `hitMaskFeatures` |
|---|---|---|
| Hotter (`positive`) | moved closer to hider | **H₂** (P2 side) |
| Colder (`negative`) | moved farther from hider | **H₁** (P1 side) |
| `unanswered` | — | empty mask; preview only |

`missMaskFeatures` is always empty for Thermometer — the renderer darkens
*outside* `hitMaskFeatures` automatically (it feeds `combinedInsideMask`).

## Critical correctness rule (do not get this backwards)

Define the valid half-plane by the **distance test**, not by an angle, so it
can't be silently inverted:

- Hotter ⇒ valid region = `{ x : dist(x, P2) < dist(x, P1) }`
- Colder ⇒ valid region = `{ x : dist(x, P1) < dist(x, P2) }`

When you build the half-plane polygon, **verify its side** by testing P2 itself:
for Hotter, P2 must be **inside** the produced polygon (before play-area
clipping) and P1 **outside**; for Colder, vice-versa. Bake that into the tests.

## Test plan (write first)

`src/features/questions/thermometer/__tests__/thermometerGeometry.test.ts`

Use a small square play-area boundary fixture and hand-placed P1/P2.

1. **Hotter side**: with P1 west of P2, a point near P2 is inside
   `hitMaskFeatures`; a point near P1 is outside.
2. **Colder side**: the mask is the mirror — point near P1 inside, near P2
   outside.
3. **Perpendicularity**: for N–S travel (P1 south, P2 north) the dividing edge
   runs E–W (assert a point due-east of the midpoint at the same latitude lies on
   the boundary / both masks agree it's ~equidistant). For E–W travel the divider
   runs N–S.
4. **Known hider point**: place a hider coordinate clearly closer to P2; assert
   it's in the Hotter mask and absent from a Colder mask built from the same pins.
   This is the anti-inversion test — keep it.
5. **Degenerate**: `dist(P1,P2) < MIN_TRAVEL_METERS` (100 m) → empty render
   state (no mask, no preview).
6. **Null positions**: either position null → question skipped, empty render
   state.
7. **Unanswered**: no `hitMaskFeatures`; `previewFeatures` contains the travel
   line + three rings, each with the right `role`.
8. **Clipping**: the half-plane is clipped to the play-area boundary (no part of
   the mask extends outside the boundary fixture).
9. **Caching**: identical inputs reuse the cached result (LRU pattern).

## Implementation

`src/features/questions/thermometer/thermometerGeometry.ts`

```typescript
import { circle } from "@turf/circle";
import { lineString, polygon } from "@turf/helpers";
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson";
import { haversineDistanceMeters } from "@/shared/geojson";
import { clipCellsToPlayArea } from "@/features/questions/clipVoronoiCells";
import type { Position } from "@/shared/geojson";
import type { QuestionState } from "@/features/questions/questionTypes";
import type { ThermometerRenderState } from "./thermometerTypes";

const MIN_TRAVEL_METERS = 100;
```

### Half-plane construction (recipe)

Work in a **local equirectangular projection** centered on the midpoint — this is
accurate at city scale and avoids needing `@turf/midpoint`/`@turf/bearing` (which
are not installed):

1. `M = [(p1[0]+p2[0])/2, (p1[1]+p2[1])/2]` (lon/lat midpoint).
2. Project to local meters: for any point `q`,
   `x = (q[0]-M[0]) * cos(M_latRad) * Rm°`, `y = (q[1]-M[1]) * Rm°`, where
   `Rm° = π/180 * EARTH_RADIUS_METERS`. Keep an inverse to go back to lon/lat.
3. Travel direction `d = normalize(P2_proj - P1_proj)`. (In projected space the
   bisector is exactly perpendicular to `d` through the origin/M.)
4. Build a large rectangle on the valid side. Let `L` = 2 × the play-area bbox
   diagonal (in meters) so the rectangle always overdraws the boundary. Let
   `n = perpendicular(d)`. The bisector segment endpoints are `±L·n`. From each,
   extend by `+L·d` for **Hotter** (P2 side) or `-L·d` for **Colder** (P1 side):
   - `A = +L·n`, `B = -L·n`, `C = B + sign·L·d`, `D = A + sign·L·d`
   - `sign = +1` for Hotter, `-1` for Colder.
   - Rectangle (projected) = `[A, B, C, D, A]`.
5. Inverse-project the four corners back to lon/lat and build a `polygon`.
6. **Verify the side** (assert in tests, and you may keep a dev assertion): the
   chosen rectangle must contain `P2` for Hotter / `P1` for Colder.
7. Clip to the play area by wrapping the rectangle as a one-cell
   `FeatureCollection<Polygon>` and calling
   `clipCellsToPlayArea(cells, playAreaBoundary)` — reuse the existing,
   bbox-pre-filtered, cached clipper rather than calling polyclip directly.

### Preview features (always when both positions set)

```typescript
function buildThermometerPreviewFeatures(p1, p2): FeatureCollection<LineString | Polygon> {
    const travelLine = lineString([p1, p2], { role: "travel-line" });
    const ring1km  = circle(p1, 1,  { units: "kilometers", properties: { role: "ring-1km" } });
    const ring5km  = circle(p1, 5,  { units: "kilometers", properties: { role: "ring-5km" } });
    const ring15km = circle(p1, 15, { units: "kilometers", properties: { role: "ring-15km" } });
    return { type: "FeatureCollection", features: [travelLine, ring1km, ring5km, ring15km] };
}
```

### Entry point

```typescript
export function buildThermometerRenderState(
    questions: QuestionState[],
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): ThermometerRenderState
```

- Skip questions with a null position or travel < `MIN_TRAVEL_METERS`.
- `unanswered` → empty mask + preview features.
- `positive`/`negative` → clipped half-plane in `hitMaskFeatures` (+ preview).
- LRU-cache keyed on `(p1, p2, answer, boundary identity)`.

### Wire into `questionGeometry.ts`

```diff
-import { EMPTY_THERMOMETER_RENDER_STATE } from "./thermometer/thermometerTypes";
+import { buildThermometerRenderState } from "./thermometer/thermometerGeometry";
...
-    thermometer: EMPTY_THERMOMETER_RENDER_STATE,
+    thermometer: buildThermometerRenderState(questions, playAreaBoundary),
```

`playAreaBoundary` is already a parameter of `buildQuestionMapRenderState`.

### (Stretch, for the planning read-out in Task 09)

Export a helper `splitAreaRatio(question, playAreaBoundary): { hotterPct, colderPct } | null`
that returns the approximate share of the play area on each side of the bisector
(area of each clipped half ÷ total). Task 09 surfaces this so seekers can pick a
cut that halves the remaining space. Area can be computed with the shoelace
formula on the projected polygons (no new dependency) — keep it approximate and
documented as such.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test` pass
- The anti-inversion test (Hotter mask contains the near-P2 hider, Colder does
  not) is green
- Half-plane is clipped to the play area
- Degenerate / null / unanswered cases handled gracefully
- No regressions to other question geometry

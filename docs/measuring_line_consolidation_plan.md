# Plan — Consolidate line-measuring geometry & fix reference-line spill

_2026-06-08. Implements fixes from `docs/measuring_perf_audit.md` Issue 1 (and its
Tōhoku follow-on). Two goals:_

1. **Fix the reference-line spill** by clipping line geometry to the play-area
   boundary — robustly, including the case where a measured boundary (e.g. a
   prefecture border) is _coincident_ with the play-area boundary.
2. **Consolidate the line path** so a single central function computes the
   windowed line geometry once, and **both** the mask buffer and the visible
   reference line are derived from that one source.

## Background (current state)

The line path computes the same bundle twice with **inconsistent** rules:

- The mask (`computeLineBuffer`, `lineMeasuringGeometry.ts:229-425`) buffers
  **every** feature whose bbox intersects the _play-area ± radius_ window.
- The reference line (`buildMeasuringRenderState`, `measuringGeometry.ts:270-317`)
  keeps only features near the **single nearest point** (`featureNearPoint` /
  `relationId`), and renders them **unclipped**.

Result: the kept feature spills off-map (HSR runs past Yokohama), while _other_
in-area corridors (Tōhoku) are dropped even though the mask covers them. See the
audit for the full diagnosis.

The fix is to make the reference line and the mask share one windowed feature
set, and to clip that set to the play-area boundary for display.

## Available primitives

- `@turf/buffer` (JSTS) — already used; will also build the ε-dilated clip
  polygon.
- `polyclip-ts` — already used by `maskBuilder`; polygon–polygon booleans only
  (no line–polygon clip).
- No `@turf/line-split` / `@turf/boolean-point-in-polygon` installed. The clip
  step needs one of: (a) add those two pure-JS turf packages, or (b) a
  self-contained line–polygon clip helper. Recommendation below.

---

## Target architecture

```
                    computeLineCategory(center, category, playAreaBbox)   ← central
                                   │
              ┌────────────────────┼─────────────────────────┐
              ▼                    ▼                          ▼
     nearestPoint+distance   windowFeatures            (cached on category/center/bbox)
        (connector,        (play-area ± radius)
         marker)                  │
                     ┌────────────┴────────────┐
                     ▼                          ▼
            computeLineBuffer(wf)     clipLineFeaturesToPlayArea(wf, dilatedBoundary)
                     │                          │
                     ▼                          ▼
                 hit/miss mask            reference lineFeatures
```

One central call selects the feature set; mask and reference line are pure
downstream derivations of it.

---

## Step 1 — Thread the play-area boundary into measuring render state

`buildMeasuringRenderState` currently receives only the bbox; clipping needs the
polygon.

- Change signature to
  `buildMeasuringRenderState(questions, playAreaBbox, playAreaBoundary)`.
- Update the only caller, `questionGeometry.ts:52`, to pass
  `playArea.boundary` (already in scope there — `tentacles`/`thermometer` already
  receive it).
- Update `measuringGeometry.test.ts` call sites.

## Step 2 — Central line computation

Add to `lineMeasuringGeometry.ts`:

```ts
export type LineCategoryComputation = {
    nearestPoint: Position;
    distanceMeters: number;
    /** Bundle features intersecting the play-area ± max(distance, MIN_MARGIN)
     *  window. The single source for both mask and reference line. */
    windowFeatures: Feature<LineString | MultiLineString>[];
};

export function computeLineCategory(
    center: Position,
    category: MeasuringCategory,
    playAreaBbox: Bbox | undefined,
): LineCategoryComputation | null;
```

Behaviour:

1. `computeLineDistance(center, category)` for `nearestPoint` + `distanceMeters`
   (reuse existing cache; unchanged).
2. Select `windowFeatures` = bundle features whose bbox intersects
   `playAreaBbox` expanded by `max(distanceMeters, MIN_WINDOW_MARGIN_M)`
   (fallback to `center ± FALLBACK_MARGIN` when no bbox). This is the **same**
   window logic `computeLineBuffer` currently does internally — factor it into a
   shared `selectWindowFeatures(category, playAreaBbox, center, marginM)` helper.
3. Cache on `(category, bboxKey, distanceBucket)`.

Then **refactor `computeLineBuffer` to consume `windowFeatures`** rather than
re-filtering the bundle: move the bbox-window filter out (now shared), keep the
clean/dedup/drop-short/simplify/`buffer` pipeline. Signature becomes
`computeLineBuffer(windowFeatures, radiusMeters)` (still cached on
`(category, center, radius)` at the call site, or keyed on feature identity).

This removes the duplicate bundle scan and makes the mask and reference line
provably consistent.

## Step 3 — ε-dilated clip polygon (shared-boundary correctness)

The core correctness mechanism. Clipping a line to the _exact_ play-area polygon
is ambiguous where a measured border lies **on** the boundary — e.g. the Tokyo
23-wards play area shares its north/east edge with the Tokyo-to **prefecture
border** (`admin-1st-border`). A point-in-polygon test on a coincident vertex can
classify it either way, dropping the border that the user is measuring to.

Fix: clip against the play-area polygon **dilated outward by a small ε** so
boundary-coincident geometry is strictly inside and always retained.

```ts
const CLIP_DILATION_M = 30; // sub-pixel at city zoom; > OSM vertex jitter

function getDilatedPlayArea(
    boundary: FeatureCollection<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon>; // buffer(boundary, +CLIP_DILATION_M)
```

- Implement with `@turf/buffer(boundary, CLIP_DILATION_M, { units: "meters" })`.
- **Cache by boundary identity** (`WeakMap<boundary, dilated>`), mirroring
  `maskBuilder`'s `featurePolygonCache` — the play-area boundary object is stable
  across renders, so this buffer runs once per play area.
- ε of ~30 m is invisible at map scale, larger than typical OSM vertex jitter
  between the two datasets, and guarantees coincident borders survive.

## Step 4 — Clip line features to the play area

```ts
export function clipLineFeaturesToPlayArea(
    features: Feature<LineString | MultiLineString>[],
    dilatedPlayArea: Feature<Polygon | MultiPolygon>,
): Feature<LineString | MultiLineString>[];
```

For each feature, return only the sub-segments inside `dilatedPlayArea`.
Implementation options:

- **Recommended (robust):** add `@turf/line-split` + `@turf/boolean-point-in-polygon`
  (both pure-JS, no native): split each line by the polygon, keep pieces whose
  midpoint is `booleanPointInPolygon(dilatedPlayArea)`.
- **Alt (no new deps):** self-contained clip — ray-cast point-in-polygon per
  vertex against the dilated rings, emit runs of consecutive inside vertices as
  separate LineStrings, interpolating the crossing point at each inside↔outside
  transition. Bundle geometry is densely sampled (HSR simplified at ~11 m), so
  even vertex-level runs without interpolation look correct; interpolation just
  cleans the endpoints.

Either way the result is clipped LineStrings; drop empties. Features entirely
outside the play area clip to nothing and disappear — so a single windowed set
naturally yields the right reference line without a separate "near nearest point"
filter.

## Step 5 — Rewire `buildMeasuringRenderState` (the consolidation)

Replace the two divergent code paths with one:

- In the per-question loop, for line categories call `computeLineCategory` once.
    - Push connector + marker from `nearestPoint` (unchanged affordance).
    - If answered → `computeLineBuffer(windowFeatures, distanceMeters)` → hit/miss.
- Build the reference line **once per category** (dedup by category as today)
  from `clipLineFeaturesToPlayArea(windowFeatures, dilatedPlayArea)`.
- **Delete** `findNearbyRelationIds`, `featureNearPoint`, `coordsNearPoint`,
  `coordsNearPointTol`, the `nearestPerCategory` relationId bookkeeping, the
  second `for (const f of bundle.features)` loop, and the local `computeBbox`
  helper (window selection now lives in `lineMeasuringGeometry`). This is the
  bulk of the consolidation cleanup.

After this, mask and reference line are derived from the identical
`windowFeatures` — Tōhoku and every other in-area corridor that contributes to
the mask is also highlighted, and nothing extends past the play area.

## Step 6 — Restyle the reference layer

`MeasuringLayers.tsx:34-43`: drop `lineWidth: 10` / `#ff0000` for a thin
(~3 px), distinct, semi-transparent stroke that reads as "the thing you measured
to" without fighting the mask. Fix the stale "orange reference line" comments in
both `MeasuringLayers.tsx` and `measuringGeometry.ts`.

---

## Edge cases & how they're handled

| Case                                                                                        | Handling                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Border coincident with play-area edge (prefecture border on Tokyo 23-wards north/east edge) | ε-dilated clip polygon keeps it                                                       |
| Corridor enters, crosses, exits play area (HSR → Yokohama)                                  | clipped at boundary; outside leg dropped                                              |
| Two separate in-area corridors (Tōkaidō + Tōhoku)                                           | both in `windowFeatures`; both clipped & shown                                        |
| Corridor entirely outside play area but within buffer window                                | in `windowFeatures` (feeds mask), clips to empty for the line (correct)               |
| Non-convex play area (Tokyo)                                                                | polygon clip follows the real boundary, not a bbox                                    |
| Seeker on the line (distance ≈ 0)                                                           | buffer returns null (unchanged); reference line still built via `MIN_WINDOW_MARGIN_M` |
| MultiLineString features                                                                    | clip per-component; recombine into MultiLineString                                    |

---

## Testing (step-by-step)

This section is written so someone new to the codebase can write the tests from
scratch. Read it top to bottom; each test below is "arrange → act → assert".

### 0. Orientation — how tests work here

- Tests are **Jest** files ending in `.test.ts`, living in a `__tests__/` folder
  next to the code. The two files you'll touch:
    - `src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts`
      (the central function + clip helper)
    - `src/features/questions/measuring/__tests__/measuringGeometry.test.ts`
      (the wired-together render state)
- Run **one** suite while iterating (fast):
    ```bash
    pnpm test -- lineMeasuringGeometry.test.ts
    ```
    Run everything before you're done: `pnpm test`, then `pnpm check`.
- **Coordinates are `[longitude, latitude]`** everywhere — lon first. Tokyo is
  about `[139.7, 35.7]`. Mixing the order up is the #1 source of confusing
  failures.
- Geometry math is approximate, so assert with **ranges/tolerances**, not exact
  equality. Jest gives you:
    - `expect(x).toBeCloseTo(value, digits)` — equal to `digits` decimal places.
    - `expect(x).toBeGreaterThan(n)` / `toBeLessThan(n)` — for "roughly".
    - `expect(arr).toHaveLength(n)`, `expect(x).not.toBeNull()`.

### 1. Reuse the existing fixture helpers

`lineMeasuringGeometry.test.ts` already defines helpers — **copy/reuse them**,
don't reinvent:

- `makeLineFeature(coords, bbox?)` — builds one bundle feature from a list of
  `[lon, lat]` points (auto-computes bbox if omitted).
- `makeBundle(features)` — wraps features in the `LineBundle` envelope.
- `__setLineBundleForTest(category, bundle)` — **injects** your fake bundle so
  the code under test reads it instead of the real 11 MB asset. Always use a
  category string like `"coastline"` or `"high-speed-rail"`.

Two test-only hooks you **must** call in `beforeEach` so caches don't leak
between tests (copy this block verbatim):

```ts
beforeEach(() => {
    clearLineDistanceCache(); // from lineMeasuringGeometry
    clearLineBufferCache(); // from lineMeasuringGeometry
    __clearLineBundlesForTest(); // from lineBundleLoader
});
```

If your new code adds a cache (e.g. for `computeLineCategory` or the dilated
play-area polygon), export a `clear…ForTest()` for it and add it here too.

### 2. A reusable play-area boundary fixture

The clip tests need a play-area **polygon**. Add this helper at the top of the
test file. It makes a simple square play area so you can reason about
inside/outside by eye:

```ts
import type {
    Feature,
    MultiPolygon,
    Polygon,
    FeatureCollection,
} from "geojson";

/** Square play area from [west,south] to [east,north], as a FeatureCollection
 *  (the shape buildMeasuringRenderState / the clip helper expect). */
function makeSquarePlayArea(
    west: number,
    south: number,
    east: number,
    north: number,
): FeatureCollection<Polygon | MultiPolygon> {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [west, south],
                            [east, south],
                            [east, north],
                            [west, north],
                            [west, south], // ring must close
                        ],
                    ],
                },
            },
        ],
    };
}

// Use a small square around 139.0–139.2 lon, 35.0–35.2 lat in every test.
const PLAY_AREA = makeSquarePlayArea(139.0, 35.0, 139.2, 35.2);
const PLAY_AREA_BBOX: [number, number, number, number] = [
    139.0, 35.0, 139.2, 35.2,
];
```

You'll also want a tiny assertion helper for "is every coordinate of this
clipped line inside the play-area bbox (plus the ε dilation tolerance)":

```ts
function allCoordsWithin(
    feature: Feature<LineString | MultiLineString>,
    bbox: [number, number, number, number],
    padDeg = 0.001, // ~100 m — covers the 30 m clip dilation
): boolean {
    const [w, s, e, n] = bbox;
    const segs =
        feature.geometry.type === "LineString"
            ? [feature.geometry.coordinates]
            : feature.geometry.coordinates;
    return segs.every((seg) =>
        seg.every(
            ([lon, lat]) =>
                lon >= w - padDeg &&
                lon <= e + padDeg &&
                lat >= s - padDeg &&
                lat <= n + padDeg,
        ),
    );
}
```

### 3. Tests for `clipLineFeaturesToPlayArea` (Step 4)

Put these in `lineMeasuringGeometry.test.ts` under
`describe("clipLineFeaturesToPlayArea", ...)`. In each test, build the dilated
play area the same way the real code will (`getDilatedPlayArea(PLAY_AREA)`), then
call the clip helper.

1. **Line fully inside → returned unchanged.**

    - Arrange: a line from `[139.05, 35.1]` to `[139.15, 35.1]` (both inside the
      square).
    - Act: clip against `PLAY_AREA`.
    - Assert: result has length 1, and `allCoordsWithin(result[0], PLAY_AREA_BBOX)`
      is `true`. (Endpoints roughly preserved: first/last coord ≈ inputs.)

2. **Line fully outside → dropped.**

    - Arrange: a line from `[140.0, 36.0]` to `[140.1, 36.0]` (nowhere near the
      square).
    - Assert: `expect(result).toHaveLength(0)`.

3. **Line crossing the boundary → cut at the boundary (the spill fix).**

    - Arrange: a horizontal line from `[138.5, 35.1]` (outside, west) to
      `[139.15, 35.1]` (inside). This is the "HSR runs off past Yokohama" shape
      in miniature.
    - Assert: result is non-empty, and **every** coord of the clipped line is
      within the play-area bbox (`allCoordsWithin(...)` true). The key assertion:
      the clipped line's westmost lon is `>= 139.0 - tolerance`, i.e. it no longer
      extends out to 138.5.

4. **Shared-boundary survival (the Tokyo-prefecture regression).** This is the
   one the whole ε-dilation exists for — do not skip it.

    - Arrange: a line lying **exactly on** the play-area's north edge:
      from `[139.0, 35.2]` to `[139.2, 35.2]` (lat 35.2 == the square's `north`).
    - Act: clip against `getDilatedPlayArea(PLAY_AREA)`.
    - Assert: `expect(result).toHaveLength(1)` — the coincident border is
      **kept**, not dropped. (Then sanity-check that without dilation — clipping
      against the raw `PLAY_AREA` — it is unreliable; you don't have to assert the
      negative, but understanding why proves the dilation is doing its job.)

5. **MultiLineString crossing the boundary → clipped per component.**
    - Arrange: a `MultiLineString` with one segment inside and one crossing out.
    - Assert: the inside segment survives; the crossing one is cut; nothing
      extends past the bbox.

### 4. Tests for `computeLineCategory` (Step 2)

Under `describe("computeLineCategory", ...)`. These verify the central function
returns a sensible nearest point + the right window of features.

6. **Returns nearest point + distance + window features.**

    - Arrange: inject a bundle with one line; `__setLineBundleForTest`.
    - Act: `computeLineCategory(center, category, PLAY_AREA_BBOX)`.
    - Assert: result not null; `distanceMeters > 0`; `windowFeatures` length ≥ 1.

7. **Window excludes features far outside the play-area ± radius window.**

    - Arrange: one feature inside the play area, one ~200 km away (like the
      existing `bbox pre-filter` test).
    - Assert: `windowFeatures` contains only the near one
      (`expect(result.windowFeatures).toHaveLength(1)`).

8. **Returns null for empty / missing bundle** (mirror the existing
   "empty or missing bundles" tests).

### 5. Tests for `buildMeasuringRenderState` (Step 5, the consolidation)

These go in `measuringGeometry.test.ts`. They call the **public** render-state
builder, so they prove mask and reference line agree. You build `questions`
(an array of `QuestionState`) and pass `PLAY_AREA_BBOX` + `PLAY_AREA`.

Helper to make a measuring question (check the existing `measuringGeometry.test.ts`
for the exact `QuestionState` shape and copy it):

```ts
function measuringQuestion(
    category: string,
    center: [number, number],
    answer: "positive" | "negative" | "unanswered",
) {
    /* return a QuestionState of type "measuring" — copy the shape from the existing tests */
}
```

9. **Tōhoku regression — both disjoint corridors get a reference line.**

    - Arrange: inject an `high-speed-rail` bundle with **two** separate lines that
      both pass through the play area — one near the seeker ("Tōkaidō"), one
      farther but still inside ("Tōhoku"). Place the seeker `center` next to the
      first.
    - Act: `buildMeasuringRenderState([q], PLAY_AREA_BBOX, PLAY_AREA)`.
    - Assert: `result.lineFeatures.features.length >= 2` — i.e. the far corridor
      is **not** dropped just because it isn't the nearest. (Before this refactor
      it would be missing; this is the guard against regressing that.)

10. **Spill regression — reference line never leaves the play area.**

    - Arrange: a single HSR line that starts inside the play area and runs far
      outside it (e.g. to `[140.5, 34.0]`).
    - Assert: every feature in `result.lineFeatures.features` passes
      `allCoordsWithin(feature, PLAY_AREA_BBOX)`. (No coordinate out near 140.5.)

11. **Mask ↔ reference-line consistency.**

    - Arrange: an _answered_ (`"positive"`) HSR question with two in-area
      corridors.
    - Assert: `result.hitMaskFeatures.features.length > 0` (the buffer ran) **and**
      `result.lineFeatures.features.length >= 2` (both corridors highlighted).
      The point is that whenever the mask exists, the reference line for the same
      corridors exists too — they're derived from one window now.

12. **Shared-boundary at render level (prefecture border).**
    - Arrange: an `admin-1st-border` line coincident with the play-area edge (as
      in test 4) and a seeker just inside.
    - Assert: `result.lineFeatures.features.length >= 1` — the prefecture border
      that _is_ the play-area edge still renders.

### 6. Buffer refactor — prove you didn't change the mask

13. **`computeLineBuffer(windowFeatures, r)` matches the old behaviour.**
    - Arrange: a fixed fixture bundle + center + radius.
    - Act: call the refactored buffer.
    - Assert: the result is a non-null `Polygon`/`MultiPolygon` and its area is
      within a small tolerance of a hard-coded expected value you capture **before**
      refactoring (run the old code once, copy the number). Use a rough area
      helper or just assert the bbox of the buffered polygon is stable. This
      catches accidental behaviour changes when you move the window filter out.

### 7. Real-bundle smoke tests (keep the existing ones green)

The file already has `describe("real bundles", ...)` that `require()`s the actual
`admin-1st-border.json` / `body-of-water.json`. After your refactor, make sure
those still pass — add an equivalent smoke test that runs the **new**
`computeLineCategory` and the clip helper against `admin-1st-border.json` with a
real Tokyo center, asserting it returns without throwing and produces ≥ 1 clipped
reference feature.

### 8. Run order & native check

```bash
pnpm test -- lineMeasuringGeometry.test.ts     # iterate fast
pnpm test -- measuringGeometry.test.ts
pnpm typecheck && pnpm test                      # full unit pass
pnpm check                                       # lint + format + drift guards
```

If a simulator/dev build is available, eyeball the measuring overlay via
`pnpm test:e2e:ios:stack` (look for: HSR line no longer runs off-screen; Tōhoku
side is highlighted; prefecture border on the play-area edge still draws).
Otherwise run the GitHub Actions Maestro workflow as the native check
(per AGENTS.md) — geometry correctness is proven by Jest, not screenshots.

### Common pitfalls (read before you start)

- **Forgot to clear caches in `beforeEach`** → a later test sees a previous
  test's injected bundle. Symptom: tests pass alone but fail together.
- **`[lat, lon]` instead of `[lon, lat]`** → your "inside" point lands in the
  ocean. Double-check every literal.
- **Asserting exact coordinates** → flaky. The buffer/clip introduce tiny
  offsets; assert ranges.
- **Testing against the raw play area instead of the dilated one** in the
  shared-boundary test → it'll pass or fail at random. The whole point of test 4
  is that you clip against `getDilatedPlayArea(...)`.

---

## Out of scope (tracked separately in the audit)

Performance fixes for `body-of-water` (segment budget, spatial index, async
derivation) are P0–P2 in `docs/measuring_perf_audit.md` and are independent of
this refactor — though Step 2's shared window selection is a natural seam to hang
the future spatial index on.

## Suggested commit breakdown

1. Thread `playAreaBoundary` into measuring render state (Step 1).
2. Extract `selectWindowFeatures` + `computeLineCategory`; refactor
   `computeLineBuffer` to consume window features (Step 2).
3. Add ε-dilated clip polygon + `clipLineFeaturesToPlayArea` (Steps 3–4).
4. Rewire `buildMeasuringRenderState`, delete dead filters, restyle layer
   (Steps 5–6).
5. Tests (Step 7).
   </content>
   </invoke>

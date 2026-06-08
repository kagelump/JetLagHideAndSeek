# P6 — Bound the reference-line clip (`clipLineFeaturesToPlayArea`)

**Status:** ready · **Priority:** ship now (post-P0 softlock) ·
**Risk:** low · **Quality cost:** sub-vertex (cosmetic line endpoints)

## Problem

After P0 shipped `body-of-water` as **dissolved polygons**, the reference-line
path converts those polygons _back_ to boundary lines
(`polygonFeaturesToLineFeatures`) and then clips them to the play-area boundary
in `clipLineFeaturesToPlayArea`
(`src/features/questions/measuring/lineMeasuringGeometry.ts`, ~line 1157). That
clip is now the dominant cost — **62.7 s, on the synchronous render path, twice**.

From the field log (Tokyo 23-wards play area, one `body-of-water` question):

```
[clipLineFeatures] starting clip of 39 features (3335 total lines) against play area
[clipLineFeatures] feature 10/39 (MultiLineString, 171 lines ...) → dropped in 3407ms
[clipLineFeatures] feature 31/39 (MultiLineString, 198 lines ...) → dropped in 3695ms
[clipLineFeatures] done: 39 → 5 features in 62708ms
[measuringGeometry] buildMeasuringRenderState total: 64092ms for 1 question(s)
# ...then the whole thing runs a SECOND time on the next render:
[clipLineFeatures] starting clip of 39 features (3335 total lines) against play area
```

Three compounding causes:

1. **`@turf/line-split` per ring is O(ring_segs × polygon_segs).** `polygonFeaturesToLineFeatures`
   turns 39 dissolved polygons into 39 MultiLineStrings totalling **3,335 rings /
   ~20 k coords**. Every ring that isn't trivially fully-inside is fed to
   `lineSplit(ring, playAreaPolygon)` (`clipMultiLineString`, ~line 1305), and the
   clip polygon is the Tokyo 23-wards boundary — thousands of vertices. A single
   198-ring feature costs 3.7 s.

2. **No bbox pre-filter — we pay full price for features we then drop.** Of 39
   features only **5 are kept**; 34 are dropped. But each dropped feature is fully
   split before we discover it has nothing inside. `selectWindowFeatures` pulls a
   deliberate **50 km margin** (`MIN_WINDOW_MARGIN_M`) around the play area, so
   much of what reaches the clip is geographically nowhere near the boundary.
   Those 34 outside features account for ~50 of the 62 s.

3. **The result is not cached.** Buffer and category computations are LRU-cached,
   but the clipped `lineFeatures` are recomputed on every render — hence the
   second full run in the log. The work blocks the JS thread the entire time
   (frozen UI, hot device).

This geometry is **only the visible reference line** (the shoreline drawn on the
map). It is not the answer mask — that is `computeLineBuffer`. So boundary-exact
clip precision here is cosmetic.

## Goal

Make `clipLineFeaturesToPlayArea` **bounded and cheap** — target **< 100 ms** on
the real `body-of-water` window on first run, and **~0** on re-render — with no
visible change to the reference line at map zoom.

Three independent, complementary changes (A + B + C):

- **A. Bbox pre-filter** — reject features/rings whose bbox doesn't intersect the
  dilated play-area bbox before any expensive geometry.
- **B. Replace `lineSplit` with the vertex-based clip** for surviving rings.
- **C. Cache the clipped result** keyed on (category, boundary identity).

**Non-goals:** changing the bundle (P0, done), the buffer budget (P1, done), the
nearest-point scan (P2), or threading the derivation (P3). P6 is a localized
rewrite of one clip function plus a cache around its call site.

## Design

### A. Bbox pre-filter (biggest win)

Compute the dilated play-area bbox **once** at the top of
`clipLineFeaturesToPlayArea`, then short-circuit:

- **Per feature:** if the feature's bbox doesn't intersect the play-area bbox,
  drop it whole — never enter the ring loop.
- **Per ring (inside `clipMultiLineString`):** if a ring's bbox doesn't intersect
  the play-area bbox, skip it.

Reuse the existing helpers: `featureBbox` (~line 790) already prefers a
precomputed `f.bbox` and falls back to `computeBboxFromCoords`; `bboxIntersects`
is imported from `@/shared/geojson`. Bundle features carry cheap bboxes (the
`selectWindowFeatures` scan was 0 ms), so this reject is effectively free and
eliminates the 34 outside features outright.

Derive the clip polygon's bbox from its geometry once (it has no precomputed
`bbox`): walk `dilatedPlayArea.geometry.coordinates` via the existing
`computeBboxFromCoords`, or accept a `playAreaBbox` argument from the caller
(`buildMeasuringRenderState` already has `playAreaBbox` in scope — passing it
avoids recomputation and is the preferred shape).

### B. Vertex-based clip instead of `lineSplit`

For rings that survive the bbox reject, replace the `lineSplit` +
midpoint-inside test with the **already-present** `clipCoordsToPolygon` helper
(~line 1366): it keeps runs of consecutive inside vertices using one
`booleanPointInPolygon` per vertex — **O(n)** instead of `lineSplit`'s O(n×m).

This is exactly what the current `catch`/empty-split **fallback** already does;
B promotes it to the primary path and deletes the `lineSplit` call from
`clipMultiLineString` (and from `clipLineString`, for symmetry). The
`isFullyInside` fast-path stays.

**Quality trade-off:** a clipped line stops at its **last inside vertex** rather
than exactly on the boundary — a sub-vertex difference (≤ one segment, typically
metres) that is invisible at map zoom, and the play-area boundary is already
ε-dilated by 30 m (`CLIP_DILATION_M`) so the line slightly overshoots the visible
edge by design anyway. Acceptable for a cosmetic reference line; **not** to be
reused for the mask.

> Optional add-on (P6-D, only if A+B aren't enough): simplify the clip polygon
> (e.g. 50 m tolerance) before the point-in-polygon tests — `booleanPointInPolygon`
> cost scales with polygon vertex count. Left out of the default scope because A+B
> are expected to suffice; documented here so it's a known lever.

### C. Cache the clipped result

Add an LRU cache around the clip, mirroring the existing
`bufferCache` / `categoryCache` pattern in this file. Key on **(category,
boundary identity)** — the dilated boundary is already cached by identity in
`dilatedBoundaryCache` (`getDilatedPlayArea`, ~line 1092), so the boundary object
is stable across renders for a fixed play area.

Suggested shape (place near the other caches):

```ts
const CLIPPED_LINE_CACHE_VERSION = 1;
const CLIPPED_LINE_CACHE_MAX = 20;
const clippedLineCache = new Map<
    string,
    Feature<LineString | MultiLineString>[]
>();

// caller passes a stable boundary id; reuse the dilated-boundary identity.
function clippedLineCacheKey(category: MeasuringCategory, boundaryId: string) {
    return [CLIPPED_LINE_CACHE_VERSION, category, boundaryId].join(":");
}

export function clearClippedLineCache(): void {
    clippedLineCache.clear();
}
```

The cleanest place to cache is one level up, in `buildMeasuringRenderState`
(`measuringGeometry.ts`, ~line 238), where `q.category` and the
`playAreaBoundary` identity are both in hand — wrap the
`clipLineFeaturesToPlayArea` call. Either site is fine; caching at the call site
keeps `clipLineFeaturesToPlayArea` pure and easier to unit-test. Use a `WeakMap`
keyed on the boundary `features` array (same trick as `dilatedBoundaryCache`) so
the cache can't leak across play-area changes, plus the category in a composite
key.

## Implementation steps

1. **A —** In `clipLineFeaturesToPlayArea`, compute the dilated play-area bbox
   once (or add a `playAreaBbox?: Bbox` param and pass it from
   `buildMeasuringRenderState`). Add a per-feature `bboxIntersects` reject before
   the LineString/MultiLineString branch. In `clipMultiLineString`, add a
   per-ring `bboxIntersects` reject at the top of the ring loop.
2. **B —** In `clipMultiLineString` and `clipLineString`, replace the `lineSplit`
    - midpoint-inside block with `clipCoordsToPolygon`. Keep the `isFullyInside`
      fast-path. Remove the now-unused `lineSplit` import. The
      `clipLineStringFallback` / `clipCoordsToPolygon` helpers stay (now the primary
      path).
3. **C —** Add the clipped-line cache (a `WeakMap<Feature[], Map<string, ...>>`
   keyed on boundary identity + category) around the `clipLineFeaturesToPlayArea`
   call in `buildMeasuringRenderState`. Export a `clearClippedLineCache()` test
   seam.
4. Trim the now-misleading per-feature `console.log` timing in
   `clipLineFeaturesToPlayArea` to a single summary line (`N → M features in X ms`),
   since per-ring `lineSplit` timing no longer exists.
5. Update any `lineMeasuringGeometry` test that asserts on `lineSplit`-specific
   output shape (the vertex clip can emit one fewer boundary vertex per piece).
6. Add the perf benchmark spec (see **Perf benchmark** below) and record the
   before/after numbers in this doc's table. Capture the `master` baseline
   **before** removing the `lineSplit` path.

## Perf benchmark (before/after)

The point of A+B+C is a measurable speedup, so land a **real-bundle benchmark**
that prints structured timing — run it on `master` to capture the baseline, then
on the P6 branch to confirm the win. It doubles as the permanent regression guard
(the `toBeLessThan` budget).

Follow the repo's existing perf-test convention
(`matching/__tests__/poiSearch.perf.test.ts`): a `*.perf.test.ts` jest spec using
the **real committed bundle**, `performance.now()`, `console.log` for the numbers,
and `expect(...).toBeLessThan(budget)`. Run standalone so it never slows
`pnpm test`:

```bash
pnpm test -- --testPathPattern=clipLineFeatures.perf
```

### The spec

`src/features/questions/measuring/__tests__/clipLineFeatures.perf.test.ts`:

```ts
/**
 * Perf benchmark for the reference-line clip (P6).
 *
 * Uses the real committed body-of-water bundle + Tokyo 23-wards boundary —
 * no mocking. Prints first-run and warm-cache timing so before/after numbers
 * can be compared across commits.
 *
 * Run standalone:
 *   pnpm test -- --testPathPattern=clipLineFeatures.perf
 *
 * Baseline captured on `master` @ <commit> (pre-P6):
 *   body-of-water / Tokyo  first-run ~62000 ms   (see field log)
 * Target after A+B+C:
 *   body-of-water / Tokyo  first-run  < 1000 ms,  warm < 5 ms
 */

import {
    clipLineFeaturesToPlayArea,
    computeLineCategory,
    getDilatedPlayArea,
    polygonFeaturesToLineFeatures,
    clearLineCategoryCache,
    clearLineDistanceCache,
    clearDilatedBoundaryCache,
    clearClippedLineCache, // added by P6 part C
} from "../lineMeasuringGeometry";
import { __setLineBundleForTest } from "../lineBundleLoader";
import type { Bbox } from "@/shared/geojson";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

// Real committed assets.
const bodyOfWater = require("../../../../../assets/measuring/body-of-water.json");
const tokyo = require("../../../../../assets/default-zones/tokyo.json");

// Adapt the default-zone file to the boundary FeatureCollection shape the
// clip expects. (Mirror whatever MapAppScreen feeds buildMeasuringRenderState;
// if tokyo.json is already a FeatureCollection<Polygon|MultiPolygon>, use it
// directly.)
const boundary = tokyo as FeatureCollection<Polygon | MultiPolygon>;

// Tokyo 23-wards-ish window + a center inside it.
const TOKYO_BBOX: Bbox = [139.0, 35.0, 140.5, 36.2];
const SHINJUKU: [number, number] = [139.7004, 35.6896];

function setup() {
    clearLineCategoryCache();
    clearLineDistanceCache();
    clearDilatedBoundaryCache();
    clearClippedLineCache();
    __setLineBundleForTest("body-of-water", bodyOfWater);
}

describe("reference-line clip performance (body-of-water / Tokyo)", () => {
    it("first run clips the real window under budget", () => {
        setup();
        const cat = computeLineCategory(SHINJUKU, "body-of-water", TOKYO_BBOX);
        expect(cat).not.toBeNull();

        const lines = polygonFeaturesToLineFeatures(cat!.windowFeatures);
        const dilated = getDilatedPlayArea(boundary);

        const totalRings = lines.reduce(
            (n, f) =>
                n +
                (f.geometry.type === "MultiLineString"
                    ? f.geometry.coordinates.length
                    : 1),
            0,
        );

        const t0 = performance.now();
        const clipped = clipLineFeaturesToPlayArea(lines, dilated);
        const ms = performance.now() - t0;

        console.log(
            `[perf] clip body-of-water/Tokyo: ${lines.length} features / ` +
                `${totalRings} rings → ${clipped.length} kept in ${ms.toFixed(0)}ms`,
        );

        expect(clipped.length).toBeGreaterThan(0);
        expect(ms).toBeLessThan(1000); // pre-P6: ~62_000 ms
    });

    it("warm re-render hits the clip cache", () => {
        setup();
        const cat = computeLineCategory(SHINJUKU, "body-of-water", TOKYO_BBOX)!;
        const lines = polygonFeaturesToLineFeatures(cat.windowFeatures);
        const dilated = getDilatedPlayArea(boundary);

        clipLineFeaturesToPlayArea(lines, dilated); // prime
        const t0 = performance.now();
        clipLineFeaturesToPlayArea(lines, dilated); // cached
        const ms = performance.now() - t0;

        console.log(`[perf] clip warm re-render: ${ms.toFixed(1)}ms`);
        expect(ms).toBeLessThan(5);
    });
});
```

> The warm-cache assertion only holds if part C caches **inside** > `clipLineFeaturesToPlayArea`. If you instead cache at the
> `buildMeasuringRenderState` call site (the doc's preferred shape), benchmark
> the warm path through `buildMeasuringRenderState` instead, or expose the cached
> wrapper for the spec to call.

### Capturing before/after

1. **Baseline (before).** On `master`, the full clip is the bottleneck. Rather
   than wait ~62 s in CI, capture the number once locally and record it in the
   spec's header comment and in the table below — do **not** ship a 62 s test
   (raise the budget to `90_000` ms only while measuring the baseline, then drop
   it back to `1_000` ms for the committed version).
2. **After.** On the P6 branch, run the same spec; the printed
   `[perf] clip body-of-water/Tokyo: ...` line is the after number.
3. Paste both into the doc:

    | Case                            | Before (`master`)     | After (P6) | Notes                 |
    | ------------------------------- | --------------------- | ---------- | --------------------- |
    | body-of-water / Tokyo first run | ~62 000 ms            | _fill in_  | A (bbox) + B (vertex) |
    | body-of-water / Tokyo warm      | ~62 000 ms (uncached) | _fill in_  | C (cache)             |

### Optional: single-run A/B

For an apples-to-apples comparison in one command, temporarily keep the old
implementation exported as `clipLineFeaturesToPlayAreaLegacy` (the `lineSplit`
path) and have the spec time both, printing the ratio:

```ts
const tLegacy = time(() => clipLineFeaturesToPlayAreaLegacy(lines, dilated));
const tNew = time(() => clipLineFeaturesToPlayArea(lines, dilated));
console.log(
    `[perf] legacy ${tLegacy}ms → new ${tNew}ms (${(tLegacy / tNew).toFixed(0)}× faster)`,
);
```

Delete `clipLineFeaturesToPlayAreaLegacy` (and this A/B test) before merge — the
committed regression guard is the single-path budget test above. Note the legacy
path is ~62 s on Tokyo, so gate the A/B run behind an env flag
(`if (!process.env.PERF_AB) return;`) so it never runs in normal CI.

## Testing

> **Orientation.** Tests live in
> `src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts`.
> Inject synthetic bundles with `__setLineBundleForTest`, clear caches in
> `beforeEach` (add `clearClippedLineCache()` to the list). Reuse `makeBundle` /
> `makeLineFeature`. Single suite: `pnpm test -- lineMeasuringGeometry`.

### Unit tests

Add a `describe("clipLineFeaturesToPlayArea")` block. The function is exported
and pure (clip-at-call-site variant keeps it so).

1. **Bbox reject (A).** Build a play-area polygon over a small box and a feature
   whose bbox is entirely outside it. Assert the feature is dropped **and** that
   it short-circuits — e.g. assert via a spy / instrumented helper that
   `booleanPointInPolygon` is **not** called for the rejected feature (or, more
   robustly, assert a 10k-coord outside feature clips in < 5 ms).
2. **Vertex clip keeps the inside run (B).** A LineString that crosses the
   boundary (some vertices in, some out) returns only the inside run; assert every
   returned coordinate is `booleanPointInPolygon(c, playArea) === true`.
3. **Fully-inside fast path unchanged.** A line entirely inside returns the same
   feature (identity or deep-equal).
4. **MultiLineString recombination.** A MultiLineString with one inside ring and
   one outside ring returns a single LineString (the inside ring); two inside
   rings return a MultiLineString.
5. **Cache (C).** Call the cached path twice with the same (category, boundary);
   assert the second call returns in ~0 ms and `clearClippedLineCache()` forces a
   recompute. (If caching at the call site, test through `buildMeasuringRenderState`.)

### Real-bundle perf guard (the actual softlock)

Add to the `describe("real bundles")` block — this is the P6 regression guard;
pre-fix it would take ~60 s:

```ts
it("clips the real body-of-water window in well under a second", () => {
    const bundle = require("../../../../../assets/measuring/body-of-water.json");
    __setLineBundleForTest("body-of-water", bundle);
    const cat = computeLineCategory(
        [139.75, 35.68],
        "body-of-water",
        [139.0, 35.0, 140.0, 36.0],
    );
    expect(cat).not.toBeNull();
    const lines = polygonFeaturesToLineFeatures(cat!.windowFeatures);
    const dilated = getDilatedPlayArea(tokyoBoundaryFixture); // load assets/default-zones/tokyo.json
    const t0 = performance.now();
    const clipped = clipLineFeaturesToPlayArea(lines, dilated);
    const ms = performance.now() - t0;
    expect(clipped.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000); // pre-fix: ~60_000 ms
});
```

> Use the bundled Tokyo boundary (`assets/default-zones/tokyo.json`) as the clip
> polygon so the test exercises the real dense-boundary cost, not a toy square.

### Commands to run

```bash
pnpm test -- lineMeasuringGeometry      # unit + perf guard above
pnpm typecheck
pnpm check                              # lint/format/perf-typecheck/poi-selector drift
```

### Manual device check (recommended)

1. `pnpm exec expo start --dev-client -c`, open the app.
2. Play area = Tokyo 23 Wards. Add a Measuring question, category
   **Body of Water**.
3. **Pass:** the reference shoreline renders within ~1 s, clipped to the play
   area (no spill off-map), the app stays responsive, and re-opening / re-rendering
   the question does **not** re-run the clip (watch Metro for a single
   `[clipLineFeatures] done` line, then cache hits on subsequent renders).

## Acceptance criteria

- [ ] `clipLineFeaturesToPlayArea` on the real `body-of-water` window returns in
      < 1 s (target < 100 ms) — down from ~62 s.
- [ ] Bbox-rejected features never reach `booleanPointInPolygon`.
- [ ] Re-render reuses the cached clip (no second full run in field logs).
- [ ] Reference line still clips to the play area with no visible spill; existing
      measuring/reference-line tests stay green.
- [ ] `lineSplit` import removed; vertex clip is the primary path.
- [ ] `clipLineFeatures.perf.test.ts` committed with a `< 1 s` budget; the
      before/after table in this doc is filled in from real runs.
- [ ] `pnpm test` and `pnpm check` pass.

## Rollback

Localized to `clipLineFeaturesToPlayArea` / `clipMultiLineString` /
`clipLineString` plus a cache at one call site. Revert the commit; the
cache-version constant (and `WeakMap` identity keying) means no stale geometry
survives. The deleted `lineSplit` path is recoverable from git if the sub-vertex
endpoint difference ever proves visible.

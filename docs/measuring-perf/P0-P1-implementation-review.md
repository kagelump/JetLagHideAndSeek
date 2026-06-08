# Implementation review — P0 (dissolved polygon bundle) & P1 (runtime input budget)

**Reviewer:** Claude (Opus 4.8) · **Date:** 2026-06-08 · **Scope:** local
working-tree changes against
[`P0-dissolved-polygon-bundle.md`](P0-dissolved-polygon-bundle.md) and
[`P1-runtime-input-budget.md`](P1-runtime-input-budget.md).

## Verdict

| Plan                         | Status               | One-line                                                                       |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| **P1**                       | ✅ Shipped, faithful | Budget guard implemented, exported, tested; one minor lever skipped.           |
| **P0 (runtime branch)**      | ✅ Implemented well  | Polygon paths + reference-line conversion are correct and unit-tested.         |
| **P0 (extraction / bundle)** | ❌ **Broken**        | The dissolve never merges and ships an invalid bundle. `pnpm test` is **red**. |

**Bottom line:** P1 is good to go. P0's _runtime_ code is solid, but the
_build-time_ dissolve is fundamentally broken — two independent critical bugs
mean the regenerated `body-of-water.json` is both un-dissolved (31,302 features
vs the ≤2,000 target) and largely invalid (75% degenerate rings). The committed
test suite already fails on it. **Do not commit the current
`assets/measuring/body-of-water.json`; the extraction script needs fixing and
the bundle regenerated.**

---

## P1 — Runtime input budget ✅

Implemented in
[`lineMeasuringGeometry.ts`](../../src/features/questions/measuring/lineMeasuringGeometry.ts).

What matches the plan:

- Constants `MAX_BUFFER_SEGMENTS = 400`, `MAX_BUFFER_COORDS = 4000`,
  `BUFFER_STEPS = 4` (lines 378–386). ✓
- `applyBufferBudget` is exported and pure (line 428), with the bounded
  ≤6-round escalation loop exactly as designed — and it goes **beyond** the
  plan with a hard-cap final round (sort by length, slice to
  `MAX_BUFFER_SEGMENTS`, truncate coords) so it can never exceed budget even if
  escalation doesn't converge (lines 454–473). Good defensive addition.
- `steps: BUFFER_STEPS` passed to every `buffer(...)` call. ✓
- `LINE_BUFFER_CACHE_VERSION` bumped `3 → 5` (P1 asked for one bump past 3; P0
  bumped it again). ✓
- Before/after logging retained and extended. ✓
- Tests present and green: `describe("computeLineBuffer input budget")` with the
  segment-budget, short-feature-drop, and 1,000-feature perf guard
  (`lineMeasuringGeometry.test.ts:695`), plus the real-bundle smoke test
  (`:883`). Jest: **49/49 pass**.

Minor deviations (non-blocking):

- **Lever #1 skipped.** The plan's first lever — raise the min-feature-length
  floor to `Math.min(Math.max(radiusMeters*0.25, 250), 2000)` — was _not_
  applied. The floor is still the original `Math.min(radiusMeters*0.1, 500)`
  (line 577). The escalation loop compensates, so this is fine, but it's a
  deliberate-looking omission worth confirming.
- **Smoke-test threshold relaxed.** P1 specified `< 1.5 s`; the real-bundle
  smoke test asserts `< 3000` ms (`:899`). See the P0 section — the looser bound
  is a symptom of the broken bundle, not of P1.

---

## P0 — Dissolved polygon bundle

### Runtime branch ✅ (well done)

All the runtime-side work the plan called for is present and correctly
unit-tested with **synthetic** polygon fixtures:

- `LineBundleFeature`/`BundleFeature` widened to include `Polygon |
MultiPolygon` ([`lineBundleLoader.ts:12`](../../src/features/questions/measuring/lineBundleLoader.ts)). ✓
- `computeLineBuffer` branches on geometry type and buffers dissolved polygons
  directly, then unions polygon + line results (lines 498–737). ✓
- `computeLineDistance` handles polygons: `booleanPointInPolygon` → distance 0
  when the seeker is inside water, else nearest-point against boundary rings
  including holes (lines 912–939). ✓
- `featureToRings` / `polygonFeaturesToLineFeatures` extract boundary rings, and
  `measuringGeometry.ts` converts polygon window features to boundary lines
  _before_ `clipLineFeaturesToPlayArea` so the reference line stays a shoreline
  (lines 217–238). ✓
- All three cache versions bumped (`LINE_DISTANCE_CACHE_VERSION 1→2`,
  `LINE_CATEGORY_CACHE_VERSION 1→2`, `LINE_BUFFER_CACHE_VERSION 3→5`). ✓
- `describe("polygon body-of-water")` covers distance-outside, distance-inside
  (Polygon + MultiPolygon), holes, mixed bundles, polygon buffering, and
  ref-line conversion — all green.

These tests pass because they inject synthetic bundles. They do **not** exercise
the real generated artifact, which is where the problems are.

### Extraction / bundle ❌ (two critical bugs)

The regenerated `assets/measuring/body-of-water.json` (uncommitted,
working-tree) is **8.86 MB / 31,302 features**, versus the P0 acceptance target
of **< 1 MB / < 2,000 features**. It also makes `pnpm test` fail. Root cause is
two independent build-time bugs in
[`extract-measuring-bundles.mjs`](../../data/geofabrik/scripts/extract-measuring-bundles.mjs).

#### Bug A — `polygonDissolve` passes GeoJSON objects to polyclip-ts → every union throws → nothing merges

`polygonDissolve` calls `union(current, tilePolys[i].geometry)` and
`intersection(merged, tileGeom)` (lines 441, 479) with **GeoJSON geometry
objects** (`{type, coordinates}`). `polyclip-ts` expects raw coordinate arrays
(`feature.geometry.coordinates`), not geometry objects. Verified directly:

```
union({type:'Polygon',coordinates}, …)  → throws "Input geometry is not a valid Polygon or MultiPolygon"
union(coordinates, …)                    → OK
```

Both `union` and `intersection` are wrapped in `try/catch` that silently falls
back to keeping geometries separate, so the failure is invisible. Every union
throws, so each input polygon becomes its own "merge group" — **the dissolve is
a no-op.** Proof via the exported function:

```
polygonDissolve([squareA, squareB], …)  // two OVERLAPPING squares
→ 2 separate features  (expected: 1 merged feature)
```

And in the real bundle: **31,243 of 31,302 features contain exactly one
polygon** — confirming essentially nothing merged. The only size reduction vs
the old 11.5 MB ring bundle comes from per-feature simplify + the min-length
filter, not from dissolving.

**Fix:** pass `.coordinates` to `union`/`intersection` and wrap the results back
into geometry objects, e.g.:

```js
let current = tilePolys[0].geometry.coordinates;            // polyclip MultiPolygon coords
for (let i = 1; i < tilePolys.length; i++) {
    try { current = union(current, tilePolys[i].geometry.coordinates); }
    catch { groups.push(current); current = tilePolys[i].geometry.coordinates; }
}
…
const clipped = intersection(current, tileGeom.coordinates); // → coords
// then wrap: { type: 'MultiPolygon', coordinates: clipped }
```

(polyclip returns MultiPolygon-shaped nested arrays; downstream
`simplifyPolygonFeature`/`computePolygonBbox` expect a geometry object, so the
result must be re-wrapped with the correct `type`.)

#### Bug B — post-dissolve simplify collapses rings to 2–3 coords, nothing filters them → 75% degenerate features → invalid bundle, red tests

`polygonDissolve` runs `simplifyPolygonFeature(feat, ~0.0005°≈55 m)` on every
emitted feature (line 495). For small ponds, RDP `simplifyCoords` returns
`[first, last]` when no vertex exceeds tolerance (line 570), collapsing a ring to
**2 coordinates**. Unlike the _runtime_ `simplifyPolygonCoords`
(`lineMeasuringGeometry.ts:346`, which filters `ring.length >= 4`), the
build-time `simplifyPolygonFeature` does **no** post-simplify ring filtering.

Result in the real bundle: **23,630 of 31,302 features (75%) have rings with
< 4 coordinates** (mostly 2–3). These are not valid polygons. Consequences:

- `pnpm test` is **red**: `extract-measuring-bundles.test.mjs` →
  "every feature has a non-empty coordinates array" fails with
  _"MultiPolygon outer ring needs at least 4 coords"_.
- At runtime, a 2-coord "ring" makes `booleanPointInPolygon` always return
  `false` (inside-water detection silently fails) and `@turf/buffer` produces
  empty/garbage for those features — so most water bodies contribute nothing or
  wrong geometry to the mask. The smoke test still "passes" only because
  degenerate polygons buffer cheaply to ~nothing (which is also why the timing
  bound had to be relaxed from 300 ms / 1.5 s to 3 s).

**Fix:** after `simplifyPolygonFeature`, drop rings with < 4 coords and features
that fully degenerate — reuse the same filter the runtime `simplifyPolygonCoords`
already applies, or call `cleanPolygonFeature` again post-simplify and skip
`null` results.

#### The dissolve unit test is too weak to catch Bug A

`extract-measuring-bundles.test.mjs:478` —
_"dissolve merges overlapping polygons into a single polygon"_ — only asserts
`result.length >= 1`. It never asserts the two overlapping squares actually
merged (single feature, or area ≈ union not sum). The P0 plan explicitly asked
for _"area ≈ the union area (not the sum)"_; that assertion was dropped, which is
exactly why Bug A slipped through green tests. **Strengthen it** to assert
`result.length === 1` (single tile, fully overlapping input) and union-area
equality.

---

## Required actions before P0 can land

1. Fix Bug A: pass `.coordinates` to polyclip `union`/`intersection`; re-wrap
   results as geometry objects.
2. Fix Bug B: filter sub-4-coord rings after `simplifyPolygonFeature`.
3. Strengthen the dissolve unit test to assert actual merging (count + area).
4. Regenerate `pnpm data:measuring`, re-verify size (< ~1 MB) and feature count
   (< 2,000), then `git add` the artifact.
5. Tighten the real-bundle smoke-test bounds back toward the plan's targets once
   the dissolve actually works (P0: < 300 ms).
6. Re-run `node --test data/geofabrik/scripts/extract-measuring-bundles.test.mjs`
   and `pnpm test` — both must be green.

## What's fine to keep as-is

- All of P1 (optionally apply the skipped min-length lever).
- The entire P0 _runtime_ branch and its synthetic-fixture tests — they're
  correct and will work once the bundle is valid and actually dissolved.
- Cache-version bumps.
  </content>
  </invoke>

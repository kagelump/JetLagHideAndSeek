# PLAN — GEOS overlay-op parity test coverage

_2026-06-09. Follow-up to the G5 overlay-ops landing. Status: **planned, not started.**_

## Why

After G5, `difference` / `union` / `intersection` have **zero GEOS-backed test
coverage**. Only `bufferMeters` (`geosParity.test.ts`) and `unaryUnion`
(`measuringDissolve.geos.test.ts`) run against real GEOS (geos-wasm). The
`maskBuilder.ts` migration — the code path that actually changed for the measuring
question — is exercised **only by the JS backend**, which runs the _same polyclip-ts
code as before the migration_. So those green tests are structurally incapable of
catching a GEOS-vs-JS divergence.

During the body-of-water mask investigation, throwaway repros wiring real GEOS
overlays through `buildCombinedEligibilityMask` **passed** (0/198 point-containment
disagreement, <1% area diff) — confirming the overlay math is correct and the
suite's silence is a **coverage gap**, not a hidden math bug. This plan makes that
repro permanent so the gap can't reopen, and adds the backend-selection test that
would have flagged the `isAvailable()` regression (see
[PLAN-backend-availability-robustness.md](./PLAN-backend-availability-robustness.md)).

## Goal

1. A `*.geos.test.ts` suite that drives the **real GEOS engine** through every
   overlay op and through `buildCombinedEligibilityMask`, asserting parity with the
   JS oracle on **area and point-containment** (the latter catches winding / hole /
   inner-vs-outer-ring structural bugs that absolute area misses).
2. A default-jest backend-**selection** unit test covering js / geos / auto and the
   stale-binary (missing native op → fallback) path.

## Ordered work items

### W1 — Extend the geos-wasm shim with the three binary ops

[`geosWasmShim.ts`](../../src/shared/geometry/__tests__/helpers/geosWasmShim.ts)
currently exposes only `bufferWKB` and `unaryUnionWKB`. Add `differenceWKB`,
`unionWKB`, `intersectionWKB`, mirroring the native module's
`(a: Uint8Array, b: Uint8Array) => Uint8Array | null` contract. Pattern (validated
during the investigation — factor the WKB↔geom marshalling once):

```ts
const binary = (geosFn: string) => (a: Uint8Array, b: Uint8Array) => {
    const ga = toGeom(a),
        gb = toGeom(b); // _malloc + GEOSGeomFromWKB_buf
    const r = geos[geosFn](ga, gb); // GEOSDifference / GEOSUnion / GEOSIntersection
    geos.GEOSGeom_destroy(ga);
    geos.GEOSGeom_destroy(gb);
    if (!r) return null;
    const out = fromGeom(r); // GEOSGeomToWKB_buf + copy off heap
    geos.GEOSGeom_destroy(r);
    return out;
};
export const differenceWKB = binary("GEOSDifference");
export const unionWKB = binary("GEOSUnion");
export const intersectionWKB = binary("GEOSIntersection");
```

### W2 — `maskBuilder.geos.test.ts` — overlay parity vs JS oracle

New suite (runs under `pnpm test:geos`; the `*.geos.test.ts` glob already matches):
point `native-geometry` at the shim (bufferWKB + all four overlay ops), then for
each scenario build the mask under **both** `jsGeometryBackend` and
`geosGeometryBackend` (via `__setGeometryBackendForTest`) and assert parity.

Scenarios (cover the structural cases radar never produces):

- required-only, single constraint fully inside (radar-like) → Polygon-with-hole
- excluded-only, single constraint (farther)
- **band that splits the play area** → multi-member MultiPolygon result
- **constraint with a hole** (e.g. a ring buffer) → exercises inner-ring round-trip
- multi-required (≥2) → the `reduceOverlay(intersection)` path
- multi-excluded (≥2) → the `reduceOverlay(union)` path

Parity assertions per scenario:

- `|areaGeos − areaJs| / areaJs < 0.01` (shoelace over all rings, holes subtracted)
- **point-containment grid**: sample a grid; `pointInMask(geos) === pointInMask(js)`
  for ≥95% of points (even-odd rule over all rings). This catches winding/hole
  inversions that absolute-area parity cannot.

### W3 — body-of-water dissolve→mask integration parity

One scenario that runs the real pipeline end to end: `computeLineCategory` →
`computeLineBuffer` (GEOS `unaryUnion` dissolve) → `buildCombinedEligibilityMask`
(GEOS `difference`), compared to the JS path, using the committed
`assets/measuring/body-of-water.json` bundle (as `measuringDissolve.geos.test.ts`
already loads). Assert containment parity, not just "returns". This is the exact
case that broke; lock it.

### W4 — Backend-selection unit test (default jest)

New `geometryBackend.selection.test.ts` (default `pnpm test`, native mocked-absent):

- `backend = "js"` → `jsGeometryBackend`
- `backend = "geos"` + mock `isAvailable() → true` → `geosGeometryBackend`
- `backend = "geos"` + `isAvailable() → false` → JS fallback (+ assert the loud warn
  from the robustness plan)
- `backend = "auto"` mirrors availability
- **stale binary**: native present, `bufferWKB` a function but `differenceWKB`
  undefined → backend still GEOS, `backend.difference(...)` returns a result via the
  per-op JS fallback (assert it does NOT throw / does NOT return null for a valid
  non-empty difference)

Reset memoized selection with `__setGeometryBackendForTest(null)` in `afterEach`.

### W5 — Wire-up + hygiene

- No new script needed: `jest.config.geos.js` `testMatch` already includes
  `**/__tests__/**/*.geos.test.{ts,tsx}`.
- Keep the shim's marshalling helpers in `geosWasmShim.ts` (not duplicated per test).
- Ensure `jest.setup.ts`'s `native-geometry` mock keeps returning `null` for the four
  overlay ops so the **default** suite exercises the JS fallback, while the
  `.geos.test.ts` suites override with the real wasm engine.

### W6 — Projection-finiteness guard (regression test for the all-NaN incident)

A field incident (see Learnings below) had the AEQD projection silently produce
**all-NaN** coordinates, so `bufferMeters` returned `null` for every input and the
mask went blank — with green tests throughout. Add cheap guards so this can never
recur silently:

- **Unit test (`bufferProjection.test.ts`, default jest):** assert
  `projectionFor(feature)` yields a projection whose output is **finite** for a
  known feature, and that `projectGeometry(...)` contains no non-finite coords.
  Also assert `EARTH_RADIUS` / `EARTH_RADIUS_METERS` is a finite positive number at
  import time (a direct tripwire for the "constant undefined via require cycle"
  failure mode).
- **Runtime guard (already shipped):** the `[geosSanity]` check in
  `geosGeometryBackend.ts` walks the projected geometry before the native call and
  warns loudly (with a sample bad coord and an input-vs-projected breakdown) when it
  would be rejected by GEOS. Keep it — it's quiet on the happy path and is the
  tripwire that localized this incident. A `bufferProjection`-level invariant
  (`if (!Number.isFinite(EARTH_RADIUS)) throw`) is a reasonable belt-and-suspenders.

### W7 — Require-cycle detection in CI (the gap that hid the real bug)

The all-NaN bug was a **require cycle** that only misbehaved under Hermes' module
init order; Jest/V8 resolved it benignly, so **every test (including the real-GEOS
parity repros) passed** while the device was broken. No amount of geometry-parity
testing catches an init-order hazard — it needs a structural check:

- Add a `madge --circular` (or equivalent) check over `src/` to `pnpm check`, or a
  focused guard asserting `src/shared/geometry/*` has no cycle through
  `@/shared/geojson`. Fail CI on new cycles.
- Treat Metro's boot-time `Require cycle: …` warning as a signal, not noise —
  cycles through modules that export **consumed-at-init constants** (like
  `EARTH_RADIUS_METERS`) are latent NaN/undefined bombs.

## Files to add / modify

1. `src/shared/geometry/__tests__/helpers/geosWasmShim.ts` — W1 three binary ops
2. `src/features/map/__tests__/maskBuilder.geos.test.ts` — W2 (new)
3. `src/features/questions/measuring/__tests__/bodyWaterMask.geos.test.ts` — W3 (new)
4. `src/shared/geometry/__tests__/geometryBackend.selection.test.ts` — W4 (new)
5. `src/shared/geometry/__tests__/bufferProjection.test.ts` — W6 (new)
6. `package.json` / `pnpm check` — W7 cycle check (e.g. `madge --circular src`)

## Acceptance

- `pnpm test:geos` runs the new suites green against real GEOS; deliberately breaking
  an overlay adapter (e.g. swapping `difference`↔`intersection`) makes W2 fail.
- `pnpm test` runs W4 green with native mocked-absent.
- A future regression like the G5 `isAvailable()` tightening is caught by W4; a future
  GEOS-vs-JS overlay divergence is caught by W2/W3.
- W6 fails if the projection ever yields non-finite output; W7 fails CI on a new
  require cycle. Together they close the two gaps that let the all-NaN incident ship.

## Verification

```bash
pnpm typecheck
pnpm test                 # includes W4 (selection) + W6 (projection finiteness)
pnpm test:geos            # includes W1–W3 (real GEOS via geos-wasm)
pnpm check                # + W7 require-cycle check
```

## Learnings (field incidents)

### The body-of-water blank-mask incident — a require cycle, not a geometry bug

**Symptom:** after G5, `body-of-water` measuring rendered no mask on device while
`radar` worked. Native logs showed `bufferWKB: failed to parse WKB` for every
polygon (`Points of LinearRing do not form a closed linestring`) and the line
buffer (`Invalid Coordinate at or near point nan nan`).

**Root cause:** G5 added `import { getGeometryBackend } from geometryBackend` to
`shared/geojson.ts` (for the `unionPolygons` migration). That closed a require
cycle:

```
geojson → geometryBackend → geosGeometryBackend → bufferProjection → geojson
                                                   (imports EARTH_RADIUS_METERS)
```

Under **Hermes'** init order, `bufferProjection.ts` evaluated
`export const EARTH_RADIUS = EARTH_RADIUS_METERS` while `geojson.ts` was only
partially initialized, so `EARTH_RADIUS` was `undefined`. The AEQD projection then
ran with `geoAzimuthalEquidistant().scale(undefined)` → **every projected
coordinate was `NaN`**. A `NaN` ring endpoint makes first≠last (`NaN !== NaN`), so
GEOS reports it as "ring not closed"; the line variant surfaced as "nan nan". Net:
`bufferMeters` returned `null` for everything → no eligible geometry → blank mask.

**Fix:** moved `EARTH_RADIUS_METERS` into a dependency-free leaf
(`shared/geometry/earthRadius.ts`); `bufferProjection` imports it from the leaf and
`geojson` re-exports it. `bufferProjection` no longer depends on `geojson`, so the
cycle is gone. **JS-only fix — no native rebuild; the GEOS binary was never at
fault.**

**Why every test stayed green (the lessons this plan encodes):**

1. **The hazard was module init order, not math.** Jest/V8 resolves the cycle in a
   benign order, so the constant was defined in tests and all geometry parity passed.
   Geometry-parity tests (W2/W3) — however thorough — cannot catch this class of
   bug. Only a structural cycle check (W7) can. **This is the most important
   takeaway: a passing real-GEOS parity suite is necessary but not sufficient;
   init-order/packaging hazards need their own guardrail.**
2. **`radar` working masked it.** `radar` doesn't route through `bufferProjection`,
   so "radar works, measuring doesn't" was the tell that the fault was in the
   shared _buffer/projection_ path, not the overlay ops or the backend selection.
   When triaging "feature X broke, feature Y works," diff the code paths they
   _don't_ share first.
3. **Layering discipline prevents the recurrence.** A low-level projection
   primitive must not import a high-level utils module. Pure constants belong in
   import-free leaves. `earthRadius.ts` documents this in-file.
4. **A cheap runtime tripwire pays for itself.** The `[geosSanity]` check (W6)
   turned "silent blank mask" into a one-line diagnosis pinpointing
   projection-introduced NaN with a sample coordinate. Keep such guards at
   marshalling boundaries where a malformed value would otherwise fail opaquely in
   native code.

# G5 Plan — Native GEOS Overlay Ops

_2026-06-09. Part of the [native-geometry implementation plan](./implementation-plan.md). Follows [G4](./implementation-plan.md) (simplification retune)._
_Status: **planned, not started.**_

## Context

G0–G4 shipped the GEOS-native `bufferMeters` backend, which moved the line-measuring
buffer hot-path (~10.7s JSTS → ~1–5ms GEOS). But `maskBuilder.ts` still uses
**polyclip-ts** (pure-JS sweepline) for `difference`/`union`/`intersection`. On the
body-of-water category, a single `difference(eligibleArea, excludedArea)` takes
**22.3 seconds** on device — the dissolved water buffer is ~40+ polygons with
thousands of coastline vertices. The 22.3s is the last JS-based geometry bottleneck.

G5 extends the `GeometryBackend` interface with `difference`, `union`, `intersection`,
and `unaryUnion`, backs them with GEOS native, and routes all polyclip-ts call sites
through the backend. Estimated impact: body-of-water re-mask drops from ~26.3s to
~2.5s (residual is GEOS dissolve + turf nearest-point-on-line).

> **Key difference from `bufferMeters`: overlay ops are NOT projected.** > `bufferMeters` projects WGS84 → per-feature AEQD meters because buffering by a
> metric distance is inherently metric. `difference`/`union`/`intersection`/
> `unaryUnion` are **coordinate-system-agnostic topological ops** — the JS oracle
> (polyclip-ts) and the web app (`turf.difference`) run them directly on lon/lat
> degrees, and GEOS (the reference robust-overlay implementation) is equally happy
> in degree space. Passing GEOS the **same raw WGS84 coordinates** the oracle uses
> (a) maximizes parity (no round-trip projection drift), (b) avoids AEQD distortion
> of the second operand when it is far from the first's centroid (e.g.
> `difference(playArea, waterBuffer)` over Tokyo's ~30 km-wide wards), and (c) is
> simpler/faster (no `@turf/center` + d3-geo per call). **The overlay pipeline is
> `encode → call native → decode`, with no project/unproject step.**

## Scope

Only add to the existing seam — no new architecture, no new modules. The `native-geometry`
Expo Module gains four new synchronous WKB functions; the JS/GEOS backends each implement
the new interface methods; and four call sites (maskBuilder, geojson, clipVoronoiCells,
lineMeasuringGeometry) switch from direct polyclip-ts to the backend.

## Ordered work items

### W1 — Extend GeometryBackend interface (`geometryBackend.ts`)

Add four new methods to the interface:

```ts
difference(
    a: Feature<Polygon | MultiPolygon>,
    b: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> | null;

union(
    a: Feature<Polygon | MultiPolygon>,
    b: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> | null;

intersection(
    a: Feature<Polygon | MultiPolygon>,
    b: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> | null;

unaryUnion(
    a: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> | null;
```

All binary (N-ary handled by `reduce` at call sites). All return `null` for empty results
(same convention as `bufferMeters`). JSDoc each one referencing the GEOS C API.

### W2 — Extend native module (WKB-level overlay ops)

#### W2a — Pattern

The code follows the exact same shape as `bufferWKB`:

1. Parse WKB → GEOS geometry (validating both inputs for binary ops)
2. MakeValid if invalid
3. Call GEOS operation
4. Write result to WKB
5. Clean up (destroy all GEOS geometries, GEOSFree WKB buffer)

**No projection.** Unlike `bufferWKB`, the JS adapter (W4) hands the native layer
raw WGS84 coordinates — overlay ops run in degree space (see the Scope note). The
native code is unit-agnostic and needs no change for this; it just parses, operates,
and writes WKB.

**Memory-ownership is the riskiest new native code.** A binary op owns **two** input
geometries (`geomA`, `geomB`), each possibly reassigned on `MakeValid`, **plus** the
result — every one destroyed exactly once. The shipped `_bufferAndWrite` helper
already isolates the validate→op→write→free dance for one geometry. Factor a single
`_binaryOpAndWrite(ctx, a, b, op)` (and reuse `_bufferAndWrite`'s structure for
`unaryUnion`) **per platform** so the `defer`/ownership pattern is written once, not
inlined four times. This prevents the G1 smoke-test double-free class of bug from
reappearing across four new entry points.

#### W2b — iOS (`NativeGeometryModule.swift`)

Add four new `Function` entries:

```
Function("differenceWKB")   { (wkbA: Data, wkbB: Data) -> Data? }
Function("unionWKB")        { (wkbA: Data, wkbB: Data) -> Data? }
Function("intersectionWKB") { (wkbA: Data, wkbB: Data) -> Data? }
Function("unaryUnionWKB")   { (wkb: Data) -> Data? }
```

Each follows the same pattern as `bufferWKB`:

- Parse WKB → `geomA`, `geomB` (for binary) or `geom` (for unary)
- Own pointers with `defer { GEOSGeom_destroy_r }` pattern (single owning var, no double-free)
- Validate + MakeValid each
- Call `GEOSDifference_r` / `GEOSUnion_r` / `GEOSIntersection_r` / `GEOSUnaryUnion_r`
- Write result WKB → Data

For binary ops, add DEBUG NSLog timing (parse + valid + makeValid + op + total).

#### W2c — Android JNI (`native-geometry-jni.cpp`)

Add four JNI exports:

```c
JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nativegeometry_NativeGeometryModule_nativeDifferenceWKB(...)
Java_expo_modules_nativegeometry_NativeGeometryModule_nativeUnionWKB(...)
Java_expo_modules_nativegeometry_NativeGeometryModule_nativeIntersectionWKB(...)
Java_expo_modules_nativegeometry_NativeGeometryModule_nativeUnaryUnionWKB(...)
```

Each follows the same parse→validate→op→write pattern as `nativeBufferWKB`.

#### W2d — Android Kotlin (`NativeGeometryModule.kt`)

Add four `Function` entries + `external fun` declarations:

```kotlin
Function("differenceWKB")   { wkbA: ByteArray, wkbB: ByteArray ->
    nativeDifferenceWKB(wkbA, wkbB)
}
// ... union, intersection, unaryUnion
```

#### W2e — JS entry (`modules/native-geometry/src/index.ts`)

Export four new typed wrappers:

```ts
export function differenceWKB(a: Uint8Array, b: Uint8Array): Uint8Array | null;
export function unionWKB(a: Uint8Array, b: Uint8Array): Uint8Array | null;
export function intersectionWKB(
    a: Uint8Array,
    b: Uint8Array,
): Uint8Array | null;
export function unaryUnionWKB(wkb: Uint8Array): Uint8Array | null;
```

Same pattern as `bufferWKB`: call native, null-guard the result, return Uint8Array.

**Also guard against a partial native ABI.** `isAvailable()` today probes only
`typeof Native.bufferWKB === "function"`, so a stale binary that has `bufferWKB` but
not the new overlay functions would still select GEOS and then call `undefined`. Each
new wrapper must check `typeof Native.differenceWKB === "function"` (etc.) and return
`null` when absent, so the `geosGeometryBackend` falls back to JS instead of throwing.
(Low risk — committed artifacts are rebuilt together — but cheap insurance, and it
keeps the seam's "native unavailable → JS" contract honest at the per-op level.)

### W3 — Implement jsGeometryBackend overlay ops

Each method wraps polyclip-ts:

- **`difference(a, b)`**: extract coordinates from both Features → `polyclip.difference(aCoords, bCoords)` → wrap result as Feature or null if empty
- **`union(a, b)`**: same with `polyclip.union(aCoords, bCoords)`
- **`intersection(a, b)`**: same with `polyclip.intersection(aCoords, bCoords)`
- **`unaryUnion(a)`**: if Polygon → return it as-is (a single polygon has no self-overlap); if MultiPolygon → `polyclip.union(allPolygons[0], ...rest)` over its member polygons

All methods add `[js]` prefixed timing logs matching the existing `bufferMeters` pattern.

### W4 — Implement geosGeometryBackend overlay ops

**No projection** (see the Scope note). Overlay ops are topological, so the adapter
hands GEOS the same raw WGS84 coordinates polyclip-ts uses — `encode → call → decode`
— rather than the AEQD project/unproject chain that `bufferMeters` needs. This keeps
the GEOS result in the oracle's own coordinate space (tight parity) and avoids
distorting the second operand.

- **Binary ops** (`difference`, `union`, `intersection`):

    1. Encode `a` to WKB (raw WGS84)
    2. Encode `b` to WKB (raw WGS84)
    3. Call native binary op
    4. Decode result WKB to a Polygon/MultiPolygon Feature (null on empty)

- **`unaryUnion(a)`**: encode `a` → `native.unaryUnionWKB` → decode.

- Fallback: any exception (incl. a missing native op per W2e) → the corresponding
  `jsGeometryBackend` method, same pattern as `bufferMeters`.
- Timing: add `[geos]` prefixed logs for each op.

Factor the shared chain into `binaryGeosOp(a, b, nativeFn)` so the
encode→call→decode→fallback pipeline is written once, not four times. **Reuse the WKB
codec from G2 unchanged** — the only G2 helper that does _not_ carry over is the
`bufferProjection` step, which is deliberately omitted here.

> **Parity note for reviewers:** GEOS robust overlay and polyclip's Greiner-Hormann
> compute intersection vertices with different math, so overlay output is **never**
> byte-identical to the oracle regardless of coordinate space — parity is an area/
> Hausdorff tolerance, not equality (see W7b). Operating in degrees (not AEQD) keeps
> that drift minimal and unbiased.

### W5 — Migrate call sites

#### W5a — `maskBuilder.ts` (the main bottleneck: 22.3s → ~1–10ms)

The current code works with `polyclip-ts` `Geom` (bare `Position[][][]`). The
backend takes `Feature<Polygon|MultiPolygon>`. Add two small helpers:

- `geomToFeature(coords: Position[][][]): Feature<Polygon|MultiPolygon>` — wrap bare coords
- `featureToGeom(f: Feature<Polygon|MultiPolygon>): Position[][][]` — unwrap

Then replace each polyclip call with a backend.reduce:

1. `intersection(requiredGeoms[0], ...requiredGeoms.slice(1))` → backend.intersection reduce
2. `union(excludedGeoms[0], ...excludedGeoms.slice(1))` → backend.union reduce
3. `difference(eligibleArea, excludedArea)` → backend.difference
4. `difference(playAreaPolygons, eligibleArea)` → backend.difference

Update `hasGeomArea` to accept Features, or unwrap before calling it.

Remove `import { difference, intersection, union } from "polyclip-ts"`.

#### W5b — `shared/geojson.ts` (`unionPolygons`)

Replace `polyUnion(coords[0], ...coords.slice(1))` with a backend.union reduce over the
Feature array (`polygons` is already `Feature<Polygon, P>[]`). Remove `polyUnion` import.

#### W5c — `clipVoronoiCells.ts`

Replace `intersection(cellGeom, boundaryCoords)` with:

1. Wrap cell and boundary as Features
2. Call `backend.intersection(cellFeature, boundaryFeature)`
3. Unwrap result coordinates

The bbox pre-filter and caching layer stay unchanged — they're already the right
optimization regardless of backend.

**Perf footgun — hoist the boundary WKB encode out of the per-cell loop.** The slow
path calls `intersection` once per straddling cell against the _same, large_ boundary
([`clipVoronoiCells.ts:223`](../../src/features/questions/clipVoronoiCells.ts)). A
naive adapter re-encodes the boundary to WKB (and GEOS re-parses + re-validates it)
on every iteration. Encode the boundary Feature once before the loop and pass the
cached WKB into each `intersection` call — or, if profiling shows it dominates,
this is the `GEOSPrepare_r` / `GEOSPreparedIntersection_r` case (prepare the boundary
once, intersect many cells). Prepared geometry is **out of scope for G5 unless W7
measurement demands it** — start with the cheap encode hoist. This is a perf, not a
correctness, concern (the un-hoisted path still produces correct masks).

#### W5d — `lineMeasuringGeometry.ts` (dissolve trick)

Replace `backend.bufferMeters(merged, 0, BUFFER_STEPS)` with `backend.unaryUnion(merged)`
at [`lineMeasuringGeometry.ts:759`](../../src/features/questions/measuring/lineMeasuringGeometry.ts).
`bufferMeters(geom, 0)` already works (GEOS buffer at distance 0 is effectively
unary-union), but `unaryUnion` is the correct semantic and drops the misleading
`bufferSteps` argument.

**Preserve the `if (backend.name !== "geos") return merged;` guard at line 756.** The
JS backend deliberately does **not** dissolve here: the input is ~40 heavily
overlapping buffer ribbons, which is polyclip's worst case (the ~25 s JSTS hang this
guard exists to avoid). Routing the new JS `unaryUnion` through this pathological
input would reintroduce the softlock. Only the GEOS backend dissolves; the JS path
keeps returning the un-dissolved `merged`. Do **not** remove the guard when wiring
`unaryUnion`.

### W6 — Tests

#### W6a — JS backend overlay tests (`jsGeometryBackend.test.ts`)

Extend existing backend test file. Test each overlay op with known polygon fixtures:

- `difference(square, innerSquare)` → square-with-hole
- `union(adjacentSquares)` → merged L-shape
- `intersection(overlappingSquares)` → overlap region
- `unaryUnion(selfOverlappingMultiPolygon)` → dissolved single polygon

All run in Jest with the JS backend (polyclip-ts under the hood).

#### W6b — GEOS adapter tests (`geosGeometryBackend.test.ts`)

Extend existing T3-style tests:

- Mock `native-geometry` overlay WKB functions to echo fixed known polygons
- Assert the `encode → call → decode` wiring works for each op (no projection — the
  WKB the adapter sends should carry the **raw WGS84** coordinates of the inputs;
  assert the bytes handed to the mocked native fn round-trip the input geometry
  unprojected)
- Assert binary ops feed both operands' coordinates through unchanged (no AEQD
  transform applied to either)
- Assert the empty-result → `null` path, the missing-native-op → JS-fallback path
  (W2e), and the exception → JS-fallback path

#### W6c — Existing suites

- `maskBuilder.test.ts`, `clipVoronoiCells.test.ts`, `lineMeasuringGeometry.test.ts`
  — should pass **unchanged**. These exercise the **JS** backend, which keeps running
  the same polyclip-ts code (just reached through the new interface methods), so
  output is identical.
- `measuringDissolve.geos.test.ts` — **must be updated, not left unchanged.** W5d
  swaps the GEOS dissolve from `bufferWKB(merged, 0)` to `unaryUnionWKB(merged)`, so:
  (a) the test's native mock moves from `bufferWKB` → `unaryUnionWKB`, and (b) any
  assertion that the GEOS path invokes `bufferWKB` must move to `unaryUnionWKB`. The
  _behavioral_ contract (GEOS dissolves, JS returns un-dissolved `merged`) is
  preserved; only the native entry point it routes through changes.

#### W6d — Jest mock

Update `jest.setup.ts` mock for `native-geometry` to include the four new WKB functions
(returning `null` by default → JS fallback exercised in Jest).

### W7 — Validation (on-device)

- **W7a — Body-of-water re-mask timing**: Place a body-of-water measuring question, toggle
  positive. Verify the re-mask time drops from ~26.3s to ~2.5s or better.
- **W7b — Correctness (quantitative, not just visual)**: GEOS robust overlay and
  polyclip's Greiner-Hormann compute intersection vertices differently, so the masks
  will never be byte-identical — a visual check can miss a systematic area bias.
  Reuse the **G3 oracle-diff harness** (area symmetric-difference ratio + Hausdorff
  distance) on the GEOS vs JS mask for at least the body-of-water `difference`. Gate:
  symmetric-diff area < ~1%. Operating in degree space (W4) keeps this drift small;
  the harness is what proves it.
- **W7c — Maestro**: Run existing E2E flows for body-of-water and admin-1st-border with
  `backend: "geos"` — no crashes, mask renders correctly.

## Files to modify (in order)

1. `src/shared/geometry/geometryBackend.ts` — add interface methods
2. `modules/native-geometry/src/index.ts` — add 4 JS wrappers
3. `modules/native-geometry/ios/NativeGeometryModule.swift` — add 4 native functions
4. `modules/native-geometry/android/src/main/cpp/native-geometry-jni.cpp` — add 4 JNI exports
5. `modules/native-geometry/android/src/main/java/expo/modules/nativegeometry/NativeGeometryModule.kt` — add 4 Function entries
6. `src/shared/geometry/jsGeometryBackend.ts` — add 4 polyclip-ts implementations
7. `src/shared/geometry/geosGeometryBackend.ts` — add 4 GEOS implementations
8. `src/features/map/maskBuilder.ts` — replace polyclip calls with backend calls
9. `src/shared/geojson.ts` — replace `polyUnion` with backend.union reduce
10. `src/features/questions/clipVoronoiCells.ts` — replace `intersection` with backend
11. `src/features/questions/measuring/lineMeasuringGeometry.ts` — replace dissolve trick with `unaryUnion`
12. Jest tests — extend `jsGeometryBackend.test.ts` / `geosGeometryBackend.test.ts`
13. `jest.setup.ts` — expand mock for new WKB functions

## Verification

```bash
# Type-check everything first
pnpm typecheck

# Unit tests (Jest — JS backend only, GEOS mocked)
pnpm test

# Full check (lint + format + typecheck + perf + POI drift)
pnpm check

# On-device: place body-of-water, toggle positive/negative
# Confirm mask renders and re-mask is fast (~2–3s vs 26s)

# Maestro E2E
pnpm test:e2e:stack  # Android
```

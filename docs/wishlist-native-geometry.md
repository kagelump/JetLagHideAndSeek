# Wishlist — Native GEOS for measuring-mask geometry

_2026-06-08. Status: **idea / not scheduled.** Captures a perf investigation
into the measuring-question buffer cost and the option of pushing the hot
geometry path to native code. Sibling to `docs/measuring_perf_audit.md` and
`docs/measuring-perf/` (P0–P8), which cover the pure-JS optimizations that
should be exhausted **before** this is worth doing._

> **Update 2026-06-09:** there is now a concrete implementation plan for option
> 2 — see [`docs/native-geometry/implementation-plan.md`](native-geometry/implementation-plan.md).
> It's being pursued because the goal is to **reduce** line simplification (the
> mask sits too far off the true geometry), which makes pure-JS lever #1
> ("simplify harder") counter-productive rather than the recommended first step.

## TL;DR

The dominant cost in building a line-category measuring mask
(`admin-1st-border`, `coastline`, rail, …) is a single `@turf/buffer` (JSTS)
call. On a real device it was measured at **~10.7s** for ~1,600 coords across 8
border segments at a ~5.4 km radius. The algorithm is fine — the cost is the
runtime: **Hermes has no JIT**, so JSTS's hot interpreter loop runs ~20–50×
slower than it would under V8.

Swapping JS engines does **not** fix this on iOS (Apple forbids JIT in
third-party apps, so every engine interprets). The two durable levers are:

1. **Do less work in JS** — aggressive simplification + lower coord budget +
   non-blocking dispatch. Cheap, high-leverage, do this first.
2. **Push the hot path to native** — wrap **GEOS** (the C++ library JSTS is a
   port of) in a JSI module. Turns ~10s into ~1–5ms, but adds a permanent
   native-build/maintenance surface.

This doc is about option 2.

## Measured breakdown (device log, admin-1st-border, "positive")

| Step                                | Cost          | Notes                                   |
| ----------------------------------- | ------------- | --------------------------------------- |
| `lineBuffer` (turf/JSTS buffer)     | **10,679 ms** | 8 segments, 1587 coords, ~5.4 km radius |
| `clipLineFeatures` (reference line) | 535 ms        | first/unanswered pass only              |
| `maskBuilder difference`            | 635 ms        | play-area minus eligible-area           |
| `lineDistance` simplify + turf      | ~160 ms       | cached after first query                |

`buildMeasuringRenderState total: 10735ms` — i.e. the buffer **is** the problem.

Relevant code: `src/features/questions/measuring/lineMeasuringGeometry.ts`
(`computeLineBuffer`, simplify tolerance at `:666`, `MAX_BUFFER_COORDS` at
`:400`).

## Why the runtime, not the algorithm

- **Hermes** (RN default) is an ahead-of-time _bytecode interpreter_. Optimized
  for startup time, memory, and app size — not sustained compute. A tight
  numeric loop like JSTS buffer/noding is its worst case.
- The taibeled web app
  (`src/maps/questions/measuring.ts`) does essentially the same thing —
  `turf.simplify()` then `turf.buffer()`, with `turf.difference(bbox, buffer)`
  for coastlines. It feels fast only because it runs in **V8 with a JIT** on
  desktop. No algorithmic trick to copy.

### JS runtime landscape

| Engine         | JIT?              | Where                                         | Notes                                 |
| -------------- | ----------------- | --------------------------------------------- | ------------------------------------- |
| V8             | Yes (TurboFan)    | Node/Chrome; `react-native-v8` (Android only) | fastest peak compute                  |
| JavaScriptCore | Yes (multi-tier)  | Safari, Android                               | old RN default pre-Hermes             |
| Hermes         | **No** (bytecode) | RN default                                    | best startup/memory, worst compute    |
| Static Hermes  | AOT→native (exp.) | not production-default                        | dramatically faster, not shipping yet |

**iOS catch:** third-party apps cannot map executable+writable memory, so **no
JS engine JITs on iOS** — Hermes, JSC, and V8 all interpret. Switching engines
can help compute on **Android** (`react-native-v8`/JSC), but creates a
cross-platform perf cliff and does nothing for iOS. This is why "go native" is
the only engine-independent fix.

## Native GEOS — cost analysis

### Runtime cost (the cheap part)

- GEOS buffer of ~1,600 coords: **sub-ms to low-single-digit ms** on a phone.
  ~10,700 ms → ~1–5 ms.
- Identical speed on iOS and Android (compiled native, no JIT involved).
- Runs on a background thread → never blocks JS/UI regardless.

### Marshalling cost (don't reintroduce it)

- **Don't** pass JS arrays-of-arrays across the bridge — host-object conversion
  can dominate.
- **Do** flatten to a `Float64Array` / WKB `ArrayBuffer` over JSI (≈ zero-copy).
  For ~1,600 coords this is < 1ms each way.
- Clean design: JS → WKB `ArrayBuffer` → GEOS parses, buffers → WKB back → JS
  parses. GEOS speaks WKB natively; encode/decode is cheap vs. the saving.

### The costs you actually pay

| Cost                  | Reality                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App binary size       | ~1–3 MB per architecture. arm64 (iOS) + arm64-v8a (Android) is the common ship target; store thinning helps.                                                        |
| Build / vendoring     | The real work: build GEOS (C++17) for iOS (device + arm64 sim xcframework/pod) and Android (CMake/NDK `.so` per ABI). No turnkey Expo package — vendor it yourself. |
| Module glue           | JSI wrapper via Expo Modules API (C++ support) or Nitro Modules. A few hundred lines + a config plugin.                                                             |
| Expo workflow         | Each change → `expo prebuild` + dev-client rebuild; Expo Go unusable. (Already true here due to MapLibre, so no new loss.)                                          |
| Maintenance/debugging | Native crashes (bad geometry into GEOS) need boundary validation; CI needs NDK + iOS toolchain; GEOS upgrades = re-vendor.                                          |

### Lighter alternatives considered

- **Rust `geo` / `geo-buffer` via UniFFI/JSI** — easier cross-compile (cargo
  handles ABIs), smaller, but buffering/noding is **less battle-tested than
  GEOS** for messy real-world borders.
- **WASM build of GEOS** — Hermes can't run WASM, and WASM can't JIT on iOS
  either. No win. Skip.

## Recommendation

Treat native GEOS as the **fallback reached for only if the pure-JS path can't
get the first-paint buffer under ~1–2s.** Exhaust the cheap levers first:

1. **Simplify harder before buffering** — `lineMeasuringGeometry.ts:666` uses
   `simplifyTol = max(radiusMeters*0.05, 10)` (270 m here → 1587 coords). The
   output is rounded off by a ~5.4 km buffer, so sub-km detail is invisible. Try
   `radiusMeters * 0.15–0.25`. Expected: few-hundred coords, ~2–3s. Mirror the
   decision in the polygon path (`:537`, body-of-water) — coastlines are
   higher-detail, so maybe keep that tolerance tighter.
2. **Lower `MAX_BUFFER_COORDS`** (currently 4000 at `:400`; you're at 1587 so
   `applyBufferBudget` never fires). Drop to ~800–1000 as a worst-case guardrail.
3. **Non-blocking dispatch** — wrap `computeLineBufferCached` in
   `InteractionManager.runAfterInteractions` (or a microtask + mask loading
   state) so the map stays interactive while the buffer computes. Existing caches
   already make the second answer-toggle instant.

Native GEOS is a multi-day effort with a permanent maintenance surface; only
pull this lever once 1–3 above are proven insufficient.

---

## GEOS-native boolean ops — `difference` / `union` / `intersection`

_2026-06-09. Status: **idea / not scheduled.**_
_Sibling investigation: `docs/measuring-perf/` and the body-of-water re-mask
trace below._

### TL;DR

The GEOS `bufferMeters` backend shipped (G2) and moved the buffer hot-path out
of Hermes. But the mask builder in `src/features/map/maskBuilder.ts` still uses
**polyclip-ts** (pure-JS Greiner-Hormann / Martinez-Rueda) for
`difference`/`union`/`intersection`. On complex dissolved geometries (e.g. the
body-of-water buffer — 40+ water polygons + rivers unioned across a 50 km
window), polyclip-ts's sweepline cost explodes. Measured on a real device:
**22.3 seconds** for a single `difference(eligibleArea, excludedArea)`.

The `geometryBackend` interface (`src/shared/geometry/geometryBackend.ts`)
currently only exposes `bufferMeters`. Adding `difference`, `union`, and
`intersection` would move the mask builder's hot path to GEOS, eliminating the
last JS-based geometry bottleneck.

### Measured breakdown (device log, body-of-water, "positive", after move)

| Step                                                       | Cost          | Backend     | Notes                                     |
| ---------------------------------------------------------- | ------------- | ----------- | ----------------------------------------- |
| 39× `bufferMeters` polygon pieces                          | ~441 ms       | GEOS WASM   | 3–31 ms each, 103k coords total           |
| `bufferMeters` dissolve (r=0, merged 40+ pieces)           | 1,824 ms      | GEOS WASM   | union of overlapping buffer ribbons       |
| `lineDistance` `@turf/nearest-point-on-line`               | 789 ms        | pure JS     | 63,914 coords, cached on re-render        |
| **`polyclip-ts` `difference(eligibleArea, excludedArea)`** | **22,310 ms** | **pure JS** | 🔴 **dominant bottleneck — 85% of total** |
| `polyclip-ts` `difference(playArea, eligibleArea)`         | 1,446 ms      | pure JS     | simple play-area boundary → cheaper       |
| **Total re-mask**                                          | **~26.3 s**   |             |                                           |

Relevant code:

- `src/features/map/maskBuilder.ts` — `buildCombinedEligibilityMask()`, the sole
  consumer of `polyclip-ts` `difference`/`union`/`intersection`.
- `src/shared/geometry/geometryBackend.ts` — the `GeometryBackend` interface
  (only `bufferMeters` today).
- `src/features/questions/measuring/lineMeasuringGeometry.ts:732-753` — the
  dissolve comment explaining why the merged buffer _must_ be dissolved before
  reaching polyclip.

### Why the dissolve doesn't fix this

The GEOS dissolve (r=0 buffer, 1.8s) **successfully** unions the 40+ overlapping
buffer ribbons into one clean MultiPolygon — without it, polyclip hard-locks
entirely (the test at `measuringDissolve.geos.test.ts` guards this). But the
_dissolved result_ is still an extremely complex geometry: Tokyo Bay + rivers +
lakes across a 50 km window, with thousands of vertices along natural
shorelines. Polyclip-ts's sweepline cost is O((n+m) log(n+m)) in the best case
but degrades badly with:

- Many rings (outer boundaries + island holes)
- Near-coincident edges (numerical robustness overhead)
- Complex topology (lakes with islands, river deltas, coastal indentations)

The second difference (`playArea ∖ eligibleArea`, 1.4s) is fast because the
_play-area boundary_ (Tokyo 23 wards) is a simple polygon — the first argument
dominates polyclip's cost, and the water buffer is the complex one.

### What to add to the backend interface

```ts
export interface GeometryBackend {
    readonly name: "js" | "geos";
    bufferMeters(…): …; // existing

    /** Subtract `b` from `a` (a ∖ b). Both are Polygon/MultiPolygon Features. */
    difference(
        a: Feature<Polygon | MultiPolygon>,
        b: Feature<Polygon | MultiPolygon>,
    ): Feature<Polygon | MultiPolygon> | null;

    /** Union two Polygon/MultiPolygon Features. */
    union(
        a: Feature<Polygon | MultiPolygon>,
        b: Feature<Polygon | MultiPolygon>,
    ): Feature<Polygon | MultiPolygon> | null;

    /** Intersection of two Polygon/MultiPolygon Features. */
    intersection(
        a: Feature<Polygon | MultiPolygon>,
        b: Feature<Polygon | MultiPolygon>,
    ): Feature<Polygon | MultiPolygon> | null;
}
```

Each method maps directly to the GEOS C API:

- `GEOSDifference_r(handle, a, b)` → `GEOSDifferencePrepared_r` for repeated use
- `GEOSUnion_r(handle, a, b)` → `GEOSUnaryUnion_r` for multi-piece flattening
- `GEOSIntersection_r(handle, a, b)`

The existing WKB encode/decode + AEQD projection pipeline from
`geosGeometryBackend.ts` is reusable — these are the same
project→encode→call-native→decode→unproject steps.

### What changes in maskBuilder.ts

The `buildCombinedEligibilityMask` function currently uses polyclip-ts directly:

- `intersection(requiredGeoms[0], ...requiredGeoms.slice(1))` → GEOS
  `intersection` in a reduce loop
- `union(excludedGeoms[0], ...excludedGeoms.slice(1))` → GEOS `union` in a
  reduce loop
- `difference(eligibleArea, excludedArea)` → GEOS `difference`
- `difference(playAreaPolygons, eligibleArea)` → GEOS `difference`

Each polyclip-ts call site is a drop-in replacement — same input types, same
output type. The JS backend would keep the polyclip-ts implementations for Jest
compatibility; the GEOS backend adds the native fast path.

### Estimated impact

| Operation                             | polyclip-ts (device) | GEOS native (est.) |
| ------------------------------------- | -------------------- | ------------------ |
| `difference(water-buffer, excluded)`  | 22,310 ms            | ~1–10 ms           |
| `difference(play-area, water-buffer)` | 1,446 ms             | ~1–5 ms            |
| `intersection` / `union` (N geoms)    | 10–100 ms            | ~1–5 ms            |
| **Total re-mask**                     | **~26.3 s**          | **~2.5 s**         |

The ~2.5s residual is the GEOS dissolve (1.8s) + individual polygon buffers
(0.4s) + turf nearest-point-on-line (0.8s, cached). Further dissolve perf can
be explored separately (e.g. `GEOSUnaryUnion_r` instead of the r=0 buffer
trick).

### Design notes

- **Prepared geometries**: use `GEOSPrepare_r` / `GEOSPreparedDifference_r` when
  the same geometry (e.g. the dissolved water buffer) is differenced against
  multiple exclude features — amortizes the spatial index build.
- **N-ary operations**: unlike `bufferMeters` (which handles one Feature at a
  time), `difference`/`union`/`intersection` are binary. Multi-operand cases
  (e.g. `intersection(A, B, C, D)`) should use a reduce pattern: GEOS
  `intersection(A, B)` → `intersection(result, C)` → `intersection(result, D)`.
- **Empty results**: GEOS can return `POLYGON EMPTY` — the backend should return
  `null` for empty results (same as `bufferMeters` today) so `hasGeomArea`
  checks in maskBuilder continue to work.
- **JS fallback**: the `jsGeometryBackend` implementations use the current
  polyclip-ts calls, keeping Jest tests deterministic and CI-safe.

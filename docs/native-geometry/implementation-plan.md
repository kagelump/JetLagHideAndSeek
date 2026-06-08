# Implementation Plan — Native GEOS for measuring-mask geometry

_2026-06-09. Realizes the [native-geometry wishlist](../wishlist-native-geometry.md)._
_Status: **planned, not started.**_

## Why we're pulling this lever now

The wishlist framed native GEOS as a fallback to reach for "only if the pure-JS
path can't get the first-paint buffer under ~1–2s," and listed three cheap
pure-JS levers to try first. The driver for this work **inverts** the first
lever:

> The line simplification already in the app pushes the mask noticeably off the
> true geometry, which hurts the game. We want to **reduce** simplification — and
> to afford that, the buffer must get dramatically cheaper.

So pure-JS lever #1 ("simplify harder") is off the table — it makes the reported
problem worse. Lever #2 (lower `MAX_BUFFER_COORDS`) is moot for the same reason.
Lever #3 (non-blocking dispatch) is still worthwhile and is folded in below as a
safety net, but it doesn't make the geometry tighter. The only lever that lets us
**lower** simplification while keeping the buffer fast is moving the buffer to
native code. That is what this plan does.

The user-facing success criterion is therefore not just "fast" but **"tight":**
the mask must hug the true border/coastline far more closely than today, with
buffer time staying well under a frame.

## What's actually slow, and where it lives

Device measurement (admin-1st-border, ~5.4 km radius, 8 segments / 1,587 coords):

| Step                                | Cost          | Engine         | Code                                                                                   |
| ----------------------------------- | ------------- | -------------- | -------------------------------------------------------------------------------------- |
| **`@turf/buffer` (line offset)**    | **10,679 ms** | JSTS (Hermes)  | [`computeLineBuffer`](../../src/features/questions/measuring/lineMeasuringGeometry.ts) |
| `clipLineFeatures` (reference line) | 535 ms        | hand-rolled JS | `clipLineFeaturesToPlayArea` (same file)                                               |
| `maskBuilder` difference            | 635 ms        | polyclip-ts    | [`buildCombinedEligibilityMask`](../../src/features/map/maskBuilder.ts)                |
| `lineDistance` simplify + nearest   | ~160 ms       | JSTS, cached   | `computeLineDistance` (same file)                                                      |

**The buffer is ~94% of the cost and is the only step on JSTS.** Everything else
is either pure JS (already tuned in P6) or polyclip-ts (a separate library — see
Phase B). JSTS runs ~20–50× slower under Hermes (no JIT; iOS forbids JIT for all
engines), so the same code is milliseconds in the web app's V8 and ~10s here.

### The buffer call sites (the seam we need to control)

`@turf/buffer` is called from exactly these places:

- `lineMeasuringGeometry.ts` — the line-feature buffer (`buffer(merged, …)`), the
  polygon-feature buffer (`buffer({…geom}, …)`), the "union via `buffer(fc, 0)`"
  combine step, and `getDilatedPlayArea` (the 30 m play-area dilation).
- `pointMeasuringGeometry.ts` — `computePointUnionBuffer` (`buffer(mp, …)` over a
  MultiPoint; this one is already bounded and `steps: 8`, but routes through the
  same primitive).

`difference` / `union` / `intersection` come from **polyclip-ts**, not JSTS, and
live in `maskBuilder.ts`, `shared/geojson.ts` (`unionPolygons`), and
`clipVoronoiCells.ts`. Those are Phase B, not Phase A.

## The decision

**Wrap the GEOS C API in a local Expo Module exposed as a _synchronous_
typed-array function, and route all `@turf/buffer` calls through a swappable
geometry backend. Keep the pure-JS buffer as the fallback and the test oracle.**

Four decisions inside that, with rationale:

1. **GEOS, not Rust `geo` / Nitro-only / WASM.**

    - JSTS _is_ a Java port of GEOS, so GEOS gives us **semantic parity** with the
      web app and with the current device behavior — buffering messy real-world
      borders/coastlines is exactly where GEOS is battle-tested and Rust
      `geo-buffer` is not (per the wishlist's own analysis).
    - WASM is out: Hermes can't run WASM, and WASM can't JIT on iOS either.
    - Rust `geo` stays the documented escape hatch if GEOS vendoring proves too
      heavy (see "Go/no-go" below).

2. **Use the GEOS C API (`geos_c.h`), reentrant `_r` variants, WKB in/out.** The C
   API is the stable ABI; the reentrant handle (`GEOS_init_r`) gives us a
   per-thread context with our own error handler so bad geometry returns `null`
   instead of crashing the app. GEOS reads/writes WKB natively, so marshalling is
   a single `GEOSGeomFromWKB_buf_r` → `GEOSBufferWithParams_r` →
   `GEOSGeomToWKB_buf_r`.

3. **Synchronous Expo `Function` taking/returning `Uint8Array`, not async.** Once
   native, the buffer is ~1–5 ms — well under a 16 ms frame. A **synchronous**
   call means **`buildMeasuringRenderState` stays a pure synchronous function
   inside the existing `useMemo`** (`questionGeometry.ts`). No async/stateful
   render refactor (the unshipped "P3"), no new race conditions. Expo Modules on
   the New Architecture (enabled here, `newArchEnabled: true`,
   expo-modules-core 3.0.30) back synchronous `Function`s with JSI and support
   `Uint8Array` arguments/returns directly. A ~1,600-coord MultiLineString is
   ~26 KB of WKB — sub-millisecond to convert each way; the wishlist's zero-copy
   JSI concern doesn't bite at this scale. (Raw JSI / Nitro stay an escape hatch
   if a profiler ever shows typed-array conversion dominating; we don't start
   there.)

4. **A `GeometryBackend` seam, JS fallback retained.** Native code can't run in
   Jest, and we want a reference oracle and a kill switch. So Phase G0 introduces
   a backend interface whose default implementation is today's turf/polyclip code
   (zero behavior change), and the native module becomes a second implementation
   selected at runtime. Jest always uses the JS backend; production prefers
   native and falls back to JS if the module is unavailable.

### Build-surface constraint that shapes everything

`ios/` and `android/` are **git-ignored** — this is a CNG / `expo prebuild`
project, and EAS (`eas.json`: development / preview / production) regenerates the
native projects on every build. **You cannot hand-edit the Xcode/Gradle project;
it will be wiped.** Native code must therefore live in a **local Expo Module**
under `modules/` (its own `expo-module.config.json`, podspec, `build.gradle`,
`CMakeLists.txt`) which Expo **autolinks**, plus a **config plugin** if any
`Info.plist`/Gradle tweaks are needed. This is the same discipline the repo
already accepts for MapLibre. The GEOS static libs are treated like the committed
POI bundles: **artifacts CI can't regenerate, built by a committed script, and
checked in** (see Phase G1).

## Phases

Phases G0–G4 deliver the user's goal (tighter mask, fast buffer). G5–G6 are
optional follow-ups. Each phase is independently shippable.

### G0 — Geometry backend seam (pure JS, zero behavior change) — **Done**

Make the buffer primitive swappable before any native code exists. This de-risks
everything: it's testable in Jest, reviewable in isolation, and is the rollback
boundary.

- Add `src/shared/geometry/geometryBackend.ts`:
    ```ts
    export interface GeometryBackend {
        name: "js" | "geos";
        /** Buffer a geometry by `meters`; quadrantSegments controls arc fidelity. */
        bufferMeters(
            geom: Feature<
                LineString | MultiLineString | Polygon | MultiPolygon
            >,
            meters: number,
            quadrantSegments: number,
        ): Feature<Polygon | MultiPolygon> | null;
        // Phase B (optional) — overlay ops:
        // unaryUnion?(...): ...; difference?(...): ...; intersection?(...): ...;
    }
    export function getGeometryBackend(): GeometryBackend; // memoized selection
    export function __setGeometryBackendForTest(
        b: GeometryBackend | null,
    ): void;
    ```
- Default impl `jsGeometryBackend.ts` wraps the **existing** `@turf/buffer` calls
  verbatim (meters units; `quadrantSegments` maps to turf's `steps`). No logic
  moves; the four `lineMeasuringGeometry.ts` buffer calls + the
  `pointMeasuringGeometry.ts` call route through `getGeometryBackend().bufferMeters(...)`.
- Selection: `getGeometryBackend()` returns the native backend when its module
  reports available, else JS. Add an `APP_CONFIG.geometry.backend: "auto" | "js" | "geos"`
  override (default `"auto"`) so we can force JS at runtime.
- **Tests:** existing `lineMeasuringGeometry.test.ts` / `clipLineFeatures.perf.test.ts`
  must pass unchanged (proves the seam is behavior-preserving). Add a tiny
  backend-selection unit test.
- **Acceptance:** `pnpm check && pnpm test` green; app behaves identically.

### G1 — Vendor & build GEOS for iOS + Android

The real work, and the only genuinely hard part. Goal: produce static GEOS
artifacts the local module can link, reproducibly, from a committed script.

- Pin GEOS as a git submodule (or a fetched, version-locked tarball) under
  `modules/native-geometry/vendor/geos/`. Use a current stable (e.g. GEOS 3.13.x);
  C++17, builds with CMake.
- **iOS:** `scripts/build-geos-ios.sh` → CMake build for `arm64` (device) and
  `arm64` (simulator, Apple Silicon — the documented target is iPhone 16 Pro),
  combined into `libgeos.xcframework`. Static, `-fvisibility=hidden`, bitcode off
  (Xcode 15+ default). Output committed under `modules/native-geometry/ios/`.
- **Android:** build via the module's `CMakeLists.txt` (NDK) per ABI —
  `arm64-v8a` + `x86_64` (emulator) at minimum, `armeabi-v7a` if we still ship it.
  Either `add_subdirectory(vendor/geos)` so Gradle's `externalNativeBuild`
  compiles GEOS from source during the app build (cleaner upgrades, slower CI), or
  pre-build `.a` per ABI with `scripts/build-geos-android.sh` and link them
  (faster CI). **Recommend pre-built `.a`, committed** — mirrors the repo's
  "commit artifacts CI can't make" rule (POI/measuring bundles) and keeps EAS
  builds fast.
- **Binary budget:** ~1–3 MB per architecture (wishlist estimate); store/app
  thinning ships one arch per device. Note it in the PR; it's the main size cost.
- **Smoke:** a throwaway native test (or a temporary button) that buffers a
  hardcoded 4-point line and logs the result WKB length — proves the toolchain
  links and GEOS runs on both platforms **before** any JS wiring.
- **Docs:** add a "Native geometry / GEOS" section to
  [`docs/implementation_notes.md`](../implementation_notes.md) — how to rebuild,
  which GEOS version, why artifacts are committed. Add a `pnpm data:*`-style
  script entry (e.g. `geos:build:ios`, `geos:build:android`) so the rebuild path
  is discoverable like the other generated-artifact pipelines.

### G2 — Local Expo Module + WKB codec + native backend

- `modules/native-geometry/` via `npx create-expo-module --local`. Single
  synchronous function:
    ```
    bufferWKB(wkb: Uint8Array, meters: number, quadrantSegments: number): Uint8Array | null
    ```
    Native impl (per platform, sharing a thin C++ core that calls the C API):
    `GEOS_init_r` (cache one handle per thread; set notice/error handlers that log
    and cause a `null` return) → `GEOSGeomFromWKB_buf_r` →
    `GEOSBufferWithParams_r` (set `quadrantSegments`, `endCapStyle=ROUND`,
    `joinStyle=ROUND`) → `GEOSGeomToWKB_buf_r` → free everything (`GEOSGeom_destroy_r`,
    `GEOSFree_r`). Guard with `GEOSisValid_r`; optionally `GEOSMakeValid_r` on
    invalid input rather than failing.
- **Meters vs degrees:** GEOS buffers in input units. The current code buffers in
  "meters" via turf's geodesic handling. To keep parity simply, reproject the
  windowed geometry to a **local azimuthal/transverse-Mercator** (meters) around
  the window centroid in JS, buffer in meters natively, then unproject — or use an
  equirectangular scale factor (`cos(lat)`) consistent with the existing
  `simplifyCoords` planar approximation. The window is small (≤ play-area ± radius),
  so a local planar projection is accurate to well under the simplification
  tolerance we're removing. **Decide and unit-test this projection against turf's
  output in G3** — it's the most likely source of subtle drift.
- `src/shared/geometry/wkb.ts`: hand-rolled little-endian WKB writer/reader for
  `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon` only (no Z, no SRID;
  ~150 LOC over a `DataView`/`ArrayBuffer`). Pure JS, fully unit-tested
  (round-trip + golden bytes). No new dependency.
- `geosGeometryBackend.ts`: GeoJSON → project → WKB → `bufferWKB` → WKB →
  unproject → GeoJSON; returns `null` on any failure so the seam falls back to JS.
- Wire selection: native available + `backend !== "js"` → GEOS; else JS.
- **Native dep checklist (AGENTS.md):** after adding the module, `expo prebuild
--clean` + dev-client rebuild; confirm `metro.config.js` doesn't need a new
  singleton pin; Expo Go remains unusable (already true).

### G3 — Parity validation (the correctness gate)

Native can't run in Jest, so prove parity on-device against the JS oracle.

- **Oracle diff harness** (dev-only screen or a scripted run): for each line
  category over the bundled Tokyo/Osaka fixtures and a sweep of radii, buffer with
  both backends and report **area symmetric-difference ratio** and **Hausdorff
  distance** (`GEOSHausdorffDistance`) between the two masks. Gate: symmetric-diff
  area < ~1% and Hausdorff < the buffer's arc resolution. This is also where the
  projection choice (G2) is validated.
- **WKB codec** has full Jest coverage (round-trip every geometry type, plus the
  shapes GEOS emits: `Polygon` and `MultiPolygon` buffer outputs).
- **Maestro on device** (`pnpm test:e2e:ios:stack` / Android workflow): add a flow
  that places a measuring question for `admin-1st-border` **and** `body-of-water`
  (the historic softlock), toggles closer/farther, and asserts the app stays
  responsive and the mask renders — i.e. no native crash on the densest bundle.
  Run `platform=all` before merge (native-dependency + MapLibre-adjacent risk per
  AGENTS.md).
- **Crash hardening:** fuzz the WKB→GEOS boundary with degenerate inputs
  (zero-length segments, NaN — already filtered upstream by `isValidCoord`, but
  defend in depth) and confirm `null`-return, not segfault.

### G4 — Reduce simplification (the actual user-facing win)

Only now that the buffer is ~milliseconds, dial fidelity **up** and measure. All
of these live in [`src/config/appConfig.ts`](../../src/config/appConfig.ts):

- **`simplifyFraction` 0.05 → ~0.01–0.02** (and/or lower `simplifyMinM` from 10).
  Today 0.05 × 5.4 km ⇒ 270 m tolerance ⇒ visibly off mask. This is the single
  knob the user is complaining about.
- **`maxBufferCoords` 4,000 → much higher** (e.g. 20–40 k) and **`maxBufferSegments`**
  up accordingly — the budget escalation becomes a true worst-case guardrail, not
  a routine fidelity cap.
- **`bufferSteps` (quadrantSegments) 4 → 8–16** — arc resolution is now cheap.
- **`nearestPointSimplifyM`** can drop too, tightening the connector/marker and
  the derived radius (secondary; this scan is JS + cached, so watch its cost or
  pair with the P2 spatial index from `docs/measuring-perf/`).
- For each change, capture before/after on device: buffer ms (must stay < ~16 ms)
  **and** a screenshot of the mask hugging the border. Land the loosest values
  that keep buffer time comfortably sub-frame. This is the phase that closes the
  ticket; G0–G3 only make it safe.

### G5 — (Optional) Native overlay ops

If de-simplification (G4) inflates the polyclip-ts cost in `maskBuilder`
(difference/union over now-denser buffer polygons), extend the backend with
`unaryUnion` / `difference` / `intersection` (`GEOSUnaryUnion_r`,
`GEOSDifference_r`, `GEOSIntersection_r`) and route `maskBuilder.ts`,
`shared/geojson.ts`, and the "buffer(fc, 0)" union trick through GEOS. **Gate on a
real measurement** — at today's 635 ms the difference isn't the bottleneck; only
pull this if G4 makes it one. polyclip-ts stays the JS-backend implementation.

### G6 — (Optional) Non-blocking dispatch safety net

Even a fast sync buffer is a sync buffer. If any de-simplified worst case (or a
future dense category) ever exceeds a frame, add the wishlist's lever #3: compute
the mask in `InteractionManager.runAfterInteractions` with a "mask loading" state.
This **does** require making `buildMeasuringRenderState` async/stateful (the
unshipped P3 from `docs/measuring-perf/`), so it's deliberately last and only if
profiling demands it. The synchronous design (decision #3) is chosen precisely to
avoid needing this.

## Testing & CI summary

- **Jest:** seam selection, WKB codec round-trip/golden, JS backend unchanged.
  Native code is never loaded in Jest (mocked-absent → JS fallback), consistent
  with how `jest.setup.ts` already mocks native modules.
- **`pnpm check`** must stay green throughout (lint + format + typecheck +
  perf-typecheck + POI-selector drift).
- **Device parity harness** (G3) is the correctness gate native can't get in Jest.
- **Maestro** (`platform=all`) before merge: no crash on `body-of-water`,
  responsive closer/farther, mask renders.
- **CI build:** committed GEOS artifacts keep EAS/Maestro builds from needing to
  compile GEOS; document the local rebuild path. If we instead build from source,
  ensure the Android emulator runner (NDK present) and the iOS toolchain have
  CMake, and budget the extra build minutes.

## Risks & mitigations

| Risk                                              | Mitigation                                                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GEOS segfault on invalid geometry                 | Reentrant context + error handler → `null` return; `GEOSisValid_r`/`GEOSMakeValid_r`; WKB-boundary fuzz (G3); upstream `isValidCoord`/dedup already runs. |
| Meters-vs-degrees / projection drift vs turf      | Local planar projection validated against the JS oracle in G3 (area + Hausdorff gates) before G4 touches tolerances.                                      |
| Native artifacts wiped by `expo prebuild --clean` | Code lives in an autolinked **local Expo Module** + committed static libs, not the generated `ios/`/`android/`.                                           |
| App-size regression (~1–3 MB/arch)                | Document in PR; one arch per device via store thinning; trim GEOS build to the C API + needed ops if needed.                                              |
| Maintenance surface (GEOS upgrades, CI toolchain) | Committed build scripts + `implementation_notes.md` runbook; pin GEOS version; treat like the POI-bundle pipeline.                                        |
| Regression / "native is wrong" in the field       | Keep JS backend + `APP_CONFIG.geometry.backend` kill switch; G0 seam is the rollback boundary.                                                            |

## Effort estimate

- G0 seam: ~0.5 day. G1 GEOS build (iOS xcframework + Android NDK, linking in a
  prebuild-safe local module): **2–4 days — the bulk of the risk.** G2 module +
  WKB codec + wiring: 1–2 days. G3 parity harness + Maestro: 1–2 days. G4 retune +
  measure: ~0.5 day.
- **Buffer-only through tighter masks (G0–G4): ~1.5–2 weeks.** G5 overlay +~2 days
  if measurement justifies it; G6 only if profiling demands the async refactor.

## Go/no-go before starting G1

Spend the build effort only if the cheap, non-conflicting wins are confirmed
insufficient for the **tightness** goal (lever #1 is already ruled out as
counter-productive). Specifically: if a quick experiment lowering `simplifyFraction`
with the **current** JS buffer pushes first-paint past ~1–2 s (it will, per the
10.7 s baseline), that confirms native is required. If GEOS iOS/Android vendoring
stalls in G1, the documented fallback is Rust `geo` via UniFFI (smaller, easier
cross-compile) behind the **same G0 backend seam** — only the `bufferMeters`
implementation changes, accepting its weaker robustness on messy borders.

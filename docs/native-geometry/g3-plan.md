# G3 Plan — Parity validation (the correctness gate)

_2026-06-09. Part of the [native-geometry implementation plan](./implementation-plan.md). Follows [G2](./g2-plan.md)._
_Status: **W1–W4 done (2026-06-09).** iOS parity harness: PARITY PASS. Crash fuzz: CRASH FUZZ PASS. ASan: clean. W5 (Maestro) flows written, pending CI run with `EXPO_PUBLIC_GEOMETRY_BACKEND=geos`._

## Goal

Prove that the GEOS native **buffer primitive** (`bufferMeters`) produces output
indistinguishable from the `@turf/buffer` (JSTS) oracle — on **both** iOS and
Android — for the real bundled line categories (admin-1st-border,
admin-2nd-border, body-of-water, coastline, high-speed-rail — all five in
`LINE_MEASURING_CATEGORIES`). Then lock that confidence in with on-device crash
fuzzing, memory-validation tooling, a performance measurement, and a Maestro E2E
flow that exercises the GEOS path in CI.

**Scope: the backend seam, not the rendered mask.** G3 validates the GEOS vs JS
`bufferMeters` primitive in isolation. It does **not** validate pipeline-level
equality of the full measuring render, because the two backends diverge there
_by design_: `lineMeasuringGeometry.ts` runs a GEOS-only 0-radius dissolve as a
post-merge step (`if (backend.name !== "geos") return merged;`), so the GEOS
render is dissolved and the JS render is not. That divergence is intentional and
out of scope here (W5 only asserts the GEOS mask _renders_, a separate weaker
check — see "What's explicitly out of scope").

G3 is the **correctness gate** before G4 (dialing up simplification fidelity).
G4 changes what the user sees; G3 makes sure the underlying engine is provably
correct first.

## What's already done (not G3 — the foundation we build on)

| Layer                             | What                                                                                 | Where                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| WKB codec Jest coverage           | Round-trip, golden bytes, independent fixtures, malformed-input fuzzing              | `src/shared/geometry/__tests__/wkb.test.ts`                                 |
| Projection Jest coverage          | Round-trip, turf-parity, center parity                                               | `src/shared/geometry/__tests__/bufferProjection.test.ts`                    |
| Adapter Jest coverage             | Echo round-trip, FC structure, null-vs-throw, seam selection                         | `src/shared/geometry/__tests__/geosGeometryBackend.test.ts`                 |
| On-host GEOS parity (geos-wasm)   | 3 hand-crafted fixtures × 3 radii at QS=8, area ratio + bbox delta → 1.00000 / 0.00m | `src/shared/geometry/__tests__/geosParity.test.ts` (via `pnpm test:geos`)   |
| body-of-water dissolve GEOS guard | Real body-of-water window through geos-wasm                                          | `src/features/questions/measuring/__tests__/measuringDissolve.geos.test.ts` |
| G2 native `bufferWKB`             | Synchronous Expo Function on both platforms; W1–W6 shipped                           | `modules/native-geometry/`                                                  |

The geos-wasm parity test proves the **math** is correct (projection + GEOS
buffer + unproject matches turf). What it does **not** prove:

- The **native module linking** works (Swift/Kotlin → GEOS C API → WKB
  marshalling across the JS↔native boundary).
- Real **dense geometries** (body-of-water: 40+ pieces, ~8.8 MB bundle) don't
  trigger platform-specific issues.
- The native path is **memory-safe** under load (no double-frees, no leaks).
- The native path is **fast enough** (<16 ms) on real device hardware.

Those four gaps are what G3 closes.

## Work items

### W1 — On-device parity harness

The core deliverable. A dev-only (`__DEV__`) action that buffers real bundled
line-category geometries through **both** backends and compares them with
rigorous metrics.

#### W1.1 Comparison logic — `parityMetrics.ts` (shared) + `parityHarness.ts` (measuring feature)

Pure-function modules (no React dependency) so they can be called from the dev
UI, from a Maestro-triggered action, or from a future scripted run. Split across
two files per the import-direction note below: pure metrics in
`src/shared/geometry/parityMetrics.ts`, the bundle-aware driver in
`src/features/questions/measuring/parityHarness.ts`.

```ts
export interface ParityCase {
    label: string; // human-readable (e.g. "admin-1st-border / on-border / 2km")
    category: MeasuringCategory;
    center: Position; // WGS84 [lon, lat]
    radiusMeters: number;
    quadrantSegments: number;
}

export interface ParityResult {
    kase: ParityCase;
    // Both backends produce a result
    jsGeom: Polygon | MultiPolygon | null;
    geosGeom: Polygon | MultiPolygon | null;
    // Metrics (null if either backend returned null)
    areaRatio: number | null; // area(geos) / area(js)
    symDiffRatio: number | null; // area(A△B) / area(A∪B) — exact via polyclip-ts
    bboxDeltaM: number | null; // max edge displacement between bboxes
    jsTimeMs: number;
    geosTimeMs: number;
}

export interface ParityReport {
    passed: boolean;
    results: ParityResult[];
    maxAreaRatio: number;
    maxSymDiffRatio: number;
    maxBboxDeltaM: number;
    failures: ParityResult[]; // results outside gates
    jsOracleTotalMs: number;
}

export function runParityCase(kase: ParityCase): ParityResult;
export function runParitySweep(cases: ParityCase[]): ParityReport;
```

**Input preparation (critical).** A `ParityCase`'s `(category, center,
radiusMeters)` is **not** fed to `bufferMeters` directly — that's not what the
app does. The harness must replicate the production pipeline up to (but not
including) the buffer: window the bundle (`selectWindowFeatures` /
`computeLineCategory`), split polygon vs line features, and simplify
(`simplifyTolerance` / `polySimplifyTolerance`, drop sub-`minFeatureLength`
features) — then feed the **identical prepared geometry** to _both_
`jsGeometryBackend.bufferMeters` and `geosGeometryBackend.bufferMeters`. Calling
the two backends directly (not via `getGeometryBackend()`) keeps the input
byte-identical, so the only measured difference is the buffer engine itself.
Do **not** run the GEOS-only dissolve post-step — that's pipeline scope, not the
primitive (see Goal).

**Pass/fail rules** (beyond the numeric gates below):

- One backend returns a polygon and the other returns `null` → **hard failure**
  (`passed = false`, result in `failures`). A null-vs-polygon mismatch is a
  correctness bug, not just an out-of-tolerance metric.
- Both backends return `null` → **agreement, but vacuous** (the case exercised
  no geometry — e.g. center too far for any buffer). Not a failure, but flag it
  separately so dead fixtures get corrected rather than silently "passing."
- Both return polygons → apply the numeric gates.

**Module placement (import direction).** `selectWindowFeatures`,
`computeLineCategory`, `getLineBundle`, et al. live in
`src/features/questions/measuring/`. Importing them from
`src/shared/geometry/` would be a `shared → feature` inward dependency
(disallowed). Split accordingly: put the **pure metrics** (symDiff, bbox delta,
spherical area) in `src/shared/geometry/parityMetrics.ts` (no feature deps), and
put the **driver** (bundle load + window + simplify + dual-backend call) in
`src/features/questions/measuring/parityHarness.ts`, which imports shared
(`feature → shared`, allowed). The `parityHarness.ts` path in W1.1's heading
moves to the measuring feature folder.

**Symmetric-difference area ratio** uses polyclip-ts (already in the tree for
`maskBuilder`):

```
union = polyclip.union(A, B)       // area(A∪B)
intersection = polyclip.intersection(A, B)  // area(A∩B)
symDiffArea = area(union) - area(intersection)
ratio = symDiffArea / area(union)
```

Area computation: reuse the `ringArea` / `geomAreaM2` spherical-area helpers
already in `geosParity.test.ts` (the `@mapbox/geojson-area` algorithm,
dependency-free) — move them into the shared module alongside
`bboxEdgeDeltaMeters`. Use these rather than reaching for `@turf/area` (not a
direct dependency; the transitive availability via `@turf/buffer` is an
implementation detail we shouldn't rely on for one function).

**Bbox edge delta** uses the same `bboxEdgeDeltaMeters` helper from
`geosParity.test.ts`, moved into the shared module.

**Why not Hausdorff?** The implementation plan's G3 mentions
`GEOSHausdorffDistance`. Computing true Hausdorff in pure JS over dense
multi-polygon boundaries (body-of-water: 40+ polygons) is either O(n²) naive
(too slow for 50k-iteration batches) or requires a spatial index (scope creep).
The geos-wasm test already demonstrated that bbox edge delta + symDiff area
ratio together catch both translation errors (bbox shift) and shape errors
(area mismatch). If a future change needs true Hausdorff, add a one-line
`hausdorffDistanceWKB` native function (delegates to `GEOSHausdorffDistance_r`)
— but we don't start there.

**Gates** (from the implementation plan and G2 Layer 5):

| Metric                          | Gate                         |
| ------------------------------- | ---------------------------- |
| Symmetric-difference area ratio | < 1% (< 0.01)                |
| Bbox edge delta                 | < `radius * 0.02 + 5` meters |

These are deliberately looser than the geos-wasm host test (which hits
1.00000 area ratio / 0.00 m bbox delta at QS=8). The looseness is **not** from
simplification divergence — simplification runs _once, upstream of_
`bufferMeters` and is backend-agnostic (`simplifyTolerance` lives in
`appConfig`, independent of which backend executes), and the harness feeds the
**identical** prepared geometry to both backends (see W1.1 "Input preparation"
below). The residual delta is purely the buffer engines differing: JSTS vs GEOS
arc approximation at the same `quadrantSegments`, end-cap style, and
`MakeValid` handling. The 1% / `radius*0.02+5m` envelope absorbs that. Tighten
in G4 if fidelity work narrows it.

#### W1.2 Fixture selection

Two distinct passes, matching the G2 Layer 5 design (T5.1):

**Parity pass (JS vs GEOS) — curated, small, fast-oracle.**

Per line category, pick centers by geometric role so coverage is meaningful
without paying the JS oracle (~10 s/call at large radii) hundreds of times:

- **admin-1st-border:** 3 centers — on the border (e.g. Tokyo/Saitama edge),
  ~2 km inside Tokyo, ~5 km outside in Saitama — × 3 radii (500m, 2km, 5km) =
  9 cases.
- **admin-2nd-border:** 3 centers — on a ward/municipal boundary, ~2 km inside
  a ward, ~5 km away — × 3 radii = 9 cases. This is the **densest** border
  category (most features), so it must not be skipped — it is the most likely to
  stress the buffer engine.
- **body-of-water:** 3 centers — inside Tokyo Bay, on the Sumida River, on
  land ~2 km from water — × 3 radii = 9 cases. **Plus 1 large-radius case**
  (10 km) covering the whole bay — this is the historic softlock case.
- **coastline:** 3 centers — on the coast (Odaiba), 2 km inland, 2 km
  offshore — × 3 radii = 9 cases.
- **high-speed-rail:** 3 centers — on the Tōkaidō corridor, on the Tōhoku
  corridor, between corridors — × 3 radii = 9 cases.

**Total: ~46 parity cases** (5 categories × 9, plus the 1 large-radius
body-of-water case). At ~10 s worst-case per JS-oracle call (5 km radius),
target JS-oracle wall time < ~8 min. Hard-code the center coordinates in the
harness (not randomized) so runs are deterministic and reproducible. Also
hard-code the Tokyo play-area bbox used for windowing — don't read whatever play
area happens to be loaded — so windowing is reproducible across runs.

**Crash/perf sweep (GEOS only) — denser, cheap.**

A uniform grid over the Tokyo play-area bbox at ~2 km spacing (~225 points) ×
2 radii (500m, 2km). To keep all five categories exercised across the grid
without exploding the case count, **rotate the category by grid point** (point
_i_ uses `categories[i % 5]`) rather than running every category at every point.
That keeps it at ~225 × 2 = ~450 GEOS-only cases (~5 ms/call → ~2.3 s total),
with each category landing on ~45 distinct grid points across the play area.
Running all five categories at every point would instead be ~2,250 cases / ~11 s
— do that only if per-category spatial coverage proves too sparse. This gives
broad crash/perf coverage without paying the JS oracle.

The sweep uses the **real** bundled geometries (loaded via `getLineBundle`),
not hand-crafted fixtures — so it exercises the exact WKB encoding/decoding
paths the app uses, at the real coordinate densities.

#### W1.3 Dev-only UI — `src/features/sheet/GeometryParityScreen.tsx`

- Gated by `__DEV__`; accessible from Settings → "Run GEOS Parity Harness"
  button (alongside the existing "Clear Cache" dev-only row).
- Triggers `runParitySweep` inside a `useEffect` / on-press.
- Shows progress ("Running case 12/46…") and a running tally.
- Final display:
    - **`PARITY PASS`** / **`PARITY FAIL`** in large text (accessible label for
      Maestro).
    - Summary: max symDiff ratio, max bbox delta, JS oracle total time.
    - Expandable detail: per-case metrics, worst N cases.
- A second button: "Run Crash/Perf Sweep" (GEOS only) — just runs and reports
  elapsed time + any nulls (crashes would kill the app before reaching the
  report).

#### W1.4 Wire into sheet routes

Add `"geometry-parity"` to `SheetRouteName` in `sheetRoutes.ts`. Leave the
union member in place (it's harmless in production) and instead guard the
**navigation button and the screen mount** behind `__DEV__` — a union member
can't be "stripped" from a TS type at build time, so dead-route removal isn't
the mechanism; gating the entry point is.

### W2 — On-device crash fuzzing (G2 Layer 6, T6.1)

Feed degenerate WKB to the native `bufferWKB` and confirm `null` return, not
a segfault. Build this into the parity harness screen as a third action:
"Run Crash Fuzz."

Degenerate inputs:

- Empty `Uint8Array` (0 bytes)
- Truncated WKB (valid header, body cut off mid-coordinate)
- 1-point LineString (valid WKB, geometrically degenerate)
- Zero-length segment (two identical consecutive coords)
- Self-intersecting polygon (bowtie — exercises `GEOSMakeValid_r`)
- Very large coordinate values (1e6, 1e9 — exercises numeric stability)
- NaN/Inf coords (pre-filtered upstream by `isValidCoord`, but defend in depth)

Each case runs 1,000 iterations in a tight loop. The harness reports
`CRASH FUZZ PASS` if all return `null` without crashing. (A crash here stops
the app; the harness can't self-report failure — that's why we also guard with
Maestro in W5.)

### W3 — Memory validation (G2 Layer 6, T6.2)

Manual tooling pass — not automated in CI, but documented for any future GEOS
upgrade or native-code change.

**iOS:**

- Edit the Xcode scheme: enable **Address Sanitizer** (catches the
  double-free / use-after-free class deterministically).
- Run the parity harness + crash fuzz; confirm ASan reports clean.
- Instruments → Allocations: run a 50k-iteration loop over body-of-water at
  2 km; confirm the count of live GEOS allocations returns to baseline after
  the batch (watch allocation count, not RSS).

**Android:**

- Guard `-fsanitize=address` behind a Gradle property in
  `modules/native-geometry/android/build.gradle` (e.g. `enableAddressSanitizer`)
  and thread it into `CMakeLists.txt` via `externalNativeBuild.cmake.arguments`.
  Commit both changes — the flag is off by default and enabled only when the
  property is set, so it is safe to keep in version control.
- Run the same harness; confirm ASan clean.
- Android Studio Memory Profiler: same 50k-iteration check.

**Document** the procedure in `docs/implementation_notes.md` under the
"Native geometry / GEOS" section.

### W4 — Performance validation (G2 Layer 7)

The justification metric for the entire native-geometry effort.

- **Headline:** the admin-1st-border window at ~5.4 km radius (the 10,679 ms
  baseline from the implementation plan) must drop to **< 16 ms** end-to-end
  on device. Measure and log in the harness.
- **Marshalling split:** log encode, native (`bufferWKB`), and decode times
  separately. The encode+decode for ~1,600 coords must be < ~2 ms (validates
  the WKB/typed-array path isn't a hidden bottleneck).
- **body-of-water specifically:** the densest category (~8.8 MB bundle, 40+
  pieces) must also be comfortably sub-frame.
- **New instrumentation required.** The existing `[geos]` log in
  `geosGeometryBackend.ts` records only _total_ ms — it does **not** split
  encode/native/decode. Producing the marshalling split means wrapping the
  `encodeWkb` / `bufferWKB` / `decodeWkb` steps inside `bufferFeature`
  individually (a `[geosPerf]` line). This is real instrumentation work, not
  just "exercise the workload and read the log." Gate the `[geosPerf]` line
  behind `__DEV__` (the existing `[geos]` logs are unconditional `console.log`
  and already fire on every call — don't add another always-on line to release
  builds). Keep it after W4: it's cheap and useful for catching future
  marshalling regressions.

### W5 — Maestro E2E (G2 Layer 8)

Two flows that exercise the GEOS path on-device in CI. Both require the GEOS
native module to be linked (it is in dev builds), and the backend forced to
`"geos"` via `APP_CONFIG.geometry.backend`.

**Approach:** rather than building a Maestro-accessible UI toggle for the
backend (scope creep), set `backend: "geos"` as a **build-time default for
E2E dev builds** by adding a conditional in `appConfig.ts`:

```ts
geometry: {
    backend: process.env.EXPO_PUBLIC_GEOMETRY_BACKEND === "geos"
        ? "geos"
        : "auto",
    ...
}
```

**Settle on: the build-time env var as primary for CI.** The Maestro E2E
workflow sets `EXPO_PUBLIC_GEOMETRY_BACKEND=geos` before building, so the
backend is fixed from app start. This is preferred over a runtime toggle
because `getGeometryBackend()` memoizes `_backend` at module level **and** the
measuring pipeline keeps its own LRU caches (`categoryCache`,
`distanceCache`) — flipping the backend at runtime after geometry is already
computed would replay stale cached results, not the forced backend.

A `__DEV__`-only "Force GEOS" button in Settings remains as a **manual-testing
convenience**, but if used it must call `__setGeometryBackendForTest(
geosGeometryBackend)` **and** clear those caches
(`clearLineCategoryCache()` / `clearLineDistanceCache()` + any mask
memoization) so the next question placement recomputes through GEOS. No app
restart is needed (the override is module-level, survives re-renders), but the
cache clear is mandatory. Maestro relies on the env-var build, not this button.

**Flow 1 — Measuring smoke with GEOS (`geos-measuring-smoke.yml`):**

1. Force backend to `"geos"` (tap dev button or rely on build config).
2. Navigate to Add Question → Measuring.
3. Select `admin-1st-border` category.
4. Place a question (tap center of play area).
5. Toggle positive/negative (closer/farther).
6. Assert the mask renders (map layer visible, app responsive).
7. Repeat steps 3–6 for `body-of-water`.
8. Navigate to Settings → "Run GEOS Parity Harness".
9. Assert `PARITY PASS` text is visible.

**Flow 2 — Crash fuzz guard (`geos-crash-fuzz.yml`):**

1. Force backend to `"geos"`.
2. Navigate to Settings → "Run Crash Fuzz".
3. Assert `CRASH FUZZ PASS` text is visible.

Run `platform=all` before merge (native-dependency + MapLibre-adjacent risk,
per AGENTS.md).

## Testing & CI summary

| Layer                | What                                                       | Where                          | Gate                     |
| -------------------- | ---------------------------------------------------------- | ------------------------------ | ------------------------ |
| Jest (existing)      | WKB codec, projection, adapter, geos-wasm parity           | `pnpm test` + `pnpm test:geos` | Must stay green          |
| On-device parity     | SymDiff area < 1%, bbox Δ < tolerance, all 5 categories    | W1 parity harness              | `PARITY PASS`            |
| On-device crash fuzz | 1k iterations × 7 degenerate inputs → all `null`, no crash | W2 fuzz harness                | `CRASH FUZZ PASS`        |
| Memory (manual)      | ASan clean, 50k-iteration allocation baseline              | W3 tooling                     | Documented in impl notes |
| On-device perf       | admin-1st-border < 16ms, encode+decode < 2ms               | W4 timing                      | Console log              |
| Maestro              | Measuring smoke + parity harness on both platforms         | W5 flows                       | Green `platform=all`     |
| `pnpm check`         | Lint + format + typecheck + perf-typecheck + POI drift     | CI                             | Must stay green          |

## What's explicitly out of scope

- **G4 simplification retuning** — G3 only validates correctness; it does not
  change `simplifyFraction`, `maxBufferCoords`, or `bufferSteps`.
- **Pipeline-level JS-vs-GEOS parity** — the measuring render applies a
  GEOS-only 0-radius dissolve (`lineMeasuringGeometry.ts`), so the two backends
  produce different _rendered_ masks by design. G3 validates the `bufferMeters`
  primitive, not the full render. W5 only asserts the GEOS mask renders; it does
  not compare it to a JS render.
- **Native Hausdorff** — bbox edge delta is the pragmatic metric. True
  Hausdorff via `GEOSHausdorffDistance_r` is a one-line native addition if
  later needed; don't add it now.
- **Native overlay ops (G5)** — union/difference/intersection are Phase B.
- **Async render refactor (G6)** — the sync design stays.

## Risks & mitigations

| Risk                                                              | Mitigation                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JS oracle is too slow for large-radius parity cases               | Cap parity-pass radii at 5 km (only 1–2 cases at 10 km for body-of-water). The geos-wasm test already covers the math; we just need on-device confirmation with real bundles.                                    |
| polyclip-ts symDiff computation is slow for body-of-water         | Run symDiff only for the parity pass (~46 cases); for the crash/perf sweep (450 cases), use only bbox delta + area ratio (no polygon ops needed).                                                                |
| Maestro can't interact with the parity harness UI                 | Keep the UI simple: one button per action, large accessible labels. If Maestro still can't target the result text, fall back to a screenshot assertion or a file-system artifact written via `expo-file-system`. |
| Memory leak only manifests at 50k+ iterations (not in normal use) | The 50k-iteration check is a safety margin, not a gate. ASan is the primary signal — it catches use-after-free/double-free on the first offending call.                                                          |

## Effort estimate

- W1 (parity harness): ~1.5 days — the comparison logic + fixture selection +
  UI + sheet-route wiring.
- W2 (crash fuzz): ~0.5 day — builds on W1's harness infrastructure.
- W3 (memory validation): ~0.5 day — manual tooling; mostly documenting and
  running.
- W4 (perf validation): ~0.5 day — a total-ms log exists, but the
  encode/native/decode marshalling split needs new instrumentation in
  `bufferFeature` before the workloads can be measured and recorded.
- W5 (Maestro E2E): ~0.75 day — two flows, backend-force mechanism, CI
  verification.

**Total: ~3.75 days.** The parity harness is the highest-value piece; W2–W4
can be parallelized after W1 lands.

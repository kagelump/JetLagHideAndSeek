# Native Module Test Suite Plan — `native-geometry` GEOS

> Status: proposed (2026-06-12). Companion to [`g2-plan.md`](g2-plan.md),
> [`g5-plan.md`](g5-plan.md), and the on-host parity work in
> [`PLAN-geos-overlay-parity-test.md`](PLAN-geos-overlay-parity-test.md).

## Context

`native-geometry` is a local Expo module wrapping GEOS 3.14.1 (vendored as an
iOS `xcframework` and per-ABI Android `.a`). It exposes five WKB ops behind the
`GeometryBackend` seam: `bufferWKB`, `differenceWKB`, `unionWKB`,
`intersectionWKB`, `unaryUnionWKB`, plus `geosVersion` / `nativeAbiVersion`.
These power every gameplay-critical geometry path — radar/measuring buffers,
mask difference/intersection, body-of-water dissolve.

**What is already tested (Jest, no device):**

- `wkb.test.ts` — the pure-JS WKB codec round-trips.
- `geosParity.test.ts` / `geosWasmSmoke.test.ts` — the **real**
  `geosGeometryBackend` pipeline (project → encode → GEOS → decode → unproject)
  against the turf oracle, using **geos-wasm (GEOS 3.13.x)** in Node, gated on
  area/bbox tolerance (`parityMetrics.ts`).
- `geosGeometryBackend.test.ts` / `geometryBackend.selection.test.ts` — adapter
  wiring, fallback logic, backend selection, with `native-geometry` mocked.

**What no test can currently catch** (the `g5-plan.md` "W7 — Validation
(on-device)" step is entirely manual: place a body-of-water question and eyeball
it). This is the gap this suite closes:

| Surface                                                                                                 | Why Jest/wasm misses it                                                                |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The **vendored 3.14.1 binary** specifically                                                             | Jest runs geos-wasm **3.13.x**; build flags, precision model, and version drift differ |
| Swift / C++ **memory ownership** (the `defer`/`GEOSFree`/`destroy` logic, MakeValid reassignment)       | geos-wasm bypasses `NativeGeometryModule.swift` and `native-geometry-jni.cpp` entirely |
| `MakeValid` recovery on the real binary                                                                 | Only the native helpers call it                                                        |
| JNI / Swift↔C marshalling (`Data`/`ByteArray` ↔ GEOS buffers, `NewByteArray`, `GetByteArrayElements`) | Not exercised by the wasm shim                                                         |
| **ABI handshake** (`nativeAbiVersion() == EXPECTED_NATIVE_ABI`)                                         | The constant is mocked in Jest                                                         |
| All five ops **present** in a freshly built binary (the stale-binary → JS-fallback trap from AGENTS.md) | Mock always provides them                                                              |
| The **body-of-water hard-lock** actually completing fast                                                | The 26 s polyclip hang is a device-runtime property                                    |
| Lazy context init thread-safety (`NSLock` / `std::call_once`)                                           | Single-threaded in Jest                                                                |
| Malformed-input rejection without crashing (NaN coords, unclosed ring, truncated WKB)                   | wasm may differ from the device binary                                                 |

The strategic frame (see the prior E2E discussion): Maestro is being reduced to
**exactly one** low-flake smoke flow. The geometry correctness it never really
tested moves here, to a native suite that runs on simulator/emulator **without
Metro, the dev-client, or the JS bundle** — removing the entire flake surface
that has kept the Maestro workflow red.

## Goals / non-goals

**Goals**

- Automated, CI-runnable native tests that exercise the **real compiled GEOS
  3.14.1** through the actual Swift and JNI code, on both target ABIs
  (iOS arm64-simulator, Android x86_64 emulator).
- Cross-engine parity: the device binary agrees with the turf/geos-wasm oracle
  on a shared, language-neutral fixture set, within tolerance.
- Catch the specific failure classes above — especially memory bugs, the
  stale-binary/ABI mismatch, and the body-of-water hang.
- Become the **gate for GEOS upgrades** (the manual steps in
  `implementation_notes.md §How to upgrade GEOS`).
- No Metro / no app bundle / no code signing → near-zero flake, fast.

**Non-goals**

- Re-testing GEOS _math_ breadth that Jest+geos-wasm already covers well (we
  reuse its fixtures, we don't expand them here).
- The expo-modules-core `Data`/`Uint8Array` marshalling boundary and
  `requireNativeModule` wiring — see "Known residual gap" below.
- Map rendering, bottom sheet, deep links — that is the 1 Maestro smoke's job.

## Design

### Testability refactor (prerequisite)

Expo Module `Function()` bodies cannot be invoked from XCTest / instrumented
JUnit without the RN bridge. So extract the GEOS logic into a thin,
bridge-free core that both the Module **and** the tests call. The Module
becomes a one-line delegator per function. No behavior change.

- **iOS** — new `modules/native-geometry/ios/GeosCore.swift`: a stateless enum
  exposing `buffer(_ wkb: Data, distance: Double, quadrantSegments: Int32) -> Data?`,
  `difference`, `union`, `intersection`, `unaryUnion`, `version`, `abiVersion`.
  Move `geosContext()`, `_bufferAndWrite`, `_binaryOpAndWrite`,
  `_unaryOpAndWrite` here. `NativeGeometryModule.swift` `Function`s delegate to
  `GeosCore`.
- **Android** — new `GeosBridge` object (Kotlin) holding `System.loadLibrary` +
  the `external fun native*` declarations as `internal`, plus public
  `buffer(...)`, `difference(...)`, etc. `NativeGeometryModule.kt` delegates.
  The JNI `.cpp` is unchanged (symbol names stay bound to the bridge object —
  rename the `Java_..._native*` symbols to match `GeosBridge` and update the
  `external fun` package, or keep the Module's external decls and expose them
  through an internal accessor; pick whichever keeps JNI symbol churn minimal).

### Shared golden fixtures (the backbone)

One committed, **language-neutral** fixture file drives all three engines
(turf oracle, geos-wasm, device GEOS):

`modules/native-geometry/__fixtures__/geos-golden.json`

Each case is keyed on **engine-independent invariants**, not exact bytes (GEOS
3.13 vs 3.14 and JSTS never produce byte-identical output):

```jsonc
{
    "version": 1,
    "cases": [
        {
            "name": "buffer/tokyo-rail-corridor",
            "op": "buffer",
            "inputWkbHex": ["01020000..."], // raw WKB hex, projected meters for buffer
            "params": { "distance": 250, "quadrantSegments": 8 },
            "expect": {
                "resultType": "Polygon",
                "areaM2": { "value": 1234567.0, "ratioTol": 0.01 }, // AREA_RATIO_MIN/MAX
                "bbox": [
                    /* w,s,e,n */
                ],
                "bboxTolM": 5,
                "isNull": false,
                "minRingVertices": 32,
            },
        },
        {
            "name": "difference/a-inside-b-empty",
            "op": "difference",
            "expect": { "isNull": true },
        },
        {
            "name": "intersection/disjoint-empty",
            "op": "intersection",
            "expect": { "isNull": true },
        },
        // ...
    ],
}
```

- WKB hex makes inputs identical across Swift / Kotlin / JS with zero parsing
  divergence.
- A small generator script
  (`modules/native-geometry/scripts/gen-golden-fixtures.mjs`) builds this from
  the existing `geosParity.test.ts` fixtures + `parityMetrics.ts` (area/bbox
  helpers), running the **oracle** to fill `expect`. Committed output; regen on
  demand. The Jest parity suite asserts against the same file so all three
  engines stay aligned and the fixtures never silently drift.

### Test case catalogue (per platform, identical intent)

Driven by the golden fixtures plus a handful of native-only behavioral tests:

1. **Diagnostics / ABI** — `version()` starts `"3.14"`; `abiVersion() ==
EXPECTED_NATIVE_ABI` (2). Guards the silent ABI-mismatch warning path.
2. **Op presence** — all five ops return non-null on a trivial valid input.
   This is the automated form of the stale-binary guard.
3. **Buffer parity** — corridor (LineString), ward (Polygon), scattered
   (MultiPoint) vs golden invariants.
4. **Overlay parity** — `difference` (square-with-hole), `union` (L-shape),
   `intersection` (overlap), `unaryUnion` (self-overlapping MultiPolygon).
5. **Body-of-water marquee case** — a large real MultiPolygon `difference`
   (the production 26 s hang): assert non-null **and** completes under a
   generous wall-clock budget (e.g. < 3 s). This is the single highest-value
   test — it is the exact gameplay path that hard-locks under JS.
6. **MakeValid recovery** — bowtie / self-intersecting polygon → valid,
   non-null result (exercises the `GEOSisValid_r != 1` branch on the real
   binary).
7. **Empty-result semantics** — disjoint `intersection` → null; `a`
   wholly-inside-`b` `difference` → null. (Confirms null is "empty", not error.)
8. **WKB round-trip fidelity** — encode → identity-ish op → decode preserves
   coordinates within epsilon; ISO Multi\* byte-order headers parse correctly.
9. **Memory stress** — run buffer + each overlay in a tight loop (≥ 1000×):
   no crash, no unbounded growth. Catches double-free / leak in the `defer`
   chain and (Android) JNI local-reference table overflow.
10. **Malformed input** — NaN coords, unclosed ring, truncated WKB → null, no
    crash (the `coordSanity` rejection cases from `geosGeometryBackend.ts`).
11. **Concurrency (best-effort)** — fire ops from multiple threads / dispatch
    queues to exercise lazy context init (`NSLock`, `std::call_once`).

## Ordered work items

### WI-0 — Golden fixtures + generator

- Add `scripts/gen-golden-fixtures.mjs`; emit
  `modules/native-geometry/__fixtures__/geos-golden.json` from the existing
  parity fixtures using the turf oracle for `expect`.
- Wire the Jest `geosParity` suite to also assert against the file (single
  source of truth). Commit the JSON.

### WI-1 — iOS testability refactor

- Extract `GeosCore.swift`; thin `NativeGeometryModule.swift` to delegators.
- `pnpm exec expo prebuild --platform ios --clean` + `run:ios` still builds and
  the app behaves identically (manual sanity).

### WI-2 — iOS XCTest target

- Add a **standalone** Xcode/SwiftPM test setup under
  `modules/native-geometry/ios/Tests/` that compiles `GeosCore.swift` + the C
  bridge (`geos_bridge.h`) and links the `ios-arm64-simulator` slice of
  `libgeos.xcframework` — **without** the app or Pods. (Fallback route: a test
  target inside the prebuilt app workspace, if standalone linking proves
  fiddly.) Standalone is preferred: no app build, no signing, fastest CI.
- Implement the case catalogue; load `geos-golden.json` from the bundle.
- Local run: `xcodebuild test -scheme NativeGeometryTests -destination 'platform=iOS Simulator,name=iPhone 16 Pro'`.

### WI-3 — Android testability refactor

- Extract `GeosBridge`; thin `NativeGeometryModule.kt`. Update JNI symbol names
  if the package/owner changes. Rebuild + sanity.

### WI-4 — Android instrumented tests

- Add `androidTest/` under the module with
  `testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"` and the
  androidx.test deps in `android/build.gradle`.
- Implement the same case catalogue against `GeosBridge`; load the fixture from
  test assets.
- Local run on emulator: `./gradlew :native-geometry:connectedAndroidTest`
  (the module's CMake builds the real `.so` for the emulator ABI).

### WI-5 — CI workflow

- New `.github/workflows/native-geometry-tests.yml` (or jobs) with two jobs:
    - `ios-geos` (macos-15): boot simulator → `xcodebuild test`. No `expo run`,
      no signing, no Metro.
    - `android-geos` (ubuntu + `reactivecircus/android-emulator-runner`):
      `:native-geometry:connectedAndroidTest`.
- Trigger on changes to `modules/native-geometry/**`,
  `src/shared/geometry/**`, and the workflow file. Mark **required**.
- These are independent of the Metro/native-geometry-resolution and iOS-signing
  problems that block the app build — they don't bundle JS.

### WI-6 — Reduce Maestro to one smoke flow

- Keep exactly one flow: launch → bottom sheet reachable → map renders →
  `"Tokyo 23 Wards"` visible. Delete `play-area`, `hiding-zone`,
  `radar-question`, `transit-line-question`, `thermometer-question`,
  `geos-*`, `reconnect`, `dismiss-continue` flows and their stack entries.
- Migrate the assertions those carried:
    - Mask **polarity** (the inversion class from AGENTS.md) → Jest render-state
      tests (already the documented home).
    - GEOS correctness → this native suite.
- Apply the two infra fixes the 1 remaining smoke still needs (from the prior
  analysis): `native-geometry` as a real `link:` dependency so Metro resolves
  it in CI; strip the leaked `associatedDomains` entitlement for E2E so the iOS
  sim build doesn't demand signing. (The native suite needs neither.)

### WI-7 — Docs + upgrade gate

- Update `implementation_notes.md §How to upgrade GEOS`: step "run
  `native-geometry-tests` (or local equivalents) — golden parity must pass" as
  the regression gate after a version bump.
- Update `AGENTS.md` Testing Expectations to point native/geometry changes at
  the new suites and note Maestro is now one smoke flow.

## Known residual gap

The native suite tests `GeosCore` / `GeosBridge` — it does **not** cross the
expo-modules-core `Data`/`ByteArray` ↔ `Uint8Array` marshalling boundary or the
`requireNativeModule("NativeGeometry")` wiring (the `index.ts` wrappers). That
boundary is exercised by (a) the one Maestro smoke during normal startup map
rendering, and (b) the existing Jest adapter tests on the JS side. If we want it
covered explicitly, the cheap add is a tiny `__DEV__`-only on-device JS
self-test invoked by the smoke flow (round-trip one buffer through the real JS
module and assert non-null). Treat as optional follow-up, not part of this
suite.

## Risks / open questions

- **iOS standalone test linking** — getting an Xcode/SPM test target to link
  the xcframework + C bridge without the full Pods graph is the fiddliest piece.
  WI-2 carries the app-workspace fallback if standalone stalls.
- **Android library `connectedAndroidTest`** — needs an instrumentation APK;
  confirm the module project produces one in isolation, otherwise host the
  androidTest in the prebuilt app project.
- **geos-wasm (3.13) vs vendored (3.14)** — handled by invariant-based golden
  fixtures (area ratio / bbox tolerance / type / null), never byte equality.
- **Fixture drift** — mitigated by having Jest parity assert against the same
  committed JSON; a divergence fails on host before it reaches a device.

## Verification

```bash
# Host (unchanged, still the fast inner loop)
pnpm test
pnpm test:geos          # geos-wasm parity, now sharing geos-golden.json

# Device suites (new)
xcodebuild test -scheme NativeGeometryTests \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
./gradlew :native-geometry:connectedAndroidTest

# CI
gh workflow run "native-geometry-tests" --ref <branch>
```

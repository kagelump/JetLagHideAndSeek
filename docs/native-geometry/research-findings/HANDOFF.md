# Native Module Test Suite — Research Handoff

> Snapshot 2026-06-14. Tracks the research phase of
> [`native-module-test-suite-research-plan.md`](../native-module-test-suite-research-plan.md).
> Read that plan for the full RQ definitions; this doc is "where we are + how to
> resume."

## TL;DR

The make-or-break gate is cleared. **A standalone iOS XCTest harness links the
vendored GEOS and runs in ~11 s with no prebuild / Pods / signing.** WKB fixtures
are cross-engine (JS↔Swift), and the GEOS 3.13→3.14.1 buffer delta is literally
zero. Three findings are GREEN. Remaining work is the Android harness, the
parity body-of-water timing case (in progress), CI wiring, and the Maestro
reduction.

| RQ    | Topic                                  | Status                                     | Finding                      |
| ----- | -------------------------------------- | ------------------------------------------ | ---------------------------- |
| A1    | iOS standalone XCTest harness          | ✅ GREEN                                   | `research-findings/RQ-A1.md` |
| C1    | WKB-hex cross-engine (JS↔Swift)       | ✅ GREEN (Kotlin pending B1)               | `research-findings/RQ-C1.md` |
| C2    | Parity tolerances 3.13→3.14.1 (buffer) | ✅ GREEN                                   | `research-findings/RQ-C2.md` |
| C3    | Body-of-water difference timing        | 🚧 IN PROGRESS                             | — (see below)                |
| E1    | Maestro infra fixes (1 smoke flow)     | ⬜ NOT STARTED                             | —                            |
| E2    | Deleted-flow assertion inventory       | ⬜ NOT STARTED                             | —                            |
| A2    | In-workspace iOS fallback              | ⏭️ UNNEEDED (A1 green; 2h desk-check only) | —                            |
| A3    | GeosCore.swift refactor                | ⬜ NOT STARTED                             | —                            |
| B1/B2 | Android instrumented harness           | ⬜ NOT STARTED                             | —                            |
| D1/D2 | iOS/Android CI                         | ⬜ NOT STARTED (D1 unblocked by A1)        | —                            |
| F1/F2 | Sanitizers / concurrency               | ⬜ NOT STARTED (gated on a harness)        | —                            |

Decision gates: **Gate 1 RETIRED** (A1 green). **Gate 2 RETIRED for iOS axis**
(C1+C2); Kotlin axis pending B1. **Gate 3 (body-of-water is real & GEOS is fast)
in progress** (C3). Gate 4 (sanitizers) not started.

## The harness (reusable for every iOS RQ)

Everything lives in `spikes/RQ-A1-ios-geos/` on branch
`research/RQ-A1-ios-standalone`. **Spike code — do not merge to master.** The
finding docs under `docs/native-geometry/research-findings/` are the keepers.

Structure:

- `Package.swift` — SwiftPM, `swift-tools-version:6.0`, `platforms:[.iOS(.v18)]`.
  Three targets: `CGEOS` (C module re-exposing `geos_c.h` via `geos_bridge.h`,
  headers copied into `Sources/CGEOS/include/`), `GeosSpike` (Swift surface,
  links the **simulator static slice directly** via `-L.../ios-arm64-simulator
-lgeos-combined` + `-lc++`), `GeosSpikeTests`.
- `Sources/GeosSpike/GeosSpike.swift` — `version()`, `intersectionArea…()`,
  `probeWkbHex()` (C1), `bufferWkbHex()` (C2). Add C3 probes here.
- `Tests/GeosSpikeTests/` — `GeosSpikeTests` (A1), `WkbParityTests` (C1),
  `BufferParityTests` (C2). Tests read JSON fixtures from the package root via
  `#filePath`.
- JS fixture emitters (run with `node --import tsx …`):
  `emit-wkb-fixtures.mts` → `wkb-fixtures.json` (C1);
  `emit-buffer-fixtures.mts` → `buffer-fixtures.json` (C2, drives geos-wasm 3.13).

Run the whole suite:

```bash
cd spikes/RQ-A1-ios-geos
UDID=79ECD5E0-0254-4F1B-818A-D633DC80C469   # iPhone 16 Pro (xcrun simctl list)
xcodebuild test -scheme GeosSpike-Package \
  -destination "platform=iOS Simulator,id=$UDID" CODE_SIGNING_ALLOWED=NO
```

Filter noise with `… 2>&1 | grep -vE "ld: warning: object file"`.

### Load-bearing gotchas (already cost us time)

1. **`.binaryTarget(libgeos.xcframework)` fails** — `Info.plist` missing
   `XCFrameworkFormatVersion` + per-lib `HeadersPath`. CocoaPods tolerates it,
   SPM/xcodebuild does not. Workaround: link the static slice directly. **Real
   artifact bug** — flagged as a separate task (task_76b534d5); root cause is the
   hand-written heredoc plist in `modules/native-geometry/scripts/build-geos-ios.sh:122-159`
   clobbering the correct plist that `xcodebuild -create-xcframework` emits.
2. **Deployment target must be iOS 18** (lib objects built for sim 18.0) or you
   get hundreds of harmless `ld: warning … built for newer iOS-simulator
version` lines. `.v18` needs `swift-tools-version:6.0`.
3. Native + wasm buffer params are identical: `GEOSBufferWithParams`, QS=8,
   `CAP_ROUND`, `JOIN_ROUND`. Match these in any buffer comparison.

## RQ-C3 — body-of-water timing (IN PROGRESS — resume here)

**Goal:** commit a real large-MultiPolygon `difference`/`unaryUnion` fixture and
show device GEOS does it fast (< 3 s, ideally sub-second, non-null), vs the JS
polyclip dissolve that hard-locks ~25 s.

**What's established:**

- The marquee op is `backend.unaryUnion(merged)` at
  `src/features/questions/measuring/lineMeasuringGeometry.ts:788-804`. `merged`
  = `mergeBuffersToMultiPolygon(allBuffers)` — dissolved water polygons + river
  line buffers over the **50 km** window (the over-wide window is the bug in
  `docs/body-of-water-mask-bug.md`). polyclip-ts dissolve of this ≈ 25 s; only
  GEOS does it cheaply. The downstream mask op is
  `buildCombinedEligibilityMask` → GEOS `difference(playArea, eligibleArea)`.
- **Repro data:** the real 15 MB asset (7012 features: 155 MultiPolygon + 6857
  LineString, `category: body-of-water`) is gone from `assets/measuring/` but
  survives at
  `.claude/worktrees/reduce-simplify-tolerances/assets/measuring/body-of-water.json`.
  (Pack form: `data/packs/dist/{asia-taiwan,europe-netherlands}/measuring-body-of-water.json.gz`;
  Kantō pack has no body-of-water file.) Repro center
  `CENTER=[139.658499,35.68783]`, `PLAY_AREA_BBOX=[139,35,140,36]` (from
  `bodyWaterMask.geos.test.ts`, which is `describe.skip`'d post-bundle-removal).

**The blocker that shaped the approach:** the app pipeline
(`computeLineCategory`/`computeLineBuffer`/`geosGeometryBackend`) imports
`native-geometry` (→ `requireNativeModule`) and RN bits, which throw under plain
`node --import tsx`. Only jest has those mocks. So two viable paths to get the
**exact** op-input WKB:

- **Path A (recommended, faithful):** add a throwaway capture test under the
  geos jest config (`*.geos.test.ts`, runs via `pnpm test:geos` which has all
  mocks). Point `require` at the worktree asset, monkeypatch
  `native.unaryUnionWKB`/`differenceWKB` to **record their input WKB to disk**
  (hex) before delegating to the wasm impl, run the pipeline from the skipped
  test, and dump `bow-fixtures.json` (the largest `unaryUnion` input + the
  `difference` a/b inputs). Also time the wasm op and, for the headline contrast,
  time `jsGeometryBackend.unaryUnion` on the same input (expect ~25 s — that IS
  the evidence; give it a long timeout).
- **Path B (lighter, approximate):** in a tsx script using only `geosWasmNode` +
  `bufferProjection` + `wkb` + turf (all tsx-safe), filter the asset to the
  50 km Tokyo window, buffer each line via geos-wasm, concat into one big
  MultiPolygon, encode → fixture. Less faithful to `mergeBuffersToMultiPolygon`
  but captures the pathological overlap that stresses the dissolve.

**Then (either path):** add `unaryUnionWkbHex()` + `differenceWkbHex()` probes to
`GeosSpike.swift` (use `GEOSUnaryUnion_r` and `GEOSDifference_r`), and a
`BodyOfWaterTimingTests.swift` that reads `bow-fixtures.json`, runs each op,
asserts non-null + result coord count > 0, and prints wall-clock
(`CFAbsoluteTimeGetCurrent()`). Commit the fixture (it's the deliverable). If
GEOS is _also_ slow → critical finding, escalate (Gate 3 fails).

## Remaining tracks (not started)

- **E2 (pure reading, cheapest):** inventory every assertion in `e2e/`
  (`play-area`, `hiding-zone`, `radar-question`, `transit-line-question`,
  `thermometer-question`, `geos-*`, `reconnect`, `dismiss-continue`) → table:
  covered by Jest render-state / will be covered by native suite / orphaned.
  Output `research-findings/RQ-E2.md`. No "unknown" rows allowed.
- **E1 (touches CI):** two known fixes — (1) add `native-geometry` as a
  `link:./modules/native-geometry` dep so Android Metro resolves it (currently a
  stray symlink); (2) own the associated-domains gate in `app.config.ts` (strip
  the entitlement, remove from `app.json`) + `CODE_SIGNING_ALLOWED=NO` on the sim
  build. Goal: one Maestro smoke flow green on both platforms ×2 (flake check).
  Verify locally what you can; the green-on-CI proof needs
  `gh workflow run "Maestro E2E"` (outward-facing — get the user to trigger or
  confirm cost).
- **B1/B2 (Android):** needs an emulator booted + a full `expo prebuild
--platform android` (no `gradle` on PATH; use the generated `./gradlew`). Add
  an `androidTest` source set to `modules/native-geometry/android/build.gradle`,
  call `GEOSversion()` through JNI, run `:native-geometry:connectedAndroidTest`.
  B2: watch for `UnsatisfiedLinkError` if the `external fun native*` decls move
  off `NativeGeometryModule` (JNI symbols are
  `Java_expo_modules_nativegeometry_NativeGeometryModule_native*`). Closes the
  Kotlin axis of C1 (reuse `wkb-fixtures.json`).
- **A3:** extract `GeosCore.swift` from `NativeGeometryModule.swift`, rebuild dev
  client, confirm a buffer renders identically. Independent of the harness (the
  harness doesn't need `ExpoModulesCore`).
- **D1 (unblocked by A1):** GitHub `macos-15` runner, reuse the simulator UDID
  block from `.github/workflows/maestro-e2e.yml`, run the A1 command. Expect a
  few-min job dominated by sim boot, not the 11 s test.
- **F1/F2:** sanitizers (seed a double-free, confirm ASan catches it) + lazy-init
  concurrency. Gated on a working harness; A1 satisfies that for iOS.

## House rules (from the plan)

- Spikes live on `research/<rq>-…` branches, never merged to master.
- Every RQ ends with a `research-findings/<rq>.md` (template at the bottom of the
  research plan). A clear RED finding is a success.
- The master working tree has unrelated in-flight edits (ux-overhaul, transit) —
  leave them alone; spike work is isolated under `spikes/`.

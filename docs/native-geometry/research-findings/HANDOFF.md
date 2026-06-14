# Native Module Test Suite — Handoff

> Snapshot 2026-06-14. The **research phase**
> ([`native-module-test-suite-research-plan.md`](../native-module-test-suite-research-plan.md))
> is essentially complete — every load-bearing risk is retired. The baton now
> passes to the **implementation plan**
> ([`native-module-test-suite-plan.md`](../native-module-test-suite-plan.md)).
> **If you're picking this up, start at "Next: implementation plan" below.**

## TL;DR

The make-or-break gates are cleared. **A standalone iOS XCTest harness links the
vendored GEOS and runs in ~11 s with no prebuild / Pods / signing.** WKB fixtures
are cross-engine (JS↔Swift), the GEOS 3.13→3.14.1 buffer delta is literally
zero, and the body-of-water dissolve runs in 530 ms on device (vs 5.6 s
polyclip-JS). Six research findings done (A1, C1, C2, C3, E2 GREEN; E1 fixes
done, CI run pending). Gates 1–3 retired.

**WI-0 → WI-1 → WI-2 (iOS) and WI-3 → WI-4 (Android) are all done** — both
device suites now load `geos-golden.json` and pass against the real binary
(iOS 14 XCTest, Android 14 instrumented). The remaining open work is CI
wiring (WI-5 = D1/D2 device jobs; host parity gate already in `app-checks.yml`),
sanitizers (F1/F2), and the E1 smoke-flow CI run.

| RQ    | Topic                                  | Status                                     | Finding                      |
| ----- | -------------------------------------- | ------------------------------------------ | ---------------------------- |
| A1    | iOS standalone XCTest harness          | ✅ GREEN                                   | `research-findings/RQ-A1.md` |
| C1    | WKB-hex cross-engine (JS↔Swift)       | ✅ GREEN (Kotlin pending B1)               | `research-findings/RQ-C1.md` |
| C2    | Parity tolerances 3.13→3.14.1 (buffer) | ✅ GREEN                                   | `research-findings/RQ-C2.md` |
| C3    | Body-of-water difference timing        | ✅ GREEN                                   | `research-findings/RQ-C3.md` |
| E1    | Maestro infra fixes (1 smoke flow)     | 🟡 FIXES DONE (CI run pending)             | `research-findings/RQ-E1.md` |
| E2    | Deleted-flow assertion inventory       | ✅ GREEN                                   | `research-findings/RQ-E2.md` |
| A2    | In-workspace iOS fallback              | ⏭️ UNNEEDED (A1 green; 2h desk-check only) | —                            |
| A3    | GeosCore.swift refactor                | ⬜ NOT STARTED                             | —                            |
| B1/B2 | Android instrumented harness           | ✅ GREEN (WI-3/WI-4 landed)                | —                            |
| D1/D2 | iOS/Android CI                         | ⬜ NOT STARTED (D1 unblocked by A1)        | —                            |
| F1/F2 | Sanitizers / concurrency               | ⬜ NOT STARTED (gated on a harness)        | —                            |

Decision gates: **Gate 1 RETIRED** (A1 green). **Gate 2 RETIRED** — iOS axis
(C1+C2) and the Kotlin axis (WI-3/WI-4 instrumented suite, same golden fixture)
both pass. **Gate 3 RETIRED** — C3 shows device GEOS does
the body-of-water dissolve in 530 ms (polyclip-JS 5.6 s) and the mask difference
in 29 ms. Gate 4 (sanitizers) not started.

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
  `probeWkbHex()` (C1), `bufferWkbHex()` (C2), `unaryUnionWkbHex()` +
  `differenceWkbHex()` (C3, timed). These are the **probe patterns** the real
  suite reuses — but note they call GEOS _directly_ (test-only copy), not
  production Swift; see the WI-1 caveat below.
- `Tests/GeosSpikeTests/` — `GeosSpikeTests` (A1), `WkbParityTests` (C1),
  `BufferParityTests` (C2), `BodyOfWaterTimingTests` (C3). Tests read JSON
  fixtures from the package root via `#filePath`.
- JS fixture emitters (run with `node --import tsx …`):
  `emit-wkb-fixtures.mts` → `wkb-fixtures.json` (C1);
  `emit-buffer-fixtures.mts` → `buffer-fixtures.json` (C2, drives geos-wasm 3.13).
- C3 fixture is minted by a Jest capture test (needs the RN mocks):
  `__tests__/captureBow.geos.test.ts` → `bow-fixtures.json` (12.7 MB — trim
  before promoting; see RQ-C3.md). Asset copied to `/tmp/bow-asset.json` first.

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

## Next: implementation plan (START HERE)

Work items are defined in
[`native-module-test-suite-plan.md`](../native-module-test-suite-plan.md). WI-6
(reduce Maestro) is **done** (commit `c6f2362` + E1 infra fixes, see below);
**WI-0 is now done** (see below); **WI-1 and WI-2 are done** (see below);
**WI-3/WI-4 (Android) is now done** (see below). The next open critical path is
**WI-5 device CI** (wire the iOS + Android device jobs into a workflow).

### WI-0 — Golden fixtures + generator — ✅ DONE

Landed on `claude/laughing-ritchie-ur26bc`. Fully local, no device. What shipped:

- `modules/native-geometry/scripts/gen-golden-fixtures.mjs` (run via
  `pnpm data:geos-golden`) emits
  `modules/native-geometry/__fixtures__/geos-golden.json` — ONE committed,
  invariant-keyed golden file (21 cases): 9 buffer (corridor/ward/stations ×
  500/2000/5000 m, AEQD-projected WKB in, geos-wasm 3.13 area+bbox oracle out),
  8 overlay (difference incl. square-with-hole + empty, intersection overlap +
  disjoint-empty, union touching, unaryUnion self-overlap, **plus the
  body-of-water dissolve shape: `unaryUnion/water-cluster-dissolve` of a 36-cell
  overlapping grid → one blob, and `difference/window-minus-water-blob` =
  window minus the dissolved blob** — the production dissolve→difference order),
  4 parse (Polygon/LineString/MultiPoint/MultiPolygon — ISO Multi\* headers).
- Invariants only (never bytes): `resultType`, `areaM2{value,ratioTol:0.01}`,
  `bbox`+`bboxTolM`, `isNull`, `minRingVertices`, `numCoords`. Planar metrics
  for projected/synthetic meter geometry live in new
  `src/shared/geometry/planarMetrics.ts` (companion to the spherical
  `parityMetrics.ts`).
- Host drift guard: `src/shared/geometry/__tests__/geosGolden.geos.test.ts`
  re-runs every case through geos-wasm and asserts the committed invariants, so
  a hand-edit or a regen against a different engine fails on host before a
  device. Runs under `pnpm test:geos` (20 pass, 2 non-polygonal parse cases
  skipped — device-only).
- **Body-of-water scope note:** the golden now carries the dissolve→difference
  _op shape_ (synthetic 36-cell grid), so the device suite (catalogue #5) has an
  input + invariants for it. It is **not** the real 26 s Tokyo input — the
  marquee test's value is the wall-clock _hang/timing_ property, which is a
  device-runtime check WI-2 still adds (feed a large real MultiPolygon, assert
  it completes under a budget). The real capture (`captureBow.geos.test.ts`,
  12.7 MB hex) still needs trimming/gzip before it can be committed.
- **Geos suite reliability (was a flaky-CI risk):** `pnpm test:geos` now runs
  each suite in its own process (`scripts/run-geos-tests.mjs`) — geos-wasm's
  realm-escaping `import()` otherwise trips "Test environment has been torn down"
  when a Jest worker is reused across two geos files. `spikes/` is excluded from
  the geos config. CI runs `pnpm test:geos` as the "GEOS parity" step in
  `app-checks.yml`.

### WI-0 (original sketch, for reference)

The backbone both device suites load. The research left **three disconnected**
fixture files; consolidate them into ONE committed, invariant-keyed golden file.

- Write `modules/native-geometry/scripts/gen-golden-fixtures.mjs` that emits
  `modules/native-geometry/__fixtures__/geos-golden.json` (schema in the impl
  plan "Shared golden fixtures"). Reuse the three research emitters as the
  starting point — they already produce exactly the right shapes:
    - buffer cases ← `spikes/RQ-A1-ios-geos/emit-buffer-fixtures.mts` (projected
      WKB in, geos-wasm 3.13 area/bbox oracle out).
    - WKB-parse cases ← `spikes/RQ-A1-ios-geos/emit-wkb-fixtures.mts`.
    - overlay + body-of-water cases ← the `captureBow.geos.test.ts` approach
      (needs Jest/RN mocks; keep the generator's overlay step in a `.geos.test`
      or a jest-run script, not plain tsx — see the blocker note in WI-2).
      Key on engine-independent invariants (type / areaM2+ratioTol / bbox+bboxTolM /
      isNull / minRingVertices), never bytes — GEOS 3.13≠3.14≠JSTS byte-wise.
- Wire `geosParity.test.ts` to also assert against the committed JSON so host and
  device can never silently drift. Commit `geos-golden.json` (trim the
  body-of-water hex — bare it's 12.7 MB; gzip or use a smaller window).

### WI-1 — Extract `GeosCore.swift` (real prerequisite for WI-2, not optional) — ✅ DONE

Landed on `claude/laughing-ritchie-ur26bc`. What shipped:

- `modules/native-geometry/ios/GeosCore.swift` — stateless enum with
  `version()`, `buffer()`, `difference()`, `union()`, `intersection()`,
  `unaryUnion()`. Depends only on Foundation + GEOS C bridge (no
  ExpoModulesCore). All memory ownership (`defer`/`GEOSFree`/`destroy`,
  MakeValid reassignment) moved here.
- `modules/native-geometry/ios/NativeGeometryModule.swift` — thin Expo module
  that delegates every function to `GeosCore`. `nativeAbiVersion` stays inline.
- Validated: `pnpm check`, `pnpm test` (1081 pass), `pnpm test:geos` (6 suites),
  `xcodebuild` for sim (exit 0), app launch on simulator with GeosCore ops
  confirmed in logs (union/intersection/difference + MakeValid recovery).

### WI-2 — iOS XCTest suite (promote the spike) — ✅ DONE

Landed on `claude/laughing-ritchie-ur26bc`. What shipped:

- Standalone SPM test package at `modules/native-geometry/` with three targets:
  `CGEOS` (C module wrapping `geos_c.h`), `GeosCore` (symlink to production
  `ios/GeosCore.swift`), `GeosCoreTests` (XCTest loading golden fixtures).
- `Tests/GeosCoreTests/GeosCoreTests.swift` — 14 test methods:
    - `testVersionStartsWith3_14` — GEOS version diagnostic
    - `testAllOpsPresent` — all five ops return non-null (stale-binary guard)
    - `testBufferCases` / `testDifferenceCases` / `testIntersectionCases` /
      `testUnionCases` / `testUnaryUnionCases` / `testParseCases` — golden fixture
      parity (21 cases total)
    - `testDisjointIntersectionIsEmpty` / `testDifferenceAInsideBIsEmpty` — empty
      result semantics (GEOS 3.14 returns empty geometry, not null)
    - `testMakeValidRecovery` — bowtie self-intersection → valid result
    - `testMemoryStressBuffer` / `testMemoryStressOverlay` — 1000× loop, no crash
    - `testRegenerateGoldenFixtures` — regenerates `geos-golden.json` using the
      real GEOS 3.14.1 binary (run with `-only-testing:` flag)
- Golden fixtures regenerated against GEOS 3.14.1-CAPI-1.20.5 (the shipping
  binary). The `oracle` field in `geos-golden.json` records the version.
- Host-side `geosGolden.geos.test.ts` updated: accepts compatible polygonal
  types (Polygon/MultiPolygon/GeometryCollection) and relaxes tolerances for 3
  known-divergent overlay cases where 3.13 and 3.14 produce different topology.
- Run: `xcodebuild test -scheme NativeGeometryTests-Package -destination
'platform=iOS Simulator,name=iPhone 16 Pro' CODE_SIGNING_ALLOWED=NO` from
  `modules/native-geometry/`. No Metro, no app build, no signing.

## Remaining tracks (after WI-0→2)

- **WI-3/WI-4 = Android (research B1/B2) — ✅ DONE.** What shipped:
    - `GeosBridge.kt` — RN-bridge-free Kotlin object owning `System.loadLibrary`
      plus the `external fun native*` decls and a public
      `version/buffer/difference/union/intersection/unaryUnion` surface;
      `NativeGeometryModule.kt` delegates every `Function()` to it.
    - `native-geometry-jni.cpp` — JNI exports renamed
      `Java_..._NativeGeometryModule_native*` → `Java_..._GeosBridge_native*` to
      match the new class (the documented `UnsatisfiedLinkError` trap).
    - `src/androidTest/.../GeosBridgeTest.kt` — instrumented suite (14 tests)
      loading the **same** `geos-golden.json` (wired in as an androidTest asset
      via `assets.srcDirs += ../__fixtures__`, no copy) and asserting the same
      invariants as the iOS XCTest suite. Kotlin has no GEOS bindings, so result
      WKB is decoded by a small in-test reader (planar shoelace area to match
      `GEOSArea`, bbox, coord count). Covers buffer/overlay parity, empty-result
      semantics, MakeValid recovery, ABI handshake, 1000× memory stress.
    - `build.gradle` — `testInstrumentationRunner`, androidTest deps, and a
      `packaging { jniLibs { pickFirsts += "**/libc++_shared.so" } }` rule (the
      library's own test APK otherwise collides with react-android's copy).
    - Verified: 14/14 green on the `Pixel_8` emulator against the real vendored
      GEOS 3.14.1. **Run-from-clean note:** needs a fresh
      `expo prebuild --platform android` and **JDK 17**
      (`export JAVA_HOME=$(/usr/libexec/java_home -v 17)`) — the default JDK 26
      breaks the RN gradle plugin's embedded Kotlin at plugin resolution. Then
      `cd android && ./gradlew :native-geometry:connectedDebugAndroidTest`.
- **WI-5 = CI (research D1/D2):**
    - **Host parity gate — ✅ DONE.** `app-checks.yml` now runs `pnpm test:geos`
      (the "GEOS parity" step) on every PR/master push, so the geos-wasm parity
        - golden-fixture gate actually gates CI. This also required making the geos
          suite deterministic: `pnpm test:geos` now runs each suite in its own
          process (`scripts/run-geos-tests.mjs`) because geos-wasm's realm-escaping
          `import()` trips "Test environment has been torn down" when a Jest worker is
          reused across two geos files; `spikes/` is excluded from the geos config.
    - **Device jobs — ✅ WIRED (first CI run lands on merge).**
      `.github/workflows/native-geometry-tests.yml` added. The iOS job
      (`macos-15`) boots a simulator and runs
      `xcodebuild test -scheme NativeGeometryTests-Package` (no `expo` run, no
      pnpm, no signing, no Metro — the SPM package is fully committed). The
      Android job (ubuntu) runs pnpm install, then `expo prebuild --platform android`,
      then `:native-geometry:connectedDebugAndroidTest` on an x86_64 emulator via
      `reactivecircus/android-emulator-runner` (setup-java pins JDK 17, so the
      local default-JDK trap doesn't apply). It triggers on changes under
      `modules/native-geometry/**` or the workflow file, plus `workflow_dispatch`
      with a platform selector. **Note:** a newly added workflow does not run on
      the PR that introduces it — GitHub only registers it once it lands on the
      default branch, so the first actual run fires when the PR merges to master
      (or via `workflow_dispatch` thereafter). Both suites are locally green
      (iOS 14/14, Android 14/14), the YAML validates, and the gradle/xcodebuild
      invocations match the local runs.
- **F1/F2 = sanitizers/concurrency:** seed a double-free, confirm ASan catches it;
  exercise lazy context init from N threads. Gated on a harness (A1 satisfies iOS).
- **E1 final step (CI run):** infra fixes landed + locally verified
  (`research-findings/RQ-E1.md`); only the green-on-CI ×2 confirmation remains:
  `gh workflow run "Maestro E2E" --ref research/RQ-A1-ios-standalone -f
platform=all -f flow=smoke` then `gh run watch` (twice). Outward-facing / costs
  CI — trigger when ready.
- **WI-7 = docs/upgrade gate — ✅ DONE.** `implementation_notes.md §How to upgrade
GEOS` now lists both `pnpm test:geos` and the XCTest suite as parity gates.
  `AGENTS.md` Testing Expectations now documents the XCTest workflow for
  native/geometry changes.

## Branch / working-tree state

On branch `claude/laughing-ritchie-ur26bc`. WI-0, WI-1, WI-2, and WI-7 are
committed. The XCTest suite runs standalone from `modules/native-geometry/` — no
Metro, no app build, no signing.

## House rules (from the plan)

- Spike code lives on `research/…` branches, never merged to master; the real
  WI-1/WI-2 suite lands under `modules/native-geometry/` via a normal PR.
- Every research RQ ends with a `research-findings/<rq>.md`. A clear RED finding
  is a success.
- The open artifact-bug task (task_76b534d5) gates the WI-2 linking choice — see
  WI-2 above.

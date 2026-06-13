# Native Module Test Suite — Research / De-risking Plan

> Status: research phase (2026-06-12). Precedes implementation of
> [`native-module-test-suite-plan.md`](native-module-test-suite-plan.md).
> Audience: a team of interns + a coordinator.

## Why this document exists

The implementation plan has four load-bearing assumptions that, if wrong, change
the whole approach. Before writing real tests we want to **prove or disprove**
each one with the smallest possible spike. This doc is a list of research
questions (RQs). Each RQ is self-contained: a risk it retires, how to
investigate, a **goal condition** (how you know you're done), and a deliverable.

**Rules of engagement for interns**

- A spike is throwaway code that answers a question. Optimize for a clear
  yes/no, not for clean code. Put spike code in a branch
  `research/<rq-id>-<short>` and never merge it to `master`.
- Every RQ ends with a short written finding in
  `docs/native-geometry/research-findings/<rq-id>.md` (template at the bottom).
  A finding of "this does **not** work, here's the error" is a success, not a
  failure — it retires the risk just as well as a green result.
- Time-box hard. If you blow past the box, stop and write up where you got
  stuck; that _is_ the finding. Escalate to the coordinator.
- Prefer the **simulator/emulator** everywhere. We never need a physical device
  or any signing for this work — if you hit a signing wall, that itself is a
  finding (it means we took a wrong turn).

**Repo orientation (read first)**

- Module under test: `modules/native-geometry/` — JS API `src/index.ts`, iOS
  `ios/NativeGeometryModule.swift` + `ios/geos_bridge.h` +
  `ios/libgeos.xcframework/`, Android
  `android/src/main/java/.../NativeGeometryModule.kt` +
  `android/src/main/cpp/native-geometry-jni.cpp` + `android/libs/<abi>/libgeos.a`.
- Existing host parity: `src/shared/geometry/__tests__/geosParity.test.ts`,
  `__tests__/helpers/geosWasmShim.ts`, `src/shared/geometry/parityMetrics.ts`,
  `src/shared/geometry/wkb.ts`. Run with `pnpm test:geos`.
- GEOS build scripts: `pnpm geos:fetch | geos:build:ios | geos:build:android`.
- Generating a dev build: `pnpm exec expo prebuild --platform ios --clean`
  (creates `ios/` Xcode workspace + Pods including the `NativeGeometry` pod).

---

## Track A — iOS test harness viability (highest risk)

The plan's riskiest claim: we can run XCTest against the **vendored GEOS
3.14.1 simulator slice** without dragging in the whole app + Pods + signing.

### RQ-A1 — Can a standalone test target link `libgeos.xcframework` + the C bridge and call GEOS directly?

- **Risk retired:** that "no app, no Pods, no signing" iOS testing is actually
  possible. If not, we fall back to an in-workspace test target (RQ-A2).
- **Hypothesis:** a minimal Xcode project (or SwiftPM package) can compile one
  Swift file that `#include`s `geos_bridge.h`, links the
  `ios-arm64-simulator` slice of `modules/native-geometry/ios/libgeos.xcframework`,
  and calls `GEOSversion()`.
- **How to investigate:**
    1. Inspect `ios/geos_bridge.h` and `ios/NativeGeometry.podspec` to see how the
       GEOS C symbols are currently exposed to Swift (umbrella header / module map).
    2. Create `modules/native-geometry/ios/Tests/` with the smallest XCTest bundle
       that links the xcframework and a bridging header for `geos_bridge.h`.
    3. Write one test: `XCTAssertTrue(String(cString: GEOSversion()).hasPrefix("3.14"))`.
    4. Run: `xcodebuild test -destination 'platform=iOS Simulator,name=iPhone 16 Pro'`.
       Capture the exact scheme/project incantation that works.
- **Goal condition:** a single XCTest that prints/asserts the GEOS version
  `3.14.x` passes on the simulator, built **without** running `expo prebuild` or
  building the app, and **without** any code-signing step. Document the exact
  project structure and `xcodebuild` command.
- **Deliverable:** working spike branch + `research-findings/RQ-A1.md` with the
  minimal project layout and command. If it fails, record the specific linker /
  module-map error.
- **Time-box:** 2 days.

### RQ-A2 — Fallback: in-workspace XCTest target after `expo prebuild`

- **Risk retired:** if RQ-A1 fails, can we instead add a test target to the
  generated app workspace and still avoid signing?
- **How to investigate:**
    1. `pnpm exec expo prebuild --platform ios --clean`; open `ios/*.xcworkspace`.
    2. Add a unit-test target that depends on the `NativeGeometry` pod; reference
       `GeosCore` (or, pre-refactor, copy the buffer helper) and the C bridge.
    3. Confirm a unit-test bundle runs on the simulator with
       `CODE_SIGNING_ALLOWED=NO` (unit tests on the simulator should not need a
       team/profile).
- **Goal condition:** GEOS version test passes inside the workspace target on
  the simulator with no signing. Note how much of the prebuild/Pods graph the
  test build pulls in (build-time cost matters for CI).
- **Deliverable:** `research-findings/RQ-A2.md` — only needed if A1 is red, but
  do a quick feasibility read regardless so we know the fallback is real.
- **Time-box:** 1.5 days (only if A1 is red; otherwise 2h desk check).

### RQ-A3 — Does the testability refactor (`GeosCore.swift`) leave the app behaving identically?

- **Risk retired:** that extracting GEOS logic out of the Expo Module into a
  bridge-free `GeosCore` is a safe, behavior-preserving move.
- **How to investigate:**
    1. Extract `geosContext()` + the `_bufferAndWrite` / `_binaryOpAndWrite` /
       `_unaryOpAndWrite` helpers into `GeosCore.swift`; make
       `NativeGeometryModule.swift` `Function`s one-line delegators.
    2. Rebuild the dev client (`expo run:ios`) and run an existing manual path
       (e.g. a radar buffer renders).
- **Goal condition:** app builds, a buffer op produces a visibly identical
  overlay, and the existing `pnpm test` / `pnpm test:geos` suites are unaffected
  (they mock/route around native, so they should be green unchanged).
- **Deliverable:** `research-findings/RQ-A3.md` + the refactor on a branch
  (this one _may_ graduate to the real PR if clean).
- **Time-box:** 1 day.

---

## Track B — Android instrumented test viability

### RQ-B1 — Can `:native-geometry:connectedAndroidTest` run on the emulator and load the real `.so`?

- **Risk retired:** that the Android library module can host instrumented tests
  that exercise the real JNI `.so`, in isolation, on an emulator.
- **Hypothesis:** adding an `androidTest` source set + AndroidJUnitRunner to
  `modules/native-geometry/android/build.gradle` lets
  `./gradlew :native-geometry:connectedAndroidTest` build an instrumentation APK,
  install it on a running emulator, and call `GEOSversion()` through JNI.
- **How to investigate:**
    1. `pnpm exec expo prebuild --platform android --clean` so the gradle project
       (`android/`) with `:native-geometry` exists.
    2. Add `androidTest` deps (`androidx.test.ext:junit`,
       `androidx.test:runner`) and `testInstrumentationRunner` to the module's
       `build.gradle`.
    3. Write one instrumented test that calls the JNI version function (via the
       existing `external fun` or a thin `GeosBridge`).
    4. Boot an emulator (x86_64, API 35) and run
       `./gradlew :native-geometry:connectedAndroidTest`.
- **Goal condition:** the instrumented test asserting GEOS `3.14.x` passes on the
  emulator and demonstrably loaded `libnative-geometry-jni.so` (check logcat for
  the `NativeGeometry-JNI` tag). Capture the exact gradle task + emulator setup.
- **Deliverable:** spike branch + `research-findings/RQ-B1.md`. If the library
  module can't produce an instrumentation APK alone, record that and pivot to
  hosting `androidTest` in the prebuilt **app** project (note the cost).
- **Time-box:** 2 days.

### RQ-B2 — JNI symbol binding after the `GeosBridge` extraction

- **Risk retired:** that moving the `external fun native*` declarations to a new
  `GeosBridge` owner doesn't break JNI symbol resolution (the C side uses
  `Java_expo_modules_nativegeometry_NativeGeometryModule_native*` names).
- **How to investigate:** try the extraction; if symbol lookup fails at runtime
  (`UnsatisfiedLinkError`), compare options: (a) rename the `Java_...` exports in
  `native-geometry-jni.cpp` to match the new owner, vs (b) keep `external fun`s
  on the Module and expose an `internal` accessor the test calls.
- **Goal condition:** a documented, working binding strategy with no
  `UnsatisfiedLinkError`, and a recommendation on (a) vs (b) by symbol-churn.
- **Deliverable:** `research-findings/RQ-B2.md`.
- **Time-box:** 1 day.

---

## Track C — Cross-engine fixtures & parity validity

### RQ-C1 — Is WKB-hex truly identical across JS, Swift, and Kotlin?

- **Risk retired:** the core assumption that one WKB-hex fixture feeds all three
  engines byte-for-byte (no endianness / signedness / parsing divergence).
- **How to investigate:**
    1. Take 3–4 geometries from `geosParity.test.ts`; encode to WKB via
       `src/shared/geometry/wkb.ts`; print hex.
    2. In a Swift snippet and a Kotlin snippet, hex-decode to `Data`/`ByteArray`,
       parse with `GEOSGeomFromWKB_buf_r`, re-serialize with
       `GEOSGeomToWKB_buf_r`, and compare the round-tripped hex to JS.
- **Goal condition:** the same input hex parses successfully on all three
  engines and round-trips to equivalent geometry (within GEOS's own
  serialization, exact bytes not required — but **no parse failures** and matching
  coordinate count/bbox).
- **Deliverable:** `research-findings/RQ-C1.md` + the sample hex used.
- **Time-box:** 1 day.

### RQ-C2 — Do the existing parity tolerances hold between geos-wasm (3.13) and the device 3.14.1?

- **Risk retired:** that invariant-based expectations (area ratio 0.99–1.01,
  bbox tol) survive the 3.13→3.14 jump on a real device, so the golden file
  isn't pinned to one GEOS build.
- **How to investigate:** once RQ-A1 **or** RQ-B1 is green, run the buffer +
  overlay fixtures through the device binary and compare against the values
  `parityMetrics.ts` produces from the oracle. Record actual area ratios and bbox
  deltas.
- **Goal condition:** all sampled fixtures fall inside the current
  `AREA_RATIO_MIN/MAX` and `bboxToleranceM`. If any don't, recommend adjusted
  tolerances **with data** (don't just widen blindly).
- **Deliverable:** `research-findings/RQ-C2.md` with a small table of measured
  ratios/deltas per fixture.
- **Time-box:** 1 day (gated on A1 or B1).

### RQ-C3 — Source a real "body-of-water" fixture and measure it on device

- **Risk retired:** that the marquee timing test is real — that we can capture
  the large MultiPolygon `difference` that hard-locks JS (~26 s) and show GEOS
  does it fast on a device.
- **How to investigate:**
    1. Find the offending geometry: see `docs/body-of-water-mask-bug.md` and
       `src/features/questions/measuring/__tests__/bodyWaterMask.geos.test.ts` for
       the shape; extract or reconstruct a representative large MultiPolygon and
       the subtrahend.
    2. Encode to WKB, run `difference` on the device binary (via the A1/B1
       harness), measure wall-clock.
- **Goal condition:** a committed fixture for this case + a measured device time
  (target: < 3 s, ideally sub-second) and a non-null result. If GEOS is _also_
  slow on this input, that's a critical finding — escalate.
- **Deliverable:** `research-findings/RQ-C3.md` + the fixture geometry.
- **Time-box:** 2 days (gated on A1 or B1).

---

## Track D — CI integration

### RQ-D1 — `xcodebuild test` on a GitHub macOS runner, no signing

- **Risk retired:** the iOS suite is green on CI, not just locally.
- **How to investigate:** add a throwaway workflow that, on `macos-15`, boots a
  simulator and runs the RQ-A1/A2 harness. Reuse the simulator-selection block
  from `.github/workflows/maestro-e2e.yml` (the iOS job already picks a UDID).
- **Goal condition:** the GEOS-version test passes on a hosted runner with no
  signing step and the job finishes in a few minutes. Record wall-clock.
- **Deliverable:** `research-findings/RQ-D1.md` + the trial workflow yaml.
- **Time-box:** 1 day (gated on A1/A2).

### RQ-D2 — `connectedAndroidTest` under `reactivecircus/android-emulator-runner`

- **Risk retired:** the Android suite is green on CI.
- **How to investigate:** mirror the existing Android job's emulator setup in
  `maestro-e2e.yml` but run `:native-geometry:connectedAndroidTest` instead of
  the Maestro stack.
- **Goal condition:** instrumented GEOS-version test passes on CI; record
  wall-clock and whether KVM/emulator boot is the dominant cost.
- **Deliverable:** `research-findings/RQ-D2.md` + trial workflow.
- **Time-box:** 1 day (gated on B1).

---

## Track E — Maestro reduction & the infra fixes it still needs

### RQ-E1 — Do the two infra fixes make the **one** smoke flow green on CI?

- **Risk retired:** that reducing Maestro to one flow is viable — i.e., the
  app-build blockers we already diagnosed are actually fixable.
- **Background:** the current workflow is red because (1) Android Metro can't
  resolve `native-geometry` (it's a stray local symlink, not a declared dep), and
  (2) the iOS sim build demands signing because `app.json`'s hardcoded
  `associatedDomains` leaks past the `E2E_DISABLE_IOS_ASSOCIATED_DOMAINS` gate in
  `app.config.ts`.
- **How to investigate:**
    1. Add `native-geometry` as a `link:./modules/native-geometry` dependency;
       confirm a clean `pnpm install --frozen-lockfile` creates the
       `node_modules/native-geometry` symlink and Android Metro bundles.
    2. Make the associated-domains gate actually strip the entitlement (own it in
       `app.config.ts`, remove from `app.json`); add `CODE_SIGNING_ALLOWED=NO` to
       the sim build as a belt-and-suspenders.
    3. Run the existing `warmup`/`smoke` flow only.
- **Goal condition:** one Maestro smoke flow goes green on **both** platforms on
  CI at least twice in a row (flake check). Document the diff.
- **Deliverable:** `research-findings/RQ-E1.md` + branch.
- **Time-box:** 2 days. (Independent of Tracks A–D — can start immediately.)

### RQ-E2 — Inventory: which deleted-flow assertions need a new Jest/native home?

- **Risk retired:** that we don't silently lose coverage when we delete the
  geometry/question Maestro flows.
- **How to investigate:** read each flow in `e2e/` (`play-area`, `hiding-zone`,
  `radar-question`, `transit-line-question`, `thermometer-question`,
  `geos-*`, `reconnect`, `dismiss-continue`). For each assertion, classify:
  already covered by Jest render-state / will be covered by the native suite /
  genuinely orphaned.
- **Goal condition:** a table mapping every current Maestro assertion to its new
  home (or an explicit "intentionally dropped, here's why"). No "unknown" rows.
- **Deliverable:** `research-findings/RQ-E2.md` (the migration map).
- **Time-box:** 1 day.

---

## Track F — Specialized test techniques

### RQ-F1 — Memory-leak / double-free detection on each platform

- **Risk retired:** that the "memory stress" case can actually _catch_ a leak or
  double-free, not just run a loop that happens to pass.
- **How to investigate:** on iOS, try the Address Sanitizer / Malloc scribble
  scheme options for the test target; on Android, try running instrumented tests
  with the NDK ASan or at least `CheckJNI` enabled. Deliberately introduce a
  known double-free in a spike build and confirm the tooling flags it.
- **Goal condition:** a documented way to run the suite such that a _seeded_ leak
  or double-free fails the run (not just hopes-and-loops). If sanitizers are too
  heavy for routine CI, recommend a separate nightly sanitizer job.
- **Deliverable:** `research-findings/RQ-F1.md`.
- **Time-box:** 2 days (gated on A1/B1).

### RQ-F2 — Concurrency test feasibility

- **Risk retired:** that we can meaningfully test the lazy context init
  (`NSLock` on iOS, `std::call_once` on Android) for races.
- **How to investigate:** fire N parallel ops from a fresh process (so the
  context is uninitialized) via `DispatchQueue.concurrentPerform` / a Kotlin
  thread pool; run under the sanitizer from F1.
- **Goal condition:** a test that exercises concurrent first-use without
  crashing/deadlocking, and (under TSan/ASan if available) reports no data race.
  If a clean process-per-test is impractical, note the limitation.
- **Deliverable:** `research-findings/RQ-F2.md`.
- **Time-box:** 1 day (gated on F1).

---

## Coordinator section

### Dependency graph / sequencing

```
Immediately, in parallel:
  RQ-A1 (iOS standalone)         RQ-B1 (Android instrumented)
  RQ-A3 (Swift refactor)         RQ-B2 (JNI binding)
  RQ-C1 (WKB hex parity)         RQ-E1 (Maestro infra fixes)  RQ-E2 (assertion inventory)

Gated on "A1 OR B1 green" (first device harness that works):
  RQ-C2 (tolerances)  RQ-C3 (body-of-water)  RQ-F1 (sanitizers)
  RQ-D1 (iOS CI, needs A1/A2)   RQ-D2 (Android CI, needs B1)

Gated on F1:
  RQ-F2 (concurrency)

Fallback only if A1 red:
  RQ-A2 (in-workspace iOS target)
```

### Assignment suggestion (3–4 interns)

- **iOS pair:** A1 → A3 → D1, fall back to A2 if needed.
- **Android pair:** B1 → B2 → D2.
- **Cross-cutting / floater:** C1 early, then C2/C3 once a harness is up; owns
  E2 (pure reading) on day 1 as a warm-up.
- **E1** (Maestro infra) is independent and high-value — give it to whoever is
  fastest with CI, or the coordinator takes it.

### Decision gates (coordinator owns these)

- **Gate 1 (end of week 1): "Do we have at least one working device harness?"**
  A1 or B1 green. If _both_ are red, stop and re-plan — the whole native-suite
  approach is in question; escalate to the maintainer.
- **Gate 2: "Are fixtures truly cross-engine?"** C1 green. If WKB-hex diverges,
  decide between per-engine fixtures vs a shared encoder before any test
  authoring begins.
- **Gate 3: "Is the marquee case real?"** C3 shows GEOS is fast on the
  body-of-water input. If GEOS is _also_ slow, the headline value prop weakens —
  surface immediately.
- **Gate 4: "Can sanitizers catch a seeded bug?"** F1. If not, downgrade the
  memory-stress test's claimed value in the impl plan (don't oversell it).

### Cadence & reporting

- Daily 15-min standup: each RQ owner says answered / blocked / time-box status.
- A finding doc per RQ is the unit of done — no finding, not done.
- Coordinator maintains a one-line status table (RQ → owner → red/green/blocked)
  and updates the **Risks** section of the impl plan as gates clear.

### Definition of done for the research phase

Every RQ has a committed finding doc; Gates 1–4 have a recorded decision; the
impl plan's "Risks / open questions" section is updated so each open question is
either **retired** (with a pointer to the finding) or **converted into a concrete
implementation task with a chosen approach**.

---

## Finding doc template

```markdown
# RQ-XX — <title>

- Owner: <name> Date: <date> Time spent: <hrs/days>
- Result: GREEN | RED | PARTIAL
- One-line answer: <the conclusion>

## What we did

<steps, commands, branch name>

## Evidence

<command output, screenshots, measured numbers, error text>

## Recommendation

<what the impl plan should do given this finding>

## Follow-ups / new risks

<anything this uncovered>
```

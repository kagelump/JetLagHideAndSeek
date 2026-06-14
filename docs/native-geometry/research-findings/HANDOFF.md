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

**Next action: WI-0 (golden fixtures) → WI-1 (extract GeosCore) → WI-2 (promote
the spike into the real iOS XCTest suite).** See the dedicated section below.
The Android side (WI-3/4 = research B1/B2) and CI (WI-5 = D1/D2) follow and need
an emulator; sanitizers (F1/F2) and the E1 smoke-flow CI run are still open.

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
| B1/B2 | Android instrumented harness           | ⬜ NOT STARTED                             | —                            |
| D1/D2 | iOS/Android CI                         | ⬜ NOT STARTED (D1 unblocked by A1)        | —                            |
| F1/F2 | Sanitizers / concurrency               | ⬜ NOT STARTED (gated on a harness)        | —                            |

Decision gates: **Gate 1 RETIRED** (A1 green). **Gate 2 RETIRED for iOS axis**
(C1+C2); Kotlin axis pending B1. **Gate 3 RETIRED** — C3 shows device GEOS does
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
**WI-0 is now done** (see below); **WI-1 → WI-2 is the next critical path**
(both need macOS/Xcode + a simulator). Do them in order.

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

### WI-1 — Extract `GeosCore.swift` (real prerequisite for WI-2, not optional)

⚠️ **The research caveat that changes the order:** the RQ-A1 spike proved the
_linking mechanism_, but `Sources/GeosSpike/GeosSpike.swift` calls GEOS through a
**test-only copy** — it does NOT exercise `NativeGeometryModule.swift`'s memory
ownership (the `defer`/`GEOSFree`/`destroy` chain, MakeValid reassignment). That
memory-ownership coverage is the impl plan's headline value (Context-table rows
2–4). So the real suite must call the extracted `GeosCore`, making WI-1 a genuine
prerequisite.

- Extract `geosContext()` + `_bufferAndWrite`/`_binaryOpAndWrite`/
  `_unaryOpAndWrite` into `modules/native-geometry/ios/GeosCore.swift` as a
  stateless enum (`buffer/difference/union/intersection/unaryUnion/version/
abiVersion`). Thin `NativeGeometryModule.swift` to one-line delegators.
- **Carve `GeosCore` to depend only on the C bridge + `Data` — NOT
  `ExpoModulesCore`** (RQ-A1 confirmed the test target links without it; keeping
  that boundary clean is what lets WI-2 compile `GeosCore` standalone).
- Rebuild dev client (`expo prebuild --clean` + `run:ios`), confirm a buffer
  renders identically. `pnpm test`/`test:geos` route around native → stay green.

### WI-2 — iOS XCTest suite (promote the spike)

- Stand up the real target at `modules/native-geometry/ios/Tests/` using the
  **proven SPM recipe** (see "The harness" above + RQ-A1.md): copy the `CGEOS`
  module + direct static-slice linking, but compile `GeosCore.swift` (production)
  instead of the test-only `GeosSpike.swift`.
- Load `geos-golden.json` from the bundle; implement the full case catalogue
  (impl plan §"Test case catalogue"). The spike covers #1-5,7 in spirit; the
  **native-only cases still to write**: #6 MakeValid recovery (bowtie), #9 memory
  stress (≥1000× loop, no leak/double-free), #10 malformed input (NaN/unclosed/
  truncated → null not crash), #11 concurrency (lazy `geosContext()` init).
- Run: `xcodebuild test -scheme NativeGeometryTests -destination 'platform=iOS
Simulator,name=iPhone 16 Pro' CODE_SIGNING_ALLOWED=NO`.
- **Before building any of this**, decide the artifact-bug fix (task_76b534d5): if
  fixed, you can use a clean `.binaryTarget(xcframework)` (links both slices); if
  not, keep the direct `-L .../ios-arm64-simulator -lgeos-combined` hack
  (simulator-only, which is fine for CI).

## Remaining tracks (after WI-0→2)

- **WI-3/WI-4 = Android (research B1/B2):** needs an emulator booted + a full
  `expo prebuild --platform android` (no `gradle` on PATH; use the generated
  `./gradlew`). Extract `GeosBridge` (Kotlin); add an `androidTest` source set to
  `modules/native-geometry/android/build.gradle`; call `GEOSversion()` through
  JNI; run `:native-geometry:connectedAndroidTest`. Watch for
  `UnsatisfiedLinkError` if the `external fun native*` decls move off
  `NativeGeometryModule` (JNI symbols are
  `Java_expo_modules_nativegeometry_NativeGeometryModule_native*`). Reuse
  `geos-golden.json` to close the Kotlin axis of C1.
- **WI-5 = CI (research D1/D2):**
    - **Host parity gate — ✅ DONE.** `app-checks.yml` now runs `pnpm test:geos`
      (the "GEOS parity" step) on every PR/master push, so the geos-wasm parity
        - golden-fixture gate actually gates CI. This also required making the geos
          suite deterministic: `pnpm test:geos` now runs each suite in its own
          process (`scripts/run-geos-tests.mjs`) because geos-wasm's realm-escaping
          `import()` trips "Test environment has been torn down" when a Jest worker is
          reused across two geos files; `spikes/` is excluded from the geos config.
    - **Device jobs — still pending** (blocked on WI-2/WI-4 targets existing):
      new `.github/workflows/native-geometry-tests.yml`. iOS job (`macos-15`):
      boot sim → `xcodebuild test` (reuse the UDID-select block from
      `maestro-e2e.yml`); no `expo run`, no signing, no Metro. Android job
      (`reactivecircus/android-emulator-runner`): `connectedAndroidTest`. D1 is
      unblocked by A1; D2 needs B1.
- **F1/F2 = sanitizers/concurrency:** seed a double-free, confirm ASan catches it;
  exercise lazy context init from N threads. Gated on a harness (A1 satisfies iOS).
- **E1 final step (CI run):** infra fixes landed + locally verified
  (`research-findings/RQ-E1.md`); only the green-on-CI ×2 confirmation remains:
  `gh workflow run "Maestro E2E" --ref research/RQ-A1-ios-standalone -f
platform=all -f flow=smoke` then `gh run watch` (twice). Outward-facing / costs
  CI — trigger when ready.
- **WI-7 = docs/upgrade gate:** update `implementation_notes.md §How to upgrade
GEOS` (golden parity must pass) + `AGENTS.md` Testing Expectations (point
  native/geometry changes at the new suite; Maestro is now one smoke flow).

## Branch / working-tree state (read before you commit anything)

On branch `research/RQ-A1-ios-standalone`, **nothing is committed yet.** The
uncommitted changes fall into three buckets — keep them separate when you stage:

1. **Spike (throwaway, do NOT merge to master):** everything under
   `spikes/RQ-A1-ios-geos/`.
2. **Keepers:** the finding docs under `docs/native-geometry/research-findings/`.
3. **Real fixes that must graduate to a proper PR (NOT throwaway):** the WI-6/E1
   infra edits — `package.json` (+`native-geometry` link dep), `app.json`
   (removed leaked `associatedDomains`), `app.config.ts` (gate now owns it),
   `pnpm-lock.yaml` (3-line add; re-prettified — a bare `pnpm install` reformats
   the whole file, so run `npx prettier --write pnpm-lock.yaml` after). These are
   verified locally (`pnpm install --frozen-lockfile`, `prettier --check`,
   `typecheck` all pass).

Also: `src/features/playArea/PlayAreaScreen.tsx` is someone else's in-flight
edit — leave it alone.

## House rules (from the plan)

- Spike code lives on `research/…` branches, never merged to master; the real
  WI-1/WI-2 suite lands under `modules/native-geometry/` via a normal PR.
- Every research RQ ends with a `research-findings/<rq>.md`. A clear RED finding
  is a success.
- The open artifact-bug task (task_76b534d5) gates the WI-2 linking choice — see
  WI-2 above.

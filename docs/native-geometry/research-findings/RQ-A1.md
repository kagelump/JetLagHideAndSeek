# RQ-A1 — Standalone iOS test target links `libgeos.xcframework` + the C bridge and calls GEOS

- Owner: Claude (pairing w/ Ryan) Date: 2026-06-14 Time spent: ~0.5 day
- Result: **GREEN**
- One-line answer: A standalone Swift Package XCTest bundle links the vendored
  GEOS simulator slice + the C bridge and calls GEOS directly on the iOS
  simulator — no `expo prebuild`, no app, no Pods, no code signing. Clean
  build+test is ~11s.

## What we did

Spike branch: `research/RQ-A1-ios-standalone`. Spike code:
`spikes/RQ-A1-ios-geos/` (throwaway — do not merge to master).

Built a minimal SwiftPM package with three targets:

- **`CGEOS`** — a C target that re-exposes the GEOS C API to Swift. It mirrors
  `modules/native-geometry/ios/module.modulemap` (`module CGEOS { header
"geos_bridge.h" }`). The xcframework's `Headers/` (`geos_c.h`, `export.h`,
  `geos/export.h`, plus the repo's `geos_bridge.h`) are **copied** into
  `Sources/CGEOS/include/` so the umbrella's `#include <geos/export.h>` resolves
  without per-arch search-path juggling. A one-line `shim.c` makes it a valid
  compile unit.
- **`GeosSpike`** — Swift surface (`import CGEOS`) with `version()` and a real
  `GEOSIntersection_r` + `GEOSArea_r` op (two overlapping unit squares → area
  1.0). Links the static lib via linker flags (see below).
- **`GeosSpikeTests`** — XCTest target asserting GEOS `3.14.x` and area `== 1.0`.

Run command (the incantation that works):

```bash
cd spikes/RQ-A1-ios-geos
xcodebuild test \
  -scheme GeosSpike-Package \
  -destination 'platform=iOS Simulator,id=<UDID>' \
  CODE_SIGNING_ALLOWED=NO
```

`-scheme GeosSpike-Package` is the auto-generated SPM scheme (`xcodebuild -list`
shows it). No `.xcodeproj`/`.xcworkspace` authored by hand.

## Evidence

```
Test Case '-[GeosSpikeTests.GeosSpikeTests testGeosVersionIs314]' started.
GEOS version: 3.14.1-CAPI-1.20.5
Test Case '-[GeosSpikeTests.GeosSpikeTests testGeosVersionIs314]' passed (0.001 seconds).
Test Case '-[GeosSpikeTests.GeosSpikeTests testIntersectionArea]' started.
intersection area: 1.0
Test Case '-[GeosSpikeTests.GeosSpikeTests testIntersectionArea]' passed (0.003 seconds).
** TEST SUCCEEDED **
```

- Clean build+test (DerivedData wiped first): **11s** wall-clock.
- Env: Xcode 16.2, macOS arm64, iPhone 16 Pro sim (iOS 18.3.1). Host arch arm64
  matches the `ios-arm64-simulator` slice (also arm64).
- Never ran `expo prebuild`; never built the app or Pods.

## Two things that bit us (load-bearing for the impl plan)

1. **`.binaryTarget` for `libgeos.xcframework` does NOT work.** Xcode's native
   xcframework decoder rejects it:
   `Failed to decode XCFramework Info.plist ... The data couldn't be read
because it is missing.` Cause: the xcframework's `Info.plist` is missing
   `XCFrameworkFormatVersion` (and per-library `HeadersPath`). **CocoaPods
   tolerates this** (the app links fine via `vendored_frameworks`), but SPM /
   xcodebuild's binaryTarget path does not. Workaround in the spike: skip
   binaryTarget, link the simulator static lib directly:
   `swift
    linkerSettings: [
      .unsafeFlags(["-L<.../ios-arm64-simulator>", "-lgeos-combined"]),
      .linkedLibrary("c++"),   // GEOS is C++ under the hood
    ]
    `
   This pins the spike to the simulator slice, which is exactly the target.
2. **Deployment target must be iOS 18** (`platforms: [.iOS(.v18)]`, which needs
   `swift-tools-version:6.0`). The static lib's objects are built for
   `iOS-simulator 18.0`; linking at a lower target floods stderr with hundreds
   of `ld: warning: object file ... built for newer 'iOS-simulator' version
(18.0)` lines. At `.v18` the warnings vanish. (Harmless either way, but noisy
   in CI logs.)

## Recommendation

- **Adopt the SPM-package approach for the real iOS suite** (RQ-A2's in-workspace
  fallback is unnecessary — do a 2h desk-check only). It's fast (~11s), needs no
  prebuild/Pods/signing, and is trivial to wire into CI (feeds RQ-D1 directly).
- **For linking, prefer fixing the xcframework `Info.plist`** over the
  direct-`-L`/`-l` hack, so a single SPM target links the right slice for both
  device and simulator and `.binaryTarget` works:
  add top-level `XCFrameworkFormatVersion = 1.0` and a `HeadersPath = Headers`
  to each `AvailableLibraries` entry. This is a real artifact bug worth fixing in
  the GEOS build scripts (`pnpm geos:build:ios`) regardless of the test suite —
  it's the difference between a portable xcframework and a CocoaPods-only one.
  The direct-link hack is fine for a simulator-only test target if we'd rather
  not touch the artifact.
- **Reuse the `CGEOS` copied-header pattern** (or point header search paths at
  the slice). Copying is simplest and keeps the test target independent of the
  module's build settings.
- Wrap real geometry assertions around the WKB fixtures (RQ-C1) rather than WKT,
  once those land — the spike used WKT only to avoid a fixture dependency.

## Follow-ups / new risks

- **Artifact bug (file separately):** `libgeos.xcframework/Info.plist` is missing
  `XCFrameworkFormatVersion` / per-lib `HeadersPath`. Non-blocking for the app
  (CocoaPods), blocking for SPM binaryTarget consumers.
- RQ-A3 (GeosCore.swift refactor): the test surface only needs the C bridge +
  static lib, so the refactor and the test harness are independent — the harness
  does not depend on `ExpoModulesCore`. Good for build isolation.
- RQ-D1 (iOS CI): the exact command above + a `simctl` UDID selection block is
  all CI needs; expect a few-minute job dominated by toolchain/sim boot, not the
  11s test.
- RQ-C2/C3 (parity, body-of-water): unblocked — a device/sim GEOS harness now
  exists. Feed WKB-hex fixtures through this same target.

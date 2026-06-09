# G1 Plan — Vendor & build GEOS for iOS + Android

_2026-06-09. Part of the [native-geometry implementation plan](./implementation-plan.md)._
_Status: **planned, not started.**_

## Goal

Produce static GEOS libraries that a local Expo Module (G2) can link against,
reproducibly, from committed scripts. The artifacts are committed to the repo
(the same discipline as POI/measuring bundles) because CI/EAS cannot regenerate
them.

## Decisions to lock before starting

1. **GEOS version.** Use GEOS 3.14.1 (latest stable at time of writing). Pin the
   exact version; upgrades are intentional PRs.

2. **Acquisition method.** Fetch a version-locked release tarball from GitHub
   (`https://github.com/libgeos/geos/archive/refs/tags/3.14.1.tar.gz`), verify
   SHA256, extract into `modules/native-geometry/vendor/geos/`. **Not a git
   submodule** — submodules break `expo prebuild --clean` workflows and add
   friction to the clone. The tarball + hash mirrors the Geofabrik download
   pattern in `data/geofabrik/scripts/fetch-geofabrik.mjs`.

3. **Android build strategy.** Pre-built `.a` per ABI, committed. Rationale:
   mirrors the "commit artifacts CI can't make" rule; keeps EAS builds fast;
   avoids requiring NDK + CMake on every dev's machine for routine app builds.
   The build script is still committed so artifacts can be regenerated.

4. **iOS architectures.** `arm64` (device) and `arm64` (Apple Silicon
   simulator). No `x86_64` simulator slice — the documented target is iPhone 16
   Pro; Intel Macs cannot run iOS 18 simulators. No bitcode (Xcode 15+ default).

5. **Android ABIs.** `arm64-v8a` (device) and `x86_64` (emulator). Skip
   `armeabi-v7a` (32-bit ARM) — the Play Store no longer requires it, and it
   doubles build time for zero user benefit on this app.

6. **Build host.** macOS with Xcode 16+ (for iOS) and Android NDK 27+ (for
   Android). The scripts assert these are present with clear error messages.

## Step-by-step

### Step 1 — Directory scaffolding

Create the module skeleton just enough to hold the vendor directory and build
artifacts. G2 will flesh out the full Expo Module; here we only need the
directories the build scripts write to.

```
modules/native-geometry/
  vendor/
    geos/          # extracted GEOS source (git-ignored)
  ios/
    libgeos.xcframework/   # committed artifact
  android/
    libs/
      arm64-v8a/libgeos.a   # committed artifact
      x86_64/libgeos.a      # committed artifact
  scripts/
    build-geos-ios.sh
    build-geos-android.sh
    fetch-geos.sh            # download + verify tarball
    geos-version.txt         # "3.14.1" — source of truth for all scripts
```

Add to `.gitignore`:

```gitignore
# GEOS build intermediates (vendor source, build dirs)
modules/native-geometry/vendor/geos/
modules/native-geometry/ios/build/
modules/native-geometry/android/build/
```

The committed artifacts (`libgeos.xcframework/`, `libs/*.a`) are explicitly
**not** git-ignored.

### Step 2 — Fetch script (`scripts/fetch-geos.sh`)

Follows the `fetch-geofabrik.mjs` pattern: download, verify hash, extract.

- Read version from `modules/native-geometry/scripts/geos-version.txt`.
- Download `geos-{version}.tar.gz` from GitHub releases.
- Verify SHA256 against a hardcoded hash in the script (updated when the version
  bumps).
- Extract to `modules/native-geometry/vendor/geos/`.
- Idempotent: skips download if the vendor directory already exists and the
  version matches (checked via `vendor/geos/Version.txt` which GEOS ships).

### Step 3 — iOS build script (`scripts/build-geos-ios.sh`)

Produces `modules/native-geometry/ios/libgeos.xcframework`.

**Build plan per slice:**

```bash
# Device (arm64)
cmake -S vendor/geos -B ios/build/device \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_SYSROOT=iphoneos \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=18.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_CXX_VISIBILITY_PRESET=hidden \
  -DBUILD_TESTING=OFF \
  -DBUILD_DOCUMENTATION=OFF \
  -DBUILD_TOOLS=OFF \
  -DDISABLE_GEOS_INLINE=OFF

# Simulator (arm64, Apple Silicon)
cmake -S vendor/geos -B ios/build/simulator \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=18.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_CXX_VISIBILITY_PRESET=hidden \
  -DBUILD_TESTING=OFF \
  -DBUILD_DOCUMENTATION=OFF \
  -DBUILD_TOOLS=OFF
```

**Thin library → xcframework:**

```bash
cmake --build ios/build/device --target geos -j$(sysctl -n hw.logicalcpu)
cmake --build ios/build/simulator --target geos -j$(sysctl -n hw.logicalcpu)

xcodebuild -create-xcframework \
  -library ios/build/device/lib/libgeos.a \
  -library ios/build/simulator/lib/libgeos.a \
  -output ios/libgeos.xcframework
```

**Key CMake flags:**

- `BUILD_SHARED_LIBS=OFF` — static library.
- `CMAKE_CXX_VISIBILITY_PRESET=hidden` — only GEOS C API symbols are exported;
  internal C++ symbols are hidden. This avoids symbol collisions if another
  library also bundles GEOS internals.
- `BUILD_TESTING=OFF`, `BUILD_DOCUMENTATION=OFF`, `BUILD_TOOLS=OFF` — minimal
  build; only the library.
- `-DCMAKE_OSX_DEPLOYMENT_TARGET=18.0` — matches the iOS 18 simulator target.

**Script behavior:**

- Requires Xcode CLI tools (`xcodebuild`, `cmake`).
- Requires the vendor source exists (run `fetch-geos.sh` first).
- Cleans `ios/build/` on each run; does **not** delete an existing
  `libgeos.xcframework` until the new one builds successfully (atomic replace).
- Prints the produced `.a` slice sizes.

### Step 4 — Android build script (`scripts/build-geos-android.sh`)

Produces `modules/native-geometry/android/libs/{abi}/libgeos.a`.

GEOS uses CMake, and the Android NDK ships a CMake toolchain file. We build
outside Gradle (standalone CMake invocation) so the artifacts are pre-built and
committed.

```bash
# Per ABI: arm64-v8a and x86_64
for abi in arm64-v8a x86_64; do
  cmake -S vendor/geos -B android/build/$abi \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
    -DANDROID_ABI=$abi \
    -DANDROID_PLATFORM=android-24 \
    -DANDROID_STL=c++_shared \
    -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_CXX_VISIBILITY_PRESET=hidden \
    -DBUILD_TESTING=OFF \
    -DBUILD_DOCUMENTATION=OFF \
    -DBUILD_TOOLS=OFF

  cmake --build android/build/$abi --target geos -j$(nproc 2>/dev/null || sysctl -n hw.logicalcpu)
  mkdir -p android/libs/$abi
  cp android/build/$abi/lib/libgeos.a android/libs/$abi/
done
```

**Key flags:**

- `ANDROID_PLATFORM=android-24` — minimum SDK 24 (Android 7.0); matches typical
  Expo minimum.
- `ANDROID_STL=c++_shared` — GEOS needs the C++ standard library. The Expo
  Module will also link `c++_shared`, so this is compatible.

**Script behavior:**

- Requires `ANDROID_NDK` environment variable (or `ANDROID_NDK_HOME`), or
  `$ANDROID_HOME/ndk/27.x.x`. Prints a clear error if not found.
- Requires the vendor source exists.
- Atomic replace: builds to a temp location, then moves into `libs/`.

### Step 5 — Minimal Expo Module skeleton (linking verification)

Create a **minimal** local Expo Module — just enough to verify GEOS links and
runs. This is NOT the full G2 module; it's the "smoke test" harness. G2 will
replace/expand this skeleton.

**Files needed:**

`modules/native-geometry/expo-module.config.json`:

```json
{
    "platforms": ["ios", "android"],
    "ios": {
        "modules": ["NativeGeometryModule"]
    },
    "android": {
        "modules": ["expo.modules.nativegeometry.NativeGeometryModule"]
    }
}
```

`modules/native-geometry/ios/NativeGeometryModule.swift`:

```swift
import ExpoModulesCore
import GEOS  // via module map — see below

public class NativeGeometryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeGeometry")

    // G1 smoke test only — proves GEOS linked and callable
    Function("geosVersion") { () -> String in
      guard let version = GEOSversion() else {
        return "unknown"
      }
      return String(cString: version)
    }

    // Verify the buffer path works end-to-end
    Function("smokeTest") { (wkb: Data) -> Data? in
      // ... GEOS buffer round-trip (see below)
    }
  }
}
```

`modules/native-geometry/ios/NativeGeometry.podspec`:

```ruby
Pod::Spec.new do |s|
  s.name = "NativeGeometry"
  s.version = "0.1.0"
  s.summary = "GEOS-backed geometry operations"
  s.homepage = "https://github.com/raycatdev/jet-lag-hide-and-seek"
  s.license = "MIT"
  s.author = ""
  s.source = { git: "" }
  s.platforms = { ios: "18.0" }
  s.swift_version = "5.9"
  s.static_framework = true

  s.source_files = "**/*.swift"
  s.vendored_frameworks = "libgeos.xcframework"
  s.dependency "ExpoModulesCore"
end
```

For Android, the module needs:

- `modules/native-geometry/android/build.gradle` with `externalNativeBuild`
  pointing at a `CMakeLists.txt` that links the pre-built `libgeos.a`.
- A Kotlin/Java module class that exposes `geosVersion()` and `smokeTest()`.

**Critical detail — the module map for iOS:** The Swift code needs a C header
to import GEOS symbols. Ship a minimal `geos_bridge.h`:

```c
// modules/native-geometry/ios/geos_bridge.h
#pragma once
#include "geos_c.h"
```

And a module map so Swift can `import GEOS`:

```
// modules/native-geometry/ios/module.modulemap
module GEOS {
    header "geos_bridge.h"
    export *
}
```

The `geos_c.h` header is shipped alongside the xcframework (copy it from the
GEOS source into the xcframework's `Headers/` directory during the build
script).

### Step 6 — `pnpm` scripts

Add to `package.json`:

```json
{
    "scripts": {
        "geos:fetch": "bash modules/native-geometry/scripts/fetch-geos.sh",
        "geos:build:ios": "bash modules/native-geometry/scripts/build-geos-ios.sh",
        "geos:build:android": "bash modules/native-geometry/scripts/build-geos-android.sh",
        "geos:verify:ios": "...",
        "geos:verify:android": "..."
    }
}
```

Discovery matches the existing `pnpm data:*` pattern.

### Step 7 — Docs

Add a "Native geometry / GEOS" section to `docs/implementation_notes.md`:

- GEOS version, why it's vendored
- How to fetch + build (`pnpm geos:fetch && pnpm geos:build:ios && pnpm geos:build:android`)
- Why artifacts are committed
- How to upgrade GEOS (bump version file, update SHA256, rebuild, commit)
- Binary budget per architecture

---

## Clearing condition — how to prove G1 worked

G1 is the highest-risk phase. The clearing condition is designed to **prove GEOS
is compiled, linked, and functional on both platforms before any JS wiring
(G2)**. Every item below must pass before G1 is declared done.

### C1 — Build reproducibility

**What:** Run the build scripts twice from a clean state. The second run
produces bit-identical artifacts (or at minimum, functionally identical — same
symbol table, same size within 1%).

**How to check:**

```bash
# iOS
rm -rf modules/native-geometry/ios/libgeos.xcframework
bash modules/native-geometry/scripts/build-geos-ios.sh
mv modules/native-geometry/ios/libgeos.xcframework /tmp/xcframework-v1
bash modules/native-geometry/scripts/build-geos-ios.sh
diff -r /tmp/xcframework-v1 modules/native-geometry/ios/libgeos.xcframework
# Expect: no differences (or only timestamps in XML plists)

# Android
rm -rf modules/native-geometry/android/libs
bash modules/native-geometry/scripts/build-geos-android.sh
# Compare .a files by checksum between runs
```

**Why this matters:** If the build isn't reproducible, CI and dev machines will
produce different artifacts, and debugging becomes a nightmare.

### C2 — Symbol check

**What:** The static libraries export the GEOS C API symbols (`GEOSversion`,
`GEOSBufferWithParams_r`, `GEOSGeomFromWKB_buf_r`, `GEOSGeomToWKB_buf_r`, etc.)
and hide internal C++ symbols.

**How to check:**

```bash
# iOS
nm -g modules/native-geometry/ios/libgeos.xcframework/ios-arm64/libgeos.a | grep GEOS
# Expect: GEOSversion, GEOSinit_r, GEOSBufferWithParams_r, GEOSGeomFromWKB_buf_r, etc.
# Expect: NO std::__1 or geos::geom symbols (C++ internals hidden)

# Android
$ANDROID_NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm -g \
  modules/native-geometry/android/libs/arm64-v8a/libgeos.a | grep GEOS
# Same expectations
```

**Why this matters:** Hidden C++ symbols prevent ODR violations if another
library bundles a different GEOS version. The C API is the stable ABI.

### C3 — `expo prebuild` survives

**What:** Running `expo prebuild --clean` does not wipe the GEOS artifacts, and
the regenerated native projects pick up the local module via autolinking.

**How to check:**

```bash
# Clean prebuild
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm exec expo prebuild --platform ios --clean
# Check that ios/ exists and contains a reference to the local module
grep -r "NativeGeometry" ios/
# Expect: the module appears in the generated Podfile or project

LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm exec expo prebuild --platform android --clean
grep -r "NativeGeometry" android/
# Expect: the module appears in generated Gradle/settings files
```

**Why this matters:** The entire CNG strategy depends on the module living under
`modules/`, not hand-editing generated `ios/`/`android/` files. If autolinking
fails, the approach is broken.

### C4 — App builds with the module linked

**What:** A dev-client build succeeds with the minimal module present. No linker
errors, no undefined symbols.

**How to check:**

iOS:

```bash
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm exec expo run:ios \
  --device "iPhone 16 Pro" --no-bundler
# Expect: build succeeds, app launches on simulator
```

Android:

```bash
pnpm exec expo run:android --no-bundler
# Expect: build succeeds, app launches on emulator
```

**Why this matters:** Undefined symbols from GEOS (`GEOSBufferWithParams_r`,
etc.) will manifest as linker errors. A clean build proves the library is
properly linked.

### C5 — `geosVersion()` returns the expected version string

**What:** Call the module's `geosVersion()` function from JS (via a temporary
`console.log` in `_layout.tsx` or a one-line Metro bundle test) and confirm it
returns the expected version.

**How to check:**

```js
// Temporary: add this in app/_layout.tsx, inside the root component
import NativeGeometry from "native-geometry";
console.log("[G1] GEOS version:", NativeGeometry.geosVersion());
// Expect Metro log: "[G1] GEOS version: 3.14.1"
```

**Why this matters:** This is the minimal proof that JS → native → GEOS C API
→ back to JS works end-to-end. If this works, the toolchain is sound.

### C6 — `smokeTest()` buffers a hardcoded line

**What:** Call the module's `smokeTest(wkb)` function with a hand-crafted WKB
for a 4-point square, and confirm the returned WKB is non-null and has the
expected structure (a Polygon with roughly the right number of coordinates for
the buffer).

**How to check:**

```js
// Temporary: add in app/_layout.tsx
import NativeGeometry from "native-geometry";

// WKB for a 4-point square (little-endian, LineString, 2D, 4 points)
// This is hardcoded golden WKB; verify manually or with a small test helper.
const squareWkb = new Uint8Array([...]); // crafted offline
const result = NativeGeometry.smokeTest(squareWkb);
console.log("[G1] smokeTest result bytes:", result?.byteLength ?? "null");
// Expect: non-null, byteLength > 0 (a valid Polygon WKB)
```

**Why this matters:** This proves the full GEOS buffer pipeline works
(`GEOSGeomFromWKB_buf_r` → `GEOSBufferWithParams_r` → `GEOSGeomToWKB_buf_r`)
on a real device, not just linking. The version string check (C5) only proves
linking; this proves execution.

### C7 — Invalid WKB returns null (no crash)

**What:** Pass garbage bytes to `smokeTest()` and confirm the module returns
`null` (or throws a catchable error) rather than crashing the app.

**How to check:**

```js
const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
const result = NativeGeometry.smokeTest(garbage);
console.log("[G1] garbage test result:", result); // Expect: null
// App should still be responsive — no crash dialog, no white screen
```

**Why this matters:** The implementation plan identifies GEOS segfault on
invalid geometry as the #1 risk. The reentrant context + error handler must
return `null`, not crash. This test proves the safety net works.

### C8 — Binary budget is acceptable

**What:** The committed artifacts are within the expected size range (~1–3 MB
per architecture).

**How to check:**

```bash
du -sh modules/native-geometry/ios/libgeos.xcframework/ios-arm64/libgeos.a
du -sh modules/native-geometry/android/libs/arm64-v8a/libgeos.a
du -sh modules/native-geometry/android/libs/x86_64/libgeos.a
# Expect: each ~1–3 MB
```

**Why this matters:** Store thinning ships one arch per device, so the per-arch
size is what matters. If it's >5 MB, we need to investigate trimming (e.g.
disabling unused GEOS features at compile time).

---

## Summary: the gate

G1 is done when:

- [ ] `pnpm geos:fetch` downloads and verifies GEOS 3.14.1 (C1 — reproducibility)
- [ ] `pnpm geos:build:ios` produces `libgeos.xcframework` (C1)
- [ ] `pnpm geos:build:android` produces `libgeos.a` per ABI (C1)
- [ ] Symbol export check passes — C API visible, C++ hidden (C2)
- [ ] `expo prebuild --clean` preserves artifacts and autolinks the module (C3)
- [ ] Dev-client build succeeds on iOS **and** Android (C4)
- [ ] `geosVersion()` returns `"3.14.1"` on iOS **and** Android (C5)
- [ ] `smokeTest(validWkb)` returns non-null Polygon WKB on iOS **and** Android (C6)
- [ ] `smokeTest(garbageWkb)` returns null on iOS **and** Android (C7)
- [ ] Per-arch binary size ≤ 3 MB (C8)
- [ ] `implementation_notes.md` updated with GEOS section (Step 7)
- [ ] `pnpm check && pnpm test` still green (no regression from module scaffolding)
- [ ] Artifacts committed: `modules/native-geometry/ios/libgeos.xcframework/` and
      `modules/native-geometry/android/libs/`

The first five items (C1–C5) can be checked immediately after the build scripts
work. C6 and C7 require the minimal module skeleton (Step 5) and a device build
— they are the true "does it work" gates. C8 is a final size sanity check.

**If C5 passes on both platforms, G1 is mechanically sound and G2 can begin.**
C6 and C7 are the final confirmation; they should be checked before merging G1
(not necessarily before starting G2 in parallel, since G2's full module will
replace the throwaway skeleton anyway).

---

## What G1 deliberately leaves for G2

- **WKB codec** (`src/shared/geometry/wkb.ts`) — G1 uses hand-crafted WKB for
  the smoke test; G2 builds the proper JS WKB reader/writer.
- **Projection logic** — G1 doesn't deal with meters-vs-degrees; the smoke test
  uses a degree-space buffer (GEOS buffers in input units, and the WKB square
  is in degrees).
- **`geosGeometryBackend.ts`** — the G0 seam's native implementation.
- **Proper error handling / logging** in the native module — G1's skeleton has
  minimal error handling; G2 hardens it.
- **The `isAvailable()` check** that G0's `getGeometryBackend()` probes.

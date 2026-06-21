# Mobile v2 Implementation Notes

## Milestone 2: Real Tokyo Map

Milestone 2 replaces the placeholder map with MapLibre RN and keeps the app dev-build-only. Expo Go will not work because `@maplibre/maplibre-react-native` is a native module.

Default play area is **Tokyo 23 Wards**, OSM relation `19631009`. The checked-in boundary fixture lives at `assets/default-zones/tokyo.json` and is loaded by `src/features/map/playArea.ts`. The old broader Tokyo prefecture relation `1543125` is intentionally not used because it includes the island chain and makes the initial bbox far too wide.

Generated Tokyo startup metadata lives at `assets/default-zones/tokyo-metadata.json`. It stores the precomputed bbox, center, and compact mask-hole paths without duplicating boundary coordinates. Run `pnpm data:default-zones` after changing the Tokyo fixture and `pnpm test:data:default-zones` to verify the checked-in metadata.

Fetched non-bundled play-area boundaries use stale-while-revalidate caching. Boundaries younger than `30` days are served from memory or AsyncStorage without a request. Older and legacy timestamp-free entries are still served immediately, then refreshed from Overpass in the background with per-relation in-flight deduplication. A refresh failure deliberately leaves the stale copy available.

The map fit is intentionally biased upward. `NativeMap` calls `fitCameraToBbox` with `getTopViewportFitPadding`, which uses asymmetric MapLibre camera bounds padding so the bbox sits in the upper map area above the medium bottom sheet. If sheet snap points change, revisit `getTopViewportFitPadding` in `src/features/map/camera.ts`.

MapLibre native setup matters:

- `app.json` must include the `@maplibre/maplibre-react-native` plugin.
- `metro.config.js` pins `@maplibre/maplibre-react-native` to the workspace root to avoid duplicate native package resolution.
- The root layout sets MapLibre's native ambient tile cache limit to `100 MiB` before rendering the route stack. Keep this startup ordering: native MapLibre documents that cache sizing should happen before a map style loads. Do not add automatic offline packs while the raster style uses `tile.openstreetmap.org`; the public OSM tile service permits normal HTTP caching but prohibits bulk offline downloading.
- Installed MapLibre React Native `10.4.2` does not expose cross-platform per-feature updates for `ShapeSource`; the bridge and both native wrappers replace the full GeoJSON shape. Official latest `v11.2.1` still exposes whole-`data` replacement plus read/cluster methods for its renamed `GeoJSONSource`, not cross-platform per-feature mutation. Since v11 also requires the React Native New Architecture, avoid a broad upgrade or splitting collections into many sources unless profiling justifies the migration cost or extra native source/layer overhead. Revisit when upstream exposes incremental updates or a native fork is justified.
- After adding MapLibre, run `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm exec expo prebuild --platform ios --clean` so the iOS project gets the MapLibre Swift Package dependency and Podfile post-install hook.
- Rebuild the dev client after native dependency changes with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm exec expo run:ios --device "iPhone 16 Pro" --no-bundler`.

Testing added in this milestone:

- Jest config and mocks for MapLibre, Gorhom bottom sheet, Reanimated, and `expo-location`.
- Unit tests for play-area metadata/bbox, OSM style JSON, camera helpers, and user-location permission handling.
- Component tests for `NativeMap` and `MapAppScreen`.
- Maestro smoke flow at `e2e/smoke.yaml`.

E2E notes:

- Maestro is installed at `~/.maestro/bin/maestro`; add it to `PATH` if `maestro` is not found.
- Start Metro first: `pnpm exec expo start --dev-client --host localhost --port 8081 -c`.
- The smoke flow handles Expo dev-client first-run prompts conditionally, then waits for "Continue" to disappear as the app-loaded signal. The Expo dev client's native UIKit dialogs ("Open", "Continue", "Connected to:") are visible to iOS XCUITest, but React Native views inside the gorhom/reanimated bottom sheet are not accessible to XCUITest on iOS. After the dialogs are dismissed, E2E flows use coordinate taps to interact since element selectors (text and testID) cannot reach the sheet content. The shared Metro bundle is pre-warmed before Maestro starts, eliminating the cold bundling wait so the app renders in ~2 seconds. The floating `Open bottom sheet` button is hidden from the native accessibility tree while the sheet covers it; otherwise Android Maestro can target the stale button and tap through to sheet content. The map controls are icon-only, so Maestro should not assert old visible copy such as `Fit Tokyo 23 Wards` or `Locate me`. The `accessible={false}` prop was removed from the gorhom bottom sheet root to allow XCUITest to see children (still blocked on iOS).
- GitHub Actions has a manually dispatchable `Maestro E2E` workflow. Agents can hand off device tests with `gh workflow run "Maestro E2E" --ref <branch> -f platform=android` or `platform=ios`, then follow it with `gh run watch`. CI pins Maestro CLI `2.6.0`; update that version intentionally after validating new releases.
- The workflow also accepts `-f flow=smoke`, `play-area`, `hiding-zone`, `radar-question`, or `transit-line-question` for focused runs. Omit it, or pass `flow=all`, to run every Maestro flow.
- Android CI must enable KVM before `reactivecircus/android-emulator-runner`. If a run fails before `expo prebuild` with repeated `adb shell getprop sys.boot_completed`, a very slow boot time, and `adb` exit code 224 after `shell input keyevent 82`, suspect missing or broken VM acceleration rather than a Maestro flow failure.
- The e2e flows target the Expo app IDs from `app.json`: `com.raycatdev.hideandseek.v2` on both iOS and Android. If the bundle/package ID changes, update the Maestro `appId` headers together with `app.json`.

## Milestone 3: Play-Area Settings

Milestone 3 adds Settings → Play Area in the bottom sheet. The app still starts with Tokyo 23 Wards, but the current in-memory play area can now be changed by Photon relation search or by entering a direct OSM relation ID. The direct-ID acceptance path uses Osaka relation `358674`.

Fetched relation boundaries are loaded from Overpass using `out geom`, converted with `osmtogeojson`, filtered to polygonal geometry, and cached in AsyncStorage under relation-specific boundary keys. Only the Tokyo placeholder (`assets/default-zones/tokyo.json`) remains bundled; Osaka `358674` and all other regions resolve via installed offline packs or live Overpass. The selected play area is now also included in the app-state v1 snapshot restored by `AppStateProviders`.

Map rendering now reads from the mobile play-area provider instead of hard-coded Tokyo metadata, so the map label, boundary source, camera fit target, and Fit button follow the applied area.

Native/dependency setup matters:

- `@react-native-async-storage/async-storage` is a native dependency; after install/prebuild it must be present in the generated native project via autolinking.
- `osmtogeojson` is used in JS to convert Overpass responses into GeoJSON.
- `metro.config.js` pins AsyncStorage to the workspace root, matching the MapLibre/native-singleton pattern from milestone 2.
- Rebuild the dev client after adding AsyncStorage with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm exec expo run:ios --device "iPhone 16 Pro" --no-bundler`.

Bottom-sheet and E2E accessibility notes:

- The Play Area route snaps the bottom sheet to the large snap point before Maestro looks for controls.
- On the small Android CI emulator, the main sheet title can be visible while the lower `Settings` row is still clipped at the medium snap. Maestro settings flows expand the sheet before tapping `main-settings-row`.
- Maestro/XCUITest sees the native accessibility hierarchy, not the React tree. A visible empty `TextInput` may not expose its `testID` as a targetable iOS node.
- The direct relation ID field has React/Jest test IDs on both the wrapper and the inner text input, but the current Maestro flow uses visible coordinate taps because iOS does not expose those nested nodes reliably through XCUITest.
- The iOS number pad does not reliably support Maestro `hideKeyboard`. The play-area flow taps the visible Apply button directly after entering text.

E2E stack helper:

- `pnpm test:e2e:stack` runs `scripts/e2e-maestro-stack.mjs`, starts Metro on port 8081, runs all Maestro flows with debug artifacts under `e2e/artifacts/<flow>/attempt-<n>/`, and shuts Metro down afterward. `pnpm test:e2e:ios:stack` resolves a booted iOS simulator, falling back to `E2E_IOS_SIMULATOR_NAME` or `iPhone 16 Pro`, and passes its UDID to Maestro with `--device` so connected Android devices are not selected accidentally.
- Set `E2E_PLATFORM=android` or `E2E_PLATFORM=ios` when the host platform does not imply the intended bundle target. The stack helper pre-warms the matching Metro bundle. Focused `E2E_FLOW=<name>` runs execute `warmup` first, then the selected flow; `E2E_FLOW=warmup` runs it once.
- Shared bootstrap grants location permission (`allow` on Android, `inuse` on iOS) and seeds the Tokyo fixture center (`35.64957465`, `139.7408995`) through Maestro commands instead of matching platform-specific permission-dialog text.
- Before Android attempts, the stack helper waits up to 30 seconds for a booted `adb` device. Failed attempts write `android-diagnostics.txt` beside Maestro debug output with device state, boot status, and a 500-line logcat tail so transient emulator disconnects are visible in uploaded artifacts.
- The default-state Maestro flows call `clearState`, then open the Expo dev-client URL from `MAESTRO_DEV_CLIENT_URL`. iOS only dismisses the development-menu intro when the `Continue` prompt is actually present; with `disableOnboarding=1`, both platforms usually wait directly for the app while the first bundle can still be compiling. `scripts/e2e-maestro-stack.mjs` opens the Expo dev-client scheme (`exp+<slug>://expo-development-client/`) and sets the bundle host to `10.0.2.2` on Linux/Android CI and `127.0.0.1` elsewhere; override `E2E_DEV_CLIENT_HOST` for local Android runs on macOS. This avoids depending on a plain Android `launchApp` for Expo dev-client startup while still preventing persisted AsyncStorage setup from leaking into default assertions. Add separate persistence-specific flows when testing relaunch behavior.
- The simulator must be booted/available before the stack run. The known working target is `iPhone 16 Pro - iOS 18.3`.

Testing added in this milestone:

- Boundary loading/cache unit tests for bundled Tokyo, mocked Osaka conversion, invalid IDs, and AsyncStorage cache hits.
- Photon result mapping tests for relation filtering and deduplication.
- Component tests for Settings → Play Area navigation, direct Osaka apply, invalid input, and fetch failure retaining Tokyo.
- Maestro flow at `e2e/play-area.yaml` that changes the play area to Osaka via relation `358674` and asserts the visible `Osaka` state change.

## Milestone 4: Hiding-Zone Presets

Milestone 4 adds Settings → Hiding Zones and map overlays for selected transit presets. The app now wraps the map and bottom sheet in both `PlayAreaProvider` and `HidingZoneProvider`; hiding-zone setup is included in the app-state v1 snapshot restored by `AppStateProviders`.

Tokyo Metro and Toei Subway presets are generated from ODPT GTFS files. The refresh script and config live under `data/odpt/`:

- `config.yaml` defines source URLs and output paths.
- `scripts/fetch-odpt.mjs` reads `ODPT_KEY` from the environment or `~/.env`, downloads GTFS zips into ignored `data/odpt/cache/`, parses the relevant GTFS tables, and writes `generated/hiding-zone-presets.json`.
- Generated transit route and station contribution IDs are source-namespaced canonical IDs such as `gtfs:odpt-tokyo-metro:route:3`. Keep raw GTFS IDs in `sourceId`, and keep station `mergeKey` separate from source-object identity so future OSM adapters can use the same downstream map and question logic. Cache-only ODPT regeneration does not require `ODPT_KEY`.
- `NOTICE.md` and `sources.md` carry ODPT/provider attribution, source links, and license/usage-rule notes. Keep these with any generated data changes.

Runtime behavior:

- Presets are suggested when the preset bbox intersects the current play-area bbox; suggestions are not auto-selected.
- Preset selection is additive. Selected stations are deduplicated by stable generated station IDs.
- Radius defaults to 600 meters. The UI can display meters, kilometers, or miles, but `HidingZoneProvider` stores meters internally.
- Distance unit conversion and compact display formatting live in `src/shared/distanceUnits.ts`. Hiding-zone modules keep backwards-compatible re-exports, but new cross-feature code should import the shared helpers and `DistanceUnit` type directly.
- `NativeMap` renders selected route lines, selected station points, and a merged hiding-zone fill generated with Turf circle/union helpers.

Testing added in this milestone:

- Unit tests for bbox suggestion logic, radius conversion, selected-station deduplication, and hiding-zone GeoJSON generation.
- Component tests for Hiding Zones navigation, Tokyo preset suggestions, preset selection, radius unit conversion, and map overlay layer rendering.

## Milestone 5 Questions

- Radar questions are preview-only. They persist in app state, render map circles, and expose the active question pin only while the question detail sheet is active.
- Pin movement is scoped by sheet state: leaving question detail or closing the sheet disables move-pin mode.
- Radar distance options are fixed presets (`500m`, `1km`, `2km`, `5km`, `10km`, `15km`, `40km`, `80km`, `150km`) plus `Other` for custom values.
- Radar custom distance and hiding-zone radius share `src/components/UnitSegmentedControl.tsx`, preserving the existing `hiding-zone-unit-*` and `radar-distance-unit-*` test IDs.
- The radar question info box compares the pin to selected hiding-zone stations; with no selected presets it shows an empty-state hint.
- Legacy persisted/shared `type: "radius"` questions are normalized to `type: "radar"` on import and restore.
- Live question state is normalized to `{ byId, allIds }`. Keep persisted and shared question payloads as ordered arrays, and use `useQuestions()` only where a consumer needs every question. ID-only consumers should use `useQuestionIds()` so single-question edits do not invalidate their subscription.
- MapLibre Jest mocks now include `FillLayer` and `CircleLayer`.

Native/dependency setup matters:

- Hiding-zone geometry uses `@turf/circle`, `@turf/helpers`, and `@turf/union`.
- ODPT processing uses `fflate` for GTFS zip extraction and the built-in Node fetch API. Refreshing ODPT data requires network access and an `ODPT_KEY` for Tokyo Metro.
- `pnpm data:odpt` rewrites generated data. Run formatting afterward because generated JSON is checked in.

## Native geometry / GEOS

GEOS 3.14.1 is vendored as a static library for iOS (xcframework) and Android
(pre-built `.a` per ABI). It powers the `bufferMeters` operation behind the
`GeometryBackend` seam (see `docs/native-geometry/implementation-plan.md`).

### How to rebuild

```bash
pnpm geos:fetch                    # download + verify GEOS tarball
pnpm geos:build:ios                # compile for arm64 device + simulator
pnpm geos:build:android            # compile for arm64-v8a + x86_64
```

### Stale dev-client warning

After pulling native-geometry JS changes (new WKB functions, ABI bump), the
JS bundle may be newer than the native binary. The `GeometryBackend` seam
detects this and:

- Keeps the **buffer** fast path native (gated on `bufferWKB` only).
- Logs a **one-time `console.warn`** per missing overlay op with a "rebuild the
  dev client" hint.
- Logs a **one-time `console.warn`** when the native ABI version is older than
  expected (`nativeAbiVersion < EXPECTED_NATIVE_ABI`).

Body-of-water measuring will hard-lock (~25 s polyclip-JS dissolve) on a stale
binary — rebuild with `expo prebuild --clean` + `expo run:ios/android` to
restore full GEOS perf.

### Why artifacts are committed

The `ios/` and `android/` directories are git-ignored and regenerated by
`expo prebuild` on every EAS build. GEOS cannot be compiled during EAS builds
(no CMake/Xcode toolchain; no NDK), so the static libraries are committed
artifacts — the same discipline as POI and measuring bundles.

Committed artifacts:

- `modules/native-geometry/ios/libgeos.xcframework/` — ~17 MB (two arm64 slices)
- `modules/native-geometry/android/libs/<abi>/libgeos.a` — ~14 MB per ABI after strip

### How to upgrade GEOS

1. Update `modules/native-geometry/scripts/geos-version.txt` to the new version.
2. Add the new version's SHA-256 to the `KNOWN_HASHES` table in `fetch-geos.sh`.
3. Run `pnpm geos:fetch && pnpm geos:build:ios && pnpm geos:build:android`.
4. Verify symbol exports (C API visible, C++ hidden) on both platforms.
5. **Run the parity gates:**
    - `pnpm test:geos` must pass (host-side geos-wasm 3.13 parity).
    - `xcodebuild test -scheme NativeGeometryTests-Package -destination 'platform=iOS Simulator,name=iPhone 16 Pro' CODE_SIGNING_ALLOWED=NO` must pass (device-side GEOS 3.14.1 golden fixture parity). Run from `modules/native-geometry/`.
    - `./gradlew :native-geometry:connectedDebugAndroidTest` must pass on a booted emulator (device-side Android GEOS parity, same `geos-golden.json`). Needs a fresh `expo prebuild --platform android` and **JDK 17** — `export JAVA_HOME=$(/usr/libexec/java_home -v 17)` before invoking `./gradlew`. A newer default JDK (e.g. 26) breaks the React Native gradle plugin's embedded Kotlin at plugin-resolution time (`IllegalArgumentException` parsing the Java version), failing before any task runs.
    - The golden fixtures (`modules/native-geometry/__fixtures__/geos-golden.json`) are keyed on engine-independent invariants (area ratio / bbox tolerance / type / null). If the new version legitimately shifts a result outside tolerance, regenerate with the XCTest `testRegenerateGoldenFixtures` method and review the diff before committing.
6. Commit the new artifacts.

### Binary budget

| Platform | ABI               | Size (stripped) |
| -------- | ----------------- | --------------- |
| iOS      | arm64 (device)    | ~8.2 MB         |
| iOS      | arm64 (simulator) | ~8.2 MB         |
| Android  | arm64-v8a         | ~14 MB          |
| Android  | x86_64            | ~14 MB          |

Store thinning ships one arch per device, so the per-device cost is one slice.

### G2 status (2026-06-09)

**JS side (W2–W6 + Layers 1–4):** done.

- WKB codec (`src/shared/geometry/wkb.ts`) — pure JS, little-endian ISO/OGC,
  encode LineString/MultiLineString/Polygon/MultiPolygon/MultiPoint, decode
  Polygon/MultiPolygon (with EMPTY → null).
- AEQD projection adapter (`src/shared/geometry/bufferProjection.ts`) —
  replicates `@turf/buffer`'s per-feature projection exactly, reuses
  `EARTH_RADIUS_METERS` from `src/shared/geojson.ts`.
- GEOS backend (`src/shared/geometry/geosGeometryBackend.ts`) — project →
  encode → native `bufferWKB` → decode → unproject, bug-for-bug parity
  with `jsGeometryBackend` (FeatureCollection → features[0], etc.).
- Seam wired (`src/shared/geometry/geometryBackend.ts`) — `APP_CONFIG.geometry.backend = "auto"` (default) or `"geos"` routes to GEOS when
  the native module is available; `"js"` forces pure JS.
- Jest: 3 new suites (WKB codec, projection, backend adapter), 37 tests.

**Native side (W1):** done.

- iOS (`NativeGeometryModule.swift`): `bufferWKB(wkb, distance, quadrantSegments)`,
  thread-safe context init (NSLock + double-check), JSTS-matching buffer params
  (round cap, round join), single-owner geometry pointer (no double-free).
- Android (`NativeGeometryModule.kt` + `native-geometry-jni.cpp`): same
  semantics, thread-safe context init (`std::call_once`).
- **Single-source op core (2026-06-16, audit #3):** the
  parse→validate→MakeValid→op→write→free pipeline lives once in
  `modules/native-geometry/ios/geos_ops.{h,cpp}` (`extern "C"`, owns the GEOS
  context + the MakeValid recovery). It is the canonical file (in `ios/` to
  match the `GeosCore.swift` convention) symlinked into `Sources/CGEOS/` and
  `android/src/main/cpp/`, and compiled into all three targets (podspec
  `source_files`, SwiftPM CGEOS auto-discovery, `CMakeLists.txt`). `GeosCore.swift`
  and `native-geometry-jni.cpp` are now thin `Data`/`jbyteArray` ⇄ `GeosWkbBuffer`
  shims that forward to `geos_ops_*`; `GeosBridge.kt`/`NativeGeometryModule.swift`
  are unchanged. The result buffer is a malloc'd copy (decoupled from the GEOS
  context) freed via `geos_ops_free`, so callers need no GEOS handle. GEOS
  notice/error diagnostics route through a settable `geos_ops_set_log` callback
  (NSLog on iOS, `__android_log` on Android); per-op success logging was dropped
  (audit #12). Editing the GEOS op semantics now means editing one C++ file +
  rebuilding the dev client. The wasm oracle (`geosWasmNode.ts`
  `parseAndValidate`) mirrors the same MakeValid policy so golden fixtures stay
  faithful to native runtime behavior.

**On-host GEOS parity (geos-wasm):** done. The GEOS buffer math is validated
against the `@turf/buffer` oracle in Jest — no device required. See the runbook
below.

**On-device (G3 — parity validation):** done (2026-06-09). Summary:

- On-device parity harness: PARITY PASS on iOS (iPhone 12 Pro, iOS 18.7.8) —
  46 curated cases across all 5 line categories, area ratio and bbox delta
  within gates.
- Crash fuzz: 7 degenerate WKB inputs × 1,000 iterations → all returned null,
  no crash. CRASH FUZZ PASS.
- Memory (ASan): Address Sanitizer enabled via Xcode scheme → crash fuzz +
  memory stress test (500 buffer iterations over body-of-water) — clean, no
  double-free or use-after-free. ASan catches lifetime bugs deterministically on
  the first offending call, so this is the primary W3 signal.
- Memory (Instruments → Allocations): 500 body-of-water buffer iterations under
  the Allocations profiler — allocation count returned to baseline after the
  batch, no monotonic drift. Confirms no leaked GEOS geometries or WKB buffers.
- Perf: `[geosPerf]` instrumentation in `geosGeometryBackend.ts` splits encode /
  native / decode times. `[NativeGeometry]` NSLog instrumentation in
  `NativeGeometryModule.swift` further splits the native call into parse / valid /
  makeValid / buffer+write (added during G4 tuning). Encode+decode marshalling:
  < 5 ms total. GEOS buffer itself is the dominant cost; see G4.
- Maestro E2E: `e2e/geos-measuring-smoke.yaml` and `e2e/geos-crash-fuzz.yaml`
  flows ready for CI (requires `EXPO_PUBLIC_GEOMETRY_BACKEND=geos` at build
  time).

**G4 — Simplification retuning:** done (2026-06-09). The goal was to lower
`simplifyFraction` from 0.05 to ~0.01 for tighter masks, since GEOS native
buffering was expected to be fast enough to afford it. On-device measurement
revealed that `GEOSBufferWithParams_r` scales non-linearly with input coordinate
count — the cost is dominated by the union step over the buffered output, not
input parsing or the buffer offset itself. Key findings on iPhone 16 Pro (iOS):

| `simplifyFraction`  | Tol @ 5.2km | Input coords | GEOS `buffer+write` |
| ------------------- | ----------- | ------------ | ------------------- |
| 0.01                | 52m         | ~6,000       | ~1,120ms            |
| 0.02                | 104m        | ~3,000       | ~172ms              |
| 0.04                | 208m        | ~1,500       | ~141ms              |
| 0.05 (old baseline) | 260m        | —            | —                   |

The GEOS cost has an output-dependent floor: admin borders span 30–50km across
Tokyo, so the buffer output at 5–8km radius is always a large polygon regardless
of input simplification. The landed config (`simplifyFraction: 0.02`,
`maxBufferCoords: 20_000`, `bufferSteps: 8`) gives 2.5× tighter masks (104m vs
260m tolerance at 5.2km) and 2× arc resolution vs the old JS baseline, at ~172ms
native time — a 62× improvement over the 10.7s `@turf/buffer` JS baseline. The
remaining frame-budget gap is a candidate for G6 (async dispatch safety net).

Config values live in `src/config/appConfig.ts` under `APP_CONFIG.measuring.line`.
Each change is a Metro hot reload away; verify with the `[geosPerf]` Metro log
and the `[NativeGeometry]` NSLog in the Xcode console.

A dedicated native-side `os_log`/`NSLog` instrument in `NativeGeometryModule.swift`
splits each `bufferWKB` call into parse / valid / makeValid / buffer+write steps.
This was essential for diagnosing that `GEOSBufferWithParams_r` (not WKB parse or
MakeValid) is the bottleneck at high input complexity.

### On-host GEOS parity gate (geos-wasm)

The native Expo module can't run in Jest, but GEOS itself is platform-agnostic C
and runs in Node via [`geos-wasm`](https://www.npmjs.com/package/geos-wasm). The
`geosParity` suite drives the **real** `geosGeometryBackend` pipeline (project →
`encodeWkb` → GEOS → `decodeWkb` → unproject) against the `jsGeometryBackend`
turf oracle and asserts they agree, closing the "GEOS math never compared to the
oracle" gap without a device.

```bash
pnpm test:geos              # all geos-wasm suites (one process each)
pnpm test:geos geosGolden   # filter by path substring
```

- **Files:** `src/shared/geometry/__tests__/geosParity.test.ts` (the buffer
  gate); `geosGolden.geos.test.ts` (the **golden-fixture** gate — replays every
  buffer/overlay case in `modules/native-geometry/__fixtures__/geos-golden.json`
  and asserts the committed invariants, the same JSON the device suites load);
  and `__tests__/helpers/geosWasmShim.ts` (a `bufferWKB(wkb, distance, qs)` shim
  over the GEOS C API matching the native module's contract; pointed at the
  mocked `native-geometry` so the real backend runs unmodified). Regenerate the
  golden file with `pnpm data:geos-golden`.
- **One process per suite:** geos-wasm is loaded through a realm-escaping runtime
  `import()`, so a reused Jest worker races VM-realm teardown across two geos
  files ("Test environment has been torn down"). `pnpm test:geos`
  (`scripts/run-geos-tests.mjs`) enumerates the suites with `--listTests` and
  runs each in its own `jest` process — deterministic, no shared worker. CI runs
  it as the "GEOS parity" step in `app-checks.yml`.
- **What it validates:** the WKB codec, the AEQD projection, the backend adapter,
  and GEOS buffer math vs turf — Tokyo/Osaka line + polygon + multipoint fixtures
  × {500, 2000, 5000} m at QS=8. Current result: **area ratio 1.00000, bbox Δ
  0.00 m** across all cases (GEOS is a C++ port of the same JTS buffer algorithm
  turf uses, run in the identical projected space the backend replicates).
- **Why a separate config/flag:** geos-wasm is ESM-only and uses `import.meta`,
  so the suites need `--experimental-vm-modules` (set per child by the runner).
  They are excluded from the default `pnpm test` (see `testPathIgnorePatterns` in
  `jest.config.js`) and run via the dedicated `test:geos` script /
  `jest.config.geos.js`. The geos config also ignores `spikes/` (throwaway
  research suites that need hand-minted local artifacts).
- **Version caveat:** geos-wasm bundles GEOS 3.13.x, not the vendored 3.14.1.
  Parity is gated on **tolerance** (area ratio + bbox proximity), stable across
  GEOS 3.x — not exact bytes. It does **not** exercise the native Swift/JNI
  wrappers, marshalling, or the exact vendored build (that's the device harness).
- **CI:** runs as a standalone step on a plain Linux Node runner (no native
  toolchain) — `pnpm test:geos`. Complements the heavier Maestro/emulator job.

### On-device parity harness (G3 — shipped 2026-06-09)

The dev-only "Geometry Parity" screen (Settings → "Run GEOS Parity Harness" in
`__DEV__` builds) exposes three actions plus the crash-fuzz action:

1. **Run Parity Harness** — 46 curated cases across all 5 line categories
   (`admin-1st-border`, `admin-2nd-border`, `body-of-water`, `coastline`,
   `high-speed-rail`) × 3 radii (500m, 2km, 5km) plus a 10km body-of-water
   case. Each case feeds identical windowed/simplified geometry to both the
   GEOS native backend and the `@turf/buffer` JS oracle, then compares area
   ratio (polyclip-ts symmetric-difference) and bbox delta. Asserts `PARITY PASS`
   if all cases are within gates (symDiff < 1%, bbox Δ < radius·0.02+5m).

2. **Run Crash/Perf Sweep** — ~450 GEOS-only cases (225 grid points × 2 radii,
   category rotated by grid point) over the Tokyo play-area bbox. Validates
   that real bundled geometries don't crash the native path and reports timing.

3. **Run Crash Fuzz** — 7 degenerate WKB inputs × 1,000 iterations each (empty,
   truncated, 1-point, zero-length segment, bowtie polygon, large coords 1e9,
   NaN/Inf coords). Asserts `CRASH FUZZ PASS` if all return `null` without
   crashing.

4. **Run Memory Stress Test** — 50k buffer iterations over body-of-water at 2km.
   Used with ASan and Instruments/Allocations to validate no leaks.

**Parity metrics gates** (from `src/shared/geometry/parityMetrics.ts`):

- Symmetric-difference area ratio < 1% (< 0.01)
- Bbox edge delta < `radius * 0.02 + 5` meters
- One backend returns polygon and the other returns null → hard failure
- Both return null → vacuous agreement (flag for dead-fixture correction)

**Result (2026-06-09):** PARITY PASS on iOS (iPhone 16 Pro, iOS 18.3). All 46
cases within gates across all 5 categories. CRASH FUZZ PASS. ASan clean.
Instruments allocations stable.

### Memory validation procedure (W3)

For any future GEOS upgrade or native-code change, re-run the memory validation
pass on both platforms. The dev-only "Geometry Parity" screen (Settings →
"Run GEOS Parity Harness" in `__DEV__` builds) exposes four actions.

#### iOS — Address Sanitizer

1. `npx expo run:ios --device` (build + install + launch through Expo first —
   populates DerivedData so Xcode doesn't miss module maps).
2. Open `ios/HideSeekMapperv2.xcworkspace` in Xcode.
3. Product → Scheme → Edit Scheme → Run → Diagnostics → check **Address
   Sanitizer**.
4. Product → Run (Cmd+R). Xcode does an incremental build.
5. In the app: Settings → Run GEOS Parity Harness.
6. Tap **Run Crash Fuzz** (lightweight — 7 cases × 1k iterations). If ASan
   detects a double-free or use-after-free, it stops execution with a bright red
   report. Confirm the console is clean and the screen shows `CRASH FUZZ PASS`.
7. Tap **Run Memory Stress Test** (50k buffer iterations over body-of-water at
   2 km). Confirm ASan remains clean throughout.
8. **Important:** the full parity harness (46 JS-oracle cases) will OOM under
   ASan on a 4 GB device — skip it. ASan adds guard pages and redzones to every
   allocation; the JS oracle (JSTS) allocates heavily. The crash fuzz + stress
   test are the right ASan workloads — they exercise every GEOS allocation path
   and ASan catches lifetime bugs on the first offending call.

#### iOS — Instruments → Allocations

1. Turn off ASan (Edit Scheme → Run → Diagnostics → uncheck).
2. Product → Profile (Cmd+I) → choose the **Allocations** template.
3. When the app launches, navigate to Settings → Run GEOS Parity Harness.
4. Tap **Run Memory Stress Test** (50k iterations).
5. In Instruments, watch the **Persistent Bytes** or **# Persistent** column
   for the HideSeekMapperv2 process. After the test completes, the live
   allocation count should return to baseline — indicating no leaked GEOS
   geometries or WKB buffers.
6. Take a screenshot of the Allocations trace for the upgrade record.

#### Android — Address Sanitizer

1. Build with the ASan Gradle property:
    ```bash
    cd android && ./gradlew assembleDebug -PenableAddressSanitizer=true
    ```
2. Run the same Crash Fuzz and Memory Stress Test actions from the parity
   harness screen.
3. Confirm ASan reports clean via `adb logcat | grep -i asan`.

#### Android — Memory Profiler

1. Build without ASan.
2. Android Studio → Profile → Memory Profiler → attach to the running process.
3. Run the Memory Stress Test (50k iterations).
4. Confirm the live allocation count returns to baseline after the batch.

## Transit Station Expansion (2026-06-11)

The transit pipeline was expanded from Tokyo-only ODPT (334 stations, 2
operators) to all-Japan OSM station extraction plus a locale-generic pipeline
ready for London, Taipei, SF Bay Area, and Schengen. The epic is broken into
10 tasks in `docs/tasks/transit-expansion/`.

### Pipeline architecture

The pipe runs four stages (plus a final notice generator):

```
gtfs → osm → conflate → emit → notice
```

- **gtfs** (`lib/gtfs.mjs`): parent-station collapsing, route-type filtering
  (with extended route types 100–117, 400–404 ranges), line grouping by
  `short_name` or `route_id`, agency split, shape-geometry fallback from
  ordered stop_times.
- **osm** (`lib/osmStage.mjs`): per-region osmium tags-filter + export to
  GeoJSONSeq, streaming record mapping, intra-source dedup (id → wikidata →
  name+distance), intermediates written to `data/transit/cache/`.
- **conflate** (`lib/conflate.mjs` + `conflateStage.mjs`): spatial grid index
  (3×3 cell block, zero-dependency haversine), attach route-less OSM records to
  route-bearing GTFS seeds via wikidata + normalized name + aliases. Seeds never
  merge with each other (D2). OSM baseline presets emitted per region with
  `routes: []`. I1 invariant checked every build (no route-less twin within
  `maxClusterMeters` of seed with matching name). Build report written to
  `data/transit/report/`.
- **emit** (`lib/emit.mjs`): per-region bundles + `manifest.json` + generated
  `transitBundles.generated.ts` require-map (literal `import()` thunks for
  Metro). OSM baseline presets assigned by `osm-<region>` id prefix.

### Conflation invariants (loaded and verified)

- **I1 — No route-less twins:** every standalone station checked against
  enriched seeds at build time; matching-name-within-range is a build failure.
- **I2 — Complete line station sets:** by construction via GTFS stop_times join
  and osmium `--add-referenced` route-member export; lines with < 2 resolved
  stations excluded from output.
- **I3 — One line per picker entry:** enforced by `groupRoutesIntoLines`
  (short_name grouping for generic feeds, route_id for ODPT) and operator
  gating (config-declared `routeSource: gtfs` drops OSM duplicates).
- **I4 — Stable canonical coords:** pipeline writes the same canonical
  `lat`/`lon` into every contribution for a given `mergeKey`.

### Merging behavior at runtime (unchanged mechanics)

`getSelectedStations` in `hidingZone.ts` now sorts presets by
`sourcePriority()` before the existing merge loop. GTFS wins name/coords when
both a GTFS and OSM preset contribute the same `mergeKey`. `nameEn` accumulates
first-non-empty from any source. Route IDs, colors, and source-station IDs are
unioned as before.

### Kantō validation numbers

| Stage          | Metric             | Value             |
| -------------- | ------------------ | ----------------- |
| OSM extraction | features read      | 2,964             |
| OSM extraction | mapped stations    | 2,706             |
| OSM extraction | after dedup        | 2,431             |
| Conflation     | GTFS seeds         | 334               |
| Conflation     | OSM records        | 2,431             |
| Conflation     | attachments        | 255               |
| Conflation     | standalone         | 2,176             |
| Conflation     | near-misses        | 34                |
| Conflation     | I1 invariant       | passed            |
| Emit           | japan-kanto bundle | 3 presets, 585 KB |

### Why mergeKey lost the coordinate suffix

The old ODPT pipeline embedded coords in `mergeKey` (`101:139.70267,35.65150`),
which prevented cross-source merging: a GTFS stop and OSM node at the same
station but with slightly different coordinates would never merge. The new
pipeline assigns canonical `mergeKey = canonicalStationId`
(`gtfs:ns:stop:<id>` or `osm:node:<id>`) so the app's existing `Map<string,
TransitStation>` merge works identically across GTFS and OSM contributions.

### Lazy bundle loading

The app imports `transitBundles.generated.ts` (generated by `pnpm
data:transit`), which embeds the manifest statically and provides one
`() => import(".../assets/transit/<region>.json")` thunk per bundle. Only
bundles whose bbox intersects the play-area bbox are loaded. Loading is
additive — previously loaded bundles stay cached. Play-area change triggers
re-evaluation in `hidingZoneStore` via the `[playArea.bbox]` useEffect
dependency.

The generated file includes an `as TransitManifest` cast because JSON `number[]`
arrays don't satisfy the `Bbox` 4-tuple type. The `import()` thunks unwrap
`{ default }` because Metro JSON modules may return `{ default: object }`.

### OSM route relations (T7 — library complete; osmium extraction pending)

`processOsmRoutes()` groups directional `route` relations under their
`route_master`, unions stop members across variants, resolves members to station
records by OSM node id, and applies operator gating (lines dropped when
`routeSource: gtfs`). The full osmium extraction + wiring into presets across
all 8 Japan regions is a follow-on change.

### Pipeline tests

All 89 `node --test` cases use synthetic fixtures (small hand-written GTFS
tables, OSM extracts in test code). The full ODPT regression test loads cached
zips from `data/odpt/cache/` and compares against
`data/odpt/generated/hiding-zone-presets.json`: same route IDs, same station
names, same counts. MergeKeys differ by design (canonical id vs coord-suffix).

### Adding a new GTFS feed

`data/transit/PLAYBOOK.md` documents the repeatable 8-step process. A feed is
entirely a config change — no pipeline code. The build enforces D3: if two
sources both contribute lines for one operator without a declaration, the build
fails. The next planned feed is JR East (~70+ lines in Kantō).

### Retired: old ODPT pipeline

`data:odpt` and `test:data:odpt` scripts removed from `package.json`. The app
loads exclusively from `assets/transit/`. Cached ODPT GTFS zips remain in
`data/odpt/cache/` (referenced by transit pipeline fallback). The ODPT
`scripts/` directory is kept for the shared `transit-identity.mjs` module.

### Per-operator OSM presets (2026-06-11)

The monolithic `osm-<region>` baseline preset was replaced with per-operator
presets. Each operator with ≥3 standalone stations in a region gets its own
preset (`kind: "operator"`). Operators with <3 stations and stations without
operator tags go into an `osm-<region>-other` catch-all (`kind: "coverage"`).
The threshold and "Other" label are in `conflateStage.mjs`.

**Multi-operator stations (semicolon-separated `operator` tags):** stations are
duplicated into each operator's group. At selection time, `getSelectedStations`
merges them back by `mergeKey` — route colors from both operators combine
correctly.

**Enriched seeds in OSM operator presets:** GTFS seeds that had OSM records
attached during conflation carry `osmOperators` and `osmSourceIds` (propagated
in `conflate.mjs`). These enriched seeds are included in the matching OSM
operator preset, using the GTFS seed id as `mergeKey`. This is how major
multi-operator hubs (Shibuya, Shinjuku) appear in the JR East preset even
though their OSM node is tagged `operator=東京地下鉄`.

**Operator name normalization** lives in `normalizeOperator.mjs`:

- `buildOperatorNormalizer(operatorNames)` — reverse-map from config.yaml
  `operatorNames`, exact match first, then substring containment (handles
  "東日本旅客鉄道 (JR East)" containing "東日本旅客鉄道")
- `splitOperators(raw, normalize)` — splits on `;`, normalizes each part,
  filters empties. Used for multi-operator OSM tags.

Add new operator variants to `config.yaml` → `operatorNames`. The pipeline
picks them up on the next `pnpm data:transit`.

### OSM route relation extraction

OSM route relations are extracted via `osmium tags-filter` → `osmium cat
-f osm` (OSM XML) → streaming line-by-line XML parser in `osmStage.mjs`.
GeoJSONSeq export **does not** work for relations — osmium can't compute
geometry for `type=route` relations, and it strips member lists from the
output. OSM XML is the reliable format.

Key gotchas from implementation:

- **Close-tag ordering in streaming XML parser:** the `</relation>` handler
  must run BEFORE the `!inRelation` guard, otherwise close tags are silently
  skipped when inside a relation.
- **Node coordinate collection:** collect ALL `<node>` elements (not just
  those with tags) — `stop_position` nodes referenced by route relations
  need their coordinates for spatial stop resolution.
- **Per-region stats counter:** track per-region delta (`current - total`),
  not cumulative `parsed` count, to avoid double-counting across regions.

### Spatial stop resolution for OSM routes

OSM route relations reference `public_transport=stop_position` nodes (points
on the track), not `railway=station` nodes. Our station cache only has the
latter. `buildLine()` in `osmRoutes.mjs` now has a spatial fallback:

1. Exact OSM node id match in station cache (fast path)
2. **Spatial fallback:** look up the stop node's coordinates in `nodeCoords`
   (collected during OSM XML parsing), then find ALL named stations within
   `maxClusterMeters * 2` range. Matching ALL stations (not just the nearest)
   is critical for multi-operator hubs — a Yamanote Line stop_position at
   Shinjuku should match JR East, Odakyu, AND Keio station nodes.
3. Name-based resolution (existing fallback)

Without this, 759 of 822 route lines had <2 resolved stations and were dropped.
After the fix, only ~99 lines are dropped (genuinely sparse routes).

### Two-pass operator inference for OSM routes

Many OSM route_master relations set `network` but omit `operator` (e.g.,
Keihin-Tōhoku Line has `network=山手線`, no operator). `buildLine()` already
falls back from the master's tags to directional variants. A post-processing
pass in `processOsmRoutes()` then applies:

1. **Network peer inference:** lines with real operators contribute to a
   `network → most-common-operator` map. Lines whose operator came from the
   network fallback check this map first.
2. **Config override:** `config.yaml` → `networkNames` maps stubborn networks
   to operators.
3. **Station majority vote:** for lines that still have no operator, tally
   operator votes from the line's member stations (using operators learned
   from lines that DO have them in pass 1). The majority operator wins.

Add stubborn network→operator mappings to `config.yaml` → `networkNames`.
Most cases resolve automatically via step 1 or 3.

### Preset ID slug collision avoidance

Preset IDs are `osm-<region>-<slug>` where `slug = slugify(operatorName)`.
The slug function in `conflateStage.mjs` strips non-ASCII characters, which
causes collisions: both "JR東日本" and "JR東海" slugify to "jr". Fix:

- Slugs with length ≥5 are used as-is (e.g., "jr-east" is fine)
- Shorter slugs append a djb2 hash: `jr-<hash>` — deterministic across builds
- Names with no ASCII at all (e.g., "ゆりかもめ") get `op<hash>`

This is checked at emit time by `validateUniquePresetIds()` — it catches any
remaining collisions and fails the build with a clear error.

### Updated Kantō validation numbers

| Stage          | Metric             | Value                      |
| -------------- | ------------------ | -------------------------- |
| OSM extraction | features read      | 2,964                      |
| OSM extraction | mapped stations    | 2,706                      |
| OSM extraction | after dedup        | 2,431                      |
| Route extract  | relations parsed   | 767                        |
| Route extract  | lines resolved     | 714                        |
| Conflation     | GTFS seeds         | 334                        |
| Conflation     | attachments        | 255                        |
| Conflation     | standalone         | 10,264                     |
| Conflation     | near-misses        | 34                         |
| Conflation     | I1 invariant       | passed                     |
| Emit           | japan-kanto bundle | 40 presets, 655 KB         |
| Emit           | JR East in Kantō   | 1,027 stations, 157 routes |

## Bottom-sheet snap behavior

Snap points: `["18%", "42%", "88%"]` — compact (0), medium (1), large (2).

- **42% (medium) is the resting state.** Every common operation must be
  completable here without expanding. This is the test for "is this screen
  done."
- **88% (large) is reserved for deep browse only** — long search lists
  (browse-all operators, candidate lists) and keyboard-active search fields.
- **18% (compact) is glanceable** — just the grabber + a HUD line.

`getRouteSnapIndex` in `AppBottomSheet.tsx` controls per-route default snap.
Most routes rest at medium; only routes with long inline lists (matching,
admin-divisions) default to large. Play-area and hiding-zone rest at medium;
their search fields trigger a transient snap to large via the expand-on-search
helper.

When adding a new sheet route, ask: "Can the user complete the primary action
at 42%?" If not, push secondary options into drill-ins rather than defaulting
to 88%.

## Map POI callouts / info bubbles (2026-06-15)

Interactive map callouts (tap a POI → name bubble) are rendered as a
**screen-space React Native overlay over the map, not a MapLibre annotation.**

Do **not** use `MarkerView`/`PointAnnotation` for this. On iOS `MarkerView`
collapses to `PointAnnotation`, a UIView-backed annotation that positions itself
by measuring its React child's frame against the native add/remove cycle. That
design is the root of three separate failures we hit:

- **Top-left flash.** When the annotation is (re)added it paints at the origin
  for a frame before the frame/centerOffset settle. `MLRNPointAnnotation.m`
  even has a comment about this; `_setCenterOffset:` early-returns on a 0×0
  frame and `setMap:` skips adding until the frame is set. A 0×0 child (e.g. a
  hidden placeholder) re-triggers it.
- **Anchoring quirks.** Default anchor is the view center, so the bubble sits
  _on_ the POI rather than above it.
- **Nil-subview crash.** Conditionally mounting/unmounting it among MapView
  children reorders native subviews by index and crashes in
  `-[MLRNMapView insertReactSubview:atIndex:]`.

The robust pattern (shipped):

- `useMapCallout` owns one callout `{ coordinate, id, title }`. Any layer's
  `ShapeSource` `onPress` feeds `showCalloutFromPress` — it's generalized, not
  per-question. Background taps (`handleMapPress`) call `dismissCallout`.
- `NativeMap` projects `callout.coordinate` to a pixel point via the map ref's
  `getPointInView` (async over the bridge) and stores it in state. It clears the
  point on `callout.id` change so a new callout never paints at the previous
  POI's stale point.
- **Hide while moving, snap on settle.** A JS-positioned overlay can't track a
  native 60fps gesture without visibly lagging — each reprojection is an async
  `getPointInView` round-trip, so a bubble dragged along behind the map looks
  broken. Instead, `onRegionWillChange` sets an `isCameraMoving` flag that hides
  the bubble (`point={null}`), and `onRegionDidChange` clears it and reprojects,
  snapping the bubble back onto the POI. `regionDidChangeDebounceTime={60}`
  re-shows it promptly instead of the default 500ms.
- `MapPoiCallout` is a plain absolutely-positioned `View` rendered as a sibling
  of `MapView` (after `MapControls`), measured via `onLayout` and offset by
  half-width / full-height + a gap so the tail tip lands above the POI. It
  renders at `opacity: 0` until measured to avoid a one-frame jump.

Known trade-offs: the bubble disappears during an active pan/zoom and reappears
when the map settles (the deliberate alternative to a visibly lagging bubble);
and there's no flip-below logic for a POI near the very top edge yet.

Regression guards live in `NativeMap.test.tsx` ("nil-subview crash regression"):
no `: null}` and no `&&`-conditional rendering of native children in any map
layer file, and no dynamic `key` on `ML*` primitives. The `&&` check was added
after the callout crash slipped past the `: null}`-only check.

## Design decisions of record — shipped epics (consolidated 2026-06-20)

Several large epics shipped and their step-by-step task docs were removed during
a docs cleanup (recover from git history if you need the play-by-play). The
binding rules they established now live in `AGENTS.md`; this section records only
the non-obvious design decisions that still constrain current work.

### Questions catalog (radar / matching / measuring / thermometer / tentacles)

- Five question types ship; the type union, per-type config, and the
  `questionRegistry` are the source of truth. See `AGENTS.md` → "Question Rules".
- The decision that bit us twice and must not regress: **per-question Zod
  schemas + normalizations are single-sourced in
  `src/sharing/wire/questionSchemas.ts`** — persistence, full-key wire, minified
  codec, and the store all derive from it. Triplicating them silently dropped
  questions. Likewise **mask polarity** (required → intersect, excluded →
  subtract) is single-sourced in `MASK_RULES` / `buildEligibilityConstraints`;
  add new answer paths there with a render-state polarity test.
- `radius` → `radar` was a terminology rename; legacy `type: "radius"` payloads
  normalize via the shared schema transform. Keep the alias until the wire
  version is intentionally bumped.

### Transit station expansion + ODPT retirement

- Detailed pipeline notes are above ("Transit Station Expansion"). Design of
  record: **OSM-only station extraction**, locale-generic, per-operator presets,
  lazy bundle loading by play-area bbox. GTFS is reference data, not shipped.
- **Open residue:** the legacy `data/odpt/` tree is still on disk (kept for
  cached GTFS zips). T10 "retire ODPT" was never finished — see open-work.md.

### Remove bundled Japan → downloadable packs

- The architecture pivot of record: **the only committed game asset is the Tokyo
  boundary placeholder**; all POI / measuring / transit / admin data — including
  Japan — comes from downloadable packs. Pack blobs are never committed (Releases
    - `site/packs/catalog.json`). See `AGENTS.md` → "Offline Pack Rules".
- Pre-launch the pack schema is free to break (no migration shims). Don't add
  back-compat code for it until launch.

### Admin levels — unified matching + measuring (2026-06-21)

- **Single source of truth:** the `AdminDivisionNamePack` (4-tuple of
  osmLevel + labels, `adminDivisionConfig.ts`) drives *both* the matching
  `admin-1st…admin-4th` categories *and* the two measuring border tiers. A
  measuring border tier maps into the pack by index — `admin-1st-border` → tier
  0, `admin-2nd-border` → tier 1 (`ADMIN_BORDER_TIER_INDEX`). Border title +
  OSM level come from the pack via `getAdminBorder{OsmLevel,Label,QueryTags}`,
  so the old hardcoded `4`/`7` + Japan titles ("Prefecture/Ward") are gone.
  Decision of record: **keep exactly two border tiers** (not one-per-level).
- **One runtime source:** measuring "distance to admin border" derives its line
  geometry from the boundary **polygon rings** already in the `boundaries`
  artifact (the unified adapter `buildAdminBorderBundle` in `lineBundleLoader.ts`
  via `boundaryStore.getBoundaryPolygonsAtLevel`), not a separate
  `measuring-admin-*-border` line bundle. The pipeline still *emits* those
  artifacts (app-side-first scope) but the app no longer depends on them; the
  legacy pack measuring source remains a fallback. Cutting them from
  `buildMeasuring.mjs` + republishing packs is the follow-up.
- **Bundle-aware UI:** `AdminDivisionScreen` is the one unified surface. When an
  offline pack is installed it constrains the OSM-level picker to
  `getAvailableBoundaryLevels()` (with per-level relation counts from
  `getBoundaryLevelCounts()`) so a user can't pick a level with no data; with no
  pack it falls back to free-text (live Overpass). Changing the pack invalidates
  cached border bundles (`invalidateAdminBorderBundles`, called from the store).
- **Fixed in passing:** `boundaryStore.getBoundaryPolygon` read the polygons
  file as a bare `{ [relationId]: encoded }` map, but the installer writes a
  `{ schemaVersion, regionId, polygons }` envelope — the read now unwraps it.
  This path backs both the matching async admin query and the new border adapter.

### Native GEOS geometry backend + cross-engine parity

- The GEOS op pipeline is single-sourced in
  `modules/native-geometry/ios/geos_ops.{h,cpp}`, compiled into iOS (Swift),
  Android (JNI), and a geos-wasm host oracle. One op edit touches all three —
  run the Swift XCTest, the Android instrumented test, and the host parity gate.
  Commands and the golden-fixture workflow are in `AGENTS.md` → "Testing
  Expectations". The native test suite (golden fixtures, memory stress, MakeValid
  recovery) shipped; the research/plan docs that produced it were removed.
- Why it exists: pure-JS polyclip dissolve hard-locked on body-of-water
  measuring (~25 s). A stale dev client silently degrades overlay ops to JS with
  a per-op `console.warn` — rebuild after `native-geometry` changes.

### Sharing (seeker → hider deep links)

- Versioned wire format with a minified codec, deep links, and QR. The
  `question-request` envelope and answer-eval shipped. Compact links omit large
  payloads (custom relation boundaries don't round-trip through QR) — that
  limitation is tracked in open-work.md, not yet solved.

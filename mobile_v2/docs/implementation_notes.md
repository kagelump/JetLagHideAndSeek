# Mobile v2 Implementation Notes

## Milestone 2: Real Tokyo Map

Milestone 2 replaces the placeholder map with MapLibre RN and keeps the app dev-build-only. Expo Go will not work because `@maplibre/maplibre-react-native` is a native module.

Default play area is **Tokyo 23 Wards**, OSM relation `19631009`. The checked-in boundary fixture lives at `mobile_v2/assets/default-zones/tokyo.json` and is loaded by `src/features/map/playArea.ts`. The old broader Tokyo prefecture relation `1543125` is intentionally not used because it includes the island chain and makes the initial bbox far too wide.

The map fit is intentionally biased upward. `NativeMap` calls `fitCameraToBbox` with `getTopViewportFitPadding`, which uses asymmetric MapLibre camera bounds padding so the bbox sits in the upper map area above the medium bottom sheet. If sheet snap points change, revisit `getTopViewportFitPadding` in `src/features/map/camera.ts`.

MapLibre native setup matters:

- `app.json` must include the `@maplibre/maplibre-react-native` plugin.
- `metro.config.js` pins `@maplibre/maplibre-react-native` to the workspace root to avoid duplicate native package resolution.
- After adding MapLibre, run `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm --dir mobile_v2 exec expo prebuild --platform ios --clean` so the iOS project gets the MapLibre Swift Package dependency and Podfile post-install hook.
- Rebuild the dev client after native dependency changes with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm --dir mobile_v2 exec expo run:ios --device "iPhone 16 Pro" --no-bundler`.

Testing added in this milestone:

- Jest config and mocks for MapLibre, Gorhom bottom sheet, Reanimated, and `expo-location`.
- Unit tests for play-area metadata/bbox, OSM style JSON, camera helpers, and user-location permission handling.
- Component tests for `NativeMap` and `MapAppScreen`.
- Maestro smoke flow at `mobile_v2/e2e/smoke.yaml`.

E2E notes:

- Maestro is installed at `~/.maestro/bin/maestro`; add it to `PATH` if `maestro` is not found.
- Start Metro first: `pnpm --dir mobile_v2 exec expo start --dev-client --host localhost --port 8081 -c`.
- The smoke flow handles Expo dev-client first-run prompts conditionally, then asserts visible map UI (`Hide & Seek`, `Tokyo 23 Wards`, `Fit Tokyo 23 Wards`, `Locate me`) rather than the bottom drawer because the dev menu can cover the drawer.

## Milestone 3: Play-Area Settings

Milestone 3 adds Settings → Play Area in the bottom sheet. The app still starts with Tokyo 23 Wards, but the current in-memory play area can now be changed by Photon relation search or by entering a direct OSM relation ID. The direct-ID acceptance path uses Osaka relation `358674`.

Fetched relation boundaries are loaded from Overpass using `out geom`, converted with `osmtogeojson`, filtered to polygonal geometry, and cached in AsyncStorage under relation-specific boundary keys. Osaka relation `358674` is also checked in at `mobile_v2/assets/default-zones/osaka.json` as a bundled boundary so the direct-ID path and Maestro flow can run deterministically without depending on Overpass. The selected play area itself is not persisted yet; that remains part of the milestone 4 wire/persistence work.

Map rendering now reads from the mobile play-area provider instead of hard-coded Tokyo metadata, so the map label, boundary source, camera fit target, and Fit button follow the applied area.

Native/dependency setup matters:

- `@react-native-async-storage/async-storage` is a native dependency; after install/prebuild it must be present in the generated native project via autolinking.
- `osmtogeojson` is used in JS to convert Overpass responses into GeoJSON.
- `metro.config.js` pins AsyncStorage to the workspace root, matching the MapLibre/native-singleton pattern from milestone 2.
- Rebuild the dev client after adding AsyncStorage with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm --dir mobile_v2 exec expo run:ios --device "iPhone 16 Pro" --no-bundler`.

Bottom-sheet and E2E accessibility notes:

- The Play Area route snaps the bottom sheet to the large snap point before Maestro looks for controls.
- Maestro/XCUITest sees the native accessibility hierarchy, not the React tree. A visible empty `TextInput` may not expose its `testID` as a targetable iOS node.
- The direct relation ID field therefore uses an accessible `Pressable` wrapper with `testID="play-area-relation-id-input"` that focuses the real `TextInput`; unit tests target the inner text input.
- The iOS number pad does not reliably support Maestro `hideKeyboard`. The play-area flow taps the visible Apply button directly after entering text.

E2E stack helper:

- `pnpm --dir mobile_v2 test:e2e:ios:stack` runs `scripts/e2e-ios-stack.mjs`, starts Metro on port 8081, runs smoke and play-area Maestro flows with debug artifacts under `mobile_v2/e2e/artifacts/`, and shuts Metro down afterward.
- The simulator must be booted/available before the stack run. The known working target is `iPhone 16 Pro - iOS 18.3`.

Testing added in this milestone:

- Boundary loading/cache unit tests for bundled Tokyo, mocked Osaka conversion, invalid IDs, and AsyncStorage cache hits.
- Photon result mapping tests for relation filtering and deduplication.
- Component tests for Settings → Play Area navigation, direct Osaka apply, invalid input, and fetch failure retaining Tokyo.
- Maestro flow at `mobile_v2/e2e/play-area.yaml` that changes the play area to Osaka via relation `358674` and asserts `Osaka`, `Fit Osaka`, bbox, and cache metadata.

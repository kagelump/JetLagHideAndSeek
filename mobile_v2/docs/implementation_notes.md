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
- The smoke flow handles Expo dev-client first-run prompts conditionally, then asserts visible map UI (`Hide & Seek`, `Tokyo 23 Wards`, `Fit Tokyo`, `Locate me`) rather than the bottom drawer because the dev menu can cover the drawer.

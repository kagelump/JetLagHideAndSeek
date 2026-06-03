# Hide & Seek Mapper

A mobile app for generating interactive maps to explore hiding possibilities in
_Jet Lag: The Game_ — Hide & Seek. Built with Expo SDK 54 and React Native,
centered on a native MapLibre map and an Apple Maps-style bottom sheet.

## Features

- **Interactive map** — MapLibre GL map with play area boundary overlay.
- **Play Area settings** — Select a play area by OSM relation search or direct
  relation ID. Bundled defaults include Tokyo 23 Wards and Osaka.
- **Hiding Zone presets** — Select transit presets (Tokyo Metro, Toei Subway)
  sourced from ODPT GTFS data. Adjust the hiding radius in meters, kilometers,
  or miles.
- **Offline POI matching** — Matching questions resolve nearby places (parks,
  museums, stations, …) from OSM data bundled in the app, working offline within
  covered regions and falling back to Overpass elsewhere.
- **E2E-tested** — Maestro smoke, play-area, hiding-zone, radar-question, and transit-line-question flows on iOS and Android via GitHub Actions.
- **Dev build required** — Uses native modules (`@maplibre/maplibre-react-native`,
  AsyncStorage, Reanimated); Expo Go will not work.

## Tech Stack

| Layer         | Technology                                  |
| ------------- | ------------------------------------------- |
| Framework     | Expo SDK 54, React Native 0.81              |
| Routing       | Expo Router                                 |
| Map           | MapLibre GL Native, OSM raster tiles        |
| Bottom sheet  | `@gorhom/bottom-sheet`                      |
| Geometry      | Turf.js (`@turf/circle`, `@turf/union`)     |
| Transit data  | ODPT GTFS (Tokyo Metro, Toei Subway)        |
| State         | React Context                               |
| Lint / Format | ESLint, Prettier, TypeScript                |
| Testing       | Jest, React Native Testing Library, Maestro |

## Prerequisites

- **Node.js** 18+ (`.node-version` or engine field)
- **pnpm** 10.11+ (see `packageManager` in `package.json`)
- **iOS**: Xcode 16+, iOS 18 simulator or device
- **Android**: Android Studio with SDK 35+

Expo Go will **not** work. This project uses native modules that require a
dev build.

## Getting Started

```bash
# Install dependencies
pnpm install

# Prebuild native projects (first time, or after native dependency changes)
pnpm exec expo prebuild --platform ios --clean

# Start the dev client
pnpm exec expo start --dev-client --host localhost --port 8081 -c

# Run on a specific platform
pnpm ios
pnpm android
```

For a full iOS rebuild after native dependency changes:

```bash
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm exec expo prebuild --platform ios --clean
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm exec expo run:ios --device "iPhone 16 Pro" --no-bundler
```

## Commands

| Command                   | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `pnpm start`              | Start the Expo dev server                                              |
| `pnpm ios`                | Run on iOS simulator or device                                         |
| `pnpm android`            | Run on Android emulator or device                                      |
| `pnpm lint`               | Lint with ESLint                                                       |
| `pnpm format`             | Format with Prettier                                                   |
| `pnpm format:check`       | Check formatting                                                       |
| `pnpm fix`                | Auto-fix lint and format issues                                        |
| `pnpm typecheck`          | Run TypeScript type checking                                           |
| `pnpm check`              | Lint, format check, and typecheck                                      |
| `pnpm test`               | Run Jest unit and component tests                                      |
| `pnpm test:data:odpt`     | Run ODPT generator fixture tests                                       |
| `pnpm test:e2e:ios`       | Run Maestro E2E flows                                                  |
| `pnpm test:e2e:ios:stack` | Start Metro, run E2E flows, stop Metro                                 |
| `pnpm data:odpt`          | Regenerate ODPT hiding-zone presets                                    |
| `pnpm data:poi`           | Regenerate bundled offline POIs, then commit `assets/poi/` (see below) |

## Bundled Offline Data

Matching questions resolve POI lookups (parks, museums, stations, …) from a small
OSM dataset **bundled in the app**, falling back to the Overpass API only outside
covered regions. The data is **generated and committed** to the repo (CI cannot
regenerate it — see below).

```bash
pnpm data:poi   # regenerate, then: git add assets/poi && commit
```

`pnpm data:poi` is the single regeneration command: it re-emits the category→tag
registry, then extracts and reduces the OSM POIs into `assets/poi/`. The first run
downloads a ~450 MB Geofabrik extract into the git-ignored `data/geofabrik/cache/`
(reused afterward); the committed output is ~3 MB of JSON.

Run it after **editing the matching category registry**
(`src/features/questions/matching/matchingSelectors.ts`) or to **refresh OSM data**.
You do not need to remember to verify: `pnpm check` runs the registry drift guard and
fails if the committed data is stale, pointing you back to `pnpm data:poi`.

## E2E Testing on CI

Maestro E2E flows run on GitHub Actions (`Maestro E2E` workflow) against
both iOS and Android. Use the `gh` CLI to trigger and monitor remote runs
without leaving the terminal.

```bash
# Full test suite — local check + unit tests + remote E2E on both platforms
pnpm check && pnpm test && gh workflow run "Maestro E2E" --ref $(git branch --show-current) -f platform=all && gh run watch

# Run only E2E on a specific platform
gh workflow run "Maestro E2E" --ref $(git branch --show-current) -f platform=ios
gh workflow run "Maestro E2E" --ref $(git branch --show-current) -f platform=android

# Run a single flow for faster iteration
gh workflow run "Maestro E2E" --ref $(git branch --show-current) -f platform=ios -f flow=smoke

# Watch the most recent workflow run
gh run watch
```

Available flow names for `-f flow`: `smoke`, `play-area`, `hiding-zone`,
`radar-question`, `transit-line-question`. Omit (or use `all`) to run every
flow.

A simulator/emulator and dev build must already be available when running
locally. See `docs/implementation_notes.md` for local E2E stack setup.

## Project Structure

```
.
├── app/                    # Expo Router entry points
│   ├── _layout.tsx         # Root layout (gesture, safe area providers)
│   ├── index.tsx           # Main screen
│   └── import.tsx          # Import/share screen
├── assets/
│   ├── default-zones/      # Bundled GeoJSON boundaries (Tokyo, Osaka)
│   └── poi/                # Bundled offline POIs (committed; `pnpm data:poi`)
├── data/
│   ├── geofabrik/          # OSM POI extraction pipeline (scripts + ignored cache/)
│   └── odpt/               # ODPT GTFS config, fetch script, generated presets
├── docs/                   # Implementation notes, sharing design, archive pointer
├── e2e/                    # Maestro E2E test flows
├── scripts/                # E2E stack helper
└── src/
    ├── features/
    │   ├── hidingZone/     # Hiding Zones settings, preset logic, GeoJSON generation
    │   ├── map/            # NativeMap, camera helpers, play-area math, map style
    │   ├── playArea/       # Play Area settings, Photon search
    │   └── sheet/          # Bottom sheet, main drawer, settings screen
    ├── screens/            # MapAppScreen (top-level coordinator)
    ├── sharing/            # Export/import, QR codes, wire format, deep links
    └── state/              # PlayAreaProvider, HidingZoneProvider
```

## License

MIT — see [LICENSE](LICENSE) for details.

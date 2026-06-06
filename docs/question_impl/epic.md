# Epic: Measuring, Thermometer, and Tentacles Questions

## Overview

Implement the three remaining question types as fully interactive features,
completing the question catalog. Each type already has a skeleton config file and
a placeholder in `QuestionDetailScreen`. This epic converts those skeletons into
working questions with map overlays, OSM/bundled POI search, detail-screen
editing, and serialization.

This epic is **metric-first by design**. JetLag's physical cards use imperial
units; this app is the metric edition. A metric/imperial display toggle in
Settings is a separate future effort and is explicitly out of scope here. Store
everything in meters (see Play Area Rules in `AGENTS.md`).

## Question Summary

| Question        | Prompt (metric)                                                                   | Answer           | Map overlay                                                                  |
| --------------- | --------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| **Measuring**   | "I'm [Distance] from my nearest \_\_\_. Are you closer to or farther from yours?" | Closer / Farther | Circle centered on the seeker's target POI, radius = seeker's distance to it |
| **Thermometer** | "I've just traveled from here to here. Am I hotter or colder?"                    | Hotter / Colder  | Half-plane defined by perpendicular bisector of the travel segment           |
| **Tentacles**   | "Of all the **_ within _** of me, which are you closest to?"                      | A named POI      | Voronoi cell of the named POI, clipped to the seeker's radius circle         |

### How these modes are actually used (product intent)

- **Measuring is a planning tool.** The seeker compares _their own_ nearest POI
  to the hider's nearest POI of the same category. The intended phrasing is:
  _"I am 1.2 km from my nearest movie theater — are you closer or farther from
  yours?"_ The seeker picks the POI/location first; the distance is a derived
  consequence. (Answering this on the hider side requires the hider to do their
  own POI lookup — that is the hider app's concern and out of scope here.)
- **Thermometer is a planning tool for halving the remaining hiding space.**
  Seekers want to plan _how far to travel, from where to where, and which
  question it spends_ so the perpendicular bisector cuts the remaining area in
  roughly half. The travel distance is usually chosen _after_ the two endpoints
  are placed, not before. The detail screen should optimize for this planning
  loop (live distance read-out, live half-plane preview, and — stretch — an
  approximate area-split read-out). The "1 cm / 5 cm / 15 km" card minimums are
  informational only.
- **Tentacles' answer is a place, not a yes/no.** The hider names which POI they
  are closest to. The answer model must represent a selected POI, not a
  positive/negative toggle (see Task 02).

## Tasks

| Task                                       | File                     | Description                                                                     | Depends on |
| ------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------- | ---------- |
| [01](task-01-foundation.md)                | Foundation               | Type system, registry, dispatch stubs, store integration (create/update/center) | —          |
| [02](task-02-answer-model.md)              | Answer model             | Binary vs POI answer model; fixes Tentacles' answer semantics                   | 01         |
| [03](task-03-wire-persistence.md)          | Wire + persistence       | Serialization, sharing, minified codecs, round-trip tests for all three types   | 01, 02     |
| [04](task-04-two-pin-selector.md)          | Two-pin selector         | Reusable dual-pin map interaction primitive (Thermometer prep)                  | 01         |
| [05](task-05-measuring.md)                 | Measuring                | 13 point categories, geometry, search, detail screen                            | 01, 02     |
| [06](task-06-measuring-line-categories.md) | Measuring (line/polygon) | The 5 distance-to-line/polygon categories — **needs a dedicated design pass**   | 05         |
| [07](task-07-rail-station-data.md)         | Rail-station data        | Add `rail-station` selector + regenerate bundled POIs (environment-gated)       | — (prep)   |
| [08](task-08-thermometer-geometry.md)      | Thermometer geometry     | Perpendicular-bisector half-plane builder + tests                               | 01         |
| [09](task-09-thermometer-ui.md)            | Thermometer UI           | Dual-pin detail screen, preview layer, planning read-outs                       | 04, 08     |
| [10](task-10-tentacles-geometry.md)        | Tentacles geometry       | Voronoi-in-radius builder, clip-to-circle helper + tests                        | 01         |
| [11](task-11-tentacles-ui.md)              | Tentacles UI             | Category picker, radius layer, POI-answer detail screen                         | 02, 10     |

## Dependency Order

```
Task 01 ─┬─► Task 02 ─┬─► Task 03
         │            ├─► Task 05 ──► Task 06
         │            └─► Task 11
         ├─► Task 04 ──► Task 09
         ├─► Task 08 ──► Task 09
         └─► Task 10 ──► Task 11

Task 07 (data prep) is independent; land it before Task 05's rail-station
acceptance criteria, or stub rail-station via the live Overpass path.
```

Geometry tasks (08, 10) are pure functions and can be built test-first in
parallel with everything else. UI tasks (09, 11) consume them.

## Sizing / staffing guidance

- **Intern-friendly:** 01, 02, 03, 05, 07. These are mechanical or follow an
  existing pattern (Matching/Radar) closely.
- **Senior / careful:** 04 (novel interaction primitive), 08 + 10 (geometry
  correctness is subtle and easy to invert), 09 + 11 (new map layers + new UX).
- **Needs design before code:** 06. Hand this to whoever owns the line/polygon
  distance design; Task 06 is now a design-and-build brief with algorithm and
  library hints, not a tracking stub.

## Test-Driven Workflow (applies to every task)

Each task is written **test-first**. The expected loop is:

1. **Red** — write the listed test file(s) and cases first; they fail (or the
   module doesn't exist yet).
2. **Green** — implement the minimum to pass.
3. **Refactor** — clean up, add caching, wire into the render pipeline.

Every task has a **"Test plan (write first)"** section that precedes its
**"Implementation"** section. Do not start implementation until the red tests
exist. Geometry tasks especially: the failing assertions _are_ the spec.

`pnpm test` runs Jest; `pnpm typecheck` runs `tsc`; `pnpm check` runs lint +
registry-drift + format. Jest already mocks MapLibre, Gorhom bottom sheet,
Reanimated, AsyncStorage, and `expo-location` (`jest.setup.ts`).

## Architecture Constraints

- **Rendering**: Measuring and Thermometer produce `hitMaskFeatures` /
  `missMaskFeatures` in the same `FeatureCollection<Polygon | MultiPolygon>`
  format as Radar. They slot into the existing `combinedInsideMask` /
  `combinedOutsideMask` in `NativeMap` with no new fill layers. Tentacles needs
  one new `LineLayer` for its radius circle; Thermometer needs one new
  `LineLayer` for its preview (travel line + range rings).
- **Distance math**: use `haversineDistanceMeters(lat1, lon1, lat2, lon2)` from
  `@/shared/geojson`. **Do not** `import { distance } from "@turf/distance"` —
  it is _not_ a dependency. Installed turf packages are only `@turf/circle`,
  `@turf/helpers`, `@turf/simplify`, `@turf/voronoi`, and `@turf/union`. Any new
  turf package (e.g. `@turf/nearest-point-on-line` for Task 06) is a dependency
  addition that must be called out and installed explicitly.
- **Caching**: geometry builders should use the `Map`-insertion-order LRU
  pattern from `radarGeometry.ts` (keyed on question identity + geometry inputs)
  to avoid rebuilding circles/cells every render.
- **Search**: Measuring and Tentacles reuse the OSM matching search
  infrastructure (`useMatchingSearch`, `osmMatchingCache`, `findMatchingFeaturesWithIndex`,
  `spatialIndex`). Note the real `useMatchingSearch` shape (see "Search contract"
  below) before writing wrappers.
- **State file layout**: each question type defines its render-state type in its
  own `*Types.ts`. `QuestionMapRenderState` in `radar/radarTypes.ts` imports and
  references all three new render-state types.
- **No new sheet routes**: all three use the existing `question-detail` route,
  dispatched by `QuestionDetailScreen`.

### Search contract (read before writing any search wrapper)

The existing hook is:

```typescript
useMatchingSearch(
    category: MatchingCategory,
    center: Position,
    /* ...stationRadiusMeters etc. */
): { isLoading: boolean; error: string | null; performSearch: (forceRefresh?: boolean) => Promise<Result | null> }
```

It does **not** return `candidates`. The detail screen calls `performSearch()`
and writes the returned candidates back onto the question via `updateQuestion`.
Wrappers for Measuring/Tentacles must follow this same shape — accept a category

- center, return `performSearch`, and let the screen persist candidates onto the
  question. Measuring/Tentacles categories are _not_ `MatchingCategory` values, so
  the wrapper must map its category to the matching selector/tags first.

## Definition of Done (per task)

- `pnpm typecheck` passes
- `pnpm test` passes (the test-first cases for that task are green)
- `pnpm check` passes (lint + registry drift + format)
- New question types can be created from `AddQuestionScreen`, edited in the
  detail screen, and answered; the correct map overlay appears
- Questions survive a serialize/deserialize round-trip — **this is owned by Task
  03**, which must land before any type's serialization DoD is claimed. Tasks
  05/09/11 should not assert round-trip survival until Task 03 covers their type.
- Maestro smoke flow covers create → answer for at least one new question type
  (added in the relevant UI task; see Task 09/11).

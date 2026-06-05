# Epic: Measuring, Thermometer, and Tentacles Questions

## Overview

Implement the three remaining question types as fully interactive features, completing the question catalog. Each type already has a skeleton config file and a placeholder in `QuestionDetailScreen`. This epic converts those skeletons into working questions with map overlays, OSM/bundled POI search, and detail-screen editing.

## Question Summary

| Question | Prompt | Answer | Map overlay |
|---|---|---|---|
| **Measuring** | "Compared to me, are you closer to or farther from ___?" | Closer / Farther | Circle centered on target POI, radius = seeker's distance to it |
| **Thermometer** | "I've just traveled at least [Distance]. Am I hotter or colder?" | Hotter / Colder | Half-plane defined by perpendicular bisector of travel segment |
| **Tentacles** | "Of all the ___ within ___ of me, which are you closest to?" | Named POI | Voronoi cell of named POI, clipped to seeker's radius circle |

## Tasks

| Task | File | Description |
|---|---|---|
| [01](task-01-foundation.md) | Foundation | Type system, registry, dispatch stubs |
| [02](task-02-measuring.md) | Measuring | Categories, geometry, search, detail screen |
| [03](task-03-thermometer.md) | Thermometer | Half-plane geometry, dual-pin detail screen |
| [04](task-04-tentacles.md) | Tentacles | Voronoi-in-radius geometry, detail screen |
| [05](task-05-deferred.md) | Deferred | Five categories requiring polygon/line distance geometry |

## Dependency Order

Tasks 02–04 each depend on the foundation from Task 01. They are otherwise independent and can be done in any order. Task 05 is a tracking document only — no code changes.

```
Task 01  ──►  Task 02
          ├─►  Task 03
          └─►  Task 04
```

## Architecture Constraints

- **Rendering**: Measuring and Thermometer produce `hitMaskFeatures`/`missMaskFeatures` in the same `FeatureCollection<Polygon | MultiPolygon>` format as Radar. They slot into the existing `combinedInsideMask` / `combinedOutsideMask` in `NativeMap` with no new fill layers. Tentacles needs one new `LineLayer` for its radius circle.
- **Search**: Measuring and Tentacles both reuse the OSM matching search infrastructure (`osmMatchingCache`, `bundledPois`, `spatialIndex`). They share `OsmFeature` from `matchingTypes.ts`.
- **Deferred categories**: Five Measuring categories (high-speed-rail, coastline, body-of-water, admin-1st-border, admin-2nd-border) require polygon/line distance geometry and are deferred. `MeasuringCategory` includes all 18 values in its union; the UI filters to the 13 implemented ones. See Task 05.
- **State file layout**: Each question type defines its render state type in its own `*Types.ts` file. `QuestionMapRenderState` in `radar/radarTypes.ts` imports and references all three new render state types.
- **No new sheet routes**: All three use the existing `question-detail` route, dispatched by `QuestionDetailScreen`.

## Definition of Done (per task)

- `pnpm typecheck` passes
- `pnpm test` passes (geometry unit tests included)
- `pnpm check` passes (covers registry drift + lint)
- New question types can be created from `AddQuestionScreen`, edited in the detail screen, and answered; the correct map overlay appears
- Questions survive a serialize/deserialize round-trip (app-state persistence)
- Maestro smoke flow covers create → answer for at least one new question type (can be added to the existing smoke flow)

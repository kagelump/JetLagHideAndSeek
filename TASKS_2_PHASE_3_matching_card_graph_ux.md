# TASKS_2 PHASE 3: Matching Card Uses Cached Transit Graph

## Source Bugs And Design Direction

This phase depends on:

- [TASKS_2_PHASE_1_transit_graph_contract.md](TASKS_2_PHASE_1_transit_graph_contract.md)
- [TASKS_2_PHASE_2_hiding_zone_graph_build.md](TASKS_2_PHASE_2_hiding_zone_graph_build.md)

It replaces the same-transit-line card's per-question Overpass behavior, fixing the user-facing symptoms from [BUG_1_train_line_dropdown_no_operator_filter.md](BUG_1_train_line_dropdown_no_operator_filter.md) and [BUG_2_zero_matched_stations_on_mismatched_operator.md](BUG_2_zero_matched_stations_on_mismatched_operator.md).

## Goal

Make `src/components/cards/matching.tsx` read same-transit-line dropdown options, auto-detect, and station preview from the cached `transitGraph`.

The card should no longer call these APIs for normal same-transit-line UI:

- `fetchStationTrainLineOptions`
- `findNodesOnTrainLine`
- `findStationLabelsOnTrainLine`
- `trainLineNodeFinder`

## UX Rules

### Hiding-zone transit graph available

- Nearest station still comes from `$trainStations`.
- Dropdown options come from cached lines for the nearest configured station.
- Auto-detect means "first cached line for the nearest configured station."
- Station preview shows cached playable stations on the selected/autodetected line.
- If a selected editable line is not available for the nearest station, clear it and return to auto.
- Locked/shared selected lines should render gracefully:
    - If the line exists in graph, show it.
    - If it does not exist in graph, keep saved label in the trigger but show an unavailable preview.

### Hiding-zone transit graph missing

- Disable the train-line selector.
- Show a red warning:

```text
Same transit line requires hiding-zone transit stops. Configure hiding zones with default transit stops to use this question.
```

- Preview should show no stations and should not attempt Overpass fallback.
- Keep closest station row independent; if `$trainStations` exists it can still show the nearest station.

### Existing warning copy

Replace the current orange copy:

```text
Warning: The train line data is based on OpenStreetMap...
```

With two states:

- Graph available: muted/orange copy that data comes from the configured OpenStreetMap hiding-zone transit graph.
- Graph missing: red copy above, because the feature is unavailable.

## Implementation Notes

In `MatchingQuestionComponent`:

- Import and read `transitGraph` from `src/lib/context.ts`.
- Replace `lineOptions` async state with derived memoized options where possible.
- Keep retry UI only for graph build errors if Phase 2 exposes a status; otherwise remove train-line retry from the card because the card no longer owns fetching.
- Use Phase 1 helpers:
    - `getLinesForStation(graph, nearestTrainStationId)`
    - `resolveAutoTransitLine(graph, nearestTrainStationId)`
    - `resolveTransitLine(graph, selectedTrainLineId)`
- Build `lineStationPreview` from `TransitLineResolution.stationLabels`.
- Avoid storing line labels from graph in local state except when persisting a user selection to question data.
- Keep `selectedTrainLineId` / `selectedTrainLineLabel` wire fields unchanged.

Select behavior:

- The Radix Select value must always exist in options.
- If an orphan locked selected value is not in graph options, include a temporary disabled/display option for the saved line label so the trigger does not go blank.
- For editable orphan selected values, clear via `questionModified()` instead of rendering an orphan option.

## TDD Plan

### Red

Add component tests if a React test harness exists; otherwise use focused E2E with mocked graph inputs through app state. Test-first expectations:

- With graph missing, selector is disabled and red warning is visible.
- With graph available, dropdown shows only graph lines for the nearest station.
- Auto-detect preview shows graph station labels.
- Selecting a graph line updates preview and persists `selectedTrainLineId` / `selectedTrainLineLabel`.
- Editable orphan selected line is cleared.
- Locked orphan selected line keeps its label and does not blank the trigger.
- Opening/selecting does not trigger Overpass requests for exact line expansion.

### Green

Wire the component to graph helpers and remove card-owned same-transit-line fetching.

### Refactor

Keep the card simple: derive display from graph and question data. Do not let it rebuild graph data or know Overpass shapes.

## Acceptance Criteria

- Same-transit-line card works entirely from `transitGraph` and `$trainStations`.
- No per-question train-line Overpass calls occur from card dropdown/preview interactions.
- Missing hiding-zone configuration produces a red unavailable warning.
- Graph-backed dropdown options cannot include lines outside the configured hiding-zone transit graph.
- BUG_2's blank selected trigger behavior is fixed for both editable and locked cases.

## Out Of Scope

- Building the graph.
- ZoneSidebar map filtering.
- Hider mode answer calculation.
- Custom station line membership.

# TASKS_2 PHASE 4: ZoneSidebar Uses Graph Membership For Same-Transit-Line Filtering

## Source Bugs And Design Direction

This phase depends on:

- [TASKS_2_PHASE_1_transit_graph_contract.md](TASKS_2_PHASE_1_transit_graph_contract.md)
- [TASKS_2_PHASE_2_hiding_zone_graph_build.md](TASKS_2_PHASE_2_hiding_zone_graph_build.md)

It completes the map-elimination side of the redesign. The card preview and ZoneSidebar filtering must answer from the same cached graph, otherwise [BUG_2_zero_matched_stations_on_mismatched_operator.md](BUG_2_zero_matched_stations_on_mismatched_operator.md) can reappear as a preview/map mismatch.

## Goal

Replace ZoneSidebar's same-transit-line filtering path with cached graph membership.

Current behavior to remove for normal same-transit-line filtering:

- `findNodesOnTrainLine(question.data.selectedTrainLineId)`
- `trainLineNodeFinder(nid)`
- raw OSM node-ID intersection against station circles

## Filtering Contract

For each same-transit-line question:

- Determine nearest configured station from the current `circles`.
- Resolve selected line:
    - explicit `selectedTrainLineId` -> `resolveTransitLine(graph, id)`;
    - auto-detect -> `resolveAutoTransitLine(graph, nearestStationId)`.
- If resolution is not `ok`, skip this question's filter and toast a warning.
- If `question.data.same` is true, keep circles whose station ID is in the line's cached station membership.
- If `question.data.same` is false, keep circles whose station ID is not in the line's cached station membership.
- After same=true filtering, continue deduping by label as current code does.

No raw Overpass fallback should run from this path.

## Resilience Rules

Guard Turf inputs before every nearest-point call in this branch:

- If `circles.length === 0`, stop applying remaining station-based filters and set stations to empty without throwing.
- If nearest station cannot be resolved, skip the specific question with a warning.
- If graph is missing, skip same-transit-line filters with a warning that hiding-zone transit graph is unavailable.

Recommended warning copy:

```text
Same transit line requires the hiding-zone transit graph; skipping this filter.
```

For zero membership:

```text
No configured stations found for this transit line; skipping this filter.
```

## TDD Plan

### Red

Add focused tests around filtering behavior. Depending on current test harness, use pure helper tests first and E2E second.

Pure helper cases:

- same=true keeps only cached member station IDs.
- same=false excludes cached member station IDs.
- missing graph returns a skip result, not an exception.
- missing selected line returns a skip result.
- empty line membership returns a skip result.

E2E cases in `e2e/same-train-line.spec.ts`:

- Card preview count and ZoneSidebar station list count agree for a selected graph line.
- Selecting a line with zero configured membership does not crash or show Turf errors.
- No exact-line Overpass request is made when applying same-transit-line filters.

### Green

Move filtering into a small pure helper if needed, then call it from ZoneSidebar.

### Refactor

Keep ZoneSidebar orchestration readable:

- station discovery;
- graph build;
- circle creation;
- question filters using graph helpers.

Do not embed graph membership parsing directly inside the React effect.

## Acceptance Criteria

- Same-transit-line map filtering uses the same graph as the matching card.
- ZoneSidebar no longer makes per-question exact train-line Overpass calls for normal same-transit-line filtering.
- Empty or missing graph/membership states skip gracefully and never throw Turf geometry errors.
- BUG_2's "Must have at least 2 geometries" path is covered by tests or E2E assertions.

## Out Of Scope

- Card UI updates.
- Hider mode answer calculation.
- Custom station line membership.
- Reworking measuring/POI Turf guards outside the same-transit-line path.

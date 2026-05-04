# TASKS_2 PHASE 5: Hiderification, Legacy Helpers, And Regression Coverage

## Source Bugs And Design Direction

This phase follows:

- [TASKS_2_PHASE_1_transit_graph_contract.md](TASKS_2_PHASE_1_transit_graph_contract.md)
- [TASKS_2_PHASE_2_hiding_zone_graph_build.md](TASKS_2_PHASE_2_hiding_zone_graph_build.md)
- [TASKS_2_PHASE_3_matching_card_graph_ux.md](TASKS_2_PHASE_3_matching_card_graph_ux.md)
- [TASKS_2_PHASE_4_zone_sidebar_graph_filtering.md](TASKS_2_PHASE_4_zone_sidebar_graph_filtering.md)

It finishes remaining consistency work so same-transit-line has one mental model across seeker UI, hider mode, and tests.

## Goal

Make hiderification and legacy code paths align with the cached hiding-zone transit graph. Then lock in broad regression coverage.

## Hiderification Design

Current `hiderifyMatching()` for same-train-line discovers generic stations with `findPlacesInZone("[railway=station]", ..., "node")` and uses raw train-line lookup. That should stop being the normal same-transit-line path.

New behavior:

- Read `transitGraph` and `trainStations` from context.
- If graph is missing or empty, toast/warn that same-transit-line hiderification requires configured hiding-zone transit stops and leave `question.same` unchanged.
- Resolve nearest hider station and nearest seeker station from configured `$trainStations`.
- Resolve line membership from graph:
    - explicit selected line uses `resolveTransitLine`;
    - auto-detect uses `resolveAutoTransitLine` for nearest seeker station.
- Set `question.same` based on whether nearest hider station ID is in the resolved line membership.
- Do not query raw Overpass line data from hiderification.

## Legacy Helper Cleanup

Keep existing Overpass helpers only where they are still useful outside the redesigned flow:

- `fetchStationTrainLineOptions`
- `findNodesOnTrainLine`
- `findStationLabelsOnTrainLine`
- `trainLineNodeFinder`

If no production callers remain after phases 3-5:

- Either remove the helpers and their tests, or mark them as legacy/internal only if tests/fixtures still need them.
- Prefer removal if TypeScript confirms no production imports.
- Do not change wire schema.

## Nearest POI Error Label Fix

Fix the small UI resilience issue from BUG_2:

- Ensure error/unavailable states preserve category.
- `NearestPoiRow` should display `Closest station: Unavailable` for station-based matching errors, not `Closest POI: Unavailable`.

Suggested type adjustment:

```ts
{ status: "error"; category?: string }
```

Or make resolver error results include category when available.

## TDD Plan

### Red

Add tests before implementation:

- Hiderification with graph sets `same=true` when hider station is in selected/autodetected line membership.
- Hiderification with graph sets `same=false` when hider station is outside membership.
- Missing graph does not throw and does not query Overpass.
- `NearestPoiRow` displays the original category for error/unavailable station results.
- Full E2E: same-transit-line workflow has no per-question exact-line Overpass calls after hiding-zone graph is built.

### Green

Replace hiderification's raw station/line discovery with graph-based resolution.

### Refactor

Delete or isolate unused legacy train-line helpers. Keep tests focused on the new graph contract.

## Final Regression Suite

Run focused tests first:

```bash
pnpm vitest src/maps/transitGraph.test.ts
pnpm vitest src/maps/api/transitGraph.test.ts
pnpm vitest tests/nearestPoi.test.ts
pnpm test:e2e -- e2e/same-train-line.spec.ts
```

Then run broader checks:

```bash
pnpm test
pnpm build
```

Run `pnpm --dir server test` only if shared wire/CAS/server behavior is touched, which should not be needed for this redesign.

## Acceptance Criteria

- Same-transit-line card, ZoneSidebar filtering, and hiderification all use the cached hiding-zone transit graph.
- The question is clearly unavailable without configured hiding-zone transit stops.
- No normal same-transit-line interaction performs a fresh exact-line Overpass query.
- BUG_1 and BUG_2 regressions are covered by tests.
- Error states retain the correct "station" category instead of falling back to generic "POI."
- Wire compatibility for `selectedTrainLineId` and `selectedTrainLineLabel` is unchanged.

## Out Of Scope

- Adding line metadata support to imported custom stations.
- Persisting transit graph in CAS/localStorage.
- Redesigning non-transit matching questions.

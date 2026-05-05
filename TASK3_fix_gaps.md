# TASK3: Fix Same-Train-Line Review Gaps

## Source

This task comes from review findings on the `fix-train-line` branch after implementing the transit graph work for:

- [BUG_1_train_line_dropdown_no_operator_filter.md](BUG_1_train_line_dropdown_no_operator_filter.md)
- [BUG_2_zero_matched_stations_on_mismatched_operator.md](BUG_2_zero_matched_stations_on_mismatched_operator.md)

The branch mostly moves same-train-line behavior onto the cached transit graph, but two gaps remain:

1. `ZoneSidebar` builds a fresh graph, stores it, then filters the same initialization pass with stale render-captured `$transitGraph`.
2. The ZoneSidebar E2E regression test does not assert the actual hiding-zone filtering result, so it can pass while the map/sidebar remains unfiltered.

## Goal

Make same-train-line hiding-zone filtering use the transit graph built during the current `initializeHidingZones()` run, and add tests that fail when the graph is stale or the ZoneSidebar output is not filtered.

## Finding 1: Use The Fresh Graph In ZoneSidebar

### Problem

In [src/components/ZoneSidebar.tsx](src/components/ZoneSidebar.tsx), `initializeHidingZones()` builds a graph around the current `circles` and calls `transitGraph.set(graph)`. Later in the same async function, same-train-line filtering reads `const graph = $transitGraph`.

On initial load, `$transitGraph` is often `null` because it is the value captured by the React render that started the effect. The newly built graph will only be visible after a rerender, so the current filtering pass can skip same-train-line elimination.

### Expected Behavior

- The graph built from the current station discovery pass is the graph used for filtering questions in that same pass.
- If graph building returns an empty graph, same-train-line filters should skip gracefully with the existing warning behavior.
- The store should still be updated so the matching card can read the graph after render.
- No per-question train-line Overpass fallback should be reintroduced.

### TDD Red

Add a failing test before changing implementation.

Preferred unit/pure test:

- Extract the graph selection/filtering portion into a small helper if needed.
- Verify that when `previousGraph` is `null` but `freshGraph` contains line membership, same=true filtering keeps only stations on the selected line.
- Verify that the helper does not read stale store state when a fresh graph is supplied.

Preferred E2E regression:

- In `e2e/same-train-line.spec.ts`, seed a locked `same-train-line` question with `selectedTrainLineId: "relation/100"`.
- Mock station discovery to return at least three configured stations.
- Mock graph-building Overpass response so only two of those stations belong to `relation/100`.
- Load with `displayHidingZones: true`.
- Assert the actual hiding-zone result contains only the two selected-line stations on first load, without requiring a second refresh or user interaction.

The test must fail on the current branch because the first initialization pass uses stale `$transitGraph`.

### Green

Implementation direction:

- Introduce a local variable in `initializeHidingZones()`, for example `let currentTransitGraph: TransitGraph | null = null`.
- Assign it from `buildTransitGraphForStations(...)` before calling `transitGraph.set(currentTransitGraph)`.
- Use `currentTransitGraph` for same-train-line question filtering in the current initialization pass.
- Keep `transitGraph.set(null)` for custom-only/default-station-disabled paths and graph build failures.
- Avoid adding `$transitGraph` to the effect dependencies just to force a second pass; that risks extra expensive station discovery and hides the stale-read bug instead of fixing it.

### Acceptance Criteria

- A locked/shared same-train-line question filters hiding-zone stations correctly on first load.
- Same-train-line filtering uses the fresh graph from the current discovery pass.
- The matching card still receives the graph through the store after render.
- No exact-line Overpass request is made during ZoneSidebar same-line filtering.

## Finding 2: Strengthen ZoneSidebar Regression Coverage

### Problem

The current test named `C10: ZoneSidebar shows only selected-line stations` in [e2e/same-train-line.spec.ts](e2e/same-train-line.spec.ts) only checks the matching-card preview/dropdown. That preview reads `$transitGraph` after React rerenders, so it can pass even when ZoneSidebar skipped filtering during the original initialization pass.

### Expected Behavior

The regression test must assert the ZoneSidebar or map output produced by hiding-zone filtering, not just the matching card preview.

### TDD Red

Update or add an E2E test that observes one of these actual ZoneSidebar outputs:

- Hiding-zone station count/list text, if exposed in the sidebar.
- Rendered station markers/circles on the map, if testable with stable selectors.
- A small, targeted `data-testid` added to the ZoneSidebar station result/count UI if no accessible selector exists.

Recommended test shape:

1. Seed three stations: `Station Alpha`, `Station Beta`, `Station Gamma`.
2. Build a transit graph where `relation/100` contains only Alpha and Beta.
3. Seed a locked same-train-line question selecting `relation/100`.
4. Load the app with hiding zones enabled.
5. Assert the station preview says `Stations matched: 2`.
6. Assert the actual hiding-zone output also represents exactly two stations, and Gamma is absent from that output.

The important assertion is step 6. Step 5 alone is not enough.

### Green

- Add the smallest stable selector or accessible assertion needed to inspect the filtered hiding-zone result.
- Keep `data-testid` usage sparse and local to a genuinely hard-to-query result.
- Do not assert implementation details of Leaflet internals if a sidebar count/list assertion can cover the behavior.

### Acceptance Criteria

- The test fails if ZoneSidebar filtering skips same-train-line elimination while the matching-card preview still works.
- The test passes after Finding 1 is fixed.
- The test documents the Bug 2 first-load/shared-state path.

## Verification Commands

Run focused tests first:

```bash
pnpm vitest run src/maps/api/transitGraph.test.ts src/maps/geo-utils/transitGraph.test.ts
pnpm test:e2e e2e/same-train-line.spec.ts --grep "ZoneSidebar"
```

Then run the broader relevant suite:

```bash
pnpm test:e2e e2e/same-train-line.spec.ts
pnpm test
```

If tests fail under Node 25 with `localStorage.getItem is not a function`, rerun under a project-supported Node version (`<25`) before judging the branch.

## Out Of Scope

- Reworking the transit graph contract.
- Reintroducing per-question Overpass line expansion.
- Changing the matching card dropdown/preview behavior unless needed for test setup.
- Broad Leaflet rendering refactors.

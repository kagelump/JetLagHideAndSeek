# TASKS_1: Train line dropdown should respect active operator filter

## Source Bug

This design/task list implements the fix for
[BUG_1_train_line_dropdown_no_operator_filter.md](BUG_1_train_line_dropdown_no_operator_filter.md).

Bug summary: when a transit pass/operator filter is active, the "Station On Same Train Line" matching question still lists every nearby OSM rail line in the train line dropdown. In the Tokyo Metro Daypass repro, that lets users select JR, Seibu, Tobu, and other non-pass lines even though the hiding-zone station universe has already been filtered to Tokyo Metro coverage.

## Product And UX Intent

### Rule framing

The transit line matching question is not asking "which OSM tracks happen to be near this point?" It asks whether the seeker is on transit that would stop at the hider's station. The rulebook also says players should operate as if out-of-bounds locations do not exist. In this app, the active station set and transit-pass operator filter are part of that game boundary.

Therefore, a same-train-line question must use one consistent in-scope transit universe:

- The nearest seeker station is chosen from `$trainStations`.
- The line dropdown should show only lines compatible with the active operator/network filter.
- Auto-detect should choose only from those compatible lines.
- Station preview should describe only the in-scope chosen/autodetected line behavior.
- ZoneSidebar filtering should use the same line selection semantics as the card preview.

### Desired user experience

When a transit pass is active, the matching card should feel like it belongs to that pass:

- With Tokyo Metro Daypass active near Takadanobaba, the dropdown should show Tokyo Metro lines, not JR/Seibu/Tobu lines.
- The default "(auto-detect from nearest station)" mode should not silently pick a non-covered operator line.
- The station preview count/list should match the line that would actually be applied when the question is locked or when hiding zones are filtered.
- If no covered line can be found near the nearest station, the card should keep the auto option and show an empty state rather than exposing out-of-scope alternatives.
- The card should not add a second operator picker. Operator scope is configured globally in the hiding-zone/sidebar transit settings.

### Non-goals

- Do not redesign the whole matching card.
- Do not change the wire schema for `selectedTrainLineId` or `selectedTrainLineLabel`.
- Do not introduce fuzzy/alias matching beyond the app's current operator semantics.
- Do not hand-edit `dist/` or `server/dist/`.
- Do not require live Overpass data in tests.

## Current Architecture Notes

Relevant files:

- `src/components/cards/matching.tsx`
    - Computes nearest station from `$trainStations`.
    - Fetches dropdown options with `fetchStationTrainLineOptions(nearestTrainStationId)`.
    - Uses `trainLineNodeFinder(nearestTrainStationId)` for auto-detect station preview.
- `src/maps/api/overpass.ts`
    - `fetchStationTrainLineOptions()` queries route relations and railway ways near the nearest station without operator filtering.
    - `elementsToTrainLineOptions()` builds/dedupes/sorts dropdown options from Overpass tags.
    - `trainLineNodeFinder()` calls `fetchStationTrainLineOptions()` and selects the first relation option.
- `src/components/ZoneSidebar.tsx`
    - Discovers stations with `findPlacesInZone(..., $displayHidingZoneOperators)`.
    - Applies `matchesOperatorSelection()` as a post-filter for OSM station features.
    - Later applies same-train-line question filtering with `findNodesOnTrainLine()` or `trainLineNodeFinder()` without passing operator scope.
- `src/maps/geo-utils/operators-tags.ts`
    - Provides `matchesOperatorSelection()` and current exact operator/network matching semantics.
- `src/lib/transitPasses.ts`
    - Defines Tokyo Metro Daypass operator strings.
- `e2e/same-train-line.spec.ts`
    - Has existing fixtures that already include one matching operator line (`Test Line A`) and one non-matching line (`Test Line B`).

Important current behavior to preserve:

- Empty operator filter means no operator filtering.
- Editable selected lines are cleared when the nearest station changes and the selected line is no longer available.
- Locked shared questions preserve their saved `selectedTrainLineId`/`selectedTrainLineLabel`.
- Custom-only station lists are still unsupported for same-train-line filtering.

## Engineering Design

### Filtering model

Use the existing station operator matching model for train-line options:

- Match against OSM `operator` and `network` tags.
- Use case-insensitive exact matching through `matchesOperatorSelection()`.
- Treat an empty/blank operator list as unrestricted.
- Keep options with matching `operator` or matching `network`.
- Exclude options with no matching operator/network when a non-empty filter is active.

The recommended implementation is post-filtering Overpass elements before they become dropdown options. This keeps the Overpass query simple and avoids subtle query-builder regressions. The query already returns `out tags`, which is enough for post-filtering.

### API shape

Update APIs in `src/maps/api/overpass.ts`:

```ts
export const elementsToTrainLineOptions = (
    elements: any[],
    preferredRefs: string[] = [],
    operatorFilter: string[] = [],
): TrainLineOption[] => { ... };

export const fetchStationTrainLineOptions = async (
    stationOsmId: string,
    operatorFilter: string[] = [],
): Promise<TrainLineOption[]> => { ... };

export const trainLineNodeFinder = async (
    node: string,
    operatorFilter: string[] = [],
): Promise<number[]> => { ... };
```

Implementation detail:

- Import `matchesOperatorSelection` from `@/maps/geo-utils`.
- Inside `elementsToTrainLineOptions()`, after `id` and `hasRailLineTags()` checks, skip the element when `!matchesOperatorSelection(element.tags, operatorFilter)`.
- Keep the rest of the scoring, relation-over-way preference, label cleanup, and deduplication behavior unchanged.
- Pass `operatorFilter` from `fetchStationTrainLineOptions()` into `elementsToTrainLineOptions()`.
- Pass `operatorFilter` from `trainLineNodeFinder()` into `fetchStationTrainLineOptions()`.

### Matching card data flow

Update `src/components/cards/matching.tsx`:

- Import `displayHidingZoneOperators`.
- Read it with `useStore(displayHidingZoneOperators)`.
- Pass `$displayHidingZoneOperators` to every auto/options path:
    - `fetchStationTrainLineOptions(nearestTrainStationId, $displayHidingZoneOperators)`
    - `trainLineNodeFinder(nearestTrainStationId!, $displayHidingZoneOperators)`
    - auto label lookup through `fetchStationTrainLineOptions(nearestTrainStationId!, $displayHidingZoneOperators)`
- Add `$displayHidingZoneOperators` to the relevant `useEffect` dependency arrays.
- When a selected line is locked (`data.drag === false`), do not clear it just because it is absent from the filtered option list.
- When a selected line is editable and disappears from the filtered option list, keep the existing clear-and-`questionModified()` behavior.

Potential UX copy:

- If the filtered list has no eligible lines, leave the dropdown with only auto-detect and let the preview show "No stations found for this line".
- Optional small improvement: when `operatorFilter.length > 0` and there are no non-auto options, show "No covered train lines found near this station" in the preview/error area. Keep this subtle; do not add a large warning block.

### ZoneSidebar consistency

Update same-train-line filtering in `src/components/ZoneSidebar.tsx`:

- When `question.data.selectedTrainLineId` exists, keep using `findNodesOnTrainLine(question.data.selectedTrainLineId)`. A saved explicit line ID should remain authoritative.
- When auto-detect is used, call `trainLineNodeFinder(nid, $displayHidingZoneOperators)`.
- This makes auto-detected filtering match the card preview under a transit pass.

### Hider mode follow-up

`src/maps/questions/matching.ts` has a hiderification path that fetches generic stations with `findPlacesInZone("[railway=station]", ..., "node")` and uses unfiltered `trainLineNodeFinder()`.

Recommended v1 handling:

- Pass `displayHidingZoneOperators.get()` into the auto `trainLineNodeFinder()` call.
- Consider a separate follow-up bug for hiderification station discovery, because it currently does not use the same station universe as `$trainStations`/ZoneSidebar. This is adjacent but larger than the dropdown bug.

## Task List

### 1. Add train-line option filtering in the Overpass API layer

- [ ] Import `matchesOperatorSelection` in `src/maps/api/overpass.ts`.
- [ ] Add optional `operatorFilter: string[] = []` to `elementsToTrainLineOptions()`.
- [ ] Skip train line elements that do not match the active operator/network selection.
- [ ] Keep existing behavior unchanged when `operatorFilter` is empty.
- [ ] Add optional `operatorFilter` to `fetchStationTrainLineOptions()` and pass it through.
- [ ] Add optional `operatorFilter` to `trainLineNodeFinder()` and pass it through.

### 2. Wire active operators into the matching card

- [ ] Read `displayHidingZoneOperators` in `src/components/cards/matching.tsx`.
- [ ] Pass active operators into line dropdown fetching.
- [ ] Pass active operators into auto-detect node discovery.
- [ ] Pass active operators into auto-detect station-label preview discovery.
- [ ] Update effect dependencies so changing transit pass/operator settings refreshes the options and preview.
- [ ] Confirm editable invalid selections clear, while locked selections remain stable.

### 3. Wire active operators into ZoneSidebar auto-detect

- [ ] Update the same-train-line branch in `src/components/ZoneSidebar.tsx`.
- [ ] Pass `$displayHidingZoneOperators` to `trainLineNodeFinder()` for auto-detect.
- [ ] Leave explicit `selectedTrainLineId` behavior unchanged.
- [ ] Confirm custom-only station warning behavior is unchanged.

### 4. Apply a minimal hiderification consistency patch

- [ ] Import/read `displayHidingZoneOperators` in `src/maps/questions/matching.ts` if not already available.
- [ ] Pass `displayHidingZoneOperators.get()` to `trainLineNodeFinder()` in the same-train-line hiderification path.
- [ ] Do not redesign hiderification station discovery in this bug fix.

### 5. Add unit tests

- [ ] In `src/maps/api/overpass.test.ts`, add an `elementsToTrainLineOptions()` test where `operatorFilter: ["Test Metro"]` includes a line with `operator: "Test Metro"`.
- [ ] Add a test where a line with `network: "Test Metro"` is included.
- [ ] Add a test where a line with `operator/network: "Test Railway"` is excluded.
- [ ] Add a test that empty `operatorFilter` still returns both matching and non-matching operator lines.
- [ ] Ensure existing dedupe, label cleanup, route-master exclusion, and ref-priority tests still pass.

### 6. Add or update E2E tests

- [ ] Update `C1: Dropdown populates from nearest station` in `e2e/same-train-line.spec.ts` or add a new case specifically for operator filtering.
- [ ] With the default `baseSeed()` operator filter `zoneOperators: ["Test Metro"]`, assert `Test Line A` is visible and `Test Line B` is not visible in the dropdown.
- [ ] Add a separate unrestricted case with `zoneOperators: []` if preserving the old "both lines appear" behavior needs explicit coverage.
- [ ] Assert auto-detect preview still shows the `Test Line A` station list.
- [ ] Confirm selecting `Test Line A` still updates preview.
- [ ] Confirm selecting a non-matching line is impossible through the UI when the operator filter is active.

### 7. Run verification

- [ ] `pnpm vitest src/maps/api/overpass.test.ts`
- [ ] `pnpm test:e2e -- e2e/same-train-line.spec.ts`
- [ ] If touching hiderification tests or shared matching logic, run `pnpm vitest src/maps/questions/matching.test.ts`.
- [ ] If broader imports/types change, run `pnpm test`.

## Acceptance Criteria

- Under Tokyo Metro Daypass, the same-train-line dropdown near Takadanobaba excludes JR, Seibu, Tobu, and other non-Tokyo Metro lines returned by the nearby Overpass query.
- The dropdown still works without an operator filter and continues showing all nearby valid rail lines.
- Auto-detect never chooses a non-matching operator line while an operator filter is active.
- Station preview and ZoneSidebar same-train-line filtering agree for auto-detected lines.
- Explicit locked/shared selected line IDs continue to display and preview without being cleared by a later operator-filter refresh.
- Existing wire compatibility tests continue to pass.

## Risks And Edge Cases

- OSM tagging is inconsistent. Some valid pass services may lack `operator`/`network` tags or use aliases not present in `TOKYO_METRO_DAYPASS_OPERATORS`; those lines will be hidden by exact matching. This matches the current station filter tradeoff.
- Some through-service lines contain multiple operators in a semicolon-delimited tag. The Tokyo Metro profile already includes known semicolon combinations. Do not split or partially match semicolon lists in this fix unless the station filter is changed the same way.
- Ways near a station may represent physical track rather than a service pattern. Existing route relation preference and label dedupe should remain intact.
- If no relation survives filtering, auto-detect may return no nodes even if a physical way survives. This is acceptable for this bug because the rule is about stopping service, and relation data is the better proxy.

## Suggested Handoff Prompt For Implementation Agent

Implement `TASKS_1_train_line_dropdown_no_operator_filter.md`, using
`BUG_1_train_line_dropdown_no_operator_filter.md` as the bug report. Keep the fix scoped to active operator/network filtering for same-train-line dropdown, auto-detect, preview, and ZoneSidebar filtering. Reuse `matchesOperatorSelection()` semantics; do not change wire schema or redesign the card. Add focused unit and E2E coverage, then run the focused tests listed in the task doc.

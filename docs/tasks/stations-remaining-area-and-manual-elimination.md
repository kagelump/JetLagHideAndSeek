# Stations-Remaining Sheet: Per-Station Area % + Manual Elimination

**Status:** Design / ready for implementation
**Author:** design pass (for handoff to an implementing agent)
**Surface:** `station-detail` bottom-sheet route (the "Stations remaining" list)

---

## 1. Summary

Two related features on the **Stations remaining** sheet
(`src/features/sheet/StationDetailScreen.tsx`):

1. **Per-station "% area remaining."** For each station, show the percentage of
   that station's hiding circle that is still eligible (not greyed out by
   question constraints). Sort the list by **most area remaining → least**, with
   eliminated stations (0%) grouped at the bottom.

2. **Manual "eliminate this station" button.** Each row gets an action that marks
   the station as no longer a candidate — the seeker uses this to fold in
   information learned from photo questions ("the hider is clearly not at X
   station"). This is conceptually a _ghost question_ ("Are you at X station? →
   No") that removes that station's exclusive hiding area from the eligible zone.

Both features build on the existing elimination pipeline
(`useStationElimination`, `eliminationMath.ts`, `maskBuilder.ts`) — no new
geometry engine work, and (critically) **no second geometry pass**: the area %
is produced as a by-product of the per-station intersection the hook already
runs.

---

## 2. Background — how station elimination works today

Read these before implementing; the design reuses all of them.

- **`src/features/map/useStationElimination.ts`** — the hook + pure
  `computeStationElimination()`. For the current question set it builds the
  _combined eligibility mask_ (the grey-out / ineligible region), computes
  `eligibleFeature = boundary − mask`, then loops every station (clipped to the
  play-area bbox), builds the station's circle polygon, and checks
  `backend.intersection(circle, eligibleFeature)`:

    - non-null → station **remaining**
    - null → station **eliminated**
      Results are memoised in a module-level LRU (`resultCache`) keyed by a
      content signature (`buildCacheKey`) that already covers stations, radius,
      boundary and the full question render-state signature. The heavy compute is
      deferred off the render path via `InteractionManager` + `requestAnimationFrame`.
      There is a **fast path**: if a station's circle bbox doesn't intersect the
      mask bbox, it's marked remaining without any GEOS call.

- **`src/features/map/eliminationMath.ts`** — single source of constraint
  assembly. `buildEligibilityConstraints(zoneFeatures, renderState, overrides?)`
  returns `{ required, excluded }`. `required[0]` is **the hiding zone**
  (`zoneFeatures`); each question family folds in per `MASK_RULES` (hit masks =
  required/intersected, miss masks = excluded/subtracted). `eligibleArea()`
  (numerator) and `zoneBaselineArea()` (denominator) both currently take the
  same `zoneFeatures`. Consumed by `useEliminationPercentage`,
  `useQuestionElimination`, and `NativeMap`'s `combinedInsideMask`.

- **`src/state/hidingZoneStore.tsx`** — owns `selectedPresetIds`,
  `selectedRouteIds`, radius, and derives `selectedStations` (the candidate
  station list) and `zoneFeatures` (the merged station-circle polygons via
  `buildHidingZoneFeatureCollection`).

- **`src/features/sheet/StationDetailScreen.tsx`** — the list UI. Today it sorts
  remaining-first then alphabetical, renders route-color dots, station name, and
  an `ELIMINATED` badge.

- **`src/state/appState.ts`** (`appStateHidingZonesSchema`) + `src/sharing/`
  (`wire/schema.ts`) — persistence and share wire formats for hiding-zone setup.

Key semantic fact used throughout: a station's hiding contribution is its
geographic circle of `radiusMeters`. The eligible hiding zone is the **union of
all selected stations' circles**, intersected with the boundary and question
constraints.

---

## 3. Feature 1 — Per-station % area remaining

### 3.1 What to compute

For each station `i`, the **eligible fraction**:

```
fraction_i  = area( circle_i ∩ eligibleFeature ) / area( circle_i )
percent_i   = round(fraction_i * 100)
remainingM2 = area( circle_i ∩ eligibleFeature )
```

where `eligibleFeature = boundary − combinedMask` (already computed once per
`computeStationElimination` call).

- **Fast-path stations** (circle bbox disjoint from mask bbox) → `fraction = 1`
  (100%), `remainingM2 = area(circle_i)`. No extra work.
- **Slow-path stations** → we already compute `intersectionResult =
intersection(circle_i, eligibleFeature)`. Add an area measurement of that
  result and of the circle. **Zero extra GEOS ops** — `geomAreaM2`
  (`@/shared/geometry/parityMetrics`, already imported by `eliminationMath.ts`)
  is a pure-JS planar area calc. - `intersectionResult === null` → `fraction = 0` (eliminated). - else `fraction = geomAreaM2(intersectionResult.geometry) /
geomAreaM2(circle_i.geometry)`, clamped to `[0, 1]`.

> **Denominator decision (recommended: full circle area).** Using the full
> geographic circle as the denominator means edge/water stations whose circle
> spills outside the boundary read slightly **below 100% even at game start**.
> This is intentional and gameplay-honest: such a station genuinely has less
> viable hiding area, so it should sort lower. It also costs **zero** extra GEOS
> ops.
>
> _Alternative (baseline-relative):_ denominator = `area(circle_i ∩ boundary)`
> with no questions, so every station starts at exactly 100%. This needs one
> extra `intersection(circle, boundary)` per station, but it is independent of
> questions and can be cached separately (keyed on station-set + radius +
> boundary, not on the question render state). Only adopt this if "100% at
> start" semantics are required after review. The recommended v1 is the full
> circle denominator.

### 3.2 When to compute / where to remember it (the explicit ask)

**Compute it inside the existing `computeStationElimination` pass and cache it in
the existing `resultCache`.** Rationale:

- The per-station intersection is _already_ the dominant cost of that function;
  the area measurement is a free rider on work that must happen anyway.
- The result LRU already keys on every input that can change the number
  (stations, radius, boundary, question render-state signature), so the areas
  invalidate correctly and survive sheet remounts / navigation transitions.
- Computing "on sheet load" would either duplicate the whole mask + per-station
  loop (wasteful) or require a second cache; computing during the hero
  "stations remaining" count (which already runs whenever questions change,
  because `MainSheetContent` calls `useStationElimination`) means the numbers are
  usually **already cached** by the time the user opens the detail sheet.

So: extend the data the existing pass produces; do **not** add a new
computation trigger.

### 3.3 Data-model change

In `useStationElimination.ts`, extend the result type:

```ts
export type StationAreaInfo = {
    /** Eligible fraction of the station's circle, in [0, 1]. */
    fraction: number;
    /** Eligible area within the circle, m² (used as the sort key). */
    remainingM2: number;
};

export type StationEliminationResult = {
    remainingCount: number | null;
    totalCount: number;
    eliminatedStationIds: Set<string>;
    /** Per-station area info, keyed by station id. Empty while loading. */
    stationAreas: Map<string, StationAreaInfo>; // NEW
    isComputing: boolean;
};
```

Populate `stationAreas` in `computeStationElimination`:

- Empty/guard returns: `stationAreas: new Map()`.
- Empty-mask fast return (all remaining): set every clipped station to
  `{ fraction: 1, remainingM2: area(circle) }`. (Cheap — circle area can be
  computed analytically; see note below to avoid building polygons here.)
- Main loop: fill `fraction`/`remainingM2` per the rules in §3.1.

> **Avoid regressing the fast path.** Don't build a circle polygon just to get
> its area on the fast path. Either (a) compute the circle area analytically
> (`π * r²` is a fine approximation at these scales; for parity with `geomAreaM2`
> you may build the circle once and reuse it), or (b) since fast-path stations
> are all 100%, store `fraction: 1` and a `remainingM2` derived from a single
> shared `area(circle of radius r at this latitude)` — latitude variation across
> a city is negligible, so a single representative circle area is acceptable for
> a sort key. Pick (a) for correctness; document the choice.

### 3.4 UI change (`StationDetailScreen.tsx`)

- Replace the sort comparator. New order: **by `remainingM2` descending**;
  eliminated stations (those in `eliminatedStationIds`, i.e. `fraction === 0`)
  sink to the bottom; tie-break alphabetically by display name. Because
  eliminated = 0 m², a single descending sort on `remainingM2` already groups
  them last, but keep the explicit eliminated check first so manual eliminations
  (which may have non-zero geometric overlap area — see §4) still sink.

    ```ts
    const aElim = eliminatedStationIds.has(a.id);
    const bElim = eliminatedStationIds.has(b.id);
    if (aElim !== bElim) return aElim ? 1 : -1;
    if (!aElim) {
        const aM2 = stationAreas.get(a.id)?.remainingM2 ?? 0;
        const bM2 = stationAreas.get(b.id)?.remainingM2 ?? 0;
        if (aM2 !== bM2) return bM2 - aM2; // most area first
    }
    return displayName(a).localeCompare(displayName(b));
    ```

- Render the percentage on each remaining row (e.g. a right-aligned
  `42%` in a muted, tabular-nums style next to / replacing the chevron area).
  Hide or show `—` for eliminated rows (the `ELIMINATED` badge already conveys
  state). Keep `numberOfLines={1}` on the name and give the percentage a fixed
  min-width so rows align.

- While `isComputing` and `stationAreas` is empty, show the existing summary
  spinner; the list can render names without percentages (or a small per-row
  shimmer) until areas land. Don't block the whole list on the area numbers.

### 3.5 Tests (Feature 1)

Extend `src/features/map/__tests__/useStationElimination.test.ts`:

- A station whose circle is fully inside the eligible area → `fraction === 1`.
- A station half-covered by a radar-negative mask → `fraction ≈ 0.5`
  (assert within a tolerance; planar circle steps make it approximate).
- A fully covered station → in `eliminatedStationIds`, `fraction === 0`.
- `stationAreas` has an entry for every clipped station.
- Sort behaviour: add a `StationDetailScreen` render/unit test (or a pure
  helper test) asserting most-area-first ordering with eliminated last.

---

## 4. Feature 2 — Manual station elimination

### 4.1 Correct semantics — _why it's zone-reduction, not mask-subtraction_

The user's mental model is a "ghost question" that subtracts the station's circle
from the eligible area. A naïve implementation (treat it like a radar-negative:
subtract `circle_X` from the eligible region) is **geometrically wrong when
stations overlap**:

The hiding zone is the **union** of all station circles — the hider picks _one_
station and hides within R of it. Learning "the hider is not at station X" means
X is no longer a candidate, so its **exclusive** area is removed. But the overlap
region `X ∩ Y` is still viable _via Y_ (the hider could be "at Y"). Subtracting
the whole `circle_X` would wrongly delete that overlap.

The correct operation is therefore: **remove X from the active station set and
rebuild the zone union without it.** This automatically removes only X's
exclusive area and preserves overlaps contributed by other live stations. It is
also exactly equivalent to the user's "ghost question" intent, computed
correctly.

### 4.2 State model

Add a manually-eliminated set to **`hidingZoneStore`** (it's a hiding-zone
concept, persists with the zone setup, and feeds the same derivations as
`selectedStations`). Do **not** model it as a real `QuestionState` — questions
eliminate _area by rule_; this eliminates a _named candidate_, and forcing it
through the radar pipeline would reintroduce the overlap bug.

State additions in `HidingZoneProvider`:

```ts
const [eliminatedStationIds, setEliminatedStationIds] = useState<string[]>([]); // store as array for cheap persistence; expose as Set
```

Actions:

```ts
eliminateStation: (stationId: string) => void;     // add to set
restoreStation: (stationId: string) => void;       // remove from set (undo)
clearEliminatedStations: () => void;               // optional bulk reset
```

Expose on the **state** context: `eliminatedStationIds: string[]` (or a derived
`Set`). Add to `HidingZoneStateValue`, the `useMemo`, and the actions `useMemo`.

> **Housekeeping:** when a preset/route is removed and a station leaves
> `selectedStations`, prune it from `eliminatedStationIds` too (an effect that
> intersects the eliminated set with current `selectedStations` ids), so the set
> doesn't accumulate stale ids. Keep this in the store.

### 4.3 Derivation changes (the load-bearing part)

The clean way to make manual elimination **count as elimination progress**
(raise the hero "% eliminated", drop the remaining count, reshape neighbours on
the map) without breaking the baseline denominator is to expose **two** zone
collections from `useHidingZoneDerived`:

| collection                 | built from                                          | role                                               |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| `zoneFeatures` (existing)  | **all** `selectedStations`                          | elimination **baseline / denominator** (unchanged) |
| `activeZoneFeatures` (new) | `selectedStations` **minus** `eliminatedStationIds` | the required-zone **numerator** constraint         |

```ts
const activeStations = useMemo(
    () => selectedStations.filter((s) => !eliminatedSet.has(s.id)),
    [selectedStations, eliminatedSet],
);
const activeZoneFeatures = useMemo(
    () =>
        eliminatedStationIds.length === 0
            ? zoneFeatures // identity reuse → preserves existing cache hits
            : buildHidingZoneFeatureCollection(
                  activeStations,
                  zoneGeometryRadiusMeters,
              ),
    [
        zoneFeatures,
        activeStations,
        zoneGeometryRadiusMeters,
        eliminatedStationIds.length,
    ],
);
```

> The identity-reuse when nothing is eliminated is important: the module caches
> in `maskBuilder.ts` and `useStationElimination.ts` are keyed partly on object
> identity / feature counts, so reusing `zoneFeatures` keeps the common
> (no-manual-elimination) path on its existing cache entries.

`buildHidingZoneFeatureCollection` is already cached internally (component-level
overlap caching), so building the active zone is cheap and reuses sub-component
geometry.

### 4.4 Wiring `activeZoneFeatures` through the math

The existing functions already separate baseline from numerator, so this is a
matter of passing the right collection at each call site — **no signature
changes to `eliminationMath.ts`**:

- **`useEliminationPercentage.ts`**

    - denominator: `zoneBaselineArea(boundary, zoneFeatures)` — **full** zone (unchanged).
    - numerator: `eligibleArea(boundary, activeZoneFeatures, renderState)` — **active** zone.

- **`NativeMap.tsx` `combinedInsideMask`** (around line 250-260)

    - `buildEligibilityConstraints(activeZoneFeatures, renderState, overrides)` —
      use the **active** zone so the eliminated station's exclusive area greys out
      on the map.

- **`useStationElimination.ts`** (`computeStationElimination` + hook)

    - Pass `activeZoneFeatures` as the zone into `buildEligibilityConstraints`
      (the eligible region must exclude manually-eliminated exclusive area, so
      neighbours' percentages drop correctly).
    - Add a `manuallyEliminatedIds: Set<string>` parameter. In the per-station
      loop, **force** any station in this set to `fraction = 0`, `remainingM2 = 0`,
      and add it to `eliminatedStationIds` regardless of geometric overlap. (A
      manually-eliminated station may still geometrically overlap a live
      neighbour, so its raw `circle ∩ eligible` can be > 0 — the manual flag
      wins.)
    - Iterate the **full** `selectedStations` for display/count (so eliminated
      rows still appear), but build the eligible region from the **active** zone.
    - Extend `buildCacheKey` to include the manually-eliminated set signature
      (e.g. sorted ids joined, or `selectedStations.length` + eliminated count +
      a hash) so cached results invalidate when the set changes.

- **`useQuestionElimination.ts`** — per-question contribution stats. For
  correctness, pass `activeZoneFeatures` to the `eligibleArea(...)` numerator
  calls (lines ~115, 141-167) and keep `zoneBaselineArea(boundary, zoneFeatures)`
  as the full-zone denominator (line ~70). Note: per-question contributions will
  then **telescope to the question-eliminated total only**; the manual-
  elimination delta appears in the hero total but is not attributed to any single
  question. That's acceptable (manual elimination isn't a question). Call this
  out in a comment.

### 4.5 UI change (`StationDetailScreen.tsx`)

- Add a trailing action on each row:

    - For a **remaining** row: an "Eliminate" affordance (icon button, e.g. an ⊘ /
      cross-circle, or a small `Eliminate` text button). On press →
      `eliminateStation(station.id)`.
    - For a **manually-eliminated** row: show the `ELIMINATED` badge plus an
      "Undo / Restore" affordance → `restoreStation(station.id)`.
    - Distinguish _manually_ eliminated from _geometrically_ eliminated: a
      geometrically-eliminated station (0% from questions) shouldn't show a
      "Restore" button (there's nothing to restore — it's eliminated by the
      questions). Drive this off `eliminatedStationIds` (manual set) from the
      store vs `stationAreas`/the elimination result. Practically: read the
      manual set directly from `useHidingZoneState()` to decide which control to
      show.

- **Accessibility (required — see AGENTS.md "RN E2E and Accessibility"):** give
  each button a stable `accessibilityLabel` (e.g. `Eliminate ${name}` /
  `Restore ${name}`), `accessibilityRole="button"`, and a `testID`
  (`station-eliminate-${id}` / `station-restore-${id}`). Update Jest and any
  Maestro flow together if a flow touches this sheet.

- Confirm-before-eliminate? Eliminating is reversible (Restore), so a
  confirmation modal is **not** needed. Keep it one tap; the undo affordance is
  the safety net.

### 4.6 Persistence

Manual eliminations are session-meaningful game state and should survive app
restart (the seeker accumulates them over a game). Add to persistence:

- **`src/state/appState.ts`** — extend `appStateHidingZonesSchema`:

    ```ts
    eliminatedStationIds: z.array(z.string()).default([]),
    ```

    Add to `DEFAULT_HIDING_ZONES`, the `toImportState`/`appStateHidingZonesToImportState`
    mappers, and `HidingZoneImportState` (in `hidingZoneStore.tsx`) +
    `replaceSetup`. The schema is pre-launch and free to extend (no migration
    shim needed; `.default([])` covers old persisted blobs).

- **`src/state/persistence.ts`** — verify the hiding-zone slice flows through
  unchanged (it serialises the whole hiding-zone import state). No new wiring if
  the field rides along in `HidingZoneImportState`.

### 4.7 Sharing wire format — **decision needed (recommend: exclude for v1)**

`src/sharing/wire/schema.ts` carries `selectedPresetIds`/`radiusMeters` so a
shared link reproduces the hiding-zone _setup_. Manual eliminations are
_per-seeker investigative state_, not setup. **Recommendation: do not add
`eliminatedStationIds` to the share wire for v1** — keep shares describing the
game configuration, not one seeker's in-progress deductions. If later desired,
add it as an optional field (the minified codec in `wire/minified.ts` +
`FIELD_MAP` would need a new key). Leave a note; don't block on it.

### 4.8 Tests (Feature 2)

- **hidingZoneStore**: `eliminateStation`/`restoreStation` mutate the set;
  pruning effect drops ids no longer in `selectedStations`; `activeZoneFeatures`
  excludes eliminated stations and is identity-equal to `zoneFeatures` when the
  set is empty.
- **eliminationMath / overlap correctness** (the important one): two overlapping
  stations X and Y, eliminate X → the overlap region `X ∩ Y` stays eligible
  (because Y is still active); only X's exclusive area is removed. Assert via
  `eligibleArea`/area comparison. This guards against the mask-subtraction bug.
- **useStationElimination**: a manually-eliminated station is in
  `eliminatedStationIds`, `fraction === 0`, even if it overlaps a live neighbour;
  remaining count drops by exactly one; a live neighbour's `remainingM2`
  decreases by the lost exclusive overlap.
- **useEliminationPercentage**: eliminating a station with non-trivial exclusive
  area raises the hero `%` (baseline full-zone unchanged, numerator active-zone
  shrinks).
- **persistence round-trip**: `eliminatedStationIds` survives
  export → parse → import; old blobs without the field default to `[]`.

---

## 5. File-by-file implementation checklist

1. `src/features/transit/transitTypes.ts` — no change (station `id` is the key).
2. `src/state/hidingZoneStore.tsx`
    - state: `eliminatedStationIds`; actions `eliminateStation`,
      `restoreStation`, `clearEliminatedStations`; prune effect.
    - derived: `activeStations`, `activeZoneFeatures` (identity-reuse when empty).
    - extend `HidingZoneStateValue`, `HidingZoneDerivedValue`,
      `HidingZoneActionsValue`, `HidingZoneImportState`, and `replaceSetup`.
3. `src/features/map/useStationElimination.ts`
    - `StationAreaInfo` + `stationAreas` on the result.
    - area math in `computeStationElimination`; `manuallyEliminatedIds` param;
      build eligible from active zone; force manual stations to 0.
    - extend `buildCacheKey` with the manual-set signature.
    - hook: read `activeZoneFeatures` + `eliminatedStationIds` from the store and
      thread them in.
4. `src/features/map/useEliminationPercentage.ts` — numerator uses
   `activeZoneFeatures`; denominator stays `zoneFeatures`.
5. `src/features/questions/useQuestionElimination.ts` — numerators use
   `activeZoneFeatures`; denominator stays full zone; comment the telescoping
   caveat.
6. `src/features/map/NativeMap.tsx` — `combinedInsideMask` builds constraints
   from `activeZoneFeatures`.
7. `src/features/sheet/StationDetailScreen.tsx` — new sort, % display, eliminate/
   restore buttons with a11y labels + testIDs.
8. `src/state/appState.ts` — schema field + defaults + mappers.
9. Tests per §3.5 and §4.8.

> **Search for other `zoneFeatures` consumers** before finishing:
> `grep -rn "zoneFeatures" src/` and confirm each consumer wants the **full**
> baseline (denominator, map station rendering, share/export) vs the **active**
> numerator (eligibility mask). The four eligibility-mask consumers
> (useStationElimination, useEliminationPercentage, useQuestionElimination,
> NativeMap) switch to `activeZoneFeatures`; everything else keeps `zoneFeatures`.

---

## 6. Open decisions (resolve during implementation review)

1. **Area denominator** — full circle (recommended, zero-cost, edge stations
   start <100%) vs baseline-relative (every station starts 100%, +1 cached GEOS
   op/station). §3.1.
2. **Hero-% accounting** — recommended Z2 (full baseline + active numerator, so
   manual elimination raises the hero %). Simpler fallback Z1: make
   `activeZoneFeatures` the only zone everywhere (manual elimination drops count
   and reshapes the map but does **not** raise the hero %). §4.3-4.4.
3. **Share wire** — recommend excluding `eliminatedStationIds` from shared links
   for v1. §4.7.

These are the only choices that change observable behaviour; everything else is
mechanical. Recommended path: full-circle denominator, Z2 accounting, no share.

---

## 7. Validation

Per AGENTS.md:

```bash
pnpm typecheck
pnpm test            # jest + node --test (covers the new unit tests)
pnpm check           # lint + format + perf-typecheck + POI-selector drift (UI/state change)
```

The geometry backend isn't modified (only new _call sites_ of existing ops), so
`pnpm test:geos` / native GEOS suites are **not** required. If a Maestro flow
exercises the stations-remaining sheet, run the relevant flow (or
`gh workflow run "Maestro E2E" -f platform=ios -f flow=<name>`) since this
changes a native-accessible interaction surface (new buttons).
</content>
</invoke>

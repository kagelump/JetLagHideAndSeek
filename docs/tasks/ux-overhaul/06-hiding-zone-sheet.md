# Phase 6 — Hiding Zone sheet (+ operator → line drill-down)

Parent: `epic.md`. Applies the Phase 4 compact system. Reused as the second step
of the setup checklist (Phase 2). Contains the one non-trivial state change of
the epic.

## Goal

Compact, friendly hiding-zone setup that rests at 42%, **plus** the ability to
dive into an operator and pick **specific lines** rather than only whole
operators. Trial-and-error is first-class: toggle a line, watch zones update on
the map behind the sheet.

## Current state

- `HidingZoneScreen.tsx`: radius input + unit segmented control, a status card,
  a three-tier preset list (operators in play area / all-stations coverage /
  selected-elsewhere), and a **collapsed, undiscoverable "Browse all regions"**
  with search. Rows are tall (label + meta + Add/Remove button).
- Selection is **operator-granularity**: `selectedPresetIds: string[]`.

## Data model supports lines already (no pipeline change)

- `HidingZonePreset` (`hidingZoneTypes.ts`) carries `routes: TransitRoute[]`
  (id, name, color) and `stations: TransitStationContribution[]`, each station
  with `routeIds: string[]`.
- `getSelectedStations` (`hidingZone.ts:65`) already keys colors/concentric
  rings off route ids. So filtering an operator's stations down to chosen lines
  is purely a selection + derivation change.

## Scope

Layout follows the `HidingZoneSheet` mock (`design-reference/screens.mock.jsx`),
**with radius removed from the body** per the design review.

### Layout (top-to-bottom, 42%-resting)
1. **`SheetHeader`** with a **"…" overflow menu** accessory + a one-line
   explainer: "Pick which transit stations the hider can be near."
2. **Radius lives in the "…" menu**, not the body — a **number input + m/km/mi
   unit toggle** (canonical value stays in meters via `HidingZoneProvider`). It
   is a secondary control, so it should not occupy body space at 42%.
3. **Suggested operators (hero):** operators intersecting the play-area bbox as
   **condensed rows** matching the mock — leading **color dot** + name +
   `"N lines · N stations"` meta + a trailing **Add / Added ✓ chip** + active
   wash when on. Suggested default is *suggested*, **not** auto-selected (preset
   selection stays additive and user-driven). Each row also carries a
   **drill-in chevron** (see below).
4. **Browse all regions:** a second section (as mocked) / drill-in; its search
   may use 88%.
5. **Sticky footer:** Continue (setup) / done.

### Operator → line drill-down
- The trailing **Add / Added ✓ chip toggles the whole operator** (= all its
  lines), as in the mock.
- A **drill-in chevron pushes a line sub-screen** (reuse MainDrawer slide
  transition + edge-swipe-back). The chip and chevron are distinct hit targets;
  if both trailing affordances feel cramped at 42%, the chevron may move to a
  tap on the row body — decide during implementation, but keep "toggle all" and
  "pick lines" as separate gestures.
  - **"All lines"** toggle at top.
  - Compact colored line rows: `color swatch · line name · ✓`.
  - Selecting specific lines flips that operator from **All** to **Custom · N
    lines**, reflected on the operator row.

### Selection-state change (the one real engineering addition)
- Extend selection from `selectedPresetIds: string[]` to also track
  **per-operator route ids**, e.g.
  `selectedRouteIds: Record<presetId, string[]>` where *operator selected with
  no subset = all lines*.
- Add a `getSelectedStations` variant: for a line-subset operator, include only
  stations whose `routeIds` intersect the selection. All downstream behavior
  (colors, concentric rings, the additive "don't drop a station still
  contributed by another selection" rule) keeps working because it is already
  route-id based.
- Update the **share/wire schema** (`sharing/wire/schema.ts`) and the Zod
  app-state schema together. Pre-launch the schema may change without migration
  shims.

## Files likely touched

- `src/features/hidingZone/HidingZoneScreen.tsx` (layout + drill-in)
- `src/features/hidingZone/hidingZone.ts` (`getSelectedStations` variant)
- `src/state/hidingZoneStore.ts` (`selectedRouteIds`)
- `src/state/appState.ts`, `src/sharing/wire/schema.ts` (serialize route subset)
- Phase 4 shared components

## Acceptance criteria

- Common ops (toggle an operator, drill one operator's lines, nudge radius,
  confirm) complete at 42%.
- Selecting specific lines contributes only those lines' stations; zones update
  live on the map.
- Removing one operator/line does not drop a station still contributed by
  another selection (additive rule preserved).
- Interchange stations on multiple selected lines render concentric rings.
- Tests (Jest, on bundled fixtures, no network): station derivation for
  all-lines vs line-subset; additive removal; ring counts; wire round-trip of
  route-subset selection. `pnpm test` + `pnpm check`.

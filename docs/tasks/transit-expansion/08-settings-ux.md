# T8 — Settings UX: play-area-scoped preset picker + derived clipping

## Context

`HidingZoneScreen` currently renders every preset in two flat sections
("Suggested" via bbox intersection, "Other"). With Japan data that's 8 OSM
regional presets + a growing list of operators — and at Schengen scale it
would be hundreds. Design decision D5: scope the picker to the play area,
group by role, show in-play-area counts. Selection stays at **preset
granularity** (operator/network) — users never pick individual lines in
settings; the transit-line question already narrows lines by distance.

**Read first:** design.md "Settings UX"; current
`src/features/hidingZone/HidingZoneScreen.tsx`;
`getSuggestedPresetIds` in `hidingZone.ts`; AGENTS.md "Bottom Sheet Rules"
and "React Native E2E and Accessibility" (testID + Maestro discipline).

## What you'll build

### Derived data (in `hidingZone.ts` / store, pure + tested first)

1. **`getPresetPlayAreaStats(presets, playAreaBbox)`** → per preset:
   stations-in-bbox count (simple lng/lat-in-bbox check per contribution;
   memoize in the store — runs over ~9k contributions only when play area or
   loaded presets change).
2. **Preset classification**: a preset is **coverage** when
   `source.kind === "osm"` and it has no routes... careful — after T7 the
   OSM regional presets _do_ have routes. Classify instead by id prefix
   (`osm-<region>`) exposed as a `kind: "coverage" | "operator"` field on the
   manifest entry (add it in the pipeline emit stage — one line — rather
   than inferring in the app).
3. **`clipStationsToPlayArea(stations, playAreaBbox, radiusMeters)`** —
   filter derived `selectedStations` to the play-area bbox expanded by
   `radiusMeters` (so circles straddling the edge survive). Apply where
   `useHidingZoneDerived` computes `selectedStations`, **before** zones,
   overlays, and question masks. No play area → no clipping. This is a
   derived filter; stored selections are untouched.

### Screen changes (`HidingZoneScreen.tsx`)

4. **Scoped view (default when a play area exists):**
    - Section **"Operators in your play area"** — operator presets whose
      in-play-area station count > 0, sorted by that count descending. Each
      row: label, "`N` stations in your play area · `M` lines", Add/Remove
      (reuse `PresetRow`, extend its metadata line).
    - Section **"All stations"** — coverage preset(s) intersecting the play
      area, labeled "All stations in <label>".
    - Row **"Add all operators"** at the top of the operators section when
      ≥ 2 are unselected (selects every listed operator preset; never the
      coverage preset).
5. **Browse-all (collapsed by default):** a "Browse all regions" row
   expands to the full preset list grouped by bundle/locale with a simple
   case-insensitive search `TextInput` over `label`. This is also the whole
   view when no play area is set. Presets selected here but outside the play
   area still show under a small "Selected elsewhere" group in the scoped
   view so removal is always possible (preset selection must stay additive
   and reversible — AGENTS.md hiding-zone rules).
6. **Counts in the "Current" card:** keep showing merged-station count, now
   the clipped count, with the unclipped total in the metadata line when
   they differ ("213 of 9,012 stations in play area").

### Tests / E2E

7. Jest: stats function (counts, zero-count hidden); clipping (station on the
   boundary + radius margin survives; outside drops; no play area = no-op —
   and the transit-line mask from a clipped set still matches I-invariants
   for stations near the edge); screen render tests for grouping, sorting,
   "Add all", search filtering, "Selected elsewhere".
8. Maestro: update the hiding-zone flow — selectors for
   `hiding-zone-preset-<id>` rows must stay; add testIDs
   `hiding-zone-browse-all`, `hiding-zone-preset-search`,
   `hiding-zone-add-all-operators`. Number-pad/keyboard rules per AGENTS.md
   (search field: prefer tapping the next control, not keyboard-dismiss).
   Run `pnpm test:e2e:stack` or the GitHub Actions workflow (this is
   bottom-sheet + accessibility surface — final check on CI per AGENTS.md).

## Acceptance checklist

- [ ] With Tokyo play area: operators sorted by in-area count; "OSM Kantō"
      under "All stations"; a Kansai operator preset not shown (but findable
      via Browse all, and removable if selected)
- [ ] No play area: browse-all view renders directly; no crash, no empty
      scoped sections
- [ ] Map: selecting Japan-wide coverage with a Tokyo play area renders only
      clipped stations/zones; radar + transit-line questions consume the
      clipped set
- [ ] Accessibility labels on every new interactive row (lint passes —
      accessibility lint is the typecheck for this surface)
- [ ] `pnpm check` + `pnpm test` green; Maestro flow green on CI

## Out of scope

- Line-level selection, per-preset detail screens, locale management UI.
- Unloading bundles when the play area shrinks.

## Gotchas

- `SheetScrollView` only — don't nest a `FlatList` inside the sheet without
  checking the existing patterns; the preset list can be plain mapped rows
  (worst case this phase ≈ 30 rows; revisit at Schengen scale).
- Keep fixed snap points; the screen may need the large snap index before
  E2E interacts with the search field (Play Area screen precedent).
- iOS `TextInput` may not expose its testID when empty — give the search
  field a stable accessible parent (AGENTS.md E2E rules).
- Don't compute stats inside render — store-level memo, or the 9k-station
  scan runs on every keystroke of the search box.

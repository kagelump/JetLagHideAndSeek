# T4 — App merge changes: `nameEn`, source priority, memoized line options

## Context

Small, self-contained app task that prepares the runtime merge for
multi-source presets. After this task, GTFS contributions win name/coords
when both a GTFS preset and (later, T6) an OSM baseline preset contribute
the same station, and English names accumulate from any source.

**Read first:** design.md "Schema additions" and the merge-rules table;
`src/features/transit/transitTypes.ts`;
`getSelectedStations` in `src/features/hidingZone/hidingZone.ts`;
`src/features/questions/transitLine/transitLineQuestion.ts` and its detail
screen.

## What you'll build

1. **Types** (`transitTypes.ts`):
    - `nameEn?: string` on `TransitStationContribution` and `TransitStation`.
    - `export function sourcePriority(source: TransitSource): number` —
      `gtfs` → 0, `osm` → 1.
2. **`getSelectedStations`** (`hidingZone.ts`):
    - Sort a copy of the presets by `sourcePriority(preset.source)` before the
      existing loop (stable sort keeps config order within a kind — note this
      in a test, not a comment).
    - In the existing-station branch, add:
      `if (!existing.nameEn && station.nameEn) existing.nameEn = station.nameEn;`
    - In the new-station branch, carry `nameEn: station.nameEn`.
    - Everything else (routeIds/routeColors/sourceStationIds union, mergeKey
      keying) stays untouched.
3. **Memoize the transit-line options.** In
   `TransitLineQuestionDetailScreen.tsx`, `routeNames` and
   `getTransitLineOptions(...)` run on every render; at 9,000 stations that's
   a per-render full scan. Wrap both in `useMemo` keyed on
   `[selectedRoutes, selectedStations, question.center, radiusMeters]`.
   Don't change `getTransitLineOptions` itself.
4. **Display fallback (tiny).** Where station names render in hiding-zone
   and question UI, nothing changes — `name` stays primary. `nameEn` is not
   surfaced in UI this phase; it exists for conflation and future locale
   display. Add it to the station feature properties only if a test needs it
   — otherwise leave rendering alone.

## Acceptance checklist

- [ ] Jest (`src/features/hidingZone/__tests__/hidingZone.test.ts`):
    - [ ] GTFS-priority: an `osm`-kind preset listed _before_ a `gtfs`-kind
          preset in the input still yields GTFS `name`/`lat`/`lon` for a shared
          mergeKey, with routeIds unioned
    - [ ] `nameEn` from an OSM contribution survives onto a GTFS-based merged
          station; a GTFS `nameEn`, when present, wins (first non-empty in
          priority order)
    - [ ] Two same-kind presets keep deterministic (input) order
- [ ] Jest for the detail screen: existing tests still pass; add a render
      test asserting `getTransitLineOptions` isn't recomputed on an unrelated
      re-render (spy via module mock)
- [ ] `pnpm check` + `pnpm test` green (this is UI/state — run both per
      AGENTS.md)

## Out of scope

- Pipeline emission of `nameEn` (T2 did GTFS `translations.txt`; T6 adds the
  OSM attachment path).
- Any settings-screen work (T8).
- Play-area clipping of derived stations (T8, alongside the UI that explains
  it).

## Gotchas

- `getSelectedStations` is consumed by zone building, map overlays, radar
  nearest-station, and the transit-line question — change only what the task
  lists; if a test elsewhere breaks, that's signal, not noise.
- The hiding-zone feature caches (`zoneFeatureCache` etc.) key off station
  id + coords — they're unaffected by `nameEn`, don't touch them.

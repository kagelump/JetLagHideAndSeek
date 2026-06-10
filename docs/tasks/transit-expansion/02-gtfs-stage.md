# T2 — GTFS stage (generic feed processing + ODPT port)

## Context

This task makes the `gtfs` stage real. It ports what
`data/odpt/scripts/fetch-odpt.mjs` does for the two ODPT feeds **and** adds
the four behaviors generic feeds need (design doc, "GTFS preprocessing"):
parent-station collapsing, mode filtering with extended route types, line
grouping, and agency split. The output of this stage is in-memory
`HidingZonePreset`-shaped objects handed to the emit stage (T3).

**Critical compatibility requirement:** for the two ODPT feeds, the produced
presets must keep today's preset ids (`tokyo-metro`, `toei-subway`),
namespaces, and **identical canonical route ids**
(`gtfs:odpt-tokyo-metro:route:<route_id>` etc.). Users have persisted
questions whose `lineId` is one of these — see
`src/features/questions/transitLine/transitLineNormalization.ts`.

**Read first:** design.md "GTFS preprocessing", "Canonical Identity";
`data/odpt/scripts/fetch-odpt.mjs` end to end (it already does zip parsing,
stop_times → route↔stop joins, shape assembly, and the no-`shapes.txt`
fallback — reuse these by extraction, not copy-paste-divergence);
`src/features/transit/transitIdentity.ts`.

## What you'll build

`data/transit/scripts/lib/gtfs.mjs` with small pure functions, each
unit-tested against synthetic GTFS tables (arrays of row objects — see
`fetch-odpt.test.mjs` for the fixture style):

1. **`collapseParentStations(stops)`** — stops with a `parent_station`
   pointing at a `location_type=1` stop collapse into the parent (parent's
   id, name, coords represent the station). Stops without a parent pass
   through. Output: station-level stops + a `childToStation` map used by the
   stop_times join.
2. **`filterRoutesByType(routes, allowlist)`** — allowlist supports single
   values and ranges (`[0, 1, 2, [100, 117], [400, 404]]` style after config
   parsing). Buses (`3`, `700–716`) must not pass with defaults.
3. **`groupRoutesIntoLines(routes, lineGrouping)`** —
    - `route_id`: every route is its own line (ODPT behavior).
    - `short_name`: group by `(agency_id, route_short_name || route_long_name)`.
    - Line id anchor = lexicographically smallest member `route_id`
      (deterministic). Line name = the group's short/long name. Line color =
      first non-empty `route_color`, normalized via the existing
      `normalizeColor` logic.
4. **`splitByAgency(feedConfig, agencies)`** — when the feed config has a
   `presets:` list, partition lines/stations by `agency_id` into one preset
   per entry; otherwise one preset for the whole feed.
5. **Station records** — for each station-level stop served by ≥1 kept line:
    - `id` / `mergeKey`: `createGtfsStopId(namespace, stationStopId)` —
      **no coordinate suffix** (the old `stationKey` embedded coords; the new
      canonical id must not, per design doc "Canonical Identity")
    - `routeIds`: canonical line ids via `createGtfsRouteId(namespace, anchorRouteId)`
    - `nameEn`: from `translations.txt` if the feed has one (look up
      `table_name=stops, field_name=stop_name, language=en`), else leave
      undefined (OSM fills it later, T6)
6. **Stage wiring** — `gtfs` stage iterates `locale.gtfs`, downloads via the
   T1 cache helper, parses zips (reuse the zip/CSV parsing from
   `fetch-odpt.mjs` — extract it into a shared lib if needed), runs 1–5, and
   pushes presets + per-feed stats into `ctx`.

### Route geometry

Reuse the existing shape assembly **including the stop_times fallback** for
feeds without `shapes.txt` (the Tokyo Metro cached feed lacks it — this
fallback is load-bearing, see AGENTS.md "Hiding Zone Rules").

## Acceptance checklist

- [ ] Synthetic-fixture tests for each of functions 1–4, including: platform
      stops collapsing to a parent; a bus route filtered out; extended type
      `109` kept when allowed; two directional `route_id`s with one short
      name grouping into one line with a deterministic anchor; agency split
      producing two presets from one feed
- [ ] ODPT regression: run `pnpm data:transit -- --cache-only` (uses cached
      zips in `data/odpt/cache/` — point the feed cache lookup there or copy
      the zips) and diff the produced presets against
      `data/odpt/generated/hiding-zone-presets.json`: same preset ids, same
      route ids, same route count, same station count and names. Coordinates
      and mergeKeys **will** differ (mergeKey loses the coord suffix) — that
      is expected; everything else must match. Write a one-off comparison
      script or test for this and keep it in the repo
- [ ] No network in `node --test` suites
- [ ] `pnpm check` + `pnpm test` green

## Out of scope

- Writing `assets/transit/` output (T3 does emission).
- OSM anything (T5–T7). Conflation (T6) — this stage outputs GTFS-only
  presets whose station mergeKeys are GTFS canonical ids; T6 may later
  rewrite mergeKeys when a station has an OSM-anchored identity. Don't
  design for that here.

## Gotchas

- GTFS CSVs may have BOMs, quoted commas, and CRLF — make sure the parser
  you reuse handles them (it already does; don't write a new CSV parser).
- `route_short_name` can be empty while `route_long_name` is set, and vice
  versa. The grouping key must use the fallback chain, and an empty-empty
  route should fall back to `route_id` grouping for that route (log it in
  stats).
- `agency_id` is optional in single-agency feeds — treat missing as one
  implicit agency.
- Keep functions pure (tables in, records out); only the stage wiring does
  I/O. That's what keeps the tests synthetic and fast.

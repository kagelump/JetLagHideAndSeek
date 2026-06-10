# T7 — OSM route relations → lines

## Context

After T6, OSM-only areas have stations but no lines, so the transit-line
question is dead there. This task extracts OSM route relations and turns
them into lines with exact station membership — the highest-fidelity source
for "this transfer station is on lines A, B, and C" (invariant I2). Operator
gating (D3) decides whether a given operator's lines come from OSM or GTFS.

**Read first:** design.md "OSM route relations" and "Line conflation across
sources"; the OSM wiki pages for `route=train` and `route_master` (skim —
you need: a `route` relation is one directional/service variant; a
`route_master` groups the variants of one line; members have roles like
`stop`, `platform`, or empty for ways).

## What you'll build

1. **Extraction.** Per region:
   `osmium tags-filter <pbf> r/route=train,subway,light_rail,monorail r/route_master=train,subway,light_rail,monorail --add-referenced`
   then export. `--add-referenced` pulls in member ways/nodes so geometry and
   stop members resolve. Intermediates git-ignored, as in T5.
2. **Line assembly** (`lib/osmRoutes.mjs`, pure + tested):
    - Group `route` relations under their `route_master` (a master lists its
      variants as members). Masterless routes stand alone.
    - Line id: `osm:relation:<masterId>` (or the route relation id when
      masterless) — matches `isCanonicalTransitRouteId`.
    - Name: master's `name` (fall back to `ref`, then variant name). Color:
      `colour` tag (normalize `#`); fall back to preset defaultColor at
      render time (existing behavior).
    - **Station membership**: union of member nodes with role `stop` or
      `station` across all variants. Members are often `stop_position` nodes
      on the track, not the `railway=station` node — resolve each member to a
      T5/T6 station: exact node-id match first, else nearest station record
      within 100 m with a normalized-name match, else nearest within 30 m
      unconditionally (platform/stop positions sit inside the station). Log
      unresolved members.
    - Geometry: stitch member ways into a `MultiLineString`; where ways are
      missing/broken, fall back to the ordered stop sequence (same idea as the
      GTFS shapes fallback).
3. **Operator gating.** Each line gets an operator (relation `operator` tag,
   falling back to the master's `network` tag). Match against config
   `operators` declarations:
    - `routeSource: gtfs` → drop the OSM line (GTFS already provides it).
    - `routeSource: osm` or unmatched → keep, **but**: if a kept OSM line's
      operator also has a GTFS feed namespace in config, **fail the build**
      with a message telling the author to add the missing declaration
      (design D3 — overlap is a config error).
4. **Wire into presets.** Kept OSM lines join their region's baseline preset:
   `routes` gets the line (geometry + color + name); each member station's
   contribution in that preset gets the line's id appended to `routeIds`.
   Seeds from GTFS are unaffected (their operators are `routeSource: gtfs`).
5. **Report additions:** lines kept/dropped per operator; unresolved stop
   members; lines with < 2 resolved stations (suspicious — listed, and
   excluded from output).

## Acceptance checklist

- [ ] Synthetic-fixture tests: master with two directional variants → one
      line with unioned stations; masterless route → line; stop_position
      member resolving to the station node by name+distance; operator with
      `routeSource: gtfs` dropped; undeclared overlap fails the build;
      broken-way geometry falls back to stop sequence
- [ ] Full japan run: report lists major operators (JR East/Central/West,
      Tōkyū, Odakyū, Keiō, Hankyū…) with plausible line counts; regenerated
      bundles committed
- [ ] Jest over committed bundle data: pick one well-known transfer station
      (e.g. 渋谷) and assert its merged `routeIds` include the expected
      OSM-sourced lines (I2 spot check); transit-line options for an
      OSM-only area are non-empty
- [ ] App smoke: Osaka E2E fixture play area + "OSM Kansai" → transit-line
      question lists JR/private lines with sane closest-station distances
- [ ] `pnpm check` + `pnpm test` green

## Out of scope

- Adding GTFS feeds for the operators you now see in the report (T9).
- Any UI work. Tram/bus modes beyond the configured `routeTypes`.

## Gotchas

- OSM route data quality varies by line: some have complete `stop` members,
  some only ways. The < 2-stations exclusion keeps garbage out of the
  picker; check the report rather than "fixing" silently.
- One physical line can have **many** variants (rapid/local/branch services)
  under one master — union their stations; don't emit per-variant lines
  (breaks I3).
- `colour` is the British spelling in OSM. Some relations use `color` —
  accept both.
- Relations can span regions (Shinkansen, JR main lines). Extract per
  region but dedupe lines by relation id at the locale level; assign the
  line to the region containing its bbox center, same rule as presets. Its
  stations stay in their own regions' presets — a cross-region line's
  `routeIds` appearing on stations in two bundles is fine because lineIds
  are globally unique.

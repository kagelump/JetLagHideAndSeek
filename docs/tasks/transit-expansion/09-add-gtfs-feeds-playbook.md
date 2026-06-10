# T9 — Adding GTFS feeds: playbook (JR East first)

## Context

With T1–T7 done, adding an operator's GTFS feed is a **config change plus
review** — no pipeline code. This doc is the repeatable playbook; run it
first for JR East, then per operator. If any step requires touching pipeline
code, the pipeline is missing a generic feature — stop and file it against
the design doc instead of special-casing.

## Playbook (per feed)

1. **Find the feed.** Search the Mobility Database catalog
   (https://mobilitydatabase.org) for the operator. Record the `mdb-<id>`
   and the direct download URL. Japanese operators may also publish via
   GTFS-JP portals (ODPT, 公共交通オープンデータセンター) — prefer the most
   official source.
2. **License check (blocking).** Read the feed's terms. CC-BY / ODPT-style
   attribution terms are fine; NC or no-redistribution terms are **not**
   (we commit derived data to the repo and ship it in the app). Record the
   verdict in the config `license` field and `data/transit/sources.md`.
   When in doubt, ask — don't ship.
3. **Inspect the feed** (unzip into `data/transit/cache/`):
    - `routes.txt`: `route_type`s present? Branches/directions as separate
      `route_id`s with one `route_short_name`? → `lineGrouping: short_name`
      (default) vs `route_id`.
    - `stops.txt`: `parent_station` used? (Pipeline handles it — just note.)
    - `agency.txt`: multiple agencies? → `presets:` split list.
    - `translations.txt` present? (English names for free.)
4. **Config entry.** Add to `locales[japan].gtfs`:
   `id`, `label`, fresh `namespace` (e.g. `mdb-<id>-jr-east` — never reuse a
   namespace; lineIds are persisted in user data), `url`, `mdbId`,
   `routeTypes`, `lineGrouping`, `defaultColor`, `license`.
5. **Operator declaration (build will force this).** Flip the operator to
   GTFS:
    ```yaml
    - match:
          {
              gtfsNamespace: mdb-<id>-jr-east,
              osmOperator: ["JR東日本", "East Japan Railway Company"],
          }
      routeSource: gtfs
    ```
    The exact `osmOperator` strings come from the T6/T7 build report's
    operator list — copy them from there, don't guess spellings.
6. **Run + review.** `pnpm data:transit`. In the build report check:
    - the operator's OSM lines are now dropped, GTFS lines kept (no doubles —
      invariant I3)
    - near-miss list: the feed's stops should attach OSM records or match
      existing seeds plausibly; new near-misses at this operator's stations
      mean name normalization or an alias is needed
    - line count vs the operator's real network (JR East ≈ 70+ lines —
      single digits means the mode filter or grouping is wrong)
7. **Spot-check in app.** Play area covering the operator; select its preset;
   transit-line question at a known transfer station lists the expected
   lines once each, with colors.
8. **Commit** regenerated `assets/transit/`, config, `NOTICE.md` (generated),
   `sources.md`. PR description includes the report diff summary.

## Acceptance checklist (for the JR East instance of this playbook)

- [ ] License verdict recorded; NOTICE regenerated
- [ ] Build passes with the operator declaration (and fails informatively if
      you temporarily remove it — verify once, it's the D3 guard)
- [ ] Report reviewed: no I3 doubles, near-misses triaged, plausible line
      count
- [ ] Jest over committed bundles: a JR East transfer station's `routeIds`
      include JR lines exactly once
- [ ] `pnpm check` + `pnpm test` green

## Notes for future locales

The same playbook is the entire process for London (TfL feed), Taipei
(TDX), SF Bay Area (511.org + `presets:` agency split), and Schengen feeds —
plus a new `locales:` entry (regions, `nameSuffixes`) the first time a
locale is touched. Extended `route_type` values (100–117 rail, 400–404
metro) show up in European feeds; they're already in the default allowlist.

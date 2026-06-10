# Epic: Transit Station Expansion (Japan)

Expand transit hiding-zone presets from Tokyo Metro + Toei (334 stations) to
all of Japan (~9,000 stations), with a locale-generic pipeline ready for
London / Taipei / SF Bay Area / Schengen later.

**Read [design.md](design.md) first.** Every task below assumes you have. The
non-negotiables are the four correctness invariants (I1–I4) and the six
locked decisions (D1–D5) in that doc — if an implementation choice seems to
conflict with one, stop and ask, don't improvise.

## Who this is for

Junior engineers, working mostly independently, one task per PR. Each task
doc tells you: the context, exactly what to build, which files to touch, how
to test it, and what is explicitly out of scope. If you finish a task and
`pnpm check` + `pnpm test` aren't both green, the task isn't done.

## House rules (apply to every task)

- Commands run from the repo root. `pnpm check` does **not** run jest — run
  `pnpm test` too.
- Pipeline code is plain Node (`.mjs`) with `node --test` suites, wired into
  `pretest` like the existing `data/geofabrik` and `data/odpt` scripts. Look
  at `data/odpt/scripts/fetch-odpt.mjs` + `fetch-odpt.test.mjs` for the
  house style.
- Pipeline outputs under `assets/transit/` are **committed** — CI cannot
  regenerate them (no PBF/GTFS downloads in CI). Heavy intermediates and
  caches are git-ignored.
- Never hand-edit generated files. If a generated file looks wrong, fix the
  generator.
- App code follows the existing feature-folder layout; tests use the shared
  mocks in `jest.setup.ts`.
- Don't change the share wire format or persisted app-state schema in any of
  these tasks. If a task seems to require it, stop and ask.

## Task list and order

```
T1 ──▶ T2 ──▶ T3 ──▶ T4 ──────────────▶ T8 (settings UX)
              │
              └──▶ T5 ──▶ T6 ──▶ T7 ──▶ T9 (feeds playbook)
                                        T10 (retire ODPT, last)
```

| #   | Task doc                                                               | Summary                                                                                                   | Depends on          |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------- |
| T1  | [01-pipeline-scaffold.md](01-pipeline-scaffold.md)                     | `data/transit/` skeleton: config loader, CLI, cache, NOTICE, test harness                                 | —                   |
| T2  | [02-gtfs-stage.md](02-gtfs-stage.md)                                   | GTFS extraction with parent-station collapse, mode filter, line grouping, agency split; ODPT feeds ported | T1                  |
| T3  | [03-bundles-and-lazy-loading.md](03-bundles-and-lazy-loading.md)       | Per-region bundles + manifest + generated require map; app loads lazily by play-area bbox                 | T2                  |
| T4  | [04-app-merge-and-types.md](04-app-merge-and-types.md)                 | `nameEn`, `sourcePriority`, merge changes, memoized line options                                          | T3                  |
| T5  | [05-osm-station-extraction.md](05-osm-station-extraction.md)           | OSM station-node extraction per region                                                                    | T1                  |
| T6  | [06-conflation-and-build-report.md](06-conflation-and-build-report.md) | Seed/attach conflation (wikidata + name + distance), aliases, build report                                | T2, T5              |
| T7  | [07-osm-route-relations.md](07-osm-route-relations.md)                 | OSM route relations → lines (route_master grouping, operator gating)                                      | T6                  |
| T8  | [08-settings-ux.md](08-settings-ux.md)                                 | Play-area-scoped preset picker + derived-station clipping                                                 | T4                  |
| T9  | [09-add-gtfs-feeds-playbook.md](09-add-gtfs-feeds-playbook.md)         | Config-only playbook for adding feeds (JR East first)                                                     | T7                  |
| T10 | [10-retire-odpt.md](10-retire-odpt.md)                                 | Fold `data/odpt/` into `data/transit/`, delete old path                                                   | T9 shipped + soaked |

T4/T8 (app track) and T5/T6/T7 (OSM track) can proceed in parallel after T3.

## Milestones

- **M1 (after T3):** App loads ODPT presets from the new manifest. Behavior
  identical for Tokyo users. Old ODPT pipeline still in place, untouched.
- **M2 (after T6):** "OSM Kantō" baseline preset selectable; Ōtemachi-class
  transfer complexes appear per-line (D2) with no route-less twins (I1).
- **M3 (after T7 + T8):** Transit-line question works on OSM-sourced lines
  (e.g. a JR line in Kansai); settings stay navigable with 30+ presets.
- **M4 (after T9):** Major Japanese operators covered; each new feed is a
  config diff.

## Definition of done (every task)

1. `pnpm check` and `pnpm test` green.
2. New pipeline logic has `node --test` coverage with **synthetic fixtures**
   (small hand-written GTFS tables / OSM extracts in the test file or a
   `fixtures/` dir) — never network, never the 450 MB PBF.
3. Regenerated `assets/transit/` artifacts committed when the pipeline
   changed.
4. The build report (T6+) has no new unexplained warnings.
5. Task doc's acceptance checklist all ticked in the PR description.
6. For UI tasks: testIDs stable, Maestro flows updated together with Jest,
   and `docs/implementation_notes.md` updated if you learned a durable
   native/E2E fact.

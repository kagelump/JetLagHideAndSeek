# Epic: Offline Data Packs

Make the app playable in any OSM-supported country with no live
Overpass/Photon dependency: downloadable per-region packs (POIs, measuring
lines, admin boundaries + offline play-area search, transit stations), blobs
on GitHub Releases, catalog on a GitHub Pages branch — all in this repo.

**Read [design.md](design.md) first.** Every task below assumes you have.
The non-negotiables are in its Decisions table — in particular: tiles are
never packaged, Japan stays bundled, packs are catalog entries grouping
per-class artifacts (not archives), and there is **no backwards-compatibility
requirement** before launch (schemas may break freely; wipe-and-redownload is
an acceptable migration).

## Who this is for

Junior engineers, working mostly independently, one task per PR. Each task
doc tells you: the context, exactly what to build, which files to touch, how
to test it, and what is explicitly out of scope. If you finish a task and
`pnpm check` + `pnpm test` aren't both green, the task isn't done.

## House rules (apply to every task)

- Commands run from the repo root. `pnpm check` does **not** run jest — run
  `pnpm test` too.
- Pipeline code is plain Node (`.mjs`) with `node --test` suites, wired into
  `pretest` like the existing `data/geofabrik` and `data/transit` scripts.
  Look at `data/transit/scripts/` for the house style.
- Pack artifacts are **not** committed — they are built locally into the
  git-ignored `data/packs/dist/` and published to GitHub Releases. This is
  different from `assets/poi`/`assets/measuring`/`assets/transit`, which stay
  committed and bundled (design decision: Japan stays bundled).
- Never hand-edit generated files. If a generated file looks wrong, fix the
  generator.
- App code follows the existing feature-folder layout; tests use the shared
  mocks in `jest.setup.ts`. Networked paths (catalog fetch, downloads) are
  mocked in Jest — no live calls in tests.
- The existing single-class POI pack system (`regionPacks.ts`,
  `OfflineDataScreen`) is the foundation. Extend it; don't build a parallel
  one. Since there are no users, you may change its storage layout and
  schemas without migration code.
- **Registration APIs share one shape.** Every `register*Source` function a
  loader exposes for the installer (T3 measuring, T7 boundaries, T9
  transit) takes `packId: string` first and a bare `path: string` (the
  uncompressed `.json` under `Document/packs/<packId>/`) — never a wrapper
  object, never a parsed payload (unless the task doc says otherwise, e.g.
  T9's preset summaries). If two task docs seem to disagree on a signature,
  this rule wins; flag the doc.
- **Installer-touching tasks land serially.** T5 owns the installer's
  per-kind `switch`; T7 and T9 each fill in one case of it. Don't start T7
  or T9 until T5 is merged, and don't run T7 and T9 against the same base
  concurrently — they edit the same switch and the second PR eats a rebase.
  (The one-case-per-kind design keeps those rebases trivial, but they're
  still rebases.)
- Don't change the share wire format or persisted question/play-area state
  schema in any of these tasks. If a task seems to require it, stop and ask.

## Milestones and task order

```
M1 ─ pilot region, POI + measuring, hosting end-to-end
     T1 ──▶ T2 ──▶ T4 ──▶ T5
     T1 ─┬▶ T3 ──────────▶ T5
     T2b ┘   (T2b is a standalone refactor; it also feeds T6 in M2)

M2 ─ boundaries + fully-offline play-area setup
     T6 ──▶ T7 ──▶ T8      (T6 needs T1 + T2b; T7 needs T5)

M3 ─ transit + coverage UX
     T9 ──▶ T10            (both need T5; T10 also needs T7)
```

M2 depends on M1 (T6 emits through the T1 scaffold; T7 installs through T5).
M3 depends on M1; T10 also touches T7's play-area flow. T2b can start
immediately, in parallel with T1.

| #   | Task doc                                                                               | Summary                                                                                                 | Depends on |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| T1  | [01-pack-pipeline-scaffold.md](01-pack-pipeline-scaffold.md)                           | `data/packs/` skeleton: `regions.yaml`, CLI, dist layout, hashes, pack-lint, test harness               | —          |
| T2  | [02-poi-artifacts.md](02-poi-artifacts.md)                                             | Generalize the Geofabrik POI extraction beyond Japan; emit per-region `poi` artifacts                   | T1         |
| T2b | [02b-measuring-extract-refactor.md](02b-measuring-extract-refactor.md)                 | Split `extract-measuring-bundles.mjs` into lib modules, golden-output guarded — no behavior change      | —          |
| T3  | [03-measuring-artifacts-and-lazy-loader.md](03-measuring-artifacts-and-lazy-loader.md) | Per-region measuring artifacts; app loads measuring bundles lazily from packs (FS, not require)         | T1, T2b    |
| T4  | [04-catalog-v2-and-publish.md](04-catalog-v2-and-publish.md)                           | Catalog schema v2, `gh-pages` branch, release publish tooling                                           | T2         |
| T5  | [05-app-pack-install-v2.md](05-app-pack-install-v2.md)                                 | Multi-artifact pack install/remove in the app; Offline Data screen v2; ship the pilot region            | T3, T4     |
| T6  | [06-boundary-extractor.md](06-boundary-extractor.md)                                   | `boundaries` artifact: delta-encoded polygons (default levels 4/7/9/10 + play-area levels) + name index | T1, T2b    |
| T7  | [07-offline-play-area-setup.md](07-offline-play-area-setup.md)                         | Offline play-area search + relation loading from installed packs                                        | T5, T6     |
| T8  | [08-admin-division-integration.md](08-admin-division-integration.md)                   | Pack `meta.adminLevels` drives admin-division defaults and pack-backed admin matching                   | T7         |
| T9  | [09-transit-artifacts.md](09-transit-artifacts.md)                                     | OSM-only transit station artifacts; manifest merge into hiding-zone presets                             | T5         |
| T10 | [10-coverage-ux.md](10-coverage-ux.md)                                                 | `coverageStatus` selector, settings badge, download prompt, update check                                | T5, T7     |

## Milestone exit criteria

- **M1**: a phone with the Netherlands pack installed can run matching and
  measuring questions there with Wi-Fi off (play area set up online
  beforehand). Catalog served from GitHub Pages; artifacts from a `packs-*`
  release on this repo.
- **M2**: same phone, full reset, airplane mode after install: search
  "Utrecht", select it as play area, admin-division matching works at the
  configured levels. Add a non-Latin pilot (Taiwan) to stress the name index.
- **M3**: hiding-zone presets appear for pack regions; leaving pack coverage
  shows the settings badge and a download prompt; "Check for updates"
  detects a republished epoch.

## Related docs

- [design.md](design.md) — the agreed design (decisions, pack model, catalog
  schema, sizing). Canonical copy of `docs/offline-data-packs.md`.
- [../admin-boundaries-delta-encoding.md](../admin-boundaries-delta-encoding.md)
  — the delta-encoding format T6 implements (note its resolution:
  length-prefixed rings, not the null sentinels in the doc body).
- `docs/buglist1.md` — items this epic resolves: offline data packs, auto
  pack discovery + red (!) badge, admin-level country defaults.
- `docs/tasks/transit-expansion/` — house style this epic follows; T9 builds
  on its OSM station pipeline.

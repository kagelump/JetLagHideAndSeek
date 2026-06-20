# Epic: Offline Data Packs — status

Make the app playable in any OSM-supported country with no live Overpass/Photon
dependency: downloadable per-region packs (POI, measuring, admin boundaries +
offline play-area search, transit) with blobs on GitHub Releases and a catalog
on GitHub Pages.

**Canonical design:** [../../offline-data-packs.md](../../offline-data-packs.md).
Binding runtime rules: `AGENTS.md` → "Offline Pack Rules".

## Shipped (M1–M3)

Milestones M1 (pilot region + POI/measuring + hosting), M2 (boundaries + offline
play-area setup + admin divisions), and M3 (transit stations + coverage UX) all
landed. Packs are actively built and published — see the live
`Update packs catalog for …` commits and `site/packs/catalog.json`. The original
per-task breakdown docs (T1–T12) were removed in the 2026-06-20 docs cleanup;
recover from git history if you need them. Durable decisions are in
`../../offline-data-packs.md` and `../../implementation_notes.md`.

> Note: this epic originally assumed "Japan stays bundled". That was later
> reversed — **all** game data including Japan now ships via packs; only the
> Tokyo boundary placeholder is committed. See `AGENTS.md` → "Offline Pack
> Rules" for the current model.

## Open

Tracked in [../../open-work.md](../../open-work.md):

- **T13** — [transit routes in packs](13-transit-routes-in-packs.md) (pack
  transit is stations-only today).
- **T14** — [transit station + route quality](14-transit-station-route-quality.md).
- **T18** — [way-geometry everywhere](18-way-geometry-everywhere.md), plus
  [15-geos-dissolve-memory](15-geos-dissolve-memory.md),
  [16-railway-infrastructure-routes](16-railway-infrastructure-routes.md),
  [16b-transit-color-and-unopened-fixes](16b-transit-color-and-unopened-fixes.md),
  [16-station-diff](16-station-diff.md).

The admin-boundary delta-encoding format T6 implemented is documented in
[../admin-boundaries-delta-encoding.md](../admin-boundaries-delta-encoding.md)
(note its resolution: length-prefixed rings, not the null sentinels in the doc
body).
</content>
</invoke>

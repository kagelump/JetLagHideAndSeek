# T9 — Transit artifacts (OSM-only stations) + preset merge

## Context

Hiding-zone presets outside Japan come from OSM only (design decision:
stations first; route lines best-effort until the osmRoutes geometry
stitching is fixed — see `docs/buglist1.md` Train lines). The transit
pipeline (`data/transit/`) already has the OSM extraction path: station
nodes, operator normalization, per-operator presets — it's what produced the
`osm-japan-*` presets in `assets/transit/`. This task runs that path for
pack regions and merges installed transit bundles into the app's preset
system.

Read first: `data/transit/scripts/` (the OSM stages),
`assets/transit/manifest.json` (bundle + preset shape),
`src/features/hidingZone/hidingZoneData.ts` (`loadHidingZonePresets`,
`getTransitManifest`) and `transitBundles.generated.ts` (the require map —
packs must NOT be added here; it's for bundled assets only).

## What to build

### 1. Pipeline: `transit` artifact builder

Replace the T1 stub by invoking the transit pipeline's OSM-only path for
the region PBF:

- Output `dist/<region-id>/transit.json.gz` with the **same schema as
  committed transit bundles** (stations with `mergeKey`/routeIds/colors,
  routes, per-operator presets + a coverage preset, attribution block).
- Set route geometry handling per the decision: keep whatever line geometry
  the OSM path produces today (best-effort), but presets and stations are
  the contract. Don't block this task on route-line quality.
- Reuse the existing locale config defaults (`maxClusterMeters` etc.);
  expose per-region overrides via `regions.yaml` (`transitOverrides`) for
  the clustering knobs — defaults must work unconfigured.
- `meta.json` gains nothing new; the artifact's presets carry their own
  bboxes (like the committed manifest entries).
- pack-lint: stations have finite coords inside region bbox (same slop rule
  as T2), every preset references ≥1 station, station count > 0 when the
  artifact is enabled.

### 2. App: merge installed transit bundles into presets

`hidingZoneData.ts` currently resolves bundles from the generated require
map by play-area bbox. Add the pack source (fill T5's installer TODO):

```ts
export function registerTransitSource(
    packId: string,
    path: string, // FS path to the UNCOMPRESSED transit.json under Document/packs/<packId>/
    presetSummaries: TransitPresetSummary[], // id, label, bbox, kind — parsed at install
): void;
export function unregisterTransitSource(packId: string): void;
```

- At install, parse the bundle **once** to extract preset summaries (small),
  persist them in the installed index entry (T5 schema: stash under the
  artifact entry) so startup needs no file read.
- `loadHidingZonePresets(playAreaBbox)` consults bundled manifest ∪
  registered pack summaries; when a pack preset's bbox intersects, lazily
  read + parse the pack file (cache like the bundled path — follow
  `clearTransitBundleCache` conventions so tests can reset).
- Preset ids must not collide across packs/bundled. The prefixing is
  **app-side, not pipeline-side**: the artifact keeps plain preset ids
  (schema-identical to bundled bundles, which is the point), and
  `registerTransitSource` transforms every preset id to
  `` `${packId}:${presetId}` `` at registration (`europe-netherlands:osm-ns`).
  This is deterministic — same pack + same artifact ⇒ same prefixed ids —
  so persisted selected-preset ids survive remove/reinstall. The `:`
  separator is safe because pack ids and preset ids are both
  kebab-alphanumeric; enforce that anyway: pack-lint rejects preset ids
  containing `:`, and `registerTransitSource` throws on one (belt and
  braces — a colon-bearing id would make the prefix ambiguous to split).
- Removing a pack with selected presets: drop those ids from the hiding
  zone selection (the store already handles additive preset selection —
  extend `hidingZoneStore` carefully and test that removing one pack's
  preset doesn't drop stations contributed by a still-selected preset; that
  invariant is an AGENTS.md Hiding Zone Rule).

## How to test

`node --test` (pipeline): fixture PBF with a small rail network → presets
per operator + coverage preset, station schema matches the committed bundle
schema (reuse the transit pipeline's existing schema assertions if present).

Jest (app):

- Register a fixture transit source: presets appear for an intersecting
  play-area bbox and not for a disjoint one; bundle file parsed only on
  first intersecting load (spy on the FS mock).
- Id prefixing: selection round-trips through persistence; no collision
  with a same-named bundled preset.
- Pack removal: selection drops only the removed pack's presets; the
  shared-station invariant test (station kept while another selected preset
  still contributes it).

Manual: NL pack on device — Hiding Zones suggests Dutch operator presets
for an Amsterdam play area; selecting one renders stations + zone circles;
radar's "nearest station" line shows a sane NS station. (Wi-Fi off.)

## Out of scope

- Fixing OSM route-line geometry (tracked in buglist Train lines), GTFS
  feeds outside Japan, coverage UX (T10).

## Done when

- NL transit artifact builds + lints; presets appear and work offline on
  device.
- Hiding-zone invariants hold under pack add/remove (tests prove it).
- `pnpm test` + `pnpm check` green.

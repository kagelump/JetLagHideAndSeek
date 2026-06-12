# T14 — Transit station + route quality (design spec)

> Approved source: `docs/tasks/offline/14-transit-station-route-quality.md`

## Goal

Improve the quality of offline-pack transit artifacts and the shared transit pipeline by: filtering non-rail stations, attaching route colors across operator boundaries, collapsing per-train route proliferation, and providing deterministic line coloring. Changes are made in the shared transit library so Japan bundles benefit too.

## Architecture

The work is split between the **shared transit primitives** (`data/transit/scripts/lib/`) and the **pack artifact builder** (`data/packs/scripts/lib/buildTransit.mjs`):

- Shared primitives (`osmStations.mjs`, `osmRoutes.mjs`, new `attachRoutes.mjs`) own station mapping/dedup, route processing/master grouping, and the global routeId attachment that connects routes to station copies in every relevant preset.
- `buildTransit.mjs` stops reimplementing station logic and calls the shared primitives, passing per-region `transitOverrides` from `regions.yaml`.
- Color resolution is unified: OSM tag → `transitOverrides.routeColors` → deterministic hue fallback keyed by line key → final `#1f6f78` only for stations with no routes.

## Components & data flow

1. **Station ingestion**

    - `buildTransit.mjs` replaces `mapStationRecord` with shared `mapOsmNode`, which enforces the `railway` gate and emits normalized names/variants.
    - Replaces crude `name|lat|lon` dedup with shared `dedupeOsmStations` (id → wikidata → normalized-name within `maxClusterMeters`).
    - Per-region `transitOverrides.nameSuffixes` (Taiwan `["站", "車站"]`, NL `[]`) wired into mapping and dedup.

2. **Global routeId attachment**

    - New shared helper `attachRoutesToPresets(presets, lines, normalizeOp)`.
    - Places each route line into the preset matching its normalized operator (existing behavior).
    - Adds the route's `routeId` to every member station copy in every preset that contains the station (operator presets + coverage), keyed by `sourceId`/`mergeKey`.

3. **Masterless route collapse**

    - Extend `processOsmRoutes` to group masterless routes by `normalizeOp(operator)` + `lineNameKey(name)`.
    - `lineNameKey` strips configurable direction tokens and train numbers (defaults cover CJK + English).
    - Per group: union `memberStationIds`, keep one representative geometry/name, resolve color.

4. **Color resolution**

    - Order: OSM `colour`/`color` → `transitOverrides.routeColors` line/operator override → deterministic hue hash from line key → `#1f6f78` last-resort station fallback.
    - Add `routeColors` map to `regions.yaml` for Taiwan majors.

5. **Validation**
    - `pack-lint`: route count per operator within sane bounds, valid hex colors, build log shows non-rail skips.
    - `node --test` pack tests for non-rail drop, cross-operator attach, masterless collapse, color resolution.
    - Japan regression: `pnpm test:data:transit` green + per-bundle route-count diff reviewed.

## Out of scope

- Route-line geometry stitching / zigzag fix.
- bbox → boundary-polygon clipping.
- GTFS feeds outside Japan; coverage UX.
- Full Japan JR-East capitalizing pass beyond non-regression.

## Acceptance criteria

- Taiwan station count drops ~28%; non-rail orphans (bus/ferry terminals) absent.
- 新北產業園區 renders yellow + purple concentric rings (Circular + Airport lines).
- THSR collapses from ~149 routes to one logical line.
- Uncolored lines show distinct fallback hues, not uniform turquoise.
- `pnpm test`, `pnpm check`, `pnpm test:data:transit` green.
- Japan route-count diff reviewed and benign.

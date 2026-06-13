# T16b — Interchange colors + unopened-line exclusion (transit follow-ups)

> Two small, independent defects found reviewing the post-T16 Taiwan pack. Read
> [16-railway-infrastructure-routes.md](16-railway-infrastructure-routes.md)
> first. Fix A is **client-only**; Fix B is a **shared-pipeline** change that
> requires a Taiwan pack rebuild + republish.

## Fix A — Interchange stations lose a route color (cross-preset resolution)

### Symptom

紅樹林 (`osm:node:3495094887`) is a 淡水信義線 (red MRT) × 淡海輕軌 (pink LRT)
interchange. It should render **red + pink** concentric rings; it renders **red +
turquoise fallback**.

### Root cause

Route colors are resolved **per preset**, but `routeIds` attach **cross-preset**
(the T14 global attach is correct). Verified from the bundle:

```
紅樹林 in preset 臺北大眾捷運股份有限公司, routeIds:
  osm:relation:447451  "淡水信義線" #FF0000  [owned by 臺北大眾捷運股份有限公司] → resolves ✓
  osm:relation:5576487 "淡海輕軌"  #FEBEB5  [owned by 新北大眾捷運股份有限公司] → NOT in this preset → fallback ✗
```

`getStationRouteColors` is fed a `routeColorById` built **inside the per-preset
loop**, so a station carrying a routeId for a line owned by _another_ operator's
preset can't find its color:

- App: [hidingZone.ts:77](../../../src/features/hidingZone/hidingZone.ts:77)
  (`getSelectedStations` — `routeColorById` rebuilt per preset).
- Viewer:
  [transitGeojson.js:54](../../../tools/data-viewer/lib/transitGeojson.js:54)
  (same per-preset map).

Route ids are globally unique (one line lives in exactly one preset via
`attachRoutesToPresets`), so a global map is unambiguous.

### Fix (client only — no data regeneration)

Build the `routeId → color` map **once across every preset in the bundle**
(independent of which presets are selected), and pass it to
`getStationRouteColors` in both places. Keep `preset.defaultColor` as the final
fallback.

- `src/features/hidingZone/hidingZone.ts` — hoist `routeColorById` above the
  `for (const preset of sorted)` loop in `getSelectedStations`, populating it
  from **all** presets the bundle exposes (not just `sorted`/selected). When the
  same id appears twice, prefer an entry with a real `route.color` over a
  `defaultColor`.
- `tools/data-viewer/lib/transitGeojson.js` — same hoist in `getSelectedStations`.

**Selection nuance:** the owning operator preset may not be individually selected
(user picks only Taipei Metro, not New Taipei). Build the color map from the
**full loaded bundle preset list**, not the selected subset, so interchange
colors resolve regardless of selection. (Route _geometry_ still draws only for
selected presets — unchanged.)

### Tests

- Jest (`hidingZone`): a station whose `routeIds` include a line owned by a
  _different_ preset resolves that line's real color (not `defaultColor`). Use a
  2-preset fixture (operator A owns line L; station in operator B carries L's id).
- Viewer unit (if covered): same assertion against `getSelectedStations`.

No pack rebuild needed — this is purely how the client maps existing `routeIds`
to colors.

## Fix B — Unopened (under-construction) lines leak into the game

### Symptom

劍南路 (`osm:node:3497302610`, a 文湖線 station) carries 臺北捷運環狀線
(`osm:relation:11122080`). The Taipei Circular Line's eastern extension is **under
construction, not open**, and 劍南路 isn't even on it.

### Root cause

Relation `11122080` is tagged:

```
construction:route = subway   ← under construction (not in service)
route = railway               ← but ALSO a plain route tag → our railway filter pulls it
type = route
members: 71 ways, 0 stops
```

Two compounding problems:

1. The line is **unopened** but slips through because it carries `route=railway`
   alongside `construction:route=subway`. Nothing filters not-in-service lines.
2. Being **way-only (0 stops)**, it relies on T16 spatial-attach — which grabbed
   劍南路 off the _planned_ alignment (a spatial-attach false positive). Removing
   the line removes the bogus attach too.

### Fix (shared pipeline — `processOsmRoutes`)

Skip any relation carrying a **not-in-service** marker, in
[osmRoutes.mjs `processOsmRoutes`](../../../data/transit/scripts/lib/osmRoutes.mjs)
where masters/routes are separated (the `for (const rel of relations)` loop).
Drop the relation when its tags include any of:

- `construction:route` present, or `route=construction`
- `proposed:route` present, or `route=proposed`
- `disused:route` present, or `route=disused`
- `state` ∈ {`construction`, `proposed`}

Do **not** key off a bare `construction` tag (it appears as `construction=*` on
in-service relations' member ways and is ambiguous). The namespaced
`construction:route` / `route=construction` markers are the reliable signal.

Add a `stats.linesDroppedUnopened` counter and log it.

### Safety — verified against the data

- **Taiwan**: exactly **1** relation matches (`臺北捷運環狀線`) — the intended
  target. (`construction:route` count = 1; `route=construction|proposed|disused`
  = 0.)
- **Japan**: **0** filtered route/route_master relations across all 8 regions
  carry any of these markers → the exclusion is a **no-op for Japan** (bundles
  stay byte-identical). Safe to land in the shared lib **ungated**.

### Secondary (optional, same spirit)

Under-construction _ways_ (`railway=construction`, `construction=rail`) can exist
inside an otherwise-open line relation and would draw planned segments via
stitching. Out of scope for the 環狀線 case (whole relation excluded), but worth a
follow-up: skip construction ways in `stitchWays` / the way map.

### Tests

- `osmRoutes.test.mjs`: a relation tagged `construction:route=subway` (with
  `route=railway`) is dropped — not emitted as a line, and its way-only geometry
  does not spatial-attach any station. Assert `stats.linesDroppedUnopened === 1`.
- Japan regression: route counts unchanged after the exclusion (the 0-match
  result above is the guard).

## Verification

```bash
# Fix A (client):
pnpm test -- hidingZone        # interchange color resolves cross-preset
node tools/data-viewer/server.mjs   # 紅樹林 shows red + pink (not red + turquoise)

# Fix B (pipeline):
pnpm test:data:transit         # Japan route counts unchanged (0 dropped)
pnpm data:pack -- --region asia-taiwan
node tools/data-viewer/server.mjs   # 劍南路 no longer lists 環狀線; 環狀線 absent
pnpm data:pack:lint
pnpm data:pack:publish -- --region asia-taiwan   # republish (B changes the blob)
```

Fix A ships in the app/viewer with no data change. Fix B requires the Taiwan pack
rebuild + republish (it removes a line from `transit.json.gz`); Japan is a no-op
so its committed bundles need no regen.

## Out of scope

- Construction _way_ filtering inside otherwise-open relations (secondary note).
- `opening_date` in the future as an exclusion signal (no current cases).
- The broader interchange/coverage color story beyond cross-preset resolution.

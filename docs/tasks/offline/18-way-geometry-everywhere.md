# T18 — Way-geometry everywhere + RDP simplification (+ Fix A gap)

> Follow-up to [16-railway-infrastructure-routes.md](16-railway-infrastructure-routes.md)
> and [16b-transit-color-and-unopened-fixes.md](16b-transit-color-and-unopened-fixes.md).
> Three related items: (1) make track-following **way geometry** the default for
> all offline packs, (2) add a **simplification** pass so the bigger geometry
> stays small, (3) close the **Fix A** cross-preset-color gap in the app.

## Context

T16 introduced way-stitched, track-following route geometry, gated behind the
per-region `useRailwayInfrastructure` flag (Taiwan only). Reviewing the result,
the geometry is a clear quality win — lines now sit exactly on the rails instead
of zig-zagging between stop positions. We want this everywhere packs are built,
not just Taiwan.

The machinery already exists: `buildLine`
([osmRoutes.mjs](../../../data/transit/scripts/lib/osmRoutes.mjs)) prefers
`stitchWays(...)` geometry whenever a line's **variants carry way members** and
the `ways` map is passed — and `buildTransit.mjs` **always** passes `ways`. So any
pack whose route relations have way members already gets track geometry on
rebuild, with **no new code**. OSM coverage is good: e.g. the NL PBF has 302
`route=train` + 43 `route=railway` + 90 `route=tram` + 27 `route=subway`
relations, most carrying way members (PTv2).

Two things block flipping it on universally, plus one carried-over app bug:

1. **Size.** Way geometry is **~94% of the Taiwan transit blob** (330 KB; stations
   alone ≈ 19 KB; 40,945 geometry points). Denser regions (NL) would balloon
   further. Needs a simplification pass.
2. **Layer policy.** `useRailwayInfrastructure` currently does _two_ things: adds
   `route=railway`/`tracks` **and drops `route=train`**. "Ways everywhere" wants
   "use whichever route layer has ways," not a hard railway-vs-train switch.
3. **Fix A gap (carried over).** The app resolves interchange colors from the
   **selected** presets only, not the full bundle — so some interchange rings
   still fall back.

## Measured size / simplification headroom (Taiwan, captured this session)

Douglas–Peucker (planar lon/lat) on the route geometry:

| RDP tolerance   | geometry points | transit.json.gz |
| --------------- | --------------- | --------------- |
| none (raw ways) | 40,945          | 330 KB          |
| ~6 m            | 10,310 (25%)    | 103 KB          |
| **~11 m**       | **7,120 (17%)** | **78 KB**       |
| ~22 m           | 5,072 (12%)     | 62 KB           |

At ~11 m tolerance (imperceptible at hide-and-seek zoom) the blob returns to
roughly stations-only size **with** track-following geometry. This is the
enabling prerequisite — do it first.

## What to build

### 1. Geometry simplification pass (do this first)

- Add an RDP simplifier (planar lon/lat is fine at these scales — same
  approximation the rest of the pipeline uses) and apply it to each route's
  stitched geometry before emit. Default tolerance **~10–12 m**
  (`transitOverrides.simplifyMeters`, per-region overridable; `0` disables).
- Apply **only to stitched way geometry**, not to the stop-position fallback
  (the latter is already sparse — simplifying it loses stops).
- Simplify each MultiLineString segment independently; drop segments that
  collapse to <2 points.
- Suggested location: a small `simplifyGeometry(geometry, meters)` helper next to
  [wayStitch.mjs](../../../data/transit/scripts/lib/wayStitch.mjs); call it in
  `buildLine` right after `stitchWays(...)` succeeds (so spatial-attach still runs
  against the full-resolution line — simplify the _output_, attach against the
  pre-simplified geometry or accept the tiny delta).
- Unit test: a dense polyline simplifies to far fewer points while endpoints are
  preserved and max deviation ≤ tolerance.

### 2. "Prefer ways" layer policy (decouple from the train-drop)

Today `useRailwayInfrastructure` couples three behaviors. Split them so packs can
get way geometry without the Taiwan-specific railway-vs-train swap:

- Introduce `transitOverrides.wayGeometry` (default **true for packs**). It only
  controls whether stitched way geometry is preferred — which is already the
  effective default whenever `ways` is present, so this is mostly making intent
  explicit + giving a per-region off switch.
- Keep `useRailwayInfrastructure` as the **separate** Taiwan knob that (a) pulls
  `route=railway`/`tracks` and (b) drops `route=train`. Do **not** turn that on
  for other regions blindly — its train-drop + collapse policy is Taiwan-tuned.
- Net rule for the builder: _use whichever route layer a line comes from; if its
  variants have way members, stitch + simplify; else fall back to the stop
  polyline._ No region loses lines that are stops-only.
- Construction/proposed/disused exclusion (T16b `isUnopened`) is a **prerequisite**
  and already in place — keep it; it prevents drawing planned/abandoned track once
  way geometry is on everywhere.

### 3. Close the Fix A app gap

The viewer resolves cross-preset interchange colors correctly (it sees all
presets). The **app** does not: `getSelectedStations(selectedPresets)`
([hidingZoneStore.tsx:184](../../../src/state/hidingZoneStore.tsx:184)) passes
only the **selected** presets, so the global `routeColorById` built in
[hidingZone.ts](../../../src/features/hidingZone/hidingZone.ts) `getSelectedStations`
omits routes owned by unselected operators. Result: e.g. 紅樹林 shows red +
turquoise (not red + 淡海輕軌 pink) unless the New Taipei operator preset is also
selected.

- Source the `routeId → color` map from the **full bundle preset list**, not the
  selected subset — either pass the full presets alongside the selected ones into
  `getSelectedStations`, or precompute a global `routeColorById` in the store and
  thread it through. Route geometry still renders for selected presets only
  (unchanged).
- Test: a station in a **selected** preset whose `routeIds` include a line owned
  by an **unselected** preset resolves that line's real color (the existing T16b
  test passes both presets and so misses this case — add the unselected variant).

## Verification

```bash
# Simplification + ways:
pnpm test:data:transit          # geometry unit tests, Japan unaffected
pnpm data:pack -- --region asia-taiwan
pnpm data:pack -- --region europe-netherlands   # needs the big-heap NODE_OPTIONS
node tools/data-viewer/server.mjs   # lines follow track; NL not bloated
pnpm data:pack:lint
# confirm transit.json.gz sizes are near stations-only after RDP

# Fix A:
pnpm test -- hidingZone         # cross-preset color with owner preset UNSELECTED
node tools/data-viewer/server.mjs   # 紅樹林 red + pink

pnpm typecheck && pnpm test
```

Republish each rebuilt pack (`pnpm data:pack:publish -- --region <id>`) — only the
catalog is committed; blobs go to the Release. Fix A ships client-side (no rebuild).

## Notes / caveats

- **Stitching is not always one stroke.** Taiwan 縱貫線 emits ~27 MultiLineString
  segments (both directions + branches + small way gaps). Accurate track, not a
  single line — fine to render, don't try to force a single stroke here.
- **Japan is out of scope.** It is GTFS-primary; `shapes.txt` already provides
  geometry and `processOsmRoutes` runs there with no `ways` arg. Unifying Japan
  onto way geometry is a separate, larger effort.
- Simplification is planar lon/lat — at pack latitudes the meter↔degree factor is
  off by `cos(lat)`; fine for a ~10 m visual tolerance, don't over-engineer.

## Out of scope

- Japan way-geometry migration.
- Single-stroke geometry stitching (branch/loop merging).
- Bus / non-rail modes (T17).

# T13 — Transit route lines in offline packs (Option A)

## Context

Offline packs (`asia-taiwan`, `europe-netherlands`) ship transit bundles with
**stations only and zero routes**. Every preset in
`data/packs/dist/<region>/transit.json.gz` has `routes: []`, and every station
has `routeIds: []`. As a result the bundle viewer (and the app's transit-line
question) draw **no route lines** and stations fall back to a single flat
`defaultColor` with no per-line coloring and no concentric rings.

Root cause: the pack transit builder
[`data/packs/scripts/lib/buildTransit.mjs`](../../../data/packs/scripts/lib/buildTransit.mjs)
extracts only station **nodes** (`railway=station`/`halt`/`tram_stop`/…), groups
them by their raw `operator` tag, and hardcodes `routes: []`
(buildTransit.mjs:255, :279). The per-operator station tint is a synthetic
`hsl()` hash of the operator name (buildTransit.mjs:294) — not a real OSM route
color. It never extracts route relations at all.

This was a **deliberate** T9 scope cut ("stations first; route lines best-effort
until the osmRoutes geometry stitching is fixed" — see
[09-transit-artifacts.md](09-transit-artifacts.md) and the epic decision table
in [../../offline-data-packs.md](../../offline-data-packs.md)). T9's spec even
said "keep whatever line geometry the OSM path produces today (best-effort)",
but the shipped builder dropped routes entirely rather than best-effort.

The capability already exists in the **Japan** pipeline (`data/transit/`):

- Route-relation extraction lives **inline** in
  [`osmStage.mjs:216–495`](../../../data/transit/scripts/lib/osmStage.mjs):
  `osmium tags-filter r/route=train|subway|light_rail|monorail` (+
  `route_master=*`) → `osmium cat` to OSM XML → stream-parse relations (tags +
  members) and collect node coords for spatial stop resolution.
- [`osmRoutes.mjs`](../../../data/transit/scripts/lib/osmRoutes.mjs)
  `processOsmRoutes(relations, stationRecords, localeConfig, nodeCoords)` groups
  directional routes under their `route_master`, resolves stop members to
  stations, repairs stop order, and reads route color from the OSM
  `colour`/`color` tag (osmRoutes.mjs:298). It returns
  `{ lines: [{ id, name, color, sourceId, operator, networkTag, geometry, memberStationIds }], stats }`.
- Attaching lines to presets lives in
  [`conflateStage.mjs:232–270`](../../../data/transit/scripts/lib/conflateStage.mjs):
  filter `osmRouteLines` by normalized operator, push a
  `{ id, name, color, sourceId, geometry }` route entry onto `preset.routes`,
  and push `line.id` onto the `routeIds` of each member station (matched by
  `sourceId`).

This task wires that route path into the pack builder so packs carry routes +
real colors + route-colored station rings, with the same bundle schema the
viewer and app already consume (no client changes needed).

**Read first:** `data/packs/scripts/lib/buildTransit.mjs`,
`data/transit/scripts/lib/osmStage.mjs` (the `// ─── Route relation extraction`
block onward), `osmRoutes.mjs`, `conflateStage.mjs:200–428`,
`normalizeOperator.mjs`, and `osmStations.mjs` `createOsmElementId`.

## Known limitation (scoped OUT)

`processOsmRoutes` route **geometry** is the known-broken fallback: a polyline
through stop positions in member order, so bidirectional relations and
multi-operator hubs zigzag (buglist `Train lines`, [H], in
[../../buglist1.md](../../buglist1.md)). The real fix — stitching member
**ways** into ordered linestrings — is tracked there and is **not** part of this
task. T13 delivers: route grouping, real OSM route colors, route-colored station
rings, and line _presence_. Line shape inherits the existing zigzag until the
way-stitching fix lands. State this plainly when reviewing pack output in the
viewer; don't tune geometry here.

## The one gotcha: station id format must match

`buildTransit.mjs` currently emits station `id`/`mergeKey` as `osm:<id>` (e.g.
`osm:64123913`). But `processOsmRoutes` resolves stops via
`createOsmElementId("node", ref)` = **`osm:node:<id>`** and returns
`memberStationIds` in that format; `conflateStage` matches them against each
preset station's `sourceId`. If the formats don't line up, **every route matches
zero stations** and `routeIds` stays empty even though `routes` populate — a
silent failure.

So the station records fed to `processOsmRoutes`, and the `sourceId` on each
emitted preset station, must use the **same** id that appears in
`line.memberStationIds`. Pick one and be consistent (recommend reusing
`createOsmElementId("node", osmId)` from `osmStations.mjs` so it matches the
Japan path exactly). Add an assertion/test that at least one station ends up
with a non-empty `routeIds` for a region known to have routes.

## What to build

### 1. Extract route-relation extraction into a shared helper

The osmium + XML-parse block is currently inline in `osmStage.mjs`. Lift it into
a reusable module so both pipelines call one implementation:

`data/transit/scripts/lib/extractOsmRoutes.mjs`:

```js
// Returns route relations (in the shape processOsmRoutes expects) + node
// coords for spatial stop resolution. osmium failures are non-fatal: log a
// warning and return { relations: [], nodeCoords: new Map() }.
export async function extractRouteRelationsFromPbf({
    pbfPath,
    cacheDir,      // where to write the filtered PBF + OSM XML (reuse/cache)
    regionId,
}): Promise<{ relations: object[], nodeCoords: Map<number,{lat,lon}> }>;
```

Move osmStage.mjs:232–423 (filter → cat → stream-parse → collect node coords →
build `allRelations` entries) into this helper verbatim, then have `osmStage`
call it in its per-region loop. **Keep the Japan call path behavior identical**
— this is a pure refactor for osmStage; verify `pnpm test:data:transit` stays
green before touching packs. If extracting cleanly proves risky, the fallback is
to duplicate the ~80 lines in the packs lib instead (less DRY, zero risk to
Japan); prefer the shared helper unless the refactor balloons.

### 2. Wire routes into `buildTransit.mjs`

After step 3 (mapping station records) and before building presets:

1. **Reshape station records** so `processOsmRoutes` can resolve stops: give
   each record an `id = createOsmElementId("node", rec.osmId)`, plus `name`,
   `lat`, `lon` (already present). `processOsmRoutes` builds both a by-name and
   a by-id lookup, so names matter for stop resolution.
2. **Extract routes:**
   `const { relations, nodeCoords } = await extractRouteRelationsFromPbf({ pbfPath, cacheDir: <pack cache>, regionId: region.id });`
3. **Process:**
   `const { lines, stats } = processOsmRoutes(relations, stationRecords, localeConfig, nodeCoords);`
   Pass a **minimal locale config** —
   `{ nameSuffixes: [], aliases: [], maxClusterMeters: 150 }` — since packs have
   no Japan-style locale entry. Allow per-region overrides via `regions.yaml`
   `transitOverrides` (T9 already reserved this knob) but defaults must work
   unconfigured.
4. **Attach lines to presets** mirroring conflateStage.mjs:232–270: - Build an
   operator normalizer (`buildOperatorNormalizer` from `normalizeOperator.mjs`)
   seeded with the operator names present, so line operators and preset
   operators normalize identically. The current `buildPresets` groups by **raw**
   operator string — switch grouping (or the line→preset match) to the
   **normalized** operator so they join. - For each operator preset, push
   matching lines as
   `{ id, name, color: line.color || preset.defaultColor, sourceId, geometry }`
   into `preset.routes`, and push `line.id` onto member stations' `routeIds`
   (match `line.memberStationIds` against station `sourceId`). - `defaultColor`:
   keep the operator-hash as the _station_ fallback, but real route colors now
   come from `line.color`. (Optionally drop the hash in favor of
   `STATION_FALLBACK_COLOR` `#1f6f78` to match Japan — decide in review; not
   load-bearing.) - Coverage preset keeps `routes: []` (matches Japan's "Other"
   preset).

Keep the emitted bundle schema **byte-for-byte compatible** with committed
transit bundles + the existing pack schema (top-level `attribution` + `presets`;
each preset owns
`id,label,operator,kind,bbox,defaultColor,source, routes,stations`; routes carry
`id,name,color,sourceId,geometry`; stations carry
`id,lat,lon,mergeKey,name,routeIds`). The viewer's
[`transitGeojson.js`](../../../tools/data-viewer/lib/transitGeojson.js) and the
app already read exactly this — no client changes.

### 3. pack-lint additions

Extend
[`data/packs/scripts/pack-lint.mjs`](../../../data/packs/scripts/pack-lint.mjs):

- Every `route.geometry` is a valid (Multi)LineString with ≥1 part, all coords
  finite and inside the region bbox (same slop rule as stations).
- Every `route.id` / `station.id` non-empty; route `color`, when present, is a
  valid hex.
- **Linkage sanity:** for a region whose `meta.json` declares transit, at least
  one preset has `routes.length > 0` **and** at least one station has
  `routeIds.length > 0` (guards the id-format gotcha — a pack that regressed to
  stations-only fails lint instead of silently shipping).
- Preset ids still contain no `:` (T9 invariant — app-side prefixing depends on
  it).

### 4. Regenerate + republish both packs

> **Packs are NOT committed.** `data/packs/dist/` is gitignored by design
> (.gitignore:32). Pack blobs are published to **GitHub Releases** and the
> **catalog** (`site/packs/catalog.json`, served via GitHub Pages) is the only
> committed, served artifact — it points at absolute Release URLs and carries
> each blob's content hash (epic decision: "Releases for blobs, Pages for the
> catalog", [design.md](design.md) → "Catalog and hosting"). This is the
> opposite of the bundled Japan assets in `assets/transit/`, which _are_
> committed because they're baked into the app binary. Do **not** `git add`
> the regenerated `transit.json.gz`.

```bash
# 1. Rebuild the transit (and any hash-affected) artifacts locally.
pnpm data:pack -- --region asia-taiwan
pnpm data:pack -- --region europe-netherlands

# 2. Eyeball each in the viewer before publishing.
node tools/data-viewer/server.mjs
#   → routes render with per-line colors; stations show concentric rings
#     where routes overlap. Verify the known-zigzag geometry caveat, don't fix.

# 3. Lint, then publish: uploads blobs to a GitHub Release, rebuilds
#    site/packs/catalog.json with fresh hashes, and commits the CATALOG.
pnpm data:pack:lint
pnpm data:pack:publish -- --region asia-taiwan
pnpm data:pack:publish -- --region europe-netherlands
```

The only file that lands in git is the regenerated **`site/packs/catalog.json`**
(updated `transit` artifact URL + hash for each region), produced and committed
by `publish.mjs`. The `transit.json.gz` blobs live on the Release, not in the
repo. Confirm the new transit hashes differ from the prior catalog before
publishing (a no-op rebuild means the route wiring didn't actually change the
artifact).

Note: schema is free to change pre-launch (epic "Compatibility: none required"),
so no migration concerns for the new `routes` payload — installed clients
re-download on the next catalog refresh.

## How to test

**`node --test` (pipeline):**

- Extend `buildTransit`'s suite (or add `buildTransit.routes.test.mjs`): a tiny
  fixture PBF with one `route_master` + two directional `route` relations over a
  handful of station nodes →
    - presets gain ≥1 route with the OSM `colour` tag's color,
    - member stations get the route id in `routeIds`,
    - the id-format assertion (a station ends up with non-empty `routeIds`),
    - a route relation with no resolvable stops is dropped, not crashed.
- `extractOsmRoutes` unit test (or reuse osmStage's existing route assertions):
  parsing tags/members/node-coords from a small OSM XML fixture.
- Regression: `pnpm test:data:transit` (Japan path) stays green after the
  shared-helper refactor — this is the canary that the refactor didn't change
  Japan behavior.

**pack-lint:** a fixture bundle with `routes: []` everywhere fails the new
linkage check; a healthy bundle passes.

**Manual (optional, on device):** NL pack + Amsterdam play area — selecting an
operator preset (e.g. NS/GVB) renders route-colored stations; a shared station
shows concentric rings. (Wi-Fi off.)

## Out of scope

- **Route-line geometry quality** (the zigzag stop-position fallback) — tracked
  in buglist `Train lines` [H]; the way-stitching fix is a separate task that
  benefits Japan and packs alike.
- GTFS feeds outside Japan (packs are OSM-only by design).
- Coverage UX (T10), app-side preset merge/registration (shipped in T9 §2).
- Changing the bundle schema or the viewer.

## Done when

- `buildTransit.mjs` emits routes + route-colored station `routeIds` for both
  packs; blobs republished to the GitHub Release and `site/packs/catalog.json`
  recommitted with updated transit hashes (the `.json.gz` blobs stay
  gitignored — only the catalog is committed).
- Bundle viewer shows route lines + per-line station coloring for Taiwan and
  Netherlands.
- pack-lint enforces route geometry validity + station↔route linkage.
- `pnpm test` + `pnpm check` + `pnpm test:data:transit` green (Japan pipeline
  unaffected by the shared-helper extraction).

# T16 — Railway-infrastructure routes (opt-in), shared transit lib

> Handoff spec for an implementing agent. Read
> [13-transit-routes-in-packs.md](13-transit-routes-in-packs.md) and
> [14-transit-station-route-quality.md](14-transit-station-route-quality.md)
> first — this builds directly on both.

## Context

Reviewing the regenerated Taiwan pack after T14 surfaced three remaining transit
defects. Investigation (against `data/packs/dist/asia-taiwan/transit.json.gz` and
the source PBF `data/packs/cache/asia-taiwan-latest.osm.pbf`) traced each to a
root cause, and a user-supplied example — node `3951206308` (南澳) → route
`5872818` (北迴線 逆行, `type=route` + `route=railway`) → route_master `10975457`
(北迴線, `route_master=railway`) — revealed the real fix.

- **Issue 1 — every station renders two colors.** The pack coverage preset holds
  **all 543 stations**, and **all 543 also sit in an operator preset** (verified:
  100% overlap). T14's global routeId attach then writes the routeId onto both
  copies; the coverage copy has no matching route entry, so it falls back to
  `defaultColor` `#1f6f78` → a second turquoise ring. Japan never does this:
  `buildOtherPreset`
  ([conflateStage.mjs:374](../../../data/transit/scripts/lib/conflateStage.mjs:374))
  holds **leftover** stations only (no-operator + operators with <3 stations).
  The pack diverged at
  [buildTransit.mjs:307-321](../../../data/packs/scripts/lib/buildTransit.mjs:307)
  (`records.map(...)` = all stations).

- **Issue 2 — per-train lines that cut across the country (自強 七堵→潮州 etc.).**
  TRA heavy rail is modeled in OSM as one `route=train` relation **per scheduled
  train**, with no `route_master`, named by service class + train number + OD
  (`區間 1112 新竹→基隆`). T14's masterless collapse (§3 there) can't fold them
  because of an **XML entity-decode bug**:
  [extractOsmRoutes.mjs:182-189](../../../data/transit/scripts/lib/extractOsmRoutes.mjs:182)
  stores the raw `v="…"` attribute, so `新竹->基隆` is kept as `新竹-&gt;基隆`.
  That literal `&gt;` defeats the arrow-strip in `lineNameKey`
  ([osmRoutes.mjs:710](../../../data/transit/scripts/lib/osmRoutes.mjs:710)) and
  makes the seeded `routeColors["區間"]` never match (the key is
  `區間 新竹-&gt;基隆`), so the lines also render fallback hues.

- **Issue 3 — stations with no connecting line (大溪, 新埔).** Confirmed not
  members of any `route=train` relation. OSM models their lines (宜蘭線, 縱貫線)
  only in the infrastructure layer.

**The real model.** OSM tags Taiwan rail twice:

| Layer              | Tagging                                  | What it is                                                                           | Used today?       |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------ | ----------------- |
| Service            | `route=train` (自強/區間/… per train)    | one relation **per scheduled train**, no master, stop-node polyline                  | ✅ — the mess     |
| **Infrastructure** | `route=railway` + `route_master=railway` | one relation **per physical line**, grouped by master, **with track `way` geometry** | ❌ — filtered out |

The infrastructure layer is clean: **6 `route_master=railway`** (台灣高速鐵路,
縱貫線, 北迴線, 宜蘭線, 沙崙線, 六家線) + **67 `route=railway`** relations whose
names are the real lines (海岸線, 屏東線, 臺中線, 南迴線, 臺東線, 集集線, 內灣線…),
carrying hundreds of track `way`s (北迴線 = 93 ways, 縱貫線 = 513). Using them
replaces the per-train smear with coherent lines, fixes the zigzag geometry, and
(via spatial attach) connects 大溪/新埔.

**Generalization decision — opt-in, not global.** The Japan PBF also has **497
`route=railway` + 65 `route_master=railway`** relations; enabling the filter
globally would inject ~500 relations into the committed Japan bundles and risk
duplicates wherever both layers exist. So gate it behind a per-region
`transitOverrides.useRailwayInfrastructure` flag (Taiwan `true`; Japan/NL
untouched). Verified the osmium `tags-filter → cat` extract already carries way
`<nd>` refs + node coords (4,166 ways / 28,716 nodes in the railway extract), so
stitching needs no new tooling.

**Bus / non-rail modes — design-for, defer (T17).** A backlog item
([buglist1.md](../../buglist1.md), "Unprocessed") wants an SF Bay mode:
everything on rails (BART, Muni Metro, Caltrain, cable cars, historic
streetcars) **plus** specific bus lines (38R, 14R). Two things in T16 are
rail-only and would become dead-ends: the **route-type filter** (hardcoded
`route=train|subway|…`) and T14's **non-rail station gate** (`mapOsmNode` drops
every bus/ferry stop). T16 **builds both from config** so T17 is config +
curation, not a refactor — but **implements rail only** now. See
[Follow-up — T17](#follow-up--t17-bus--cable-car-line-modes-sf-bay).

**Intended outcome.** Taiwan ships ~a dozen real rail lines (THSR, 縱貫/海/北迴/
宜蘭/臺東/南迴…) with track-following geometry and route-colored stations incl.
大溪/新埔; every station single-colored unless a genuine interchange; Japan
bundles change only in entity-decoded name strings (see baseline gate).

## Design decisions

| Fork                 | Decision                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Railway layer        | **Opt-in** `transitOverrides.useRailwayInfrastructure`. Default off → Japan/NL unaffected.                                                                                                                                                                          |
| Heavy-rail dedup     | Flag on: extractor adds `route=railway`/`tracks` (+ masters); `processOsmRoutes` **drops `route=train`/`route_master=train`** lines. `route=subway`/`light_rail`/`monorail` + masters stay (Taipei/Kaohsiung/Taoyuan/Taichung MRT; THSR is `route_master=railway`). |
| Geometry             | Stitch `way` members into ordered LineString(s) → MultiLineString. Fall back to the stop-node polyline when a line has no usable ways.                                                                                                                              |
| Station attach       | `role=stop/station` members **plus spatial**: any station node within `railwayAttachMeters` (default ~120 m) of the stitched geometry. Fixes 0-stop infra lines (宜蘭/縱貫 → 大溪/新埔).                                                                            |
| Entity decode        | **Always** (pure bug fix; also cleans Japan names — see gate).                                                                                                                                                                                                      |
| Coverage preset      | **Leftovers only** in the pack (mirror Japan). Independent of the flag.                                                                                                                                                                                             |
| Non-rail / bus modes | **Design-for, defer (T17).** Route-type filter + station gate built from config; rail only implemented now.                                                                                                                                                         |

## What to build

### 1. `data/transit/scripts/lib/extractOsmRoutes.mjs` (shared)

- **Build the tags-filter from a mode list, not hardcoded literals.** Accept
  `opts.routeModes` (default `["train","subway","light_rail","monorail"]`) and
  emit `r/route=<m>` + `r/route_master=<m>` per mode — so T17 adds modes via
  config, no code change. `opts.includeRailway` (default false) appends
  `railway`/`tracks` to the set.
- **Cache-key by mode set.** Suffix the filtered PBF/XML filenames so a railway
  run doesn't collide with a train-only run. Keep the **legacy filename for the
  default set** (`${regionId}-routes.osm{,.pbf}`) so the existing Japan cache
  stays valid; only the railway run gets a suffix (e.g. `-rail`).
- **Fix entity decode.** Add `decodeXmlEntities()` (handle
  `&lt; &gt; &amp; &quot; &apos; &#NN; &#xHH;`, decoding `&amp;` **last**) and
  apply to every parsed `<tag>` value and member `role`. Unit-test it.
- **Parse `<way>`.** Track `inWay` like `inRelation`; collect `wayId → [nodeRef…]`
  from ordered `<nd ref>` (handle the self-closing `<way .../>` edge). Member
  parsing already captures `type="way"` members, so only the geometry map is new.
- **Return** `{ relations, nodeCoords, ways }` (was `{ relations, nodeCoords }`).

### 2. `data/transit/scripts/lib/osmRoutes.mjs` (shared)

- Signature: `processOsmRoutes(relations, stationRecords, localeConfig, nodeCoords, ways?)`
  — optional `ways` (back-compatible; Japan passes nothing → unchanged).
- **Drop the train layer when infra is active.** If
  `localeConfig.useRailwayInfrastructure`, skip relations whose
  `route`/`route_master` is `train` (keep railway/tracks/subway/light_rail/
  monorail). Gate strictly so the flag-off path is byte-for-byte the same.
- **`buildLine` geometry.** New `stitchWays(wayMembers, ways, nodeCoords)` in a
  new `lib/wayStitch.mjs`: chain ways by shared endpoints into ordered
  LineStrings (handle reversal + branches → MultiLineString segments; never
  crash; fall back to the stop polyline if stitching yields < 2 points). Use it
  when way members exist; else keep the current stop-position path.
- **Spatial station attach.** New `attachStationsAlongLine(geometry, stationById,
meters)` using point-to-segment distance via existing `haversineM`
  ([grid.mjs](../../../data/transit/scripts/lib/grid.mjs)); union results into
  `memberStationIds`. Order spatial-only members by projection along the line so
  the station list stays geographic.
- **Color.** `resolveLineColor` already keys on `lineNameKey(name)`; with infra
  the keys become real line names — seed those in config (§4). Keep `#1f6f78`
  as the last-resort station fallback only.

### 3. `data/packs/scripts/lib/buildTransit.mjs` (pack)

- Pass `includeRailway: region.transitOverrides?.useRailwayInfrastructure` and
  (future) `routeModes` to `extractRouteRelationsFromPbf`; thread the returned
  `ways` into `processOsmRoutes`; add `useRailwayInfrastructure` +
  `railwayAttachMeters` into `localeConfig`.
- **Coverage = leftovers (Issue 1).** In `buildPresets`, after grouping records
  by normalized operator, emit the coverage preset from only records whose
  primary operator group is `other` **or** whose operator has
  `< minOperatorStations` (mirror Japan's ≥3 rule — see
  [conflateStage.mjs:214-231](../../../data/transit/scripts/lib/conflateStage.mjs:214)).
  Stations already in a real operator preset must **not** be duplicated into
  coverage. (`attachRoutesToPresets` still attaches routeIds across every preset
  a station appears in — that part is correct and stays.)

### 4. `data/packs/regions.yaml` (config)

- `asia-taiwan.transitOverrides`: add `useRailwayInfrastructure: true`,
  `railwayAttachMeters: 120`, and **re-key `routeColors` to line names**
  (縱貫線/海岸線/北迴線/宜蘭線/臺東線/南迴線/屏東線/集集線/內灣線 + 台灣高速鐵路),
  dropping the now-unused service-class keys (區間/自強/莒光/復興). Validate exact
  hexes in the viewer.
- Reserve (do **not** wire) `transitOverrides.curatedRoutes` as a comment/empty
  map — the T17 selector for specific lines (38R/14R).
- Leave `europe-netherlands` untouched (flag absent).

### 5. `data/packs/scripts/pack-lint.mjs`

- Tighten the per-operator route-count bound now that heavy rail collapses
  (THSR ≤ a small N; no operator with an implausible count).
- Existing geometry-validity + station↔route linkage checks stay; they now also
  cover stitched MultiLineString geometry.

### 6. Generalization seams for non-rail modes (factoring only — no behavior change)

- **Route modes are data** (§1): the extractor filter comes from a mode list;
  rail is the default. Bus/tram/cable_car become extra modes in T17.
- **Station gate parameterized.** T14's rail gate in
  [osmStations.mjs](../../../data/transit/scripts/lib/osmStations.mjs)
  `mapOsmNode` hard-drops non-rail nodes. Don't change the default, but thread
  the accept-rule from config (e.g. `mapOsmNode(..., { acceptModes })`) so a
  later "admit stops of curated routes" pass can re-include specific bus stops
  without rewriting ingestion. Ship rail-only behavior.
- **Curation knob reserved** (§4): `transitOverrides.curatedRoutes`, read by no
  T16 code.

## Japan regression baseline (the gate)

The entity-decode fix is shared and **always on**, so Japan output is **not
byte-identical** — the committed bundles already carry `&gt;`/`&lt;` in route
names (the `<=>`/`=>` bidirectional markers). The gate is **names + a few
fallback colors**, not "names only".

**Verified Japan diff after T16 (flag off), HEAD vs `--cache-only` regen, keyed
by `mergeKey|id`:**

- **counts / ids / geometry / routeIds / station coords / preset membership —
  all unchanged.** Collapse grouping intact.
- **832 route-name changes — 100% pure entity-decode** (`&gt;`→`>`, `&lt;`→`<`;
  e.g. `JR大糸線 (松本 =&gt; 南小谷)` → `(松本 => 南小谷)`). Station names: 0.
- **96 route-color changes** (12 distinct routes × 8 bundles) — **all** on
  entity-named, hash-fallback lines (no OSM `colour`, no `routeColors` override).
  Mechanism: `color = hashHue(lineNameKey(name))`; decoding the name shifts the
  hash input → a new arbitrary fallback hue. **Benign** (arbitrary→arbitrary) and
  **one-time** (future regens are stable). Examples: `特急 新潟<=>新井`,
  `亀山-->加茂`, `Train 普通: 佐伯 => 大分`.
- **No `route=railway` content** in Japan bundles (flag off); way-stitch never
  runs (Japan calls `processOsmRoutes` with no `ways` arg).

**Diff gotcha — key by `mergeKey`, not `id`.** A single OSM node can back
multiple GTFS contributions (e.g. 四ツ谷 = `osm:node:2822191201` for Tokyo Metro
stops 215 **and** 808, ~200 m apart). A station diff keyed on `id` alone collapses
these and reports phantom coord changes + false non-determinism. Key on
`mergeKey|id`; then regen-vs-regen is bit-stable (pipeline is deterministic).

If any **count**, **geometry**, or **routeId** moves, stop — that is not expected.

Captured **2026-06-12** from committed `assets/transit/` (HEAD). Reproduce with:

```bash
node -e '
const fs=require("fs");let rtot=0,stot=0,ptot=0;
for(const f of fs.readdirSync("assets/transit").filter(f=>/^japan-.*\.json$/.test(f)).sort()){
  const b=JSON.parse(fs.readFileSync("assets/transit/"+f,"utf8"));const ps=b.presets||b;
  let r=0,s=0;for(const p of ps){r+=(p.routes||[]).length;s+=(p.stations||[]).length;}
  rtot+=r;stot+=s;ptot+=ps.length;console.log(f.replace(".json",""),ps.length,r,s);
}
console.log("TOTAL",ptot,rtot,stot);'
```

| bundle         | presets | routes   | stations  |
| -------------- | ------- | -------- | --------- |
| japan-chubu    | 30      | 625      | 1947      |
| japan-chugoku  | 20      | 625      | 2072      |
| japan-hokkaido | 5       | 625      | 385       |
| japan-kansai   | 35      | 625      | 2000      |
| japan-kanto    | 64      | 640      | 3244      |
| japan-kyushu   | 19      | 625      | 1594      |
| japan-shikoku  | 11      | 625      | 1147      |
| japan-tohoku   | 16      | 625      | 1092      |
| **TOTAL**      | **200** | **5015** | **13481** |

Entity counts to expect cleaned (per bundle, identical across all eight): **110×
`&gt;`, 65× `&lt;`**.

sha256 of the pre-T16 committed bundles (a post-T16 `pnpm data:transit
--cache-only` differs by **decoded names + 96 fallback colors** — confirm via a
structural diff keyed by `mergeKey|id`, not hash equality):

```
45b01a99a50c6d3e411a3fe26c549c7c1405b8565f3096b26ab170023e9c8e8f  japan-chubu.json
5b1d0cc8136227ce34996d52c0b4345a02d74b44359dfbaa2487363e04d519d5  japan-chugoku.json
76e009e77eae4e981e79492eddae51538caa7ab4438dbc5e646d45d56cfae054  japan-hokkaido.json
1604ec621f7e163fdeb65a9ddba0bfc2ec604c280e636eaf214f2e81a178a479  japan-kansai.json
4f0592d1677c89447cc68196835859513b7f8b84148fe7e1ac26932b3aed693d  japan-kanto.json
2d5ce8b01c83d52b355f832f8d02546ca71d79e6152dff49867ac4d4da12712f  japan-kyushu.json
76446ec86b1552d3cca4a4841d463d7b2325deac2fa8dfc5cfb3eaabe066e435  japan-shikoku.json
3c68bfcf086eb2bd8c1d656927484f9bb790719b2db932920dd83ce6469e1243  japan-tohoku.json
d991d696313418b03c30695140f6bf92d4629966a69f64db4962b63e60158bbf  manifest.json
```

## Tests

- **extractOsmRoutes**: entity-decode unit (`區間 1112 新竹-&gt;基隆` →
  `…新竹->基隆`); `<way>` parsing from a small OSM-XML fixture; railway filters
  added only when `includeRailway`.
- **wayStitch**: unordered + reversed ways chain into one LineString; a gap
  yields two segments; degenerate input never throws.
- **osmRoutes**: a `route_master=railway` groups its directional `route=railway`
  variants → 1 line; spatial attach pulls in a station on the geometry that is
  **not** a `stop` member; with `useRailwayInfrastructure`, `route=train`
  relations are dropped. Add a parallel-line attach test (海線/臺中線) so over-
  attach is caught.
- **buildTransit (pack)**: a station in an operator preset is **absent** from the
  coverage preset (Issue 1 regression); a railway line colors a previously orphan
  station.
- **Japan regression (gate):** `pnpm test:data:transit` green; counts match the
  table; only-name diff confirmed.

## Verification

```bash
# Japan untouched except decoded names (flag off):
pnpm test:data:transit
pnpm data:transit -- --cache-only        # regenerate from cache
# then re-run the baseline node snippet above and diff counts (must be 0 delta);
# spot-check that &gt;/&lt; are gone from names and nothing else moved.

# Taiwan rebuild (flag on):
pnpm data:pack -- --region asia-taiwan
pnpm data:pack:lint
node tools/data-viewer/server.mjs   # eyeball:
#   - 北迴/縱貫/海/宜蘭/臺東/南迴/THSR draw as track-following lines (not zigzag)
#   - 大溪 & 新埔 sit on a colored line
#   - 松山機場 / 體育大學 single-colored (no turquoise second ring)
#   - per-train 自強/區間 lines gone

pnpm typecheck && pnpm test          # full pack + shared-lib suites
```

Republish via the existing flow (`pnpm data:pack:publish -- --region
asia-taiwan`) — only `site/packs/catalog.json` is committed; the `.json.gz` blob
goes to the Release. Japan bundles in `assets/transit/` **are** committed; if
the decoded-name regen is accepted, `git add` them with a clear message.

## Risks / mitigations

- **Shared-lib blast radius.** Every `osmRoutes`/`extractOsmRoutes` change is
  behind the flag or a pure addition (way parsing, entity decode). The Japan gate
  is the canary; entity decode's only Japan effect is name cleanup.
- **Spatial over-attach.** Parallel lines (海線/臺中線) can attach a station to
  both; `railwayAttachMeters` is tunable and concentric rings are fine at true
  interchanges. Covered by the parallel-line test.
- **Way-stitch edge cases** (branches, loops, gaps): degrade to MultiLineString
  segments; fall back to stop polyline on < 2 points.
- **Region-specific railway quality.** Opt-in by design — only Taiwan flips on.

## Follow-up — T17: bus / cable-car line modes (SF Bay)

Deferred; T16 leaves the seams (§6). Captured so it isn't lost:

- **Use case:** "everything on rails (BART, Muni Metro, Caltrain, cable cars,
  historic streetcars) + bus lines 38R & 14R." Rails come from the §1 mode set
  (add `tram`/`cable_car`/`funicular`); buses are **curated**, not bulk.
- **Work:** add `route=bus` extraction limited to
  `transitOverrides.curatedRoutes`; re-admit those routes' stop nodes past the
  station gate (§6); model curated bus lines as their own presets/options;
  per-`ref` selection (38R/14R).
- **New region needed:** no SF/California pack exists in `regions.yaml`; T17 adds
  one (`us-california` or a metro-scoped extract) with its own PBF + verification.
- **Risk:** bus stop volume is huge — curation-by-`ref` is mandatory, and the
  non-rail gate must stay default-on everywhere else.

## Out of scope

- **Bus / non-rail line implementation** — deferred to T17 (seams only here).
- Enabling the railway flag for Japan/NL (separate verified opt-in later).
- bbox→boundary clipping; GTFS feeds outside Japan; coverage UX (T10).
- Curating upstream OSM gaps beyond what spatial attach recovers.

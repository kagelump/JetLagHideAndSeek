# T14 — Transit station + route quality (packs, with shared fixes)

## Context

T13 ([13-transit-routes-in-packs.md](13-transit-routes-in-packs.md)) wired OSM
route lines into offline packs. Reviewing the regenerated Taiwan pack in the
bundle viewer surfaced four quality problems, three of which are **pack bugs or
crude reimplementations**, not just upstream OSM noise. Evidence was gathered
from `data/packs/cache/asia-taiwan-latest.osm.pbf` and the shipped bundle.

1. **Non-rail nodes ingested as stations.** The pack's `mapStationRecord`
   ([buildTransit.mjs:232](../../../data/packs/scripts/lib/buildTransit.mjs:232))
   is a "simplified version of `mapOsmNode`" that **dropped the rail-mode gate**.
   The Japan `mapOsmNode` rejects any node without a `railway` tag
   ([osmStations.mjs:61](../../../data/transit/scripts/lib/osmStations.mjs:61))
   to filter the bus terminals / ferry landings / gondolas that the broad
   `public_transport=station` osmium filter pulls in. Measured contamination:
   **Taiwan 226/797 (28%)** non-rail (104 bus, 100 ferry), **NL 310/2184 (14%)**.
   This explains every "orphan non-train" the review flagged (黄岐港,
   大佳/美堤碼頭 = `amenity=ferry_terminal`; 行天宮, 捷運…站 bus stops =
   `amenity=bus_station`, all carrying `public_transport=station`, no `railway`).

2. **Cross-operator routeId attachment bug (the turquoise-station cause).** The
   Circular Line (環狀線) route is real and **yellow** (`colour=#ffd900`), and
   `processOsmRoutes` globally resolves 新北產業園區 (`osm:node:2083320848`) as
   one of its members. But the route relation is tagged
   `operator=臺北大眾捷運股份有限公司` while the **station node** is tagged
   `operator=新北捷運公司` (real-world operator handover; OSM tags disagree).
   `buildPresets` attaches a route's `routeId` only to member stations **inside
   the same operator preset as the route**
   ([buildTransit.mjs:360](../../../data/packs/scripts/lib/buildTransit.mjs:360))
   — and `conflateStage` does the same in Japan
   ([conflateStage.mjs:259](../../../data/transit/scripts/lib/conflateStage.mjs:259)).
   So the link is silently dropped and the station falls back to
   `defaultColor` (#1f6f78 turquoise). **Any station whose OSM `operator` tag
   disagrees with its serving route's loses its color** — common at interchanges
   and operator-boundary stations.

3. **Per-train route proliferation.** Taiwan OSM models lines as one relation
   per scheduled train: THSR shows **149 routes** in the bundle (`台灣高鐵 603
南港→左營`, `805 …`), **all `colour=NONE`, no `route_master`**. TRA local
   trains are the same (`區間 1112 新竹→基隆`). `route_master` is inconsistent —
   淡水信義線/板南線 have masters; 環狀/機場/文湖/THSR don't — so masterless
   variants explode into separate lines, bloating the legend and bundle.

4. **Weak dedup + sparse colour (context).** The pack dedups by exact
   `name|lat.toFixed(4)|lon.toFixed(4)` (~11 m), far cruder than the pipeline's
   `dedupeOsmStations` (id → wikidata → normalized-name-within-150 m). Only
   **54/269 (20%)** of Taiwan rail routes carry an OSM colour, so uncolored
   lines need a fallback or curation.

**Key realization:** once routeIds attach **globally** and member-stations
**union** across variants (fix #2 + #3's union), coloring no longer depends on a
"local service that stops everywhere" existing — every station any train (express
or local) touches gets colored. Collapsing per-train relations is therefore about
**legend cleanliness + bundle size**, not correctness.

Read first: `buildTransit.mjs`, `osmStations.mjs` (`mapOsmNode`,
`dedupeOsmStations`), `osmRoutes.mjs` (`processOsmRoutes`, master grouping),
`conflateStage.mjs:200–428` (the OSM-baseline attach), `normalizeOperator.mjs`.

## Decisions (from review)

| Fork               | Decision                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Line color         | **OSM colour + curated overrides.** Use OSM `colour` where present; a `transitOverrides` colour map fills gaps; deterministic per-line fallback last.                                                                                                                                                                                                  |
| Per-train collapse | **One line per logical line.** Group masterless variants by normalized line name (strip direction / train number) + `route_master` where present; union stops; keep one geometry.                                                                                                                                                                      |
| Code location      | **Shared `processOsmRoutes` / shared attach helper.** Fix in the shared transit lib so Japan benefits (the JR-East buglist item is partly the same masterless proliferation). Requires a Japan regression pass.                                                                                                                                        |
| Name suffixes      | **Per-region `transitOverrides.nameSuffixes`, wired for both packs.** Taiwan = `[站, 車站]`. NL = **empty by default** — the data shows last-tokens are meaningful (`Zuid`/`Centraal`/`Noord`/`West`/`Oost`); stripping them would over-merge distinct stations. The slot exists; NL stays empty until a real source-name mismatch justifies an entry. |

## What to build

### 1. Station ingestion — reuse the real primitives (pack-only)

Replace the two simplified copies in `buildTransit.mjs`:

- `mapStationRecord` → **`mapOsmNode`** (imports cleanly; the osmium
  `geojsonseq -a type,id` export gives flat props, which `mapOsmNode` handles via
  `props.tags ?? props`). Brings the **railway gate** (kills the 28%/14% non-rail
  noise), `nameVariants`, and `normalizedName`. Pass `region.id`, the locale
  `suffixes`, and a `stats` accumulator; log `stats.skippedNonRailway`.
- `dedupeStations` → **`dedupeOsmStations`** (id → wikidata → normalized-name
  within `maxClusterMeters`). Adapt `buildPresets` to the `mapOsmNode` record
  shape (`id` already `osm:node:…`, `tags`, `operator`) — this actually
  simplifies `buildPresets`, since the route code already wants that shape.
- **Accept cross-operator merge as designed.** `dedupeOsmStations` merges
  co-located same-name nodes across operators (the two 新北產業園區 platforms →
  one record). That is desirable here: with the global routeId fix (§2) the
  merged node collects **both** lines' routeIds → the viewer renders concentric
  rings (yellow + purple). Add a test asserting the merge + multi-color outcome
  so nobody "fixes" it back to per-operator orphans.
- **Name suffixes — wire `transitOverrides.nameSuffixes` per region** (passed as
  `mapOsmNode`'s `suffixes` and into `dedupeOsmStations`/stop resolution):
    - **Taiwan = `[站, 車站]`** — tightens name-based dedup/resolution where one
      source includes the 站 suffix and the other omits it. Guard with an
      over-merge test (`中山` must not merge with a different `中山`).
    - **NL = `[]` (empty).** Verified against the PBF: the common last-tokens are
      `Zuid` (13), `Centrum` (12), `Centraal` (10), `Noord` (8), `West` (6),
      `Oost` (6) — all **meaningful** ("Rotterdam Zuid" ≠ "Rotterdam Centraal");
      stripping them would corrupt dedup. `Station` appears only 3×. So the slot
      is wired but carries no entries until a concrete source-name mismatch is
      found. Add a test asserting NL direction-qualified stations stay distinct.

### 2. Global routeId attachment — split line-placement from coloring (SHARED)

Today one step does two jobs and conflates them: it puts a route's **line** in
the operator preset **and** only colors that preset's member stations. Split:

- **Route line → operator preset** (by normalized operator): unchanged.
- **routeId → every member station, in every preset that contains it** (operator
  presets **and** the coverage preset), keyed by `sourceId`/`mergeKey`, using the
  line's global `memberStationIds`. This is the decisive Q2 fix.

Factor this into a **shared helper** — e.g.
`data/transit/scripts/lib/attachRoutes.mjs`
`attachRoutesToPresets(presets, lines, normalizeOp)` — and call it from **both**
`buildPresets` (pack) and `conflateStage` (Japan), replacing the two ad-hoc
loops. Behavior to preserve: route entry shape `{ id, name, color, sourceId,
geometry }`; `color` falls back to the owning preset's `defaultColor`.

Add a polarity-style test: a route in operator-A's preset whose `memberStationIds`
includes a station tagged operator-B gets its `routeId` onto the operator-B
**and** coverage station copies.

### 3. Collapse masterless variants into logical lines (SHARED)

Extend `processOsmRoutes` master grouping ([osmRoutes.mjs](../../../data/transit/scripts/lib/osmRoutes.mjs)):

- Keep existing `route_master` grouping.
- For **masterless** routes, group by a **line key** =
  `normalizeOp(operator)` + `lineNameKey(name)`, where `lineNameKey` strips
  direction markers and train numbers. Direction tokens are locale-configurable
  (`transitOverrides.directionTokens`) with defaults covering CJK + EN:
  `順向/逆向/上り/下り/往程/返程/(西向)/(東向)/(順行)/(逆行)/inbound/outbound`,
  parenthetical `（…）` direction suffixes, and trailing/embedded train numbers.
    - THSR: `台灣高鐵 603 南港→左營` → key `台灣高鐵` → 175 variants → ~1 line.
    - 環狀: `臺北捷運環狀線（大坪林→新北產業園區）` → `臺北捷運環狀線` → 1 line.
- Per group: **union** all variants' resolved `memberStationIds`; keep the
  most-complete variant's geometry (or a MultiLineString of distinct branch
  geometries — do **not** improve the zigzag here, that's the separate buglist
  item); derive name from the stripped key; pick colour per §4.
- This touches Japan too (per-departure JR variants) — see Risks; gate on a
  Japan route-count before/after diff.

### 4. Colour resolution order (SHARED + config)

`color = OSM colour/colour tag → transitOverrides line/operator override →
deterministic per-line fallback`.

- Replace the constant `operatorColor()` (#1f6f78 everywhere) with a
  **stable hash → distinct hue** keyed by line key, so uncolored lines are at
  least visually separable instead of a turquoise smear. Keep `#1f6f78` only as
  the true last-resort station fallback (no route at all).
- Add `transitOverrides.routeColors` to `regions.yaml`: `{ lineKeyOrOperator:
"#hex" }`. Seed Taiwan's uncolored majors (THSR, TRA service classes) — leave
  exact hexes as a curation step, validated in the viewer.

### 5. pack-lint + tests

- pack-lint: route count per operator within a sane bound (guards proliferation
  regression — THSR ≤ a small N); every route `color` a valid hex; the §1 build
  log shows `skippedNonRailway > 0` for Taiwan/NL.
- `node --test` (pack): non-rail fixture nodes dropped; cross-operator routeId
  attach (§2); masterless collapse (§3) folds N same-line variants → 1 with
  unioned stops; colour resolution order (§4).
- **Japan regression (required):** `pnpm test:data:transit` green; capture
  per-bundle route counts in `assets/transit/` before/after the shared changes
  and diff — collapse must not erase distinct Japan lines or merge unrelated
  ones. Spot-check JR East in the data viewer (it may _improve_).

### 6. Regenerate + republish (NOT committed — see T13 §4)

```bash
pnpm data:pack -- --region asia-taiwan
pnpm data:pack -- --region europe-netherlands   # verify collapse is no-op/benefit, no over-merge
node tools/data-viewer/server.mjs               # eyeball both
pnpm data:pack:lint
pnpm data:pack:publish -- --region asia-taiwan
pnpm data:pack:publish -- --region europe-netherlands
```

Only `site/packs/catalog.json` is committed; the `transit.json.gz` blobs go to
the GitHub Release.

## Acceptance / how we know it's better

- Taiwan station count drops ~28% (non-rail gone); 黄岐港 / 碼頭 / bus-stop
  orphans absent from the bundle.
- 新北產業園區 renders **yellow + purple concentric rings** (Circular + Airport),
  not turquoise.
- THSR collapses from 149 routes to ~1 logical line; legend is readable.
- Uncolored lines show distinct fallback hues, not uniform turquoise.
- Japan bundles unchanged in spirit (route-count diff reviewed; JR East no worse).

## Out of scope

- **Route-line geometry stitching** (the zigzag stop-position fallback) — buglist
  `Train lines` [H], unchanged here.
- **bbox → boundary-polygon clipping** — explicitly deferred (acceptable now).
- GTFS feeds outside Japan; coverage UX (T10).
- A full Japan JR-East fix/validation pass — this task only must not regress
  Japan; capitalizing on the shared collapse for Japan is a follow-up.

## Risks

- **Shared-code blast radius.** §2–§4 touch `processOsmRoutes` / the attach path
  used by Japan. Mitigate with the §5 Japan regression diff before publishing.
- **Line-key over/under-merge.** `lineNameKey` is heuristic; two distinct lines
  with the same stripped name over-merge, or one line named inconsistently
  across variants under-merges. Mitigate with config + targeted tests; tune
  `directionTokens` per region.
- **Cross-operator dedup** merges same-name co-located stations by design; verify
  150 m is tight enough that it never merges genuinely-distinct stations.

## Done when

- §1–§5 implemented; Taiwan + NL packs regenerated, lint-clean, republished
  (catalog recommitted, blobs on the Release).
- Acceptance bullets verified in the viewer.
- `pnpm test` + `pnpm check` + `pnpm test:data:transit` green, with the Japan
  route-count diff reviewed and benign.

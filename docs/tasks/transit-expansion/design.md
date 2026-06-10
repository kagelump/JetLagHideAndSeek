# Transit Station Expansion — Design (Japan First, Locale-Generic Pipeline)

> Implementation is broken into tasks in this folder — start at
> [README.md](README.md) (the epic doc).

## Goal

Expand the hiding-zone transit preset bundle from Tokyo Metro + Toei Subway
(334 stations, 2 operators, 294 KB) to **all railway stations in Japan**
(~9,000+ stations, 100+ operators) with route lines and colors, using a
pipeline whose design is locale-generic from day one. Adding London, Taipei,
the SF Bay Area, or all of Schengen later must be a config change plus
normalization tables — not pipeline rework.

**Non-goal (this phase):** shipping non-Japan bundles. The architecture must
make them straightforward; the first ship is Japan.

## Why the original draft was rewritten

The earlier draft merged stations at **runtime** via a coordinate-grid
mergeKey (`geo:` + coords rounded to ~11 m). That fails in practice:

- Grid rounding is a snap, not a clustering — two records of the same station
  1 m apart can straddle a cell edge and not merge.
- Real OSM-node ↔ GTFS-stop offsets are routinely 50–300 m at large complexes
  (GTFS stops are platform centroids/entrances; OSM nodes sit at the station
  label point). The OSM baseline and GTFS enrichment would almost never merge.
- The failure mode corrupts the **transit-line question**: an unmerged OSM
  twin has `routeIds: []`, so a "No, not on line X" answer eliminates the GTFS
  circles while the twin's circle ~50 m away survives — the eliminated hiding
  zone reappears. Eliminations are the core game mechanic; this is a hard
  correctness bug, not cosmetic duplication.

The fix: **conflation happens offline in the pipeline**, which emits canonical
ids. The app's existing merge-by-key in `getSelectedStations` stays exactly as
it is — but the key equality it relies on becomes actually true.

## Decisions (locked)

- **D1 — Conflation signals are wikidata + normalized name + distance.**
  No `stop_area` relations, no transliteration, no blind tight-distance merge
  in this phase. The build report surfaces unmatched near-pairs; stubborn
  cases get manual `aliases` entries.
- **D2 — Station granularity comes from the route source; route-bearing
  stations never merge with each other.** Ōtemachi is ~5 stations (one per
  line, per the ODPT feeds), not one complex. This keeps the transit-line
  question's per-line masks simple and exact. Conflation only _attaches_
  route-less OSM records to route-bearing stations so no route-less twin
  survives. (Accepted approximation: a "Yes, on line X" answer at a transfer
  complex trims the slivers of the other lines' circles that extend past
  line X's circle — geometrically minor at hiding-zone radii.)
- **D3 — Lines are single-sourced per operator** (config-declared `gtfs` or
  `osm`); overlap without a declaration fails the build.
- **D4 — Per-region bundles + manifest from day one**, loaded lazily by
  play-area bbox.
- **D5 — Settings UI is play-area-scoped**: only presets relevant to the
  current play area are shown by default (see Settings UX below).

---

## Correctness invariants (transit-line question)

The matching question "are you on the same transit line?" builds its
elimination mask from `station.routeIds.includes(lineId)`
(`buildTransitLineMaskFeatures`). These invariants must hold for **any**
combination of selected presets, and the pipeline build must verify them:

- **I1 — No route-less twins.** A route-less station record never survives as
  a separate merged station when a route-bearing station for the same
  physical station exists: every route-less contribution either shares its
  mergeKey with a route-bearing station or stands alone in an area with no
  route data. (Otherwise a "No" answer leaves a surviving twin circle.)
- **I2 — Line station sets are complete.** Every station served by a line
  carries that line's canonical `routeId`.
- **I3 — One physical line, one picker entry.** A line appears exactly once in
  `getTransitLineOptions`, regardless of how many sources or
  direction/branch variants describe it.
- **I4 — Stable geometry across preset combinations.** A station's
  coordinates are identical in every preset that contributes it (canonical
  coords written by the pipeline), so circle geometry doesn't shift with
  preset selection.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Data Pipeline (offline, Node.js) — pnpm data:transit         │
│                                                               │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │ OSM PBF      │  │ OSM route        │  │ GTFS zips      │   │
│  │ station nodes│  │ relations        │  │ (ODPT, Mobility│   │
│  │ (Geofabrik)  │  │ (+route_master)  │  │  DB, NAPs, …)  │   │
│  └──────┬───────┘  └────────┬─────────┘  └───────┬────────┘   │
│         │                   │                    │            │
│         ▼                   ▼                    ▼            │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1. extract     — per-source station + line records   │     │
│  │ 2. normalize   — names (NFKC, suffix strip, scripts) │     │
│  │ 3. conflate    — attach route-less records to seeds  │     │
│  │ 4. emit        — presets + per-region bundles +      │     │
│  │                  manifest + build report + NOTICE    │     │
│  └──────────────────────┬───────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  assets/transit/manifest.json                                 │
│  assets/transit/<bundle>.json   (one per region)              │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼ lazy load by play-area bbox
┌──────────────────────────────────────────────────────────────┐
│  App Runtime (unchanged merge mechanics)                      │
│                                                               │
│  getSelectedStations(presets)                                 │
│    - Map keyed by mergeKey (pipeline-assigned canonical id)   │
│    - routeIds / routeColors / sourceStationIds union          │
│    - presets sorted by source priority; nameEn merged         │
└──────────────────────────────────────────────────────────────┘
```

### Division of labor

| Concern                                                | Where it lives                                   |
| ------------------------------------------------------ | ------------------------------------------------ |
| Station conflation (wikidata + name + distance)        | Pipeline                                         |
| Line identity (direction grouping, cross-source dedup) | Pipeline                                         |
| GTFS parent-station collapsing, mode filtering         | Pipeline                                         |
| Locale normalization (name suffixes, scripts)          | Pipeline config tables                           |
| Merging contributions from selected presets            | App (`getSelectedStations`, unchanged mechanics) |
| Picking which bundles to load                          | App (manifest bbox vs play-area bbox)            |
| Reducing visible presets to the play area              | App (settings UI + derived counts)               |

---

## Canonical Identity

Reuses the existing formats in `src/features/transit/transitIdentity.ts` —
no new id grammar, so `isCanonicalTransitRouteId` /
`isCanonicalTransitStationId` and the persisted-question normalization keep
working.

### Station identity (mergeKey)

- Route-bearing station (a **seed**): `gtfs:<namespace>:stop:<stopId>` or
  `osm:node:<id>` depending on which source defines it.
- Standalone route-less station: `osm:node:<id>`.
- Wikidata QIDs are **merge evidence, not ids**.

The pipeline fixes one canonical `lat`/`lon` per station and writes it into
every preset contribution (invariant I4).

### Line identity (routeId)

A "line" is the unit the transit-line question asks about — the named line a
rider would say they're on, not a GTFS trip pattern or a per-direction OSM
relation.

- GTFS: `gtfs:<namespace>:route:<anchorRouteId>` where variants are grouped
  first (see Line grouping). Anchor = lexicographically smallest grouped
  `route_id` (deterministic across rebuilds).
- OSM: `osm:relation:<routeMasterId>` (the `route_master`; a bare `route`
  relation only when no master exists).

ODPT namespaces (`odpt-tokyo-metro`, `odpt-toei-subway`) are preserved, so
`lineId`s persisted in existing questions remain valid.

---

## Conflation Spec (pipeline)

### Seeds and attachments (D2)

- A **seed** is a route-bearing station record: a GTFS stop (after
  parent-station collapsing) serving ≥1 kept line, or an OSM station node
  that is a `stop`/`station` member of ≥1 kept route relation.
- **Seeds never merge with each other.** Station granularity is whatever the
  route source says: per-line stops (ODPT) stay per-line; a generic feed's
  multi-line `parent_station` stays one multi-line station. Per-operator
  single-sourcing (D3) guarantees one physical line never produces two seeds
  for the same station.
- A **route-less record** (plain OSM `railway=station` node not in any kept
  route relation) is matched against seeds within `maxClusterMeters`
  (default **150 m**). Match signals, in order:
    1. same `wikidata` QID,
    2. normalized-name match against the seed's full name set
       (`name`, `name:en`, `alt_name`, GTFS `translations.txt` variants),
    3. manual `aliases` entry (force-attach or forbid-attach).
- A matched route-less record **attaches**: it contributes `nameEn`,
  `wikidata`, and tag completeness to the seed(s) and emits **no station of
  its own**. One OSM node may attach to several seeds (the Ōtemachi node
  enriches all five per-line seeds).
- An unmatched route-less record becomes a **standalone station**. Standalone
  records also conflate among themselves with the same signals (handles
  duplicate OSM nodes for one rural station).

Distinct adjacent stations with different names never merge (name gate);
identical names across a city never merge (distance gate). That combination
is the property a pure-distance or pure-name scheme can't give you.

**Name normalization** (per-locale tables, not code):

- Unicode NFKC, case-fold, collapse whitespace.
- Strip locale suffixes/prefixes: `駅` (ja), `Station`/`Railway Station` (en),
  `Bahnhof`/`Hbf` (de), `Gare de` (fr), `站`/`車站` (zh) — a `nameSuffixes`
  list per locale in config.
- No transliteration: where scripts differ across sources, matching runs
  against the full name set (`name:en` etc.) and falls back to
  wikidata/aliases. This keeps the scheme honest in Taipei (zh + en) and
  Schengen (Latin/Greek/Cyrillic mixes).

### GTFS preprocessing (per feed)

Required for generic feeds even though the current ODPT feeds don't need
them all:

- **Parent-station collapsing**: stops with `parent_station` collapse into
  the `location_type=1` parent. Without this, a station splits into
  per-platform stops, each carrying a subset of its lines (breaks I2).
- **Mode filter**: keep only routes whose `route_type` is in the feed's
  `routeTypes` allowlist, including **extended route types** (`100–117` rail,
  `400–404` metro, `900–906` tram) used by European NAP feeds. Buses are
  excluded by default — bus `route_id`s would otherwise flow through the
  `stop_times` join into station `routeIds` and the line picker.
- **Line grouping**: group `route_id`s by
  `(agency_id, route_short_name || route_long_name)` when
  `lineGrouping: short_name` (default for generic feeds), or keep raw
  `route_id`s when `lineGrouping: route_id` (the ODPT feeds — already
  line-granular, and preserves existing persisted `lineId`s). Otherwise
  per-direction modeling doubles every line in the picker (I3).
- **Agency split**: one feed may produce **multiple presets**, partitioned by
  `agency_id`. This is what makes regional aggregate feeds usable — SF Bay
  Area's 511.org feed is one GTFS feed covering ~30 agencies; Schengen NAP
  feeds are often country-wide.

### Line conflation across sources (D3)

Config declares one `routeSource` per operator/network:

```yaml
operators:
    - match:
          {
              gtfsNamespace: odpt-tokyo-metro,
              osmOperator: ["東京メトロ", "Tokyo Metro"],
          }
      routeSource: gtfs # OSM route relations for this operator are dropped
    - match: { osmOperator: ["JR東日本", "East Japan Railway Company"] }
      routeSource: osm # until a JR East GTFS feed is added
```

The pipeline **fails the build** if two sources both contribute lines for the
same operator without a declaration — overlap is a config error to resolve,
never a runtime duplicate.

**Through-running services** (Japan 直通運転; London Overground ↔ National
Rail): each operator's line stays a separate picker entry — matches the
game's usage.

### OSM route relations (in this phase, not future)

Without route data, OSM-baseline stations have `routeIds: []` and the
transit-line question is silently dead everywhere GTFS doesn't reach — in
Japan that's most operators (JR East alone is most of Kantō):

- Extract relations `type=route` + `route` ∈ {`train`, `subway`,
  `light_rail`, `monorail`, `tram` (per-locale)} with osmium
  `--add-referenced`.
- Group per-direction relations under their `route_master`; the master is the
  line (id, `name`, `colour` tag → route color).
- Line↔station membership comes from relation `stop`/`station` member roles —
  **exact membership, no spatial join**. A station node that is a member of N
  route relations carries N routeIds by construction (I2). This is the
  highest-fidelity transfer-station source available.
- Route geometry from way members; fall back to the ordered station sequence
  when ways are incomplete (same fallback the GTFS path has for missing
  `shapes.txt`).

---

## Data Sources

| Source                                  | Provides                                                  | Notes                                                            |
| --------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| Geofabrik PBF (per region)              | Station nodes, route relations, `wikidata`/`name:en` tags | Reuses `data/geofabrik/cache/`                                   |
| ODPT GTFS (Tokyo Metro, Toei)           | Lines, colors, geometry — already shipping                | Namespaces preserved                                             |
| Mobility Database catalog               | GTFS feed URLs with stable `mdb-<id>` references          | Config stores the MDB id so dead URLs are re-resolvable          |
| (later) EU NAPs / DELFI / 511.org / TDX | Country- or region-aggregate GTFS                         | Needs agency split + extended route types — both specified above |

GTFS coordinate quality varies; OSM Japan station nodes are excellent. GTFS
seeds keep their own coordinates (consistent with their route geometry); the
design does not depend on either source being "survey-grade".

---

## Config

`data/transit/config.yaml`. One file, multiple locales; each locale is
self-contained.

```yaml
outputDir: ../../assets/transit
cacheDir: cache
notice: NOTICE.md

locales:
    - id: japan
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      aliases: [] # force-attach / forbid-attach record pairs

      osm:
          regions:
              - {
                    id: japan-kanto,
                    pbf: "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf",
                }
              - {
                    id: japan-kansai,
                    pbf: "https://download.geofabrik.de/asia/japan/kansai-latest.osm.pbf",
                }
              - {
                    id: japan-chubu,
                    pbf: "https://download.geofabrik.de/asia/japan/chubu-latest.osm.pbf",
                }
              - {
                    id: japan-tohoku,
                    pbf: "https://download.geofabrik.de/asia/japan/tohoku-latest.osm.pbf",
                }
              - {
                    id: japan-chugoku,
                    pbf: "https://download.geofabrik.de/asia/japan/chugoku-latest.osm.pbf",
                }
              - {
                    id: japan-kyushu,
                    pbf: "https://download.geofabrik.de/asia/japan/kyushu-latest.osm.pbf",
                }
              - {
                    id: japan-shikoku,
                    pbf: "https://download.geofabrik.de/asia/japan/shikoku-latest.osm.pbf",
                }
              - {
                    id: japan-hokkaido,
                    pbf: "https://download.geofabrik.de/asia/japan/hokkaido-latest.osm.pbf",
                }
          stationTags:
              [
                  "n/railway=station",
                  "n/railway=halt",
                  "n/public_transport=station",
              ]
          routeTypes: [train, subway, light_rail, monorail]

      gtfs:
          - id: tokyo-metro
            label: Tokyo Metro
            namespace: odpt-tokyo-metro # preserved — keeps persisted lineIds valid
            url: "https://api.odpt.org/api/v4/files/TokyoMetro/data/TokyoMetro-Train-GTFS.zip?acl:consumerKey=${ODPT_KEY}"
            requiresKey: true
            lineGrouping: route_id # ODPT is already line-granular
            routeTypes: [1]
            defaultColor: "#009BBF"
            license: "ODPT terms — see NOTICE"
          - id: toei-subway
            label: Toei Subway
            namespace: odpt-toei-subway
            url: "https://api-public.odpt.org/api/v4/files/Toei/data/Toei-Train-GTFS.zip"
            requiresKey: false
            lineGrouping: route_id
            routeTypes: [1]
            defaultColor: "#6CBB5A"
            license: "ODPT terms — see NOTICE"
          # Future feeds default to: lineGrouping: short_name,
          # routeTypes: [0,1,2, 100-117, 400-404], optional presets: [{agency: …}]

      operators:
          - match:
                {
                    gtfsNamespace: odpt-tokyo-metro,
                    osmOperator: ["東京メトロ", "Tokyo Metro"],
                }
            routeSource: gtfs
          - match:
                {
                    gtfsNamespace: odpt-toei-subway,
                    osmOperator: ["東京都交通局", "Toei"],
                }
            routeSource: gtfs
          # Everything else defaults to routeSource: osm. Adding a GTFS feed for
          # an operator without declaring it here fails the build.
```

What a future locale needs (and **only** this — pipeline code is closed):

| Locale      | Config additions                                                                                                  | Pre-specified feature it exercises                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| London      | TfL GTFS (Mobility DB), National Rail feed; `nameSuffixes: ["Station", "Railway Station", "Underground Station"]` | `lineGrouping: short_name`, `route_master` grouping                                                             |
| Taipei      | TDX/MOTC GTFS; `nameSuffixes: ["站", "車站"]`                                                                     | Multi-script name sets (zh `name` + `name:en`), wikidata joins                                                  |
| SF Bay Area | 511.org regional feed with `presets: [{agency: BART}, {agency: SFMTA}, …]`                                        | Agency split (one feed → many presets)                                                                          |
| Schengen    | Per-country NAP/DELFI feeds + Geofabrik country regions                                                           | Extended route types, country-aggregate agency split, manifest lazy loading at scale, per-feed `license` review |

---

## Output Format

### Per-region bundles + manifest (D4)

```
assets/transit/manifest.json
assets/transit/japan-kanto.json
assets/transit/japan-kansai.json
…
```

`manifest.json` lists `{ id, bbox, file, presets: [{ id, label, bbox }] }` per
bundle. The app loads only bundles whose bbox intersects the play area (the
POI-bundle pattern). Metro needs literal `require()`/`import()` paths, so the
pipeline emits a generated require-map module (the `bundledPois.ts` pattern) —
a missing artifact is a build break, not a runtime fallback.

Each bundle contains the presets whose bbox center falls in that region: the
region's OSM baseline preset plus the GTFS presets centered there. Preset ids
are globally unique across bundles (the pipeline enforces it).

The OSM baseline preset for a region contains **every** station in the
region: seeded clusters contribute per-seed entries (`mergeKey` = seed id,
canonical coords, `routeIds: []`), standalone stations contribute themselves.
Selecting only "OSM Kantō" therefore shows Ōtemachi as ~5 fallback-colored
dots (accepted under D2); also selecting Tokyo Metro/Toei enriches the same
mergeKeys with lines and colors via the unchanged runtime merge.

### Schema additions

```typescript
// TransitStationContribution / TransitStation: one new optional field
nameEn?: string;        // best English/romanized name across sources

// mergeKey: pipeline-assigned canonical station id
// (osm:node:<id> or gtfs:<ns>:stop:<id>) — same grammar transitIdentity.ts
// already validates. Canonical lat/lon repeated in every contribution.

export function sourcePriority(source: TransitSource): number {
  return source.kind === "gtfs" ? 0 : 1;
}
```

Merge rules in `getSelectedStations` (mechanics unchanged, two additions):

| Field                                         | Rule                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `lat`, `lon`, `name`                          | Highest-priority source wins (presets pre-sorted by `sourcePriority`); pipeline already wrote identical canonical coords everywhere |
| `nameEn`                                      | First non-empty value from any source                                                                                               |
| `routeIds`, `routeColors`, `sourceStationIds` | Union (existing behavior)                                                                                                           |

### Build report (pipeline output, not shipped)

`data/transit/report/<locale>.md`, regenerated every run:

- route-less records within `maxClusterMeters` of a seed that did **not**
  attach (the review queue for `aliases`)
- operators with stations but no line source (transit-line question dead
  zones)
- lines whose station count changed > 10% since the last committed bundle
- per-preset station/line counts and bundle sizes

The report is how invariants I1–I4 stay verified at 9,000 stations: checked
mechanically every build, exceptions human-reviewed once, at build time.

---

## Settings UX — selecting presets without drowning (D5)

Today `HidingZoneScreen` lists every preset in two flat sections ("Suggested"
by bbox intersection, "Other"). Fine at 2 presets; unusable at 30+ per locale
and absurd at Schengen scale. The redesign keeps **preset granularity**
(operator/network — never individual lines; the transit-line question already
narrows lines by distance from the pin) and scopes everything to the play
area:

1. **Play-area scoping is the default view.** Only presets whose bbox
   intersects the play area appear. Everything else lives behind a collapsed
   "Browse all regions" row with a search field (searches label + locale).
   With no play area set, show the browse-all view directly.
2. **Two groups within the scoped view:**
    - **Operators** — GTFS/OSM-route presets (have lines + colors), sorted by
      station count within the play area, descending.
    - **All stations (coverage)** — the regional OSM baseline preset(s),
      presented as a single "All stations in <region>" row.
3. **In-play-area counts, not totals.** Each row shows
   "_N stations in your play area_" (computed from contributions within the
   play-area bbox), so "JR East — 1,742 stations" becomes "JR East — 213
   stations in your play area". A preset intersecting the bbox but
   contributing 0 stations inside it is hidden.
4. **One-tap setup.** A "Add all operators in play area" action selects every
   operator preset in the scoped list (not the coverage preset — that's an
   explicit choice). Selection stays additive and per-preset removable, as
   today.
5. **Derived-station clipping.** `selectedStations` is filtered to the
   play-area bbox expanded by the hiding-zone radius before deriving zones,
   map overlays, and question masks. This keeps a Japan-wide preset selection
   from rendering 9,000 circles when the play area is one city, and bounds
   the transit-line option scan. (The clip is a derived-state filter, not a
   mutation of the stored selection — changing the play area re-derives.)

Visual/UX details stay native to the existing sheet patterns: same
`PresetRow` add/remove affordance, `SheetScrollView`, fixed snap points, and
stable testIDs for Maestro.

---

## App-Side Changes

| File                                                                     | Change                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/features/transit/transitTypes.ts`                                   | Add `nameEn?`; add `sourcePriority()`                                              |
| `src/features/hidingZone/hidingZone.ts`                                  | Priority sort + `nameEn` merge in `getSelectedStations`; play-area clip helper     |
| `src/features/hidingZone/hidingZoneData.ts`                              | Manifest-driven lazy loading by play-area bbox; per-bundle cache                   |
| `src/features/hidingZone/HidingZoneScreen.tsx`                           | Play-area-scoped preset picker (see Settings UX)                                   |
| `src/features/questions/transitLine/TransitLineQuestionDetailScreen.tsx` | Memoize `getTransitLineOptions`                                                    |
| Tests                                                                    | Priority sort, `nameEn` merge, multi-bundle load, clipping, picker grouping/counts |

No map-rendering changes: stations without colors already render
`STATION_FALLBACK_COLOR`; stations without `nameEn` display the local name.
Persisted state is safe: hiding zones persist preset ids + radius (ODPT
preset ids kept), questions persist `lineId` (namespaces kept ⇒ stable).
**Verify before shipping** that the share wire format
(`src/sharing/wire/schema.ts`) embeds no station ids — the mergeKey grammar
changes.

---

## Estimated Sizes

| Scope                      | Stations | Bundles | Total JSON (est.) |
| -------------------------- | -------- | ------- | ----------------- |
| Current (ODPT only)        | 334      | 1       | 294 KB            |
| Japan, OSM baseline + ODPT | ~9,000   | 8       | ~4–5 MB           |
| Japan + 20 GTFS feeds      | ~9,000   | 8       | ~8 MB             |
| Global OSM                 | ~500,000 | ~400    | ~180 MB           |

Per-bundle sizes stay ~0.5–2 MB, loaded lazily by play-area bbox. Exact
counts come from the build report; don't bake guesses into tests (Kantō alone
has well over 2,000 stations).

---

## Attribution & Licensing

- OSM: ODbL — attribution already rendered in-app; NOTICE updated per region.
- Each GTFS feed carries a `license` field in config; the pipeline writes a
  consolidated `NOTICE.md` and embeds an attribution block in each bundle
  (the ODPT pattern). A feed without a reviewed `license` fails the build —
  this matters at Schengen scale where NAP terms vary by country.

---

## Resolved Questions

1. **OSM dedup preference** → subsumed by conflation: among standalone
   route-less records, the canonical record prefers `railway=station` over
   `public_transport=station`, then most-complete tags.
2. **GTFS `nameEn`** → `translations.txt` when present, else per-feed
   `stop_desc` romaji heuristics; OSM `name:en` is the universal fallback.
3. **Shinkansen** → include; excluding is a one-line tag filter if a game
   variant wants it.
4. **Bus stops** → excluded by the mandatory `routeTypes` filter.
5. **`stop_area` relations** → not used (D1). Revisit only if the Phase 2
   build report shows wikidata + name + distance leaving a meaningful
   attachment gap.
6. **Station-complex granularity** → per-line/per-operator stations (D2);
   no "complex" notion unless a concrete game rule demands one.

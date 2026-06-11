# Offline Data Packs — Design

Downloadable per-region data bundles so the app can run a full game — including
play-area setup — in any OSM-supported country, with no live OSM-service
dependency after a one-time download. Blobs hosted on GitHub Releases, catalog
on GitHub Pages.

**Motivation**: Overpass is unreliable and frequently errors out mid-game.
"Offline" here primarily means _removing live Overpass/Photon dependence for
gameplay-critical data_ — the airplane-mode benefit falls out of the same
design. Map tiles are explicitly excluded: the app will never store or host
OSM tiles; the basemap stays the live raster style with ordinary on-device
tile caching.

## Decisions (agreed 2026-06-12)

| Question           | Decision                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Basemap            | **Never packaged.** Live OSM raster tiles + normal cache only; offline basemap is permanently out of scope.         |
| Granularity        | **Geofabrik regions.** Country-level where small, Geofabrik sub-regions (US states, Japan regions) where big.       |
| Build pipeline     | **Local builds** on the dev machine (existing PBF caches/tooling), with a scripted publish step.                    |
| Hosting            | **GitHub Releases for blobs, GitHub Pages branch for the catalog**, in the app repo (see Layout).                   |
| Bundled Japan data | **Stays bundled.** Packs are an additive source; bundled Kantō keeps first-run + E2E deterministic.                 |
| Play-area setup    | **Fully offline.** Packs include admin boundary polygons + a name-search index for the region.                      |
| Transit outside JP | **OSM-only, stations first.** Station presets drive hiding zones; route lines best-effort until stitching is fixed. |
| Compatibility      | **None required.** No users yet — schemas (catalog, installed index, payloads) may break freely until launch.       |

## Goals / Non-goals

**Goals**

1. No gameplay path depends on Overpass/Photon being up: download a region
   once → set play area, build hiding zones, and ask all five question types
   with zero live OSM-service calls. Overpass demotes to a fallback for
   uncovered areas, never a mid-game dependency.
2. Cover any region Geofabrik publishes, with a curated launch list.
3. Reuse the shipped pack machinery (`regionPacks.ts`) and existing extractors
   (`data/geofabrik/`, `data/transit/`) rather than building parallel systems.
4. Free, static hosting; no server-side compute anywhere.

**Non-goals (permanent)**

- Storing or hosting OSM basemap tiles in any form. The basemap remains the
  live raster style; only ordinary tile caching applies.
- Backwards compatibility before launch — no users exist, so schema changes
  are free until then.

**Non-goals (v1)**

- GTFS transit outside Japan; play-area-shaped custom packs; pack auto-update;
  background downloads; diff/delta pack updates.

## Current state (what already exists)

This is an extension, not a green-field build:

- **POI packs work end-to-end** minus hosting: `regionPacks.ts` downloads a
  `.json.gz`, verifies size + MD5 (compressed) + SHA-256 (uncompressed), guards
  decompression bombs and schema versions, registers into the dynamic region
  registry (`registerRegion` in `bundledPois.ts`), persists an installed index,
  and reloads on app start (`loadInstalledPacks`). `OfflineDataScreen` lists
  and installs packs from a manifest — the manifest URL is a placeholder
  (`https://<cdn>/poi/packs.json`).
- **Extraction pipelines are region-config driven**: `data/geofabrik/config.yaml`
  already lists regions with Geofabrik PBF URLs (Japan sub-regions today);
  `data/transit/` has an OSM-only station/route path that needs no GTFS.
- **Boundary compression is designed**: `docs/tasks/admin-boundaries-delta-encoding.md`
  (13.8 MB → 1.6 MB gz for Kantō levels 2–11) — boundaries are the largest v1
  payload, so packs should adopt it from the start.

## Pack model

### A pack is a catalog entry, not an archive

A _pack_ (one per Geofabrik region) is a catalog entry grouping N independent
**artifacts**, one per data class. The app's "Download" button fetches all of
them; each artifact reuses the existing download/verify/install path.

Why not one tar/zip per region:

- The per-artifact `.json.gz` flow is already implemented and tested.
- Partial re-publish: when only `body-of-water` regenerates, only that artifact
  changes; installed packs re-download one file, not 40 MB.
- Per-file integrity and resume come free; no archive/tmp-dir/atomic-unpack
  machinery; every file stays well under GitHub's 100 MB cap without splitting.

### Artifacts per pack

| Kind         | Contents                                                                                | Format                                  | Kantō-scale gz size |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------------- | ------------------- |
| `poi`        | Columnar POIs, all matching categories                                                  | existing `RawRegion` schema             | 0.7 MB              |
| `measuring`  | One artifact per line category: `coastline`, `body-of-water`, `admin-1st/2nd-border`, … | existing measuring bundle schema        | 0.1–7 MB each       |
| `boundaries` | Admin boundary polygons (configured levels, default 4/7/9/10) **+ name-search index**   | delta-encoded rings + index (see below) | ~1.6 MB (delta)     |
| `transit`    | OSM-derived station presets per operator; best-effort route lines                       | existing `assets/transit` bundle schema | 0.2 MB              |
| `meta`       | Pack manifest: ids, bbox, counts, OSM snapshot date, admin-level mapping, attribution   | new, small                              | <10 KB              |

Category availability varies by country (no HSR in most; landlocked countries
have no coastline). `meta` carries an explicit list of present categories so
the app can grey out absent measuring/matching categories instead of silently
returning nothing.

### Boundaries artifact (the new payload)

Two parts:

1. **Polygons**: every admin boundary relation at the configured levels,
   delta-encoded per the existing doc. Keyed by OSM relation id.
2. **Search index**: one row per boundary —
   `{ relationId, name, nameEn?, normalized[], adminLevel, centroid, bbox, areaKm2 }`.
   `normalized` holds lowercase/diacritic-stripped name variants (local name,
   `name:en`, romanization when present in OSM tags). Target <200 KB gz per
   region; it ships inside the same artifact so search and polygons can't skew.

This single artifact serves three consumers: offline play-area setup, the
admin-division matching categories (`admin-1st`…`admin-4th`), and the
measuring admin-border lines' polygon source.

### Admin-level semantics

The app's existing default mapping for `admin-1st`…`admin-4th` is OSM levels
**4 / 7 / 9 / 10** (`adminDivisionConfig.ts` — this is both the generic
default and Japan's: prefecture / city / neighborhood / chōme), and the same
levels are likely a workable default in most countries. The pipeline region
config gains an `adminLevels` mapping (which levels to extract, and which
level corresponds to `admin-1st`…`admin-4th`), defaulting to 4/7/9/10 with
per-region overrides where a country's `admin_level` semantics diverge (e.g.
DE: 4 = Land, 6 = Kreis; US: 4 = state, 6 = county). The mapping is emitted
into `meta` so the app configures the admin-division pack automatically when
a play area falls inside an installed pack — which also resolves the "admin
level should default to country of play area" buglist item for pack-covered
regions.

## Catalog and hosting

### Layout

**App repo, not a new repo.** Releases are repo-scoped (there is no "releases
on a branch"), but a branch covers everything else, and the costs of sharing
the repo are cosmetic for a solo project:

- **GitHub Releases** (on this repo) hold artifact blobs. One release per
  publish epoch, tag-prefixed to stay out of the app's namespace
  (`packs-YYYY-MM-DD`); asset names
  `<region-id>-<kind>[-<category>].json.gz`
  (e.g. `europe-netherlands-measuring-coastline.json.gz`). Mark pack releases
  as pre-release (or keep app releases "latest") so the repo's Latest badge
  stays meaningful.
- **GitHub Pages** serves from an orphan `gh-pages` branch:
  `catalog.json`, a human-readable index page, and the attribution/NOTICE
  page. One Pages site per repo — this claims it for packs, which is fine
  (the app has no other Pages use).
- If release/tag clutter ever grates, splitting into a dedicated repo later
  is a catalog republish (URLs are absolute), zero app changes.

GitHub limits check: Releases allow 2 GB/file and effectively unlimited
storage/bandwidth for open-source use; Pages limits (1 GB site, 100 MB/file,
100 GB/mo soft) only apply to the tiny catalog. Both are CDN-fronted. Plain
GET range/resume works on release assets, which is all the downloader needs.

### `catalog.json` (Pages)

Replaces the existing `PackManifest` (`schemaVersion: 2` — no migration from
v1 needed; nothing is deployed and no users exist, so the v1 manifest path and
any v1-installed packs can simply be dropped):

```jsonc
{
    "schemaVersion": 2,
    "generatedAt": "2026-06-12T00:00:00Z",
    "attributionUrl": "https://<user>.github.io/JetLagHideAndSeek/NOTICE",
    "packs": [
        {
            "id": "europe-netherlands",
            "label": "Netherlands",
            "regionPath": ["Europe", "Netherlands"], // catalog browse tree
            "bbox": [3.31, 50.75, 7.22, 53.7],
            "osmSnapshot": "2026-06-08", // Geofabrik extract date
            "totalBytes": 31457280,
            "artifacts": [
                {
                    "kind": "poi",
                    "url": "https://github.com/<user>/JetLagHideAndSeek/releases/download/packs-2026-06-12/europe-netherlands-poi.json.gz",
                    "bytes": 1234567,
                    "md5": "…", // compressed (FS verify)
                    "sha256": "…", // uncompressed (content verify)
                    "schemaVersion": 1, // per-artifact payload schema
                },
                // measuring-*, boundaries, transit, meta …
            ],
        },
    ],
}
```

Notes:

- URLs are absolute (the existing `PackMeta.url` already is) → blobs can move
  to a dedicated repo or R2/Cloudflare later by republishing only
  `catalog.json`.
- Per-artifact `schemaVersion` lets payload formats evolve independently; the
  app skips artifacts with unknown majors and reports "pack needs app update"
  (the install path already refuses unknown versions). Pre-launch, version
  bumps are free — wipe-and-redownload is an acceptable migration.
- The app pins `MANIFEST_URL` to the Pages catalog URL (replacing the
  `https://<cdn>/poi/packs.json` placeholder) via `src/config/appConfig.ts`.

## Build & publish pipeline (local)

New orchestrator `data/packs/`:

```bash
pnpm data:pack -- --region europe/netherlands   # build one pack into data/packs/dist/
pnpm data:pack -- --all                          # every enabled region
pnpm data:pack:publish                           # gh release upload + regenerate catalog.json + push Pages
```

1. **Region config** (`data/packs/regions.yaml`): Geofabrik path/URL, label,
   `adminLevels` mapping, enabled artifact kinds, per-region overrides.
   Launch with a curated list (~5–10 regions); adding a region = adding an
   entry and rerunning.
2. **Build** per region: fetch/cache the PBF (`fetch-geofabrik.mjs` already
   does this), then run the existing extractors parameterized by region:
   POI reducer, measuring extractor, boundary extractor (new: polygons at
   configured levels + delta encoding + name index), transit OSM-only path.
   Emit `dist/<region-id>/` artifacts + `meta`, then a `pack-lint` step
   (schema validation, count/bbox sanity, hash manifest).
3. **Publish**: `gh release create/upload` the artifacts, regenerate
   `catalog.json` from `dist/` hash manifests, commit to the Pages branch.
   Idempotent: re-publishing a region replaces its assets in a new epoch
   release and repoints the catalog; old releases stay (rollback = repoint).
4. **Validation loop**: `tools/data-viewer` learns to load a `dist/` pack so
   each region can be eyeballed (boundaries, stations, measuring lines)
   before upload.

CI is out of scope for builds (decision), but a tiny CI check should validate
`catalog.json` against its schema on every push to `gh-pages`.

## App-side changes

### Loading (the part that needs care)

`loadInstalledPacks` currently parses every installed JSON into memory at app
start. Fine for 0.7 MB of POI columns; **not** fine for a 25 MB raw
body-of-water bundle. Rule: _registries load eagerly, payloads load lazily._

- `poi`: as today — columnar region registered at start (memory cost is
  acceptable and the kdbush index builds lazily per category already).
- `measuring`: extend `lineBundleLoader.ts` to resolve a category from
  (bundled assets) ∪ (installed pack files), reading + parsing the FS file on
  first use per category, LRU-bounded. Never parsed at app start.
- `boundaries`: name index loads eagerly (small); polygons decode on demand
  per relation id.
- `transit`: installed pack manifests merge into the bundled
  `transitBundles.generated.ts` manifest at start; station/route payloads stay
  lazy by play-area bbox as today.

### Offline play-area setup

- `searchPlayAreas` (Photon) gains a local source: normalized-prefix/substring
  match over installed packs' name indexes, merged ahead of Photon results
  (and used alone when offline). Results carry `source: "pack"`.
- `loadPlayAreaByRelationId` resolution order becomes: bundled Tokyo/Osaka →
  memory → AsyncStorage cache → **installed packs** → Overpass.
- Selecting a pack-sourced area decodes the delta-encoded polygon into the
  same boundary shape the Overpass path produces (including `maskHoles`
  metadata), so everything downstream is unchanged.

### Coverage UX (ties into existing buglist items)

- Derived `coverageStatus(playAreaBbox)`: which packs intersect, installed?,
  up-to-date? Drives: the red (!) badge on Settings when playing in an
  uncovered area, a "Download <region> pack?" prompt on play-area change, and
  per-category greying from `meta`'s category list.
- `OfflineDataScreen` grows: grouped catalog browse (`regionPath`), per-pack
  progress (n of m artifacts), installed size, "Check for updates" (compare
  catalog `osmSnapshot` vs installed; manual update, no auto-download).

### Failure modes

- Partial install (some artifacts failed): pack shows "incomplete — retry";
  installed artifacts already work individually since each registers
  independently. Retry only fetches missing/failed artifacts.
- Catalog unreachable: installed packs are unaffected (load from FS index);
  the catalog list shows cached state with a stale banner.

## Sizing (measured, Kantō-scale region, gzip)

| Artifact                 | Today   | v1 target                                       |
| ------------------------ | ------- | ----------------------------------------------- |
| poi                      | 0.69 MB | same                                            |
| transit                  | 0.22 MB | same                                            |
| measuring: coastline     | 0.30 MB | same                                            |
| measuring: admin borders | 1.85 MB | ~0.9 MB (delta-encode)                          |
| measuring: body-of-water | 7.13 MB | ~4 MB (simplify + delta, verify)                |
| boundaries (levels 2–11) | 3.55 MB | ~1.6 MB (delta; 4/7/9/10-only is smaller still) |
| **Pack total**           | ~14 MB  | **~8–10 MB**                                    |

Budget: target ≤30 MB gz typical country pack, 100 MB hard per-artifact cap
(GitHub file limit headroom); regions that blow the budget get Geofabrik
sub-region packs instead. Body-of-water is the watch item — its extraction
budget work (`docs/measuring-perf/`) directly reduces pack size.

## Licensing & attribution

OSM data is ODbL: packs are a "produced work"/database redistribution —
attribution required, which we already do for bundled data
(`data/geofabrik/NOTICE.md`, transit attribution blocks). Each pack `meta`
carries the attribution block + OSM snapshot date; the Pages site hosts the
NOTICE; `OfflineDataScreen` links to it. Geofabrik extracts are
freely redistributable with OSM attribution. No GTFS terms apply outside
Japan (OSM-only decision).

## Milestones

1. **M1 — Pilot region, POI + measuring**: `gh-pages` branch + catalog
   schema v2 + release publish tooling; `data/packs/` orchestrator;
   generalize POI/measuring extractors beyond Japan config; lazy measuring
   loader; point `MANIFEST_URL` at Pages; ship one small pilot region (e.g.
   Netherlands or Taiwan) end-to-end.
2. **M2 — Boundaries + offline setup**: boundary extractor with delta
   encoding + name index; offline play-area search and relation loading;
   admin-level mapping into the admin-division flow.
3. **M3 — Transit + coverage UX**: OSM-only transit artifacts; manifest
   merge; coverage badges, download prompt, update check. Expand the curated
   region list.
4. **Later (if ever needed)**: download queue improvements / resumable
   multi-artifact installs, delta updates. (No basemap phase — permanently
   out of scope.)

## Open questions / risks

- **Name-index search quality**: OSM `name:en`/romanization coverage is
  uneven outside big cities; may need a transliteration fallback (or accept
  local-script search). Decide during M2 with real data.
- **Boundary level curation**: which levels make _useful play areas_ per
  country needs human judgment; start with the 4/7/9/10 default everywhere +
  per-region overrides in `regions.yaml`. Note play-area selection may also
  want levels the matching categories don't use (e.g. level 6/8 cities in
  countries that put municipalities there) — extraction levels are a
  superset of the matching mapping.
- **JSON parse cost on device** for multi-MB artifacts (boundaries ~6 MB
  raw after delta encoding): measure on Android first (M1 pilot includes a
  parse-time budget); escape hatch is chunked per-level files.
- **`useDownloadPack` is sequential and foreground-only**: a multi-artifact
  pack download needs a small queue with per-artifact status; backgrounding
  is explicitly out of scope.
- **Geofabrik bandwidth courtesy**: local builds with the existing PBF cache;
  don't re-download unchanged extracts (HTTP `If-Modified-Since`).
- **Release asset count**: ~10 artifacts/region × many regions per epoch
  release is fine (GitHub caps assets per release at ~1,000); revisit naming
  if the region list grows past ~80.

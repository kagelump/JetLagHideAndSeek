# T5 — OSM station-node extraction

## Context

Extract every railway station node in Japan from Geofabrik PBFs into
normalized station records. These records are conflation _input_ (T6) — this
task does **not** produce presets or merge anything. It runs as an `osm`
stage in the pipeline and writes intermediate records to a git-ignored
location.

**Read first:** design.md "Data Sources" and the `osm:` block of the Config
section; `data/geofabrik/scripts/` for how this repo already drives osmium
(tags-filter → export → reduce) and caches PBFs; design.md "Name
normalization".

## Prerequisites

`osmium` CLI installed locally (the geofabrik pipeline already requires it —
follow whatever its README/script header says). PBFs are cached in
`data/geofabrik/cache/`; **reuse that cache directory** so a machine that has
run `pnpm data:poi` downloads nothing new.

## What you'll build

1. **Config.** Add the `osm:` block to the japan locale in
   `data/transit/config.yaml` exactly as in the design doc (8 regions,
   `stationTags`, `routeTypes`). T3 already defined region ids/bboxes — fold
   those together so regions are declared once.
2. **Extraction (per region).**
    - `osmium tags-filter <pbf> n/railway=station n/railway=halt n/public_transport=station -o stations.osm.pbf`
    - `osmium export` to GeoJSON(Seq) — newline-delimited preferred; these
      files are intermediates under `data/transit/cache/`, git-ignored.
3. **Record mapping** (`lib/osmStations.mjs`, pure + tested). Each node →
    ```js
    {
      id: createOsmElementId("node", node.id),   // from a port of transitIdentity helpers
      lat, lon,
      name,            // `name` tag; skip nodes with no name at all (count them in stats)
      nameEn,          // `name:en`
      nameVariants,    // [name, name:en, alt_name…] for conflation matching
      wikidata,        // `wikidata` tag or undefined
      operator,        // `operator` tag (used by T7 operator gating)
      tags: { railway, public_transport, highspeed },  // only what's needed downstream
      region,          // geofabrik region id
    }
    ```
    Note: pipeline `.mjs` can't import the app's TypeScript — re-implement
    `osm:node:<id>` formatting in the pipeline lib and add a tiny test
    asserting the format matches `transitIdentity.ts` expectations (string
    fixture, not an import).
4. **Name normalization** (`lib/names.mjs`, pure + tested): NFKC, casefold,
   whitespace collapse, strip `nameSuffixes` from config. This lib is shared
   with T6 — put it in `lib/`, not inside the OSM stage.
5. **Intra-source dedup.** The same physical station sometimes has multiple
   OSM nodes (mapping noise) and regions overlap at boundaries. Within the
   extracted set: group records whose normalized name matches within 150 m
   (or same wikidata), keep the most complete record (`name:en` > `operator`
    > `wikidata` tag presence, then `railway=station` over
    > `public_transport=station` — design doc Resolved Q1), drop the rest, and
    > record drops in stats. Region-boundary duplicates dedupe here too (same
    > node id appearing from two regional extracts: trivially dedupe by id
    > first).
6. **Stage output.** Write `data/transit/cache/osm-stations-<region>.json`
   (records array + stats) for T6 to consume; print per-region counts.

## Acceptance checklist

- [ ] `node --test` coverage with synthetic GeoJSON features for: record
      mapping (incl. missing `name:en`, missing `wikidata`); normalization
      table cases (`新宿駅` ↔ `新宿`, case/width folding); intra-source dedup
      (same-name pair within 150 m → one survivor by completeness; same-name
      pair 5 km apart → both survive; same node id from two regions → one)
- [ ] Full run on a real region (`pnpm data:transit -- --region japan-kanto`)
      completes and reports a plausible count (Kantō: expect well over 2,000
      stations — if you see hundreds, the tag filter is wrong)
- [ ] No `assets/` output from this task; intermediates git-ignored
- [ ] `pnpm check` + `pnpm test` green

## Out of scope

- Conflation against GTFS (T6). Route relations (T7). Presets/bundles for
  OSM stations (T6 emits them once conflation exists).

## Gotchas

- Some stations are mapped as **ways/relations** (station buildings), not
  nodes. This phase extracts nodes only (the design's `stationTags` are
  node-scoped). Count how many named `railway=station` ways the filter drops
  if easy, but don't extract them — note the count in stats so we have data
  for a future decision.
- `name:en` coverage in Japan is good but not universal; never assume it.
- Don't load a whole region GeoJSON into memory if osmium emitted GeoJSONSeq
  — stream line by line (Kantō is big).

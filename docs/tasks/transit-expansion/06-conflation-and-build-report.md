# T6 — Conflation (seeds + attachments) and the build report

## Context

The heart of the epic. This stage takes GTFS station records (T2, the
"seeds" — they carry routeIds) and OSM station records (T5, route-less until
T7) and produces the final station sets per preset, such that **no route-less
twin of a route-bearing station ever ships** (invariant I1). It also emits
the OSM regional baseline presets and the build report that keeps the whole
system reviewable.

This is where the design decisions D1 and D2 live in code. Read
design.md "Conflation Spec" until you can answer: _why do seeds never merge
with each other?_ (Answer: station granularity comes from the route source —
Ōtemachi stays ~5 per-line stations — and per-operator single-sourcing means
seeds can't duplicate a line. Conflation only attaches route-less records to
seeds.)

## What you'll build

`data/transit/scripts/lib/conflate.mjs` — pure functions over arrays of
records; the stage wires I/O around them.

1. **Spatial grid index** (`lib/grid.mjs`): bucket records into
   `maxClusterMeters`-sized cells; neighbor lookup checks the 3×3 cell block,
   then exact haversine distance. (The 3×3 block check is what fixes the
   grid-boundary problem the original design had — a candidate within 150 m
   is always found even across cell edges. Distance math: port the small
   haversine already used in the app's `shared/geojson` — don't pull a
   dependency.)
2. **`attachStationRecords({ seeds, looseRecords, config })`**:
   For each route-less OSM record, find candidate seeds within
   `maxClusterMeters` and attach when (in order):
    1. `wikidata` equality,
    2. normalized-name match — compare the record's `nameVariants` against
       the seed's name set (seed names + `translations.txt` variants from T2),
       using `lib/names.mjs` from T5,
    3. `aliases` from config: `{ attach: [osmId, seedId] }` forces,
       `{ separate: [osmId, seedId] }` forbids (checked first as an override).
    - A record may attach to **multiple** seeds (Ōtemachi node → all five
      per-line seeds). Attachment contributes `nameEn`, `wikidata`, and name
      variants to each seed; the record emits no station.
    - Unattached records become **standalone stations**, then conflate among
      themselves with the same signals (reuse T5's dedup helper).
      Returns `{ enrichedSeeds, standaloneStations, attachments, nearMisses }`
      where `nearMisses` = (looseRecord, seed) pairs within range that no signal
      matched — build-report fodder, never auto-merged.
3. **OSM baseline preset emission (per region).** One preset per region:
   `id: osm-<region>`, `source: { kind: "osm", namespace: "openstreetmap" }`,
   `routes: []`, stations =
    - per-seed contributions for every seed in the region
      (`mergeKey` = seed id, **seed's canonical coords**, `routeIds: []`,
      `name`/`nameEn` from the enriched seed), plus
    - all standalone stations (`mergeKey` = their `osm:node:<id>`).
      This is what makes "OSM Kantō alone" complete, and "OSM Kantō +
      Tokyo Metro" duplicate-free via the app's unchanged mergeKey merge.
4. **Invariant checks (fail the build):**
    - I1: no standalone station within `maxClusterMeters` of a seed with a
      matching normalized name (would mean attachment logic is broken)
    - I4: for every mergeKey, identical coords across all presets that emit it
    - unique preset ids; every station's mergeKey passes the canonical-id
      format check
5. **Build report** (`data/transit/report/japan.md`, git-ignored): sections
   per design doc — near-misses (sorted by distance, with names — this is
   the `aliases` review queue), per-preset counts, count deltas vs the
   committed bundles, operators seen in OSM `operator` tags with no line
   source (preview of T7's coverage gaps).

## Acceptance checklist

- [ ] Synthetic-fixture tests:
    - [ ] wikidata attach across a 120 m gap with different name spellings
    - [ ] name attach: `大手町駅` (OSM) attaches to all five `大手町` seeds;
          emits no standalone station
    - [ ] name gate: adjacent distinct stations (different names, 80 m apart)
          do **not** attach → near-miss recorded
    - [ ] distance gate: identical names 5 km apart don't attach
    - [ ] aliases: force-attach and forbid-attach both honored
    - [ ] standalone conflation: two OSM nodes for one rural station → one
          station
    - [ ] I1/I4 checks actually fail a poisoned fixture
- [ ] Full japan run: build report generated; near-miss list reviewed with a
      senior — seed initial `aliases` entries for anything obviously the same
      station; commit regenerated `assets/transit/` bundles
- [ ] App smoke (with T4 merged): select "OSM Kantō" + Tokyo Metro + Toei →
      Ōtemachi renders as the per-line stations with colors, no extra
      fallback-colored twin within 150 m of any Metro/Toei station (write a
      jest test over the real committed bundle data for exactly this — it's
      the I1 regression test and it runs in CI)
- [ ] `pnpm check` + `pnpm test` green

## Out of scope

- OSM route relations (T7) — until then, OSM-only areas have stations but no
  lines, and the transit-line question shows "No transit lines found within
  range" there. Expected at this milestone.

## Gotchas

- **Never attach by distance alone.** Tokyo is full of physically adjacent,
  genuinely distinct stations. If the report shows a real pair the signals
  miss, the fix is an `aliases` entry or a wikidata edit upstream — not a
  looser matcher.
- Normalized-name matching must compare against the **full variant sets** on
  both sides (OSM `name`/`name:en`/`alt_name`; GTFS stop_name +
  translations). A zh/en or ja/en mismatch with no shared variant and no
  wikidata is a correct near-miss, not a bug.
- Keep per-record allocations flat — this runs over ~10k records × neighbor
  sets; arrays + plain objects, no per-pair regex compilation.

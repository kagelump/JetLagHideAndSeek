# T1 — Pack pipeline scaffold (`data/packs/`)

## Context

Packs are built locally and published to GitHub Releases (see
[design.md](design.md) → "Build & publish pipeline"). This task creates the
orchestrator that every later extractor task (T2 POI, T3 measuring, T6
boundaries, T9 transit) plugs into. It produces no real artifacts yet — just
the skeleton, config, dist layout, hashing, lint, and tests.

Model it on `data/transit/` (config loader + CLI + cache + `node --test`
suites). Read `data/transit/scripts/` before starting.

## What to build

### 1. Region config — `data/packs/regions.yaml`

One entry per pack region:

```yaml
regions:
    - id: europe-netherlands # pack id; must match /^[a-z0-9][a-z0-9-]*$/
      label: Netherlands
      regionPath: [Europe, Netherlands] # catalog browse tree
      pbfUrl: https://download.geofabrik.de/europe/netherlands-latest.osm.pbf # usually Geofabrik, but any PBF mirror works
      adminLevels:
          matching: [4, 7, 9, 10] # admin-1st..4th mapping (design default)
          extract: [4, 7, 8, 9, 10] # superset: levels to include in boundaries artifact
      artifacts: [poi, measuring, boundaries, transit] # enabled kinds
```

Write a loader (`data/packs/scripts/lib/config.mjs`) that parses and
validates this: unique ids, valid id charset (same regex as
`regionPacks.ts` `VALID_PACK_ID`), `matching` exactly 4 ascending levels,
`extract` ⊇ `matching`. Throw with a clear message on any violation —
config errors must fail the build, not produce weird packs.

### 2. CLI — `data/packs/scripts/build-packs.mjs`

```bash
pnpm data:pack -- --region europe-netherlands   # one region
pnpm data:pack -- --all                          # all enabled regions
```

For each selected region:

1. Ensure the PBF is cached (reuse the fetch/cache pattern from
   `data/geofabrik/scripts/fetch-geofabrik.mjs`; cache dir
   `data/packs/cache/`, git-ignored, honour `If-Modified-Since`).
2. Call each enabled artifact builder. In this task the builders are stubs
   registered in a map — `{ poi: notImplemented, measuring: notImplemented, … }`
   — that later tasks replace. `notImplemented` logs and skips.
3. Write `dist/<region-id>/meta.json` (see schema below) and
   `dist/<region-id>/hashes.json` — per artifact file:
   `{ bytes, md5, sha256 }` where `md5` is of the `.gz` bytes and `sha256`
   is of the uncompressed JSON. **These field names are copied verbatim
   into the T4 catalog** (same names, same meaning — the device verifies
   `md5` against the downloaded gz and `sha256` against the inflated JSON,
   exactly like `regionPacks.ts` does today), so don't invent variants like
   `md5OfGz`.

### 3. Dist layout (git-ignored)

```
data/packs/dist/<region-id>/
    meta.json
    hashes.json
    poi.json.gz                       # T2
    measuring-coastline.json.gz       # T3 (one per category present)
    boundaries.json.gz                # T6
    transit.json.gz                   # T9
```

### 4. `meta.json` schema (v1)

```jsonc
{
    "schemaVersion": 1,
    "regionId": "europe-netherlands",
    "label": "Netherlands",
    "regionPath": ["Europe", "Netherlands"],
    "bbox": [3.31, 50.75, 7.22, 53.7], // computed from the PBF extract; stub: from config
    "osmSnapshot": "2026-06-08", // Last-Modified of the PBF download
    "adminLevels": { "matching": [4, 7, 9, 10], "extract": [4, 7, 8, 9, 10] },
    "categories": { "measuring": [], "matching": [] }, // filled by T2/T3
    "attribution": "© OpenStreetMap contributors, ODbL — via Geofabrik",
}
```

Define this shape once in `lib/metaSchema.mjs` with a `validateMeta()` used
by both the builder and pack-lint.

### 5. Pack lint — `data/packs/scripts/pack-lint.mjs`

`pnpm data:pack:lint -- --region <id>` validates a dist dir: meta validates,
every artifact listed in `hashes.json` exists with matching bytes/hashes,
gz files actually gunzip, bbox is sane (west < east, south < north, within
[-180,180]/[-90,90]). Exit non-zero on any failure. The build CLI runs lint
automatically at the end.

### 6. Wiring

- `package.json`: add `data:pack`, `data:pack:lint` scripts; add the test
  suite to `pretest` alongside the existing `test:data:*` entries (follow
  how `test:data:transit` is wired).
- `.gitignore`: `data/packs/cache/`, `data/packs/dist/`.
- `data/packs/README.md`: two paragraphs — what this pipeline is, how to add
  a region (edit `regions.yaml`, run build, run lint).

## How to test

`node --test` suites next to the libs (`*.test.mjs`):

- config loader: accepts the sample config; rejects duplicate ids, bad id
  charset, `matching` not 4 levels, `extract` missing a matching level.
- meta validation: round-trips the sample; rejects missing fields and a
  malformed bbox.
- hashing: write a temp file, assert `hashes.json` entries match
  independently computed md5/sha256 (use `node:crypto`).
- pack-lint: build a synthetic dist dir in a temp folder; assert pass; then
  corrupt one byte of a gz and assert lint fails.

The CLI's network fetch is **not** unit-tested — keep fetch behind a small
lib function and test the cache logic with a local file URL or injected
fetcher.

Run `pnpm test` and `pnpm check` before opening the PR.

## Out of scope

- Real artifact extraction (T2/T3/T6/T9), catalog generation and publishing
  (T4), any app-side change.

## Done when

- `pnpm data:pack -- --region europe-netherlands` downloads/caches the PBF,
  writes a valid `meta.json` + `hashes.json` with stubbed artifacts, and
  lint passes on the result.
- All new `node --test` suites pass via `pnpm test`; `pnpm check` is green.

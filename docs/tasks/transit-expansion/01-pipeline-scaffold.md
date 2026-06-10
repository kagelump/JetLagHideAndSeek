# T1 — Pipeline scaffold (`data/transit/`)

## Context

We're building a new offline pipeline that will eventually replace
`data/odpt/`. This task creates the skeleton: directory layout, config
parsing, CLI entry point, caching, NOTICE generation, and the test harness.
No GTFS or OSM processing yet — that's T2/T5. The goal is that T2 and T5 can
each plug a "stage" into a working frame.

**Read first:** [design.md](design.md) — Architecture, Config, and
Attribution sections. Then skim `data/odpt/scripts/fetch-odpt.mjs` and
`data/geofabrik/scripts/extract-measuring-bundles.mjs` for the house style
(plain `.mjs`, small pure functions, `node --test`).

## What you'll build

```
data/transit/
  config.yaml               # locales config (start: japan locale, gtfs feeds only)
  NOTICE.md                 # generated — do not hand-edit after T1
  sources.md                # human-maintained source provenance notes
  cache/                    # git-ignored downloads
  report/                   # git-ignored build reports (used from T6)
  scripts/
    extract-transit.mjs     # CLI entry point
    lib/
      config.mjs            # YAML load + validation
      cache.mjs             # download-with-cache, ${ODPT_KEY} substitution, --cache-only
      notice.mjs            # NOTICE.md generation from config license fields
    *.test.mjs              # node --test suites next to the code
```

### Steps

1. **Directory + gitignore.** Add `data/transit/cache/` and
   `data/transit/report/` to `.gitignore` (match how `data/odpt/cache/` is
   ignored).
2. **`config.mjs`.** Load `config.yaml` (use the same YAML dependency the
   geofabrik pipeline uses — check its imports; do not add a new one without
   asking). Validate into a plain object and **fail loudly** with the path of
   the bad field. Required validations:
    - locale ids, region ids, feed ids, namespaces: non-empty, unique
    - every GTFS feed has `license` (build fails without it — design doc,
      Attribution)
    - `lineGrouping` ∈ {`route_id`, `short_name`}; `maxClusterMeters` a
      positive number
    - `operators[].routeSource` ∈ {`gtfs`, `osm`}
3. **`cache.mjs`.** `fetchToCache(url, cacheKey, { requiresKey, cacheOnly })`:
    - substitutes `${ODPT_KEY}` from `process.env`; if `requiresKey` and no
      key and the file isn't cached → skip with a warning (matches the
      existing ODPT `--cache-only` behavior)
    - never logs the substituted URL (it contains the key)
4. **CLI.** `extract-transit.mjs --locale japan [--cache-only] [--region id]`
   parses args, loads config, and runs an ordered list of stages. A stage is
   `{ name, run(ctx) }`; T1 ships with a no-op `gtfs` stage placeholder and
   a working `notice` stage. `ctx` carries config, cache helpers, and an
   output collector.
5. **`notice.mjs`.** Generates `NOTICE.md` from config: OSM/ODbL block for
   locales with `osm` config plus one block per GTFS feed from its `license`
   field. Copy the current ODPT attribution text for the two ODPT feeds from
   `data/odpt/NOTICE.md`.
6. **Wire up scripts.** In root `package.json`:
    - `"data:transit": "node data/transit/scripts/extract-transit.mjs --locale japan"`
    - `"test:data:transit": "node --test data/transit/scripts"`
    - add `test:data:transit` to `pretest` (match how the other data tests
      are chained).
7. **Config content.** Author `config.yaml` exactly as in the design doc's
   Config section, but **omit the `osm:` block for now** (T5 adds it) and
   keep the two ODPT feeds + the two `operators` declarations.

## Acceptance checklist

- [ ] `pnpm data:transit -- --cache-only` runs end to end (stages: gtfs no-op,
      notice) and writes `data/transit/NOTICE.md`
- [ ] Config validation has tests: valid config passes; missing `license`,
      duplicate feed id, bad `lineGrouping` each fail with a useful message
- [ ] `${ODPT_KEY}` substitution + `--cache-only` skip behavior tested (mock
      fetch; no network in tests)
- [ ] `pnpm test` runs the new `node --test` suite via `pretest`
- [ ] `pnpm check` green

## Out of scope

- Any GTFS parsing (T2), OSM/osmium work (T5), bundle emission (T3).
- Touching `data/odpt/` — the old pipeline keeps running until T10.

## Gotchas

- `node --test` discovers `*.test.mjs`; keep fixtures tiny and inline.
- Don't print secrets. The ODPT consumer key appears inside the URL —
  redact in all logging.

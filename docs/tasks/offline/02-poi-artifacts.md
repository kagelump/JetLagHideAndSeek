# T2 — POI artifacts for any region

## Context

The app already consumes downloadable POI packs: `regionPacks.ts` installs a
gzipped `RawRegion` JSON and registers it via `registerRegion()` in
`bundledPois.ts`, and the matching/tentacles/measuring-point code paths then
treat it exactly like the bundled Kantō region. What's missing is producing
those `RawRegion` files for regions other than Japan.

Today the POI extraction lives in `data/geofabrik/` and is driven by
`config.yaml` (Japan sub-regions) + `poi-selectors.json` (generated from
`matchingSelectors.ts` — never hand-edited). This task parameterizes that
extraction by an arbitrary Geofabrik region and plugs it into the T1
scaffold as the `poi` artifact builder.

Read first: `data/geofabrik/scripts/poiReducer.mjs`,
`src/features/questions/matching/bundledPois.ts` (the `RawRegion` type and
`registerRegion`), and the AGENTS.md "Bundled POI and Measuring Data"
section.

## What to build

### 1. Extract the reusable core

The Japan pipeline mixes "extract POIs from a PBF using the selector
registry" with "Japan region list + committed `assets/poi/` output". Pull
the reusable part into a function the packs pipeline can call:

```js
// data/geofabrik/scripts/lib/extractPois.mjs (new home for shared logic)
export async function extractPoisFromPbf({
    pbfPath,
    selectors, // parsed poi-selectors.json
    bbox, // optional clip
}): Promise<RawRegionJson>;
```

The existing `pnpm data:poi` flow must keep working unchanged and keep
producing byte-identical `assets/poi/japan-kanto.json` (it becomes a thin
caller of the shared lib). Byte-identical is stricter than it sounds —
watch for: object key insertion order (JSON.stringify preserves it, so
build objects in the same order the old code did), feature/category
ordering (keep the original sort), and number formatting (don't round or
re-parse coordinates the old code passed through). Verify with
`pnpm data:poi && git status` — clean tree under `assets/poi/` — not by
eyeballing with jq. If byte-identical turns out impossible (e.g. you fixed
an ordering nondeterminism), regenerate + commit the asset in the same PR
and itemize why in the PR description.

Use the same PBF processing approach the Japan pipeline already uses (check
which tool it shells out to — osmium or similar — and reuse it; do not
introduce a new PBF library).

### 2. The `poi` artifact builder

Replace the T1 stub:

- Input: the region's cached PBF + `data/geofabrik/poi-selectors.json`.
- Output: `dist/<region-id>/poi.json.gz` — a `RawRegion` with
  `schemaVersion: 1`, `generatedAt`, the region bbox, and one columnar block
  per matching category (same shape as `assets/poi/japan-kanto.json`; the
  app must not be able to tell pack POIs from bundled POIs).
- Update `meta.json` → `categories.matching` with the categories that have
  ≥1 feature, and `hashes.json` with the artifact's bytes/md5/sha256
  (T1 helpers).

Selector source of truth is unchanged: `matchingSelectors.ts` →
`poi-selectors.json`. The packs pipeline only ever _reads_
`poi-selectors.json`.

### 3. Counts sanity in pack-lint

Extend pack-lint: for a `poi` artifact, every category's columnar arrays
(`lon`, `lat`, …) must have length == `count`, all coordinates finite and
inside the region bbox (allow a 0.05° slop for boundary-straddling
features). Total POI count must be > 0 for an enabled region — an empty
extract is a build error, not a valid pack.

## How to test

`node --test`:

- **Golden-output test first, before refactoring** (same safety net T2b
  uses): build a fixture PBF (tiny — a handful of nodes/ways; check how the
  geofabrik tests do fixtures and follow that pattern), run the _current_
  Japan extraction on it, and commit the output as a snapshot file. The
  refactored `extractPoisFromPbf` must reproduce that snapshot byte-for-byte
  — `assert.strictEqual` on the serialized JSON, not a deep-equal (deep
  equality won't catch key-order or formatting drift; the device cache keys
  and the committed-asset diff both depend on the exact bytes).
- Assert `extractPoisFromPbf` produces correct columnar output for two
  categories (count, lon/lat alignment) — behavioral assertions on top of
  the snapshot.
- pack-lint POI rules: malformed count mismatch fails; out-of-bbox point
  fails; valid fixture passes.

Manual verification:

```bash
pnpm data:pack -- --region europe-netherlands
pnpm data:pack:lint -- --region europe-netherlands
```

Then load `dist/europe-netherlands/poi.json.gz` in `tools/data-viewer` and
eyeball: museums/parks/etc. appear where the Netherlands actually has them.

The viewer can't read dist packs yet — **adding that is in scope for this
task**. Orientation, since the viewer is a different beast from the
pipeline scripts: `tools/data-viewer/server.mjs` is one `node:http`
`createServer` handler that matches `url.pathname` against hardcoded
`/api/<name>` routes; each route reads JSON from the repo (helpers like
`measuringGeojson()` over `assets/measuring/`), transforms it to a GeoJSON
FeatureCollection, and returns it. The browser side (`index.html`) fetches
those endpoints and draws each as a toggleable map layer. Shared transform
code lives in `tools/data-viewer/lib/` (see `transitGeojson.js`, consumed
via `createRequire`).

So `--pack <dir>` means: parse the flag from `process.argv`, and when
present add routes like `/api/pack/poi` and
`/api/pack/measuring/<category>` that read `dist/<region-id>/` artifacts
(gunzip with `node:zlib`, then the same transform-to-GeoJSON pattern), plus
one fetch-and-layer entry in `index.html` per new endpoint. Budget a couple
of hours, not minutes. T3 and T6 reuse this flag for their artifacts.

Run `pnpm data:poi` afterwards and confirm `git status` shows no diff under
`assets/poi/` (proves the refactor didn't change Japan output).

## Out of scope

- Measuring/boundaries/transit artifacts (T3/T6/T9), catalog/publish (T4),
  app changes (none needed — the install path already exists).

## Done when

- `pnpm data:pack -- --region europe-netherlands` emits a lint-clean
  `poi.json.gz`; the viewer shows sensible POIs.
- `pnpm data:poi` output is unchanged (or regenerated + explained in-PR).
- `pnpm test` + `pnpm check` green.

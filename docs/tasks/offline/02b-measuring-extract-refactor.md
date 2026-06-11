# T2b — Refactor `extract-measuring-bundles.mjs` into libs (no behavior change)

## Context

`data/geofabrik/scripts/extract-measuring-bundles.mjs` is ~2,500 lines: one
`main()` plus ~40 top-level helper functions. Two later tasks need pieces of
it — T3 (measuring artifacts for any region) and T6 (admin boundary
assembly) — and neither should be doing surgery on a 2,500-line script while
also building new features. This task is the surgery, alone, with a
golden-output safety net. **It changes no behavior and no committed assets.**

Know the map before you start (all in the current script):

- **Line-category processing** (helpers roughly between lines 100–1420):
  post-filter predicates (`highSpeedPostFilter`, `adminLevelPostFilter`,
  `applyPostFilter`), geometry cleanup/simplify (`cleanRingCoords`,
  `simplifyFeature`, …), polygon dissolve (`polygonDissolve` + the
  grid/clip helpers), line stitching (`stitchSegments`,
  `dedupeParallelTracks`, `bridgeCollinearGaps`), and validation
  (`validateLineContinuity`).
- **Admin relation assembly** (inside `main()`, the
  `category.key === "admin-boundaries"` branches around lines 1515–1675):
  a three-step **osmium** pipeline — (1) `osmium tags-filter` for
  `r/boundary=administrative`, (2) dump relation ids via `osmium cat -f opl`
  and pull complete relations + members with `osmium getid -r`,
  (3) `osmium export` which does the multipolygon ring assembly itself.
  **There is no hand-written ring-assembly code to extract — osmium does
  it.** What gets factored out is the orchestration of those three steps.

## What to build

### 1. Split into lib modules — `data/geofabrik/scripts/lib/`

Move (don't rewrite) the helpers into cohesive modules, e.g.:

- `postFilters.mjs` — the post-filter predicates + `applyPostFilter`.
- `geometryCleanup.mjs` — clean/simplify/bbox helpers.
- `polygonDissolve.mjs` — dissolve + grid/clip helpers.
- `lineStitching.mjs` — stitch/dedupe/bridge/validate.
- `osmiumPipeline.mjs` — thin wrappers for the osmium invocations,
  including:

```js
/**
 * Assemble complete admin-boundary (multi)polygons from a PBF.
 * Wraps the three-step osmium pipeline (tags-filter → getid -r → export).
 * Returns GeoJSON features with properties { relationId, tags } and a
 * summary { assembled, droppedNoName, droppedBroken } the caller logs.
 */
export async function assembleAdminBoundaries({ pbfPath, levels, tmpDir });
```

Exact module boundaries are yours to judge — the test below is the
contract, not the file names. Keep function bodies character-identical
where possible; resist drive-by cleanups (they show up as golden-output
diffs and you'll have to explain each one).

`extract-measuring-bundles.mjs` shrinks to: config loading + `main()`
orchestration importing the libs. `pnpm data:measuring` behavior is
unchanged.

### 2. Golden-output test

Before touching anything, capture the safety net:

- Add a small fixture PBF (or reuse one from T2's fixtures if merged) and a
  `node --test` suite that runs the extraction pipeline on it and snapshots
  the output JSON (committed snapshot file).
- The refactor PR must show this snapshot unchanged. For the real-world
  check, run `pnpm data:measuring` after the refactor and confirm
  `git status` is clean under `assets/measuring/` — byte-identical output.
  If a diff is unavoidable (e.g. you fixed an ordering nondeterminism),
  regenerate + commit and itemize the cause in the PR description.

### 3. Unit tests for the moved seams

The functions T3/T6 will call get direct tests now that they're importable:
`applyPostFilter` per category, `polygonDissolve` on a two-polygon overlap
fixture, `stitchSegments` on a split way, `assembleAdminBoundaries` on the
fixture PBF (assert relation count + a known relation id present).

## How to test

- New `node --test` suites above, wired into `pretest` (follow how the
  existing `extract-measuring-bundles.test.mjs` is wired — extend it rather
  than duplicating its harness if that's simpler).
- `pnpm data:measuring` → no diff under `assets/measuring/` (or explained
  regeneration).
- `pnpm test` + `pnpm check` green.

## Out of scope

- Any new capability: no region parameterization (T3), no boundaries
  artifact (T6), no delta encoding. No changes to `assets/` content.
- Refactoring `poiReducer.mjs` (T2 owns the POI side).

## Done when

- The script is an orchestrator over `lib/` modules; golden output proves
  no behavior change; the seams T3/T6 need (`assembleAdminBoundaries`, the
  line-processing helpers) are importable and unit-tested.

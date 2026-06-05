# Task 07: Rail-Station POI Bundle (data prep)

**Depends on**: nothing (prep). Land before Task 05's `rail-station` acceptance,
or Task 05 ships `rail-station` via live Overpass until this lands.
**Audience**: intern-friendly **only if** the Geofabrik PBF is available locally.
This task is **environment-gated**.

## Why it's separate

Measuring's `rail-station` category needs a new OSM selector, and the
category→tag registry is the single source of truth that drives the **committed**
bundled POIs in `assets/poi/`. Per `AGENTS.md`:

- The category→tag mapping lives **only** in `matchingSelectors.ts`.
- `pnpm check` runs the registry-drift guard (`test:data:poi-selectors`). The
  moment you add a selector, the guard **fails** until you regenerate the bundle.
- Regenerating runs `pnpm data:poi`, which needs the ~450 MB Geofabrik PBF. **CI
  and most sandboxed agents cannot do this.** The output must be committed.

So adding `rail-station` is not a "just edit a file" change — it forces a bundle
regeneration that only an environment with the PBF can perform. Isolating it here
keeps Task 05 unblocked.

## Steps (requires the Geofabrik PBF locally)

1. Add a `rail-station` entry to `CATEGORY_SELECTORS` in
   `src/features/questions/matching/matchingSelectors.ts`, matching the existing
   entry shape:

   ```typescript
   "rail-station": {
       osmTags: `["railway"="station"]`,
       // ...mirror the other entries' fields (section/title/bundleable/etc.)
   },
   ```

   Never hand-edit `data/geofabrik/poi-selectors.json` — it's regenerated.

2. Regenerate everything in one command (do **not** chain sub-steps):

   ```bash
   pnpm data:poi
   ```

3. Commit the regenerated runtime artifacts:

   ```bash
   git add assets/poi data/geofabrik/poi-selectors.json
   ```

4. Verify guards:

   ```bash
   pnpm check   # registry drift guard must pass
   pnpm test    # reducer tests
   ```

## If you do NOT have the PBF

Do not add the selector (it will wedge `pnpm check` with unregenerated drift).
Instead, in Task 05, route `rail-station` through the **live Overpass fallback**
in `findMatchingFeaturesWithIndex` by marking it non-bundleable, and leave a
`// TODO(task-07): bundle rail-station once PBF available` note. Functionality is
identical online; only offline coverage differs.

## Test plan

- After regeneration, `assets/poi/<region>.json` contains rail-station features
  (spot-check a known station appears).
- `pnpm check` passes (no registry drift).
- `data/geofabrik/scripts/poiReducer.test.mjs` still passes.

## Acceptance Criteria

- `rail-station` selector added and bundle regenerated **and committed**, OR a
  documented decision to defer bundling and use Overpass
- `pnpm check` passes
- `bundledPois.ts`'s literal `require()` of the region artifact still resolves
  (no Metro build break)

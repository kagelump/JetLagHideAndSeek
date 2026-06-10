# T3 — Per-region bundles, manifest, and lazy app loading

## Context

The pipeline now produces presets in memory (T2). This task writes them to
disk as **per-region bundles + a manifest** (design decision D4) and teaches
the app to load only the bundles intersecting the play area. After this task
ships, the app reads transit data from `assets/transit/` and behavior for
Tokyo users is identical (milestone M1). The old ODPT pipeline and JSON stay
in place untouched until T10.

**Read first:** design.md "Output Format"; the POI bundle pattern in
`src/features/questions/matching/bundledPois.ts` (literal `require()` map —
a missing artifact is a Metro build break, which is what we want);
`src/features/hidingZone/hidingZoneData.ts` (current single-file dynamic
import you're replacing); `getSuggestedPresetIds` in
`src/features/hidingZone/hidingZone.ts` (bbox intersection helper pattern).

## What you'll build

### Pipeline side — `emit` stage

1. **Region assignment.** Each preset goes into exactly one bundle: the
   region whose bbox contains the preset's bbox center. With no `osm:` config
   yet (T5 pending), define the japan regions in config now (ids + bboxes are
   needed for assignment even before OSM extraction exists) and both ODPT
   presets land in `japan-kanto`.
2. **Bundle files.** `assets/transit/<region>.json`:
   `{ attribution, presets: HidingZonePreset[] }` — same preset schema the
   app already consumes, plus the per-bundle attribution block (ODPT
   pattern).
3. **Manifest.** `assets/transit/manifest.json`:
   `{ version: 1, bundles: [{ id, bbox, file, presets: [{ id, label, bbox }] }] }`.
   Pipeline enforces globally unique preset ids across bundles (fail the
   build otherwise).
4. **Generated require map.** Emit
   `src/features/hidingZone/transitBundles.generated.ts`: a map from bundle
   id to a `() => import("../../../assets/transit/<region>.json")` thunk plus
   the manifest imported statically. Mark the file header "GENERATED —
   regenerate with pnpm data:transit". Add a drift guard: a jest test that
   the generated map's keys equal the manifest's bundle ids.

### App side

5. **`hidingZoneData.ts` rewrite.**
    - `loadHidingZonePresets(playAreaBbox?)`: read the manifest, pick bundles
      whose bbox intersects the play-area bbox (all bundles when no play area),
      `await` their thunks, concatenate presets. Cache per bundle id; calling
      again with a different bbox loads only missing bundles.
    - Keep `getHidingZonePresets()` / `getHidingZonePresetsOrEmpty()`
      semantics (throw / empty-until-loaded) so existing callers don't churn.
6. **Trigger on play-area change.** Find where presets are loaded today
   (search for `loadHidingZonePresets` callers — the hiding-zone store /
   `AppStateProviders`) and re-invoke when the play-area bbox changes, so a
   user who moves the play area from Tokyo to Osaka gets the Kansai bundle
   without restart. Loading is additive; never unload (memory is bounded by
   Japan's ~5 MB total this phase).

## Acceptance checklist

- [ ] `pnpm data:transit -- --cache-only` writes manifest + `japan-kanto.json` + the generated require map; all committed
- [ ] Pipeline test: preset placed in the correct region by bbox center;
      duplicate preset ids across bundles fail the build
- [ ] Jest: manifest/require-map drift guard; `loadHidingZonePresets` loads
      only intersecting bundles (mock the thunks); per-bundle caching (second
      call doesn't re-import); play-area change loads the new region
- [ ] Manual/E2E sanity: app boots, Tokyo play area shows Tokyo Metro + Toei
      presets as before; existing Maestro hiding-zone flow passes
      (`pnpm test:e2e:stack` or the GitHub Actions workflow per AGENTS.md)
- [ ] `pnpm check` + `pnpm test` green

## Out of scope

- Settings UI changes (T8). The current screen will list whatever loads —
  fine while it's still 2 presets.
- Deleting `data/odpt/generated/` or its loader path (T10).

## Gotchas

- Metro cannot `import()` a computed string — every bundle path must appear
  as a **literal** in the generated map. That's the whole reason the map is
  generated.
- `bboxIntersects` lives in `src/shared/geojson` — don't reimplement.
- Bboxes are `[west, south, east, north]`; coordinates `[lng, lat]`.
- The manifest is also a runtime asset: import it statically (it's tiny);
  only bundles are lazy.
- If the app needs presets before any play area exists (fresh install),
  loading all japan bundles is acceptable this phase — note it in code; the
  global phase revisits.

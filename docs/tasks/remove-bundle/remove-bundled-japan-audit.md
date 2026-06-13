# Audit: Removing the Bundled Japan Data (→ Downloadable Pack)

**Status:** Audit / design proposal — not yet scheduled.
**Date:** 2026-06-13
**Goal:** Stop baking Japan game data into the app binary; deliver it as a
downloadable offline pack like every other region, so the bundle-vs-pack
dual-source logic collapses into a single code path.

> TL;DR — the _plumbing_ is already there. Packs register through the exact
> same seams that bundled Japan uses (`registerRegion`, `registerMeasuringSource`,
> `registerBoundarySource`, `registerTransitSource`, `registerPackAdminLevels`).
> The hard parts are **not** the loaders — they are (1) first-run / default
> play area, (2) E2E determinism, (3) a real **scope mismatch** (bundled =
> all-Japan transit + Kantō everything-else; the only Japan pack today is
> Kantō-only), and (4) a handful of `isJapan` / `BUNDLED_*` special-cases that
> assume Japan is "always covered."

---

## 1. What "the bundled Japan data" actually is

Five distinct committed asset groups, ~**68 MB uncompressed** baked into the
Metro bundle (this is the prize — it ships in every install today):

| Group             | Files                                                                                                                | Size            | Loader                                                                                                                                                                  | Coverage                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Default zones** | `assets/default-zones/tokyo.json` (+`tokyo-metadata.json`), `osaka.json`                                             | 175 KB / 0.7 KB | [`playArea.ts`](../src/features/map/playArea.ts), [`playAreaBoundary.ts`](../src/features/map/playAreaBoundary.ts)                                                      | Tokyo 23 Wards (default play area) + Osaka (E2E fixture)       |
| **POI**           | `assets/poi/japan-kanto.json` (+`regions.json`, `*.stats.json`)                                                      | 2.1 MB          | [`bundledPois.ts`](../src/features/questions/matching/bundledPois.ts)                                                                                                   | **Kantō only**                                                 |
| **Measuring**     | `assets/measuring/{coastline,high-speed-rail,body-of-water,admin-1st-border,admin-2nd-border,admin-boundaries}.json` | ~47.6 MB        | [`lineBundleLoader.ts`](../src/features/questions/measuring/lineBundleLoader.ts), [`adminBoundaryLoader.ts`](../src/features/questions/matching/adminBoundaryLoader.ts) | **Kantō + margin** (extract bbox `[137.9, 33.9, 141.9, 37.9]`) |
| **Transit**       | `assets/transit/japan-{kanto,kansai,chubu,tohoku,chugoku,kyushu,shikoku,hokkaido}.json` (+`manifest.json`)           | ~20.9 MB        | [`transitBundles.generated.ts`](../src/features/hidingZone/transitBundles.generated.ts) via [`hidingZoneData.ts`](../src/features/hidingZone/hidingZoneData.ts)         | **All 8 Japan regions**                                        |

`body-of-water.json` (25.7 MB) and `admin-boundaries.json` (14.5 MB) alone are
~40 MB — over half the payload.

### The scope mismatch (the most important finding)

The bundled data and the existing Japan pack do **not** cover the same area:

- **Bundled** = nationwide transit (8 regions) + Kantō-only POI/measuring/admin-boundaries.
- **Pack today** = `asia-japan-kanto` only ([`data/packs/regions.yaml:163`](../data/packs/regions.yaml)). It's already published in [`site/packs/catalog.json`](../site/packs/catalog.json). There is **no** Kansai/Chūbu/Tōhoku/etc. Japan pack.

So "remove the bundle, rely on the pack" is **not** a like-for-like swap today.
A user in Osaka would lose offline transit they have now. See §5.

---

## 2. How loading works today (the seam already exists)

Every data type resolves bundled-first, then packs. Packs register through
public functions that the bundled path _also_ (effectively) uses:

```
loadInstalledPacks()                       // AppStateProviders.tsx:175, on startup
  → installSingleArtifact / per-kind
      registerRegion(packId, raw)          // bundledPois.ts          (POI)
      registerMeasuringSource(packId, …)   // lineBundleLoader.ts     (measuring, lazy path)
      registerBoundarySource(packId, …)    // boundaryStore.ts        (play-area + admin boundaries)
      registerTransitSource(packId, …)     // hidingZoneData.ts       (hiding-zone presets)
      registerPackAdminLevels(packId, …)   // adminLevelDefaults.ts   (admin division defaults)
```

Bundled Japan, by contrast, is wired in via **hardcoded literal `require()`
switch-cases** so Metro can statically bundle the JSON:

- POI: `case "japan-kanto"` in [`bundledPois.ts:71-87`](../src/features/questions/matching/bundledPois.ts) + the `regions.json` registry it reads at import.
- Measuring: `switch (category)` in [`lineBundleLoader.ts:138-156`](../src/features/questions/measuring/lineBundleLoader.ts) and `requirePristineBundle` (`:282`).
- Admin boundaries: `require(".../admin-boundaries.json")` in [`adminBoundaryLoader.ts:189-198`](../src/features/questions/matching/adminBoundaryLoader.ts).
- Transit: `transitBundleLoaders` (8 dynamic `import()`s) + `TRANSIT_MANIFEST` in [`transitBundles.generated.ts`](../src/features/hidingZone/transitBundles.generated.ts).
- Play area: direct top-level `import tokyoBoundaryJson` in [`playArea.ts:3`](../src/features/map/playArea.ts); Osaka in [`playAreaBoundary.ts:4,33-35`](../src/features/map/playAreaBoundary.ts).

**Implication:** removing the bundle is mostly _deleting_ these literal cases
and letting the pack registration path be the only source — plus fixing the
four special-cases in §3.

---

## 3. Code that hardcodes "Japan is special" (must change)

These assume bundled Japan exists and/or is always covered:

1. **Coverage badge** — [`coverage.ts:48-85`](../src/features/offline/coverage.ts).
   `BUNDLED_REGION_BBOXES` (8 hardcoded Japan bboxes) + `isCoveredByBundledJapan`

    - `isBboxInJapan` short-circuit coverage to `state: "covered", packId:
"japan-bundled"` _before_ any pack check ([`:106-113`](../src/features/offline/coverage.ts)).
      Remove this once Japan is pack-backed, or Japan play areas with no pack
      installed will falsely show "covered" and never prompt a download.

2. **Default play area** — [`playArea.ts:89-99`](../src/features/map/playArea.ts).
   `defaultPlayArea` (Tokyo) is constructed synchronously from the bundled
   JSON at import time and is the literal initial state of the store
   ([`playAreaStore.tsx:40`](../src/state/playAreaStore.tsx)) and the reset
   target ([`maintenance.ts:56`](../src/state/maintenance.ts)). If the Tokyo
   boundary is no longer bundled, **there is no offline default play area on
   first run.** This is the single biggest design decision (see §5).

3. **Bundled-id fast path** — [`playAreaBoundary.ts:33-60,332-339`](../src/features/map/playAreaBoundary.ts).
   `BUNDLED_BOUNDARIES = {358674: osaka}`, `isBundledPlayAreaId`,
   `getBundledPlayArea` — these short-circuit Overpass for Tokyo/Osaka. The
   pack path (`findBoundaryRelation` → `getBoundaryPolygon`, [`:139-168`](../src/features/map/playAreaBoundary.ts))
   already handles arbitrary relations; the bundled shortcut becomes redundant
   _if_ the Japan boundaries ship in a pack.

4. **Admin-boundary sync path** — [`adminBoundaryLoader.ts:189-234`](../src/features/questions/matching/adminBoundaryLoader.ts).
   `getBundle()` `require()`s `admin-boundaries.json` and the bundled grid is
   checked _first_, synchronously. Pack boundaries only resolve via the **async**
   `queryAdminBoundaryAsync` (`:263`). Removing the bundle means the matching
   admin path must go fully async for Japan too — check callers handle the
   async variant (the sync `queryAdminBoundary` returns `null` to signal "call
   async", `:252-253`).

---

## 4. What removal touches, file by file

### Delete / regenerate

- `assets/poi/japan-kanto.json`, `regions.json`, `*.stats.json`
- `assets/measuring/*.json` (all six)
- `assets/transit/japan-*.json` + `manifest.json`
- `assets/default-zones/tokyo.json`, `tokyo-metadata.json`, `osaka.json` (pending §5/§6 decisions)
- The generator outputs are committed; the `pnpm data:poi` / `data:measuring` /
  `data:transit` pipelines would no longer emit _bundled_ artifacts (they'd run
  only in the packs pipeline).

### Code changes

- [`bundledPois.ts`](../src/features/questions/matching/bundledPois.ts): drop the `japan-kanto` `require()` case and the eager `regions.json` import; `REGIONS` starts empty and is populated entirely by `registerRegion`. Keep all the registry/coverage machinery — it's pack-ready.
- [`lineBundleLoader.ts`](../src/features/questions/measuring/lineBundleLoader.ts): remove the `require()` switch in `getLineBundle`/`requirePristineBundle`; every category becomes "pack-only" (`isPackOnlyCategory` → always true). Simplifies the merge logic substantially.
- [`adminBoundaryLoader.ts`](../src/features/questions/matching/adminBoundaryLoader.ts): drop `getBundle()` + the sync bundled grid; route everything through the pack boundary store. Confirm matching callers use the async path.
- [`transitBundles.generated.ts`](../src/features/hidingZone/transitBundles.generated.ts) + [`hidingZoneData.ts`](../src/features/hidingZone/hidingZoneData.ts): remove `TRANSIT_MANIFEST` + `transitBundleLoaders`; `loadHidingZonePresets` collects only from `packTransitSources`. The generated manifest file can be deleted; regenerate the transit pipeline to emit _pack_ artifacts only.
- [`playArea.ts`](../src/features/map/playArea.ts) / [`playAreaBoundary.ts`](../src/features/map/playAreaBoundary.ts): remove Tokyo/Osaka imports + `BUNDLED_BOUNDARIES`/`isBundledPlayAreaId`/`getBundledPlayArea`; replace `defaultPlayArea` per §5.
- [`coverage.ts`](../src/features/offline/coverage.ts): delete `BUNDLED_REGION_BBOXES` + the Japan short-circuit.
- [`maintenance.ts`](../src/state/maintenance.ts), [`playAreaStore.tsx`](../src/state/playAreaStore.tsx): new default-play-area handling.
- `adminDivisionConfig.ts`: the `japan` preset ([`:71`](../src/features/questions/matching/adminDivisionConfig.ts)) can stay as a named preset, but it should arrive via the pack's `meta.adminLevels` (`registerPackAdminLevels`) like every other region, not be hardcoded.

### Tests (will break — expect a sweep)

Direct asset dependencies live in (at least):
`bundledPois.test.ts`, `lineMeasuringGeometry.test.ts`,
`clipLineFeatures.perf.test.ts`, `bodyWaterMask.geos.test.ts`,
`measuringDissolve.geos.test.ts`, plus anything asserting Tokyo as the default
play area. These should switch to **synthetic fixtures registered via
`registerRegion`/`registerMeasuringSource`** (the test seams already exist:
`__setLineBundleForTest`, `setAdminBoundaryBundle`, `registerTestRegion`).

### E2E (Maestro)

`e2e/warmup.yaml`, `transit-line-question.yaml`, `hiding-zone.yaml` assert
**"Tokyo 23 Wards"** and **"Tokyo Metro"**; `play-area.yaml` enters Osaka
relation `358674`. All of these assume bundled data is present offline at
launch. See §6.

---

## 5. The first-run / default-play-area problem (decision required)

Today the app boots straight into Tokyo 23 Wards with full offline data, zero
network. Remove the bundle and that guarantee disappears. Options:

| Option                                                                                   | First-run UX                                                      | Binary cost                                                | Complexity                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| **A. Keep only the Tokyo _boundary_ bundled** (175 KB), drop POI/measuring/transit/Osaka | Map shows Tokyo outline instantly; questions need a pack download | ~175 KB (vs 68 MB)                                         | Low — surgical; keeps `defaultPlayArea` synchronous |
| **B. No default play area** — first-run is an empty "choose a region" state              | Onboarding/region-picker flow needed                              | 0                                                          | High — new UX, store must allow null play area      |
| **C. Tiny generic default** (e.g. a small bundled world-city outline)                    | Generic outline; download prompt                                  | small                                                      | Medium                                              |
| **D. Ship Tokyo as a pre-installed pack** seeded into Documents on first launch          | Identical to today                                                | 68 MB (or less if Kantō-only) — but on disk, not in binary | Medium — but defeats most of the size win           |

**DECIDED → Option A.** Keep only the Tokyo 23 Wards _boundary_ (`tokyo.json` +
`tokyo-metadata.json`, ~175 KB) bundled as a **pure placeholder** — it holds no
UX importance and will be replaced by an out-of-the-box wizard later. It removes
~67.8 MB (99%+ of the payload — all of measuring + transit + POI) while keeping
`defaultPlayArea` synchronous and first-run network-free. Osaka (`osaka.json`)
is dropped (it only existed as an E2E fixture — see §6). Implementation detail:
the default play area renders the outline only; questions/hiding-zones in Tokyo
need a pack download like everywhere else, which is acceptable for a placeholder.

---

## 6. E2E determinism (decision required)

E2E currently relies on bundled offline data so flows are network-free and
deterministic. After removal:

- **`play-area.yaml`** (Osaka `358674`): if Osaka boundary is unbundled, this
  flow either needs a mocked Overpass response or a test-only pre-installed
  pack. Cheapest fix: keep `osaka.json` (0.7 KB) bundled **behind a test/E2E
  build flag**, or seed it into the installed-pack dir in the E2E stack setup.
- **`hiding-zone.yaml` / `transit-line-question.yaml`** ("Tokyo Metro"
  presets): these need Kantō transit present. Under Option A, transit is gone
  from the binary → these flows must install the `asia-japan-kanto` pack first
  (adds a download step + network dependency to E2E) **or** the E2E stack
  pre-seeds the pack into Documents.

**DECIDED → keep only `smoke`; delete every other E2E flow.** The
data-dependent flows (`play-area`, `hiding-zone`, `transit-line-question`,
`radar-question`, `warmup`, and the unused standalone flows) are no longer
worth maintaining. `smoke.yaml` only boots the app, swipes the sheet, taps, and
screenshots — it asserts **no** Japan data — so it survives bundle removal
cleanly (the Tokyo boundary placeholder from Option A keeps it rendering a map).
`smoke.yaml` does `runFlow: bootstrap.yaml`, so **`bootstrap.yaml` stays**
(and any flow `bootstrap` itself references). No pack-seeding is needed.

---

## 7. Coverage gaps to close before removal

Removal should be gated on these existing in the catalog, or it's a regression:

1. **All-Japan packs, not just Kantō.** Add `asia-japan-{kansai,chubu,tohoku,chugoku,kyushu,shikoku,hokkaido}` to [`data/packs/regions.yaml`](../data/packs/regions.yaml), build, and publish — otherwise non-Kantō Japan loses offline transit it has today.
2. **`body-of-water` is disabled** for the Kantō pack (`measuringOverrides.body-of-water.enabled: false`, [`regions.yaml`](../data/packs/regions.yaml)) due to the GEOS dissolve hard-lock noted in AGENTS.md and `docs/tasks/offline/15-geos-dissolve-memory.md`. Bundled Japan **has** body-of-water. Removing the bundle **regresses** the measuring "body of water" question in Japan until that pipeline bug is fixed.
3. **Transit routes/colors.** Pack transit is **stations-only** (T9 scope cut, `docs/tasks/offline/13-transit-routes-in-packs.md`). Bundled Japan transit carries route geometry + colors (GTFS-sourced Tokyo Metro/Toei). Removing the bundle **loses route lines/colors** for Japan hiding zones until T13/T18 land.
4. **POI completeness.** Confirm the pack POI extract matches the bundled `japan-kanto.json` category coverage (the bundled file is 33,754 features; verify the pack isn't a thinner extract).

These three (body-of-water, transit routes, all-Japan coverage) are the real
blockers — they're feature regressions, not plumbing.

---

## 8. Recommended phasing

1. **Pre-req:** publish all-Japan packs (§7.1); fix or accept body-of-water gap (§7.2); decide on transit routes (§7.3).
2. **Phase 1 — first-run:** implement Option A (Tokyo boundary stays, async-free default). Land behind no behavior change yet.
3. **Phase 2 — E2E:** add pack-seeding to the E2E stack (§6); migrate Maestro flows to assert against seeded-pack data.
4. **Phase 3 — remove loaders:** delete the literal `require()` cases (§4), let `register*` be the only source, delete `BUNDLED_*` special-cases (§3). Migrate unit tests to synthetic fixtures.
5. **Phase 4 — drop assets:** delete `assets/poi|measuring|transit` Japan files (keep `tokyo.json` boundary), stop the bundled-emit pipelines.
6. **Phase 5 — cleanup:** remove `coverage.ts` Japan short-circuit, the `data:poi`/`data:measuring`/`data:transit` _bundled_ outputs, and update AGENTS.md (the "Bundled vs published" section and "Default play area" lines).

## 9. Net effect

- **Binary:** −~68 MB (or −67.8 MB keeping the Tokyo boundary).
- **Code:** one resolution path (`register*`) instead of bundled-first + pack;
  deletes ~4 special-case blocks and the 1,331-line generated transit manifest.
- **Risk:** first-run and E2E both currently _depend_ on the bundle; both need
  explicit replacements before deletion. Three feature regressions
  (body-of-water, transit routes, non-Kantō coverage) must be resolved or
  consciously accepted first.

## 10. Decisions & open questions

**Decided (2026-06-13):**

- **Default play area → Option A.** Keep the Tokyo 23 Wards boundary (~175 KB) as a pure placeholder; drop Osaka. (§5)
- **E2E → smoke only.** Delete all other flows; keep `smoke.yaml` + `bootstrap.yaml`. (§6)

**Still open (drive the coverage-non-regression work in the plan):**

- Is losing **transit route lines/colors** in Japan acceptable until T13/T18, or a hard blocker?
- Is dropping the **body-of-water** measuring question in Japan acceptable until the GEOS dissolve fix (`docs/tasks/offline/15-geos-dissolve-memory.md`)?
- All-Japan packs: build 7 more regions, or ship Kantō-only and accept reduced Japan coverage at launch?

See **[remove-bundled-japan-plan.md](remove-bundled-japan-plan.md)** for the phased plan and task list.

# Plan: Remove Bundled Japan Data → Downloadable Pack

**Companion to:** [remove-bundled-japan-audit.md](remove-bundled-japan-audit.md) (read it first).
**Date:** 2026-06-13

## Locked decisions

1. **First run** — keep only the Tokyo 23 Wards _boundary_ (`tokyo.json` +
   `tokyo-metadata.json`, ~175 KB) as a **placeholder** default play area. No UX
   importance; an OOTB wizard supersedes it later. Drop Osaka. `defaultPlayArea`
   stays synchronous.
2. **E2E** — keep `smoke.yaml` (+ `bootstrap.yaml` and its deps) only. Delete
   every other Maestro flow and prune the runner/CI/test config to match.
3. **Everything else** Japan-related (POI, measuring, transit, admin boundaries)
   moves to packs and is deleted from the binary.

## Guiding principle: coverage must not silently regress

Today a Japan player has, **fully offline and baked in**: nationwide transit
(8 regions, with route lines + colors), Kantō POI, Kantō+margin measuring
(incl. body-of-water), and Kantō admin boundaries. After this work, all of that
comes from packs. The plan is structured so that **every deletion is gated on a
proven pack equivalent**, and any _accepted_ regression is recorded explicitly
rather than discovered by a user.

The three known regression risks (from audit §7) and how we de-risk each:

| Risk                                                             | De-risk strategy                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-Kantō Japan has no pack** (only `asia-japan-kanto` exists) | T1 builds + publishes all 8 Japan packs _before_ any deletion. Coverage parity check (T2) fails the plan until catalog covers what the bundle covered.                                            |
| **`body-of-water` disabled in packs** (GEOS dissolve hard-lock)  | T3 spike: either fix the dissolve for Japan regions or make the regression explicit (feature-flag the body-of-water question off for pack-only regions + log). Decision gate before T10 deletion. |
| **Pack transit is stations-only** (no routes/colors)             | T4 spike: confirm hiding-zone gameplay is acceptable stations-only in Japan, or pull T13/T18 forward. Decision gate before T9 deletion.                                                           |

---

## Phase 0 — De-risk & measure (no deletions)

### T0. Capture the current coverage baseline

- **Goal:** a written, reproducible inventory of _exactly_ what bundled Japan provides, so "no regression" is checkable.
- **Do:**
    - Record per-data-type coverage: POI categories + feature counts (bundled Kantō = 33,754), measuring categories + extract bbox (`[137.9, 33.9, 141.9, 37.9]`), transit preset count per region (parse `manifest.json`), admin-boundary levels present.
    - Dump them into a `coverage-baseline.json` checked into `docs/tasks/offline/` (or alongside this plan).
- **Done when:** baseline file exists and is referenced by T2.
- **Risk:** low. Pure measurement.

### T1. Build & publish all-Japan packs

- **Goal:** the catalog covers everywhere the bundle did, before anything is deleted.
- **Do:**
    - Add `asia-japan-{kansai,chubu,tohoku,chugoku,kyushu,shikoku,hokkaido}` to [`data/packs/regions.yaml`](../data/packs/regions.yaml), mirroring the existing `asia-japan-kanto` block (Geofabrik sub-region PBF URLs, adminLevels, transitOverrides `nameSuffixes: ["駅"]`, `useRailwayInfrastructure: true`).
    - Build each: `NODE_OPTIONS=--max-old-space-size=16384 pnpm data:pack -- --region <id>` (water-dense regions need the large heap — see AGENTS.md).
    - `pnpm data:pack:lint`, then `pnpm data:pack:publish -- --region <id>` (uploads blobs to a Release, recommits `site/packs/catalog.json`).
- **Done when:** `site/packs/catalog.json` lists 8 `asia-japan-*` packs with live blob URLs (the `packs-catalog.yml` liveness check passes).
- **Risk:** **high.** Body-of-water builds can OOM/hard-lock (depends on T3); some Japan regions are water-dense. Build regions incrementally; expect to disable body-of-water per region until T3.

### T2. Coverage parity gate (bundle vs catalog)

- **Goal:** an automated check that the published Japan packs cover the T0 baseline.
- **Do:**
    - Add a `node --test` script under `data/packs/scripts/lib/` (alongside `pack-lint`) that, given `coverage-baseline.json` + `catalog.json`, asserts: every bundled transit region has a pack; pack POI category set ⊇ baseline; measuring categories present (modulo _explicitly_ accepted gaps); admin levels present.
    - Wire it into `pnpm test:data:packs`.
- **Done when:** the parity test passes (or fails only on consciously-recorded accepted gaps from T3/T4).
- **Risk:** medium. This is the load-bearing safety net — invest in it.

### T3. Spike: body-of-water in Japan packs

- **Goal:** resolve the biggest feature regression or record it as accepted.
- **Do:** attempt a body-of-water build for one water-dense Japan region (e.g. Kansai/Setouchi). If the GEOS dissolve hard-locks (`docs/tasks/offline/15-geos-dissolve-memory.md`), decide: (a) pull the dissolve fix forward, or (b) ship without body-of-water in Japan and gate the question off for pack-only coverage + emit a log/flag.
- **Done when:** decision recorded in the audit §10 and reflected in `regions.yaml` `measuringOverrides`.
- **Risk:** high (known hard problem). Time-box it.

### T4. Spike: transit stations-only acceptability

- **Goal:** confirm whether losing Japan route lines/colors blocks launch.
- **Do:** install `asia-japan-kanto` pack on a dev build, build hiding zones from its presets, eyeball vs bundled (which has Tokyo Metro/Toei colors + route geometry). Decide: accept stations-only, or pull T13/T18 forward.
- **Done when:** decision recorded in audit §10.
- **Risk:** medium (mostly a product call).

---

## Phase 1 — First-run placeholder (Option A)

### T5. Make Tokyo a boundary-only placeholder default

- **Goal:** keep `defaultPlayArea` synchronous and offline, with only the boundary bundled.
- **Do:**
    - Keep `tokyo.json` + `tokyo-metadata.json`; confirm [`playArea.ts`](../src/features/map/playArea.ts) still builds `defaultPlayArea` from them (no change needed if we keep the boundary).
    - Add a short comment marking it a placeholder pending the OOTB wizard.
- **Done when:** app boots to "Tokyo 23 Wards" outline with **no** bundled POI/measuring/transit present (verify with the deletions stubbed in a branch).
- **Risk:** low.

### T6. Remove the Osaka bundled boundary

- **Do:** delete `assets/default-zones/osaka.json`; remove `BUNDLED_BOUNDARIES`, the `358674` entry, and simplify `isBundledPlayAreaId`/`getBundledPlayArea` in [`playAreaBoundary.ts`](../src/features/map/playAreaBoundary.ts) to Tokyo-only (or fold Tokyo into the same check).
- **Done when:** Osaka resolves via pack/Overpass like any other relation; tests updated.
- **Risk:** low–medium (touches the resolution order; covered by `loadPlayAreaByRelationId` tests).

---

## Phase 2 — E2E reduction

### T7. Reduce E2E to smoke only

- **Goal:** drop maintenance burden; keep a single boot-sanity flow.
- **Do:**
    - Delete `e2e/{warmup,play-area,hiding-zone,radar-question,transit-line-question,thermometer-question,reconnect,geos-crash-fuzz,geos-measuring-smoke,dismiss-continue}.yaml`. **Keep** `smoke.yaml` and `bootstrap.yaml` (smoke `runFlow`s it). Grep `runFlow:` in the survivors to confirm no other dependency.
    - [`scripts/e2e-maestro-stack.mjs`](../scripts/e2e-maestro-stack.mjs): trim the `flows` array (`:33`) to just `smoke`.
    - [`scripts/e2e-maestro-stack-config.test.mjs`](../scripts/e2e-maestro-stack-config.test.mjs): update the `flows` fixture + the "prepends warmup" / "rejects unknown" tests (warmup is gone).
    - `package.json` `test:e2e` (`:54`): reduce to `maestro test e2e/smoke.yaml`.
    - [`.github/workflows/maestro-e2e.yml`](../.github/workflows/maestro-e2e.yml): trim the `flow` choice options (`:22-26`) to `smoke`; keep the `pull_request` `assets/**` path trigger (still relevant — we change assets).
- **Done when:** `pnpm test:e2e:stack` runs only smoke and passes; `pretest` config test passes.
- **Risk:** low. Do this early so the later asset deletions don't trip removed flows.

---

## Phase 3 — Collapse loaders to the pack path

> Each task removes a bundled literal `require()` and lets `register*` be the
> sole source. Migrate the corresponding unit tests to synthetic fixtures via
> existing test seams. Gate Phase 3 on T1/T2 green and the T3/T4 decisions.

### T8. POI

- **Do:** in [`bundledPois.ts`](../src/features/questions/matching/bundledPois.ts) remove the `case "japan-kanto"` loader (`:71-87`) and the eager `regions.json` import (`:3,43-45`); `REGIONS` starts empty, populated only by `registerRegion`. Delete the `__DEV__` "no loader" guard for bundled regions or repurpose it.
- **Tests:** `bundledPois.test.ts` → register a synthetic region with `registerTestRegion`.
- **Risk:** low (the registry is already pack-driven).

### T9. Transit

- **Gate:** T4 decision.
- **Do:** delete `transitBundles.generated.ts` (manifest + 8 loaders); in [`hidingZoneData.ts`](../src/features/hidingZone/hidingZoneData.ts) drop `TRANSIT_MANIFEST`/`transitBundleLoaders` imports and the bundled branches in `loadHidingZonePresets`/`getHidingZonePresets`/`pickBundles`/`getTransitManifest` — collect only from `packTransitSources`. Stop the bundled-emit mode of `pnpm data:transit` (it feeds packs now).
- **Tests:** `hidingZoneData` tests register a synthetic pack transit source.
- **Risk:** medium (largest file deletion; many consumers of `getTransitManifest`). Grep callers first.

### T10. Measuring

- **Gate:** T3 decision (body-of-water).
- **Do:** in [`lineBundleLoader.ts`](../src/features/questions/measuring/lineBundleLoader.ts) remove the `require()` switch in `getLineBundle` + `requirePristineBundle`; every category becomes pack-only (`isPackOnlyCategory` → true). Simplify the merge path.
- **Tests:** use `__setLineBundleForTest`; the `*.geos.test.ts` + `lineMeasuringGeometry.test.ts` need synthetic bundles instead of the Japan assets.
- **Risk:** medium.

### T11. Admin boundaries

- **Do:** in [`adminBoundaryLoader.ts`](../src/features/questions/matching/adminBoundaryLoader.ts) drop `getBundle()` + the sync bundled grid; route everything through the pack boundary store (async). Verify matching callers handle `queryAdminBoundary` returning `null` → `queryAdminBoundaryAsync`.
- **Tests:** `setAdminBoundaryBundle` seam stays for synthetic fixtures.
- **Risk:** medium–high (sync→async behavior change for Japan matching; trace callers carefully).

### T12. Coverage badge

- **Do:** in [`coverage.ts`](../src/features/offline/coverage.ts) delete `BUNDLED_REGION_BBOXES`, `isCoveredByBundledJapan`, `isBboxInJapan`, and the `state: "covered", packId: "japan-bundled"` short-circuit (`:48-113`). Japan now flows through normal pack coverage → shows "available"/"download" when no pack is installed (correct behavior).
- **Tests:** coverage tests asserting Japan-always-covered must be rewritten.
- **Risk:** medium. This is the one that _changes user-visible behavior_ (Japan will now prompt downloads) — intended, but call it out in the PR.

---

## Phase 4 — Delete assets & pipelines

### T13. Delete bundled Japan assets

- **Do:** remove `assets/poi/japan-kanto.json` (+`regions.json`, `*.stats.json`), all `assets/measuring/*.json`, all `assets/transit/japan-*.json` + `manifest.json`. Keep `assets/default-zones/tokyo*.json`.
- **Done when:** `pnpm typecheck && pnpm test && pnpm check` green; app builds; smoke E2E passes; Metro has no dangling `require()` (audit: a missing POI asset is a _build break_, not a runtime fallback — that's our safety net here).
- **Risk:** medium. Do **last**; gated on all Phase 3 tasks.

### T14. Prune bundled-emit data scripts

- **Do:** review `data:poi` / `data:measuring` / `data:transit` — they should no longer emit _bundled_ `assets/*` outputs (packs pipeline owns this). Update `package.json` scripts, the drift guards (`test:data:poi-selectors`, `test:data:default-zones`), and the `pretest` list as needed. Keep the packs pipeline intact.
- **Risk:** medium (don't break the packs pipeline, which shares extractors).

---

## Phase 5 — Docs & cleanup

### T15. Update AGENTS.md & docs

- **Do:** rewrite the "Bundled POI and Measuring Data", "Offline Pack Rules" (Bundled-vs-published table), "Default play area", and "Hiding Zone Rules" (bundled transit) sections to reflect that Japan is now a pack and only the Tokyo boundary is bundled. Update the project memory note.
- **Risk:** low (but important — these instructions are load-bearing for future agents).

---

## Task dependency graph

```
T0 ─┐
T1 ─┼─ T2 (parity gate) ─────────────┐
T3 (body-of-water decision) ─────────┤
T4 (transit decision) ───────────────┤
                                      ▼
T5, T6 (first-run)        T7 (E2E)   Phase 3 gate
                                      │
                          T8 ── T9 ── T10 ── T11 ── T12   (collapse loaders)
                                      │
                                      ▼
                          T13 (delete assets) ── T14 (prune scripts)
                                      │
                                      ▼
                                    T15 (docs)
```

T5–T7 can run in parallel with Phase 0. **Phase 3 must not start until T2 is
green and T3/T4 decisions are recorded.** T13 is the point of no return — gate
it on everything above.

## Definition of done

- 8 `asia-japan-*` packs published; T2 parity gate green (or accepted-gap list recorded).
- App ships with **only** the Tokyo boundary (~175 KB) of Japan data; binary ~68 MB smaller.
- Single data-resolution path (`register*`); no `BUNDLED_*`/`isJapan` special-cases.
- `pnpm typecheck && pnpm test && pnpm check` green; smoke E2E green.
- Any feature regression (body-of-water, transit routes) is documented and intentional, not incidental.

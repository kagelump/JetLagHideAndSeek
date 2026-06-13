# Design: Remove Bundled Japan Data → Downloadable Pack

**Status:** Approved — ready for implementation plan  
**Date:** 2026-06-13  
**Companion docs:**

- `docs/tasks/remove-bundle/remove-bundled-japan-audit.md`
- `docs/tasks/remove-bundle/remove-bundled-japan-plan.md`
- `docs/tasks/remove-bundle/implementers-log.md` (lightweight progress log)

## Goal and success criteria

Remove all bundled Japan game data from the app binary except the Tokyo 23 Wards boundary placeholder (~175 KB). POI, measuring, transit, admin boundaries, and the Osaka boundary all move to downloadable offline packs.

After completion:

- Only `assets/default-zones/tokyo.json` + `tokyo-metadata.json` remain as Japan assets.
- Eight `asia-japan-*` packs are published in `site/packs/catalog.json` and validated by a coverage-parity test.
- A single `register*` code path serves all regions; no `BUNDLED_*` / `isJapan` shortcuts remain.
- `pnpm typecheck && pnpm test && pnpm check` are green; smoke E2E is green.
- Any accepted regression (body-of-water, transit route lines/colors) is explicitly documented, not incidental.

## High-level approach

**Sequential, gated execution.** Follow the existing plan's phases in order and do not proceed to the next phase until the current phase's gate is satisfied.

| Phase                         | Tasks   | Gate before next phase                          |
| ----------------------------- | ------- | ----------------------------------------------- |
| 0 — De-risk & measure         | T0–T4   | T2 parity test passes; T3/T4 decisions recorded |
| 1 — First-run placeholder     | T5–T6   | Tests green                                     |
| 2 — E2E reduction             | T7      | Config test green                               |
| 3 — Collapse loaders          | T8–T12  | `pnpm typecheck && pnpm test` green             |
| 4 — Delete assets & pipelines | T13–T14 | No dangling `require()`; `pnpm check` green     |
| 5 — Docs & cleanup            | T15     | AGENTS.md updated; implementer's log complete   |

## Decisions already locked

- **Default play area:** keep only the Tokyo 23 Wards boundary bundled as a placeholder; drop Osaka. `defaultPlayArea` stays synchronous.
- **E2E:** keep `smoke.yaml` + `bootstrap.yaml` only; delete every other Maestro flow.
- **Known regressions:** time-box spikes for both body-of-water and transit routes/colors; if either cannot be resolved, document it as an accepted gap and continue.

## Phase details

### Phase 0 — De-risk & measure

**T0. Capture coverage baseline**
Write `docs/tasks/offline/coverage-baseline.json` inventorying exactly what bundled Japan provides today:

- POI: categories + feature counts (bundled Kantō = 33,754).
- Measuring: categories + extract bbox (`[137.9, 33.9, 141.9, 37.9]`).
- Transit: preset count per region from `assets/transit/manifest.json`.
- Admin boundaries: levels present.

**T1. Build & publish all-Japan packs**

- Add `asia-japan-{kansai,chubu,tohoku,chugoku,kyushu,shikoku,hokkaido}` to `data/packs/regions.yaml`, mirroring the existing `asia-japan-kanto` block (Geofabrik sub-region PBF URLs, adminLevels, transitOverrides with `nameSuffixes: ["駅"]`, `useRailwayInfrastructure: true`).
- Build each region with `NODE_OPTIONS=--max-old-space-size=16384 pnpm data:pack -- --region <id>`.
- Run `pnpm data:pack:lint`, then `pnpm data:pack:publish -- --region <id>`.
- Start with body-of-water disabled per region (matching existing Kanto config) until T3 decides otherwise.

**T2. Coverage parity gate**
Add a `node --test` script under `data/packs/scripts/lib/` (alongside `pack-lint`) that, given `coverage-baseline.json` + `site/packs/catalog.json`, asserts:

- Every bundled transit region has a corresponding published pack.
- Pack POI category set ⊇ baseline category set.
- Measuring categories present (modulo explicitly accepted gaps).
- Admin levels present.
  Wire it into `pnpm test:data:packs`.

**T3. Spike: body-of-water in Japan packs**
Attempt a body-of-water build for one water-dense Japan region (e.g., Kansai/Setouchi). If the GEOS dissolve hard-locks, decide to disable body-of-water for all Japan packs and record the accepted gap. Update `regions.yaml` `measuringOverrides` accordingly.

**T4. Spike: transit stations-only acceptability**
Install `asia-japan-kanto` pack on a dev build, build hiding zones from its presets, and compare against bundled transit (which has Tokyo Metro/Toei colors + route geometry). Decide whether stations-only is acceptable or whether T13/T18 must be pulled forward. Record the decision.

### Phase 1 — First-run placeholder

**T5. Make Tokyo a boundary-only placeholder default**
Keep `tokyo.json` + `tokyo-metadata.json`; confirm `src/features/map/playArea.ts` still builds `defaultPlayArea` from them. Add a comment marking the default play area as a placeholder pending the OOTB wizard.

**T6. Remove the Osaka bundled boundary**
Delete `assets/default-zones/osaka.json`; remove `BUNDLED_BOUNDARIES`, the `358674` entry, and simplify `isBundledPlayAreaId`/`getBundledPlayArea` in `src/features/map/playAreaBoundary.ts` to Tokyo-only. Update tests so Osaka resolves via pack/Overpass like any other relation.

### Phase 2 — E2E reduction

**T7. Reduce E2E to smoke only**

- Delete `e2e/{warmup,play-area,hiding-zone,radar-question,transit-line-question,thermometer-question,reconnect,geos-crash-fuzz,geos-measuring-smoke,dismiss-continue}.yaml`. Keep `smoke.yaml` and `bootstrap.yaml`.
- Trim `scripts/e2e-maestro-stack.mjs` flows array to just `smoke`.
- Update `scripts/e2e-maestro-stack-config.test.mjs` flows fixture and related tests.
- Update `package.json` `test:e2e` to `maestro test e2e/smoke.yaml`.
- Trim `.github/workflows/maestro-e2e.yml` flow choice options to `smoke`; keep the `assets/**` path trigger.

### Phase 3 — Collapse loaders

**T8. POI**
In `src/features/questions/matching/bundledPois.ts`:

- Remove the `case "japan-kanto"` loader.
- Remove the eager `regions.json` import.
- `REGIONS` starts empty and is populated only by `registerRegion`.
- Repurpose or remove the `__DEV__` "no loader" guard for bundled regions.
- Migrate `bundledPois.test.ts` to register a synthetic region with `registerTestRegion`.

**T9. Transit**

- Delete `src/features/hidingZone/transitBundles.generated.ts`.
- In `src/features/hidingZone/hidingZoneData.ts`, drop `TRANSIT_MANIFEST`/`transitBundleLoaders` imports and the bundled branches in `loadHidingZonePresets`/`getHidingZonePresets`/`pickBundles`/`getTransitManifest`.
- Collect hiding-zone presets only from `packTransitSources`.
- Stop the bundled-emit mode of `pnpm data:transit`.
- Migrate tests to register a synthetic pack transit source.

**T10. Measuring**
In `src/features/questions/measuring/lineBundleLoader.ts`:

- Remove the `require()` switch in `getLineBundle` and `requirePristineBundle`.
- Every category becomes pack-only (`isPackOnlyCategory` → true).
- Simplify the merge path.
- Update tests to use `__setLineBundleForTest`; migrate `*.geos.test.ts` and `lineMeasuringGeometry.test.ts` to synthetic bundles.

**T11. Admin boundaries**
In `src/features/questions/matching/adminBoundaryLoader.ts`:

- Drop `getBundle()` and the sync bundled grid.
- Route everything through the pack boundary store (async).
- Verify matching callers handle `queryAdminBoundary` returning `null` → use `queryAdminBoundaryAsync`.
- Keep `setAdminBoundaryBundle` for synthetic test fixtures.

**T12. Coverage badge**
In `src/features/offline/coverage.ts`:

- Delete `BUNDLED_REGION_BBOXES`, `isCoveredByBundledJapan`, `isBboxInJapan`.
- Delete the `state: "covered", packId: "japan-bundled"` short-circuit.
- Japan now flows through normal pack coverage and shows "available"/"download" when no pack is installed.
- Rewrite coverage tests that asserted Japan-always-covered.

### Phase 4 — Delete assets & prune pipelines

**T13. Delete bundled Japan assets**
Remove:

- `assets/poi/japan-kanto.json`, `regions.json`, `*.stats.json`
- All `assets/measuring/*.json`
- All `assets/transit/japan-*.json` + `manifest.json`
  Keep `assets/default-zones/tokyo*.json`.

**T14. Prune bundled-emit data scripts**
Review `data:poi` / `data:measuring` / `data:transit` scripts — they must no longer emit bundled `assets/*` outputs. Update `package.json` scripts, drift guards (`test:data:poi-selectors`, `test:data:default-zones`), and the `pretest` list. Keep the packs pipeline intact.

### Phase 5 — Docs & cleanup

**T15. Update AGENTS.md & docs**
Rewrite the following AGENTS.md sections to reflect pack-only Japan:

- "Bundled POI and Measuring Data"
- "Offline Pack Rules" (bundled-vs-published table)
- "Default play area"
- "Hiding Zone Rules" (bundled transit)

Maintain a lightweight **implementer's log** at `docs/tasks/remove-bundle/implementers-log.md` with decisions, pack build results, spike outcomes, and accepted regressions.

## Testing & verification

- After each code phase: `pnpm typecheck && pnpm test`.
- After pack phases: `pnpm data:pack:lint` + the new parity test (`pnpm test:data:packs`).
- Final gate before asset deletion: `pnpm check` green.
- Final gate overall: smoke E2E green (`pnpm test:e2e:stack` or GitHub Actions `Maestro E2E` workflow).

## Risk handling

| Risk                                           | Mitigation                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Pack build OOM/hard-lock                       | Retry with larger heap; disable body-of-water per region if persistent.                                   |
| Body-of-water dissolve cannot be fixed         | Accepted gap: disable for all Japan packs; document in audit §10 and implementer's log.                   |
| Transit routes/colors cannot be pulled forward | Accepted gap: ship stations-only; document in audit §10 and implementer's log.                            |
| Unexpected test failures                       | Stop phase, log in implementer's log, do not proceed to asset deletion until green.                       |
| Dangling `require()` after asset deletion      | `pnpm check` / Metro build is the safety net; missing POI asset is a build break, not a runtime fallback. |

## Open questions resolved

- Scope: full plan including pack builds and publishing.
- Execution style: sequential, gated (Approach A).
- Regressions: spike both body-of-water and transit routes/colors; document accepted gaps if either fails.
- Default play area: keep Tokyo boundary placeholder; drop Osaka.
- E2E: smoke-only.

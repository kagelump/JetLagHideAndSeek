# Handoff: Remove Bundled Japan Data → Downloadable Pack

**Date:** 2026-06-13  
**Branch:** `master`  
**Last commit:** `edc6394` — _fix(packs): rebuild catalog with all 8 Japan packs_  
**Release tag:** `packs-2026-06-13` on GitHub Releases  
**Pages catalog:** https://jetlag.hinoka.org/packs/catalog.json

---

## What this doc is

A clean-slate handoff for the next agent continuing `docs/tasks/remove-bundle/remove-bundled-japan-plan.md`.  
It contains the current state, decisions already made, blockers, exact next steps, and the files/docs that matter.

---

## Locked product decisions

1. **First-run default** — keep only the Tokyo 23 Wards _boundary_ (`assets/default-zones/tokyo.json` + `tokyo-metadata.json`, ~175 KB) as a placeholder. No bundled POI/measuring/transit. Osaka is gone.
2. **E2E** — reduce to `e2e/smoke.yaml` (+ `e2e/bootstrap.yaml`, which smoke runs). Delete every other Maestro flow.
3. **Japan data** — everything else moves to downloadable offline packs.

---

## Phase 0 status: DONE (with two spike exceptions)

| Task                               | Status          | Notes / Commit                                                                                                                                                                            |
| ---------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0 — Coverage baseline             | ✅              | `docs/tasks/offline/coverage-baseline.json`                                                                                                                                               |
| T1 — Add 7 Japan regions           | ✅              | `data/packs/regions.yaml` — `asia-japan-{kansai,chubu,tohoku,chugoku,kyushu,shikoku,hokkaido}`                                                                                            |
| T1 — Build all 8 packs             | ✅              | Artifacts in `data/packs/dist/`                                                                                                                                                           |
| T1 — Lint all 8 packs              | ✅              | `pnpm data:pack:lint -- --region <id>` passed                                                                                                                                             |
| T1 — Publish all 8 packs           | ✅              | Release `packs-2026-06-13` on GitHub; catalog rebuilt in `edc6394`                                                                                                                        |
| T2 — Coverage parity gate          | ✅              | `data/packs/scripts/lib/japanParity.test.mjs` passes; wired into `pnpm test:data:packs`                                                                                                   |
| T3 — Spike: body-of-water in Japan | ⏸️ **NOT DONE** | Disabled for all Japan packs (`measuringOverrides.body-of-water.enabled: false`). Decision still needed: fix GEOS dissolve or accept gap and gate the question off for pack-only regions. |
| T4 — Spike: transit stations-only  | ⏸️ **NOT DONE** | Pack transit is stations-only (no route lines/colors). Decision still needed: accept or pull route-geometry work forward.                                                                 |

**Catalog sanity:**

```bash
node --test data/packs/scripts/lib/japanParity.test.mjs   # PASS
pnpm test:data:packs                                      # PASS (except publish-test mocks write site/packs/catalog.json; restore from git if needed)
```

**Important caution:** `pnpm test:data:packs` contains publish-script tests that overwrite `site/packs/catalog.json` with test fixture data. If it ever leaves the working tree dirty, rebuild the real catalog from `data/packs/dist/` (see `data/packs/scripts/build-catalog.mjs`) and commit.

---

## Phase 1 status: DONE (with leftover stale references)

| Task                       | Status | Notes / Commit                                                                                             |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| T5 — Tokyo placeholder     | ✅     | Comment added in `src/features/map/playArea.ts`                                                            |
| T6 — Remove Osaka boundary | ✅     | `assets/default-zones/osaka.json` deleted; `src/features/map/playAreaBoundary.ts` simplified to Tokyo-only |

**Leftover stale references to Osaka / bundled boundaries** that still need cleanup (do these before Phase 3 asset deletion or as part of Phase 5 docs):

- `tools/data-viewer/server.mjs:42` — reads `assets/default-zones/osaka.json` for `/api/zones`. Remove Osaka; keep Tokyo.
- `tools/data-viewer/build.mjs:51` — same, for static bundle viewer. Remove Osaka; keep Tokyo.
- `perf/scenarios/boundary.mts:1,85-92` — imports deleted `osaka.json` for the `boundary/osaka-bbox` scenario. Replace with a synthetic fixture or delete the scenario.
- `docs/implementation_notes.md:43-45` — describes Osaka as a bundled boundary. Rewrite to say only Tokyo placeholder remains; Osaka resolves via pack/Overpass.
- `AGENTS.md:24-26` — says deterministic E2E fixture is Osaka (`assets/default-zones/osaka.json`). Update to say Osaka is no longer bundled; E2E determinism now comes from packs or the Tokyo placeholder.
- `data/geofabrik/PLAN.md:10` — references `assets/default-zones/osaka.json`. Update.

The plan/spec files (`docs/tasks/remove-bundle/remove-bundled-japan-plan.md`, `docs/tasks/remove-bundle/remove-bundled-japan-audit.md`, `docs/superpowers/specs/2026-06-13-remove-bundled-japan-design.md`, `docs/superpowers/plans/2026-06-13-remove-bundled-japan-app.md`) are intentionally historical and do not need to be edited to match code changes.

---

## What the next agent should do

### Immediate clean-up (recommended first)

1. Fix the stale Osaka/bundled-boundary references listed above.
2. Run:
    ```bash
    pnpm typecheck
    pnpm test
    ```
3. Commit as one or more clean-up commits.

### Then proceed with the plan

Follow `docs/tasks/remove-bundle/remove-bundled-japan-plan.md`, gated as documented:

| Phase | Task                                   | Key files                                                                                         | Gate                      |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| 0     | T3 body-of-water spike                 | `data/packs/regions.yaml`, `docs/tasks/remove-bundle/remove-bundled-japan-audit.md` §10           | Do before Phase 3 T10     |
| 0     | T4 transit stations-only spike         | dev build + `asia-japan-kanto` pack, `docs/tasks/remove-bundle/remove-bundled-japan-audit.md` §10 | Do before Phase 3 T9      |
| 2     | T7 Delete non-smoke Maestro flows      | `e2e/*.yaml`                                                                                      | Can run now               |
| 2     | T8 Trim E2E runner                     | `scripts/e2e-maestro-stack.mjs`                                                                   | After T7                  |
| 2     | T9 Update E2E config test              | `scripts/e2e-maestro-stack-config.test.mjs`                                                       | After T8                  |
| 2     | T10 Update package.json + workflow     | `package.json`, `.github/workflows/maestro-e2e.yml`                                               | After T9                  |
| 3     | T11 POI loader collapse                | `src/features/questions/matching/bundledPois.ts`                                                  | After T2 green            |
| 3     | T12 Transit loader collapse            | `src/features/hidingZone/hidingZoneData.ts`, `transitBundles.generated.ts`, `jest.setup.ts`       | After T4 decision         |
| 3     | T13 Measuring loader collapse          | `src/features/questions/measuring/lineBundleLoader.ts`                                            | After T3 decision         |
| 3     | T14 Admin boundary async-only          | `src/features/questions/matching/adminBoundaryLoader.ts`                                          | After T2 green            |
| 3     | T15 Coverage badge Japan short-circuit | `src/features/offline/coverage.ts`                                                                | After T2 green            |
| 4     | T16 Delete bundled Japan assets        | `assets/poi/*`, `assets/measuring/*`, `assets/transit/*`                                          | Gate on all Phase 3 tasks |
| 4     | T17 Prune bundled-emit scripts         | `package.json`, drift guards, `data:poi`/`data:measuring`/`data:transit`                          | After T16                 |
| 5     | T18 Update docs                        | `AGENTS.md`, `docs/implementation_notes.md`, implementer's log                                    | Final                     |

The detailed, step-by-step instructions for each task are in `docs/superpowers/plans/2026-06-13-remove-bundled-japan-app.md`.

---

## Critical technical facts

- **Coordinates / bboxes:** `[longitude, latitude]`; bboxes are `[west, south, east, north]`.
- **Default play area:** `src/features/map/playArea.ts` exports `defaultPlayArea` built from `assets/default-zones/tokyo.json` + `tokyo-metadata.json`.
- **Bundled-boundary resolution:** `src/features/map/playAreaBoundary.ts` now only recognizes `defaultPlayArea.osmId` (Tokyo `19631009`). Osaka `358674` is not bundled.
- **Pack catalog:** `site/packs/catalog.json` is the committed, Pages-served catalog. All 8 `asia-japan-*` packs are present.
- **Parity gate:** `data/packs/scripts/lib/japanParity.test.mjs` is the load-bearing safety net. It must keep passing.
- **Body-of-water:** disabled for all Japan packs. If you enable it, builds need `NODE_OPTIONS=--max-old-space-size=16384` and may hard-lock on GEOS dissolve; see `docs/tasks/offline/15-geos-dissolve-memory.md`.
- **Transit in packs:** stations-only, no route geometry/colors. Pack preset ids are prefixed with `${packId}:` at runtime, so pack preset ids must not contain `:`.
- **Metro `require()` safety:** a missing asset under `assets/poi/...` is a Metro build break, not a runtime fallback. Deleting assets is the point of no return.

---

## Verification commands

Run these before claiming any phase complete:

```bash
# Type check
pnpm typecheck

# Jest + node --test suites
pnpm test

# Lint + format + typecheck + perf typecheck + POI-selector drift guard
pnpm check

# Pack parity + pipeline tests
pnpm test:data:packs

# Smoke E2E (requires dev build + simulator)
pnpm test:e2e:stack        # Android
pnpm test:e2e:ios:stack    # iOS
```

For CI-only final validation:

```bash
gh workflow run "Maestro E2E" --ref master -f platform=android
gh run watch
```

---

## Open questions / blockers

1. **T3 body-of-water:** Is the GEOS dissolve fix feasible for Japan, or do we accept no body-of-water in Japan packs and feature-flag that question off for pack-only regions?
2. **T4 transit routes/colors:** Is stations-only acceptable for hiding-zone presets in Japan, or do we pull route-line geometry into packs before deleting bundled transit?
3. **E2E fixture:** With Osaka no longer bundled, the deterministic E2E direct-relation-ID flow needs to use Tokyo `19631009` or install a pack in the test setup. Update Maestro flows accordingly when pruning.

---

## Reference docs

- **Plan (main):** `docs/tasks/remove-bundle/remove-bundled-japan-plan.md`
- **Detailed app plan:** `docs/superpowers/plans/2026-06-13-remove-bundled-japan-app.md`
- **Audit / inventory:** `docs/tasks/remove-bundle/remove-bundled-japan-audit.md`
- **Design spec:** `docs/superpowers/specs/2026-06-13-remove-bundled-japan-design.md`
- **Implementer's log:** `docs/tasks/remove-bundle/implementers-log.md`
- **Coverage baseline:** `docs/tasks/offline/coverage-baseline.json`
- **Body-of-water memory issue:** `docs/tasks/offline/15-geos-dissolve-memory.md`
- **Agent guide:** `AGENTS.md`
- **Pack regions config:** `data/packs/regions.yaml`
- **Pack catalog:** `site/packs/catalog.json`
- **Parity test:** `data/packs/scripts/lib/japanParity.test.mjs`

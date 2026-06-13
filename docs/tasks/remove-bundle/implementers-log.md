# Implementer's Log: Remove Bundled Japan Data

Lightweight running log of the `docs/tasks/remove-bundle/remove-bundled-japan-plan.md` execution.

## Session start

- **Date:** 2026-06-13
- **Scope:** Full plan including pack builds and publishing.
- **Approach:** Sequential, gated (Phase 0 → 1 → 2 → 3 → 4 → 5).
- **Decisions:** Keep Tokyo boundary placeholder; E2E smoke-only; spike body-of-water and transit routes/colors, document accepted gaps if they fail.
- **Design spec:** `docs/superpowers/specs/2026-06-13-remove-bundled-japan-design.md`

## Phase 0 — De-risk & measure

### T0. Coverage baseline

- [x] Generated `docs/tasks/offline/coverage-baseline.json`
- [x] POI categories + feature counts (33,754 Kantō features)
- [x] Measuring categories + extract bbox
- [x] Transit preset count per region
- [x] Admin levels present
- [x] Notes / surprises: see coverage-baseline.json

### T1. Build & publish all-Japan packs

| Region              | Config added | Build status | Lint | Publish status | Notes                               |
| ------------------- | ------------ | ------------ | ---- | -------------- | ----------------------------------- |
| asia-japan-kanto    | exists       | exists       | pass | published      | baseline pack                       |
| asia-japan-kansai   | yes          | built        | pass | published      | body-of-water disabled              |
| asia-japan-chubu    | yes          | built        | pass | published      | body-of-water disabled              |
| asia-japan-tohoku   | yes          | built        | pass | published      | body-of-water disabled              |
| asia-japan-chugoku  | yes          | built        | pass | published      | body-of-water disabled              |
| asia-japan-kyushu   | yes          | built        | pass | published      | body-of-water disabled              |
| asia-japan-shikoku  | yes          | built        | pass | published      | body-of-water disabled; level 8 = 0 |
| asia-japan-hokkaido | yes          | built        | pass | published      | body-of-water disabled              |

- [x] All 8 packs listed in `site/packs/catalog.json`
- [x] Parity gate passes

### T2. Coverage parity gate

- [x] Parity script added: `data/packs/scripts/lib/japanParity.test.mjs`
- [x] Wired into `pnpm test:data:packs`
- [x] Test passes

### T3. Spike: body-of-water in Japan packs

- [ ] Test region selected:
- [ ] Build attempt result:
- [ ] Decision: FIX / ACCEPT GAP
- [x] If gap accepted: `measuringOverrides.body-of-water.enabled: false` set for all Japan packs
- [ ] Recorded in audit §10

### T4. Spike: transit stations-only acceptability

- [ ] Installed `asia-japan-kanto` pack on dev build
- [ ] Compared hiding-zone presets against bundled transit
- [ ] Decision: ACCEPT STATIONS-ONLY / PULL ROUTES FORWARD
- [ ] Recorded in audit §10

## Phase 1 — First-run placeholder

- [x] T5: Tokyo placeholder comment added
- [x] T6: Osaka boundary deleted; `playAreaBoundary.ts` simplified; tests updated
- [ ] Stale Osaka/bundled-boundary references still exist in `tools/data-viewer`, `perf/scenarios/boundary.mts`, `docs/implementation_notes.md`, `AGENTS.md`, `data/geofabrik/PLAN.md`

## Phase 2 — E2E reduction

- [ ] T7: Unnecessary Maestro flows deleted
- [ ] `e2e-maestro-stack.mjs` trimmed
- [ ] Config test updated
- [ ] `package.json` `test:e2e` updated
- [ ] `.github/workflows/maestro-e2e.yml` trimmed

## Phase 3 — Collapse loaders

- [ ] T8: POI loader collapsed
- [ ] T9: Transit loader collapsed; `transitBundles.generated.ts` deleted
- [ ] T10: Measuring loader collapsed
- [ ] T11: Admin boundaries async-only
- [ ] T12: Coverage badge Japan short-circuit removed
- [ ] `pnpm typecheck && pnpm test` green

## Phase 4 — Delete assets & prune pipelines

- [ ] T13: Japan POI/measuring/transit assets deleted; Tokyo boundary kept
- [ ] T14: Bundled-emit scripts pruned; drift guards updated
- [ ] `pnpm check` green
- [ ] No dangling `require()`

## Phase 5 — Docs & cleanup

- [ ] T15: AGENTS.md sections updated
- [ ] Stale Osaka references fixed
- [ ] This log finalized

## Final verification

- [ ] `pnpm typecheck && pnpm test && pnpm check` green
- [ ] Smoke E2E green
- [ ] Binary size measured / noted
- [ ] Accepted regressions documented

## Handoff

See `docs/tasks/remove-bundle/handoff.md` for a clean-slate summary for the next agent.

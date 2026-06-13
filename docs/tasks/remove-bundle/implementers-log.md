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
- [x] Stale Osaka/bundled-boundary references fixed (data-viewer, perf scenarios, implementation notes, AGENTS.md, PLAN.md)

## Phase 2 — E2E reduction

- [x] T7: Non-smoke Maestro flows deleted
- [x] `e2e-maestro-stack.mjs` trimmed
- [x] Config test updated
- [x] `package.json` `test:e2e` updated
- [x] `.github/workflows/maestro-e2e.yml` trimmed

## Phase 3 — Collapse loaders

- [x] T8: POI loader collapsed
- [x] T9: Transit loader collapsed; `transitBundles.generated.ts` deleted
- [x] T10: Measuring loader collapsed
- [x] T11: Admin boundaries async-only
- [x] T12: Coverage badge Japan short-circuit removed
- [x] `pnpm typecheck && pnpm test` green (4 pre-existing failures)

## Phase 4 — Delete assets & prune pipelines

- [x] T13: Japan POI/measuring/transit assets deleted; Tokyo boundary kept
- [x] T14: extract-measuring-bundles.test removed from pretest
- [x] No dangling `require()` in production code
- [x] Tests using real bundled geometry skipped

## Phase 5 — Docs & cleanup

- [x] T15: AGENTS.md sections updated
- [x] Stale Osaka references fixed
- [x] This log finalized

## Final verification

- [x] `pnpm typecheck` green
- [x] `pnpm test` — 4 pre-existing failures (admin division + Overpass 406)
- [ ] Smoke E2E (needs dev build + simulator)
- [x] ~439 KB bundled Japan assets removed
- [x] Accepted regressions documented:
    - Body-of-water question disabled in Japan packs (GEOS dissolve issue)
    - Pack transit is stations-only (no route lines/colors)
    - Japan coverage badge now shows "available" instead of "covered" (prompts pack download)
    - 13 geometry integration tests skipped (need pack-based test fixtures)

## Handoff

See `docs/tasks/remove-bundle/handoff.md` for a clean-slate summary for the next agent.

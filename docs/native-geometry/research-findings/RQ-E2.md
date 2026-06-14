# RQ-E2 — Inventory: which deleted-flow assertions need a new Jest/native home?

- Owner: Claude (pairing w/ Ryan) Date: 2026-06-14 Time spent: ~0.5 day
- Result: **GREEN** (no orphaned coverage; no "unknown" rows)
- One-line answer: The 10 Maestro flows were already deleted in commit `c6f2362`
  (2026-06-13, "chore(e2e): reduce to smoke-only flows"); only `smoke.yaml` +
  `bootstrap.yaml` remain. Every substantive assertion in the deleted flows maps
  to an existing Jest home, the planned native suite, or the surviving smoke
  flow. The only intentional drops are dev-client connection plumbing.

## Method

Recovered each deleted flow from git (`git show c6f2362^:e2e/<flow>.yaml`) and
classified every _assertion_ (assertVisible / assertNotVisible / extendedWaitUntil
visibility gate — not taps/swipes/screenshots). Buckets:

- **JEST** — covered by an existing Jest test (file named per row).
- **NATIVE** — belongs in the new native module suite (this epic).
- **SMOKE** — retained by current `smoke.yaml` / `bootstrap.yaml`.
- **DROPPED** — intentionally dropped; reason given.

## Migration map

### play-area.yaml

| assertion                                       | home    | where                                                                                      |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `notVisible "Loading boundary..."` (Osaka load) | JEST    | `playAreaSearch.test.ts`, `playAreaStore.test.tsx` (loadPlayAreaByRelationId)              |
| `"Relation 358674"` (Osaka resolved)            | JEST    | `playAreaSearch.test.ts` (direct relation-id accept), `playAreaBoundary.test.tsx` (render) |
| live Overpass fetch round-trip                  | DROPPED | live service — manual/integration only (AGENTS "Sharp Edges")                              |

### hiding-zone.yaml

| assertion                                                         | home | where                                                                                  |
| ----------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| `"0 presets selected"` / `"0 stations"` (initial)                 | JEST | `hidingZoneStore.test.tsx`                                                             |
| `"1 preset selected"` / `"185 stations"` (Tokyo Metro add)        | JEST | `hidingZone.test.ts`, `hidingZoneData.test.ts` (count is now pack-derived — see risks) |
| `"2 presets selected"` (Toei add, additive)                       | JEST | `hidingZoneStore.test.tsx` (additive selection rule)                                   |
| `"Stored as 500 m"` (radius in meters)                            | JEST | `hidingZoneStore.test.tsx` (canonical meters)                                          |
| `"1 preset selected"` after remove (station kept by other preset) | JEST | `hidingZone.test.ts` (additive removal rule)                                           |
| concentric rings for shared stations                              | JEST | geometry asserted via `ShapeSource.shape` (AGENTS Hiding Zone Rules)                   |

### radar-question.yaml

| assertion                                   | home | where                                                           |
| ------------------------------------------- | ---- | --------------------------------------------------------------- |
| `"Current distance 500 m"` (default preset) | JEST | `radarConfig.ts` + `questionRegistry.test.ts`                   |
| `"N/A answer"` (initial status)             | JEST | `radar/__tests__/radarAnswer.test.ts` (getQuestionAnswerStatus) |
| `"Current distance 1000 m"` (1km preset)    | JEST | `radarConfig.ts` presets                                        |
| Miss answer toggles state                   | JEST | `radarAnswer.test.ts`                                           |

### thermometer-question.yaml

| assertion                                  | home | where                                                                       |
| ------------------------------------------ | ---- | --------------------------------------------------------------------------- |
| `".*km"` distance summary                  | JEST | `thermometerGeometry.test.ts`                                               |
| `notVisible "Pins are too close together"` | JEST | `thermometerGeometry.test.ts` (too-close logic in `thermometerGeometry.ts`) |
| labels `"Hotter"/"Colder"/"Start"/"End"`   | JEST | `thermometerConfig.test.ts` (label/answer model); thin UI labels            |
| Hotter answer toggles                      | JEST | `thermometerConfig.test.ts` + questionStore pin helpers                     |

### transit-line-question.yaml

| assertion                                       | home         | where                                                                                                           |
| ----------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `"1 preset selected"` (Tokyo Metro)             | JEST         | `hidingZoneStore.test.tsx`                                                                                      |
| `matching-answer-option-positive` visible + tap | JEST         | `matchingConfig.test.ts`, `osmMatching.test.ts` (transit-line category + answer polarity)                       |
| `"Tokyo 23 Wards"` survives stopApp → reconnect | JEST + SMOKE | persistence logic in `persistence.test.ts`; on-device restart survival is the one genuinely-E2E bit (see risks) |

### geos-measuring-smoke.yaml

| assertion                                                | home   | where                                                                                          |
| -------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `notVisible "Computing..."` (prefecture-border distance) | JEST   | `measuringConfig.test.ts`, line distance tests                                                 |
| `notVisible "Computing..."` (body-of-water distance)     | NATIVE | RQ-C3 (device GEOS dissolve/difference timing)                                                 |
| `".*km"` coord summary (responsive)                      | JEST   | measuring geometry tests                                                                       |
| `"PARITY PASS"` (on-device JS↔GEOS harness, 46 cases)   | NATIVE | **replaced** by RQ-C1/C2/C3 native parity tests (faster, deterministic, no 5–8 min device run) |

### geos-crash-fuzz.yaml

| assertion                                                           | home   | where                                                                                                |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `"CRASH FUZZ PASS"` (degenerate WKB → native bufferWKB, 1k×7 cases) | NATIVE | new native suite — add a degenerate-WKB fuzz test in the A1/B1 harness (pairs with RQ-F1 sanitizers) |

### warmup.yaml

| assertion                                              | home  | where                                                                                                   |
| ------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------- |
| `"Tokyo 23 Wards"` (boots + renders default play area) | SMOKE | `smoke.yaml` boots via `bootstrap.yaml` + screenshots; render-state also in `playAreaBoundary.test.tsx` |

### dismiss-continue.yaml & reconnect.yaml

| assertion                                                                   | home    | where                                                                                                                  |
| --------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `"Continue"`/`"Connected to:"`/`notVisible "Continue"` (dev-client overlay) | DROPPED | dev-client connection plumbing, not app behavior; `bootstrap.yaml` already handles the `Open`/`Continue` taps it needs |

## Recommendation

- **The reduction is safe to keep.** No assertion is orphaned. Two items become
  native-suite tests this epic: (1) the on-device **parity harness** → C1/C2/C3
  (already green), (2) the **crash-fuzz** → add a degenerate-WKB test in the A1/B1
  harness alongside RQ-F1.
- **Delete the in-app dev parity harness UI** ("Run GEOS Parity Harness" / "Run
  Crash Fuzz" Settings rows) once the native suite lands — it only existed to be
  driven by the now-deleted Maestro flows, and the native suite covers it far
  faster. Confirm with the maintainer before removing.
- **Keep exactly one on-device E2E concern: persistence-across-restart.** The
  `transit-line` flow's "Tokyo 23 Wards survives stopApp" is the only assertion
  with real E2E value that Jest can't fully prove (Jest tests the serializer, not
  a true process restart). Fold a minimal "relaunch → default play area still
  shown" check into `smoke.yaml` rather than re-adding a whole flow.

## Follow-ups / new risks

- **Station-count assertions are stale.** `"185 stations"` (Tokyo Metro) assumed
  bundled transit; transit is now **pack-derived** (`registerTransitSource`).
  Any re-homed count assertion must read from the installed pack, not a literal.
- Confirms RQ-E1's premise: the flow reduction is done; E1 is now only the _infra
  fixes_ needed to make the surviving `smoke.yaml` green on CI (Android
  `native-geometry` dep + iOS associated-domains gate), not a deletion exercise.

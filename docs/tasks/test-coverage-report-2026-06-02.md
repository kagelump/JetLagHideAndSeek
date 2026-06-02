# Test Coverage Report — 2026-06-02

**Generated:** 2026-06-02
**Runner:** `jest --coverage` (jest-expo, 39 test suites)
**Branch:** `claude/test-coverage-analysis-ysShk` (merged `origin/master` through `c4e44ee`)

---

## Headline Numbers

|                   | Previous run | This run | Δ       |
| ----------------- | ------------ | -------- | ------- |
| **Statements**    | 89.14 %      | 88.76 %  | −0.38   |
| **Branches**      | 77.01 %      | 76.54 %  | −0.47   |
| **Functions**     | 87.94 %      | 86.95 %  | −0.99   |
| **Lines**         | 90.64 %      | 90.04 %  | −0.60   |
| **Tests passing** | 342 / 346    | 377 / 378| +35 net |
| **Suites failing**| 2            | 1        | −1      |

The slight headline dip is expected: several new source files were added across the recent
commits (spatial grid cache, debounce hook, query client, expanded OSM matching) and new
tests have not yet caught up to all of them. The absolute improvement is the +35 passing
tests and halving of failing suites.

---

## Failing Tests

### Remaining failure (pre-existing)

**`MapAppScreen.test.tsx` — 1 test fails with a 5 s `afterEach` timeout.**

This is the same flaky timeout that appeared in the previous run. One test
(`"maintains correct direction across forward and back navigation cycles"`) leaves async
work running at the end of the suite; `@testing-library/react-native`'s `afterEach` cleanup
catches it. Root cause: the test is exercising navigation state that now involves async
query-client rehydration, and the suite's default 5 s timeout is too tight. Fix: add an
explicit `jest.setTimeout` for that test or mock the query-client in the test wrapper.

### Resolved since last run (+3 fixed)

- **`questionGeometry.test.ts`** — transit-line hit-mask assertion (`toHaveLength(1)`) was
  fixed in `b5525d5`. Now passes.
- **`MapAppScreen.test.tsx`** — two hiding-zone feature-count assertions that expected 1
  feature but received 22 were fixed in the same commit. Now pass.

---

## Changes Since Last Analysis

### New source files (and their coverage)

| File | Stmts | Branch | Funcs | Key uncovered |
| --- | --- | --- | --- | --- |
| `state/queryClient.ts` | **100 %** | **100 %** | **100 %** | — |
| `features/questions/matching/osmMatchingGrid.ts` | 94.6 % | 83.3 % | 83.3 % | L49, L65 |
| `shared/useDebouncedValue.ts` | 85.7 % | **100 %** | 75 % | — (line-covered) |

`queryClient.ts` (TanStack Query setup) is fully covered via the framework test. The grid
cache is well covered with two branches and one function not yet exercised.
`useDebouncedValue` lacks a test for the cleanup path when the component unmounts mid-debounce.

### Coverage regressions (new code added, tests not yet updated)

These files have *lower* coverage than the previous run because new code paths were added
by the recent performance and refactor commits.

**`osmMatching.ts`: 95 % → 77 % statements**

Lines 157–225 are uncovered. These are new Overpass query-builder branches added as part of
the OSM spatial-cache expansion (likely the bbox-grid cell fetch paths). The underlying
`fetchAndParseOverpassFeatures` function has new overloads/branches that the existing tests
do not exercise. Priority: **high** — this is core search logic.

**`playAreaBoundary.ts`: 92 % → 84 % statements**

Lines 82–84, 225–237, 275–276 are uncovered. The migration to `useQuery` in
`ceb8bb9` rewrote the stale-while-revalidate and persistence paths; the new hook-based
paths are not reflected in `playAreaBoundary.test.ts`. Priority: **high** — boundary
loading is a critical startup path.

**`radarGeometry.ts`: 100 % → 90 % statements**

Lines 89–90, 99 are uncovered. A small addition to the radar geometry computation
(likely a guard or fallback path) introduced in the perf commits was not tested.
Priority: **medium** — the existing tests cover the main paths.

---

## Full Per-File Table

```
All files                             |   88.76 |    76.54 |   86.95 |   90.04
 components
  SheetListRow.tsx                    |     100 |    61.53 |     100 |     100 | 28-47
  UnitSegmentedControl.tsx            |     100 |    83.33 |     100 |     100 | 32
 features/hidingZone
  HidingZoneScreen.tsx                |     100 |    73.07 |     100 |     100 | 29,75-113,146-156
  hidingZone.ts                       |    92.4 |    78.04 |   91.17 |   91.94 | 38-42,179-181,366-369,389-392
  hidingZoneData.ts                   |       0 |        0 |       0 |       0 | 7-53
 features/map
  ActivePinLayer.tsx                  |     100 |      100 |     100 |     100
  HidingZoneLayers.tsx                |     100 |      100 |     100 |     100
  MapControls.tsx                     |     100 |       50 |     100 |     100 | 43
  NativeMap.tsx                       |     100 |      100 |     100 |     100
  OsmMatchingLayers.tsx               |     100 |      100 |     100 |     100
  PlayAreaBoundaryLayer.tsx           |     100 |      100 |     100 |     100
  PlayAreaMaskLayers.tsx              |     100 |      100 |     100 |     100
  RadarQuestionLayers.tsx             |     100 |      100 |     100 |     100
  camera.ts                           |     100 |       80 |     100 |     100 | 46
  eventCoordinate.ts                  |     100 |    88.88 |     100 |     100 | 7,13,26,32
  mapLibrePrimitives.ts               |     100 |      100 |     100 |     100
  mapStyle.ts                         |     100 |      100 |     100 |     100
  mapTileCache.ts                     |     100 |      100 |     100 |     100
  maskBuilder.ts                      |   91.86 |    68.88 |   96.66 |   94.01 | 77,93,112,200,212-213,332
  playArea.ts                         |    91.3 |    81.81 |     100 |   95.45 | 46
  playAreaBoundary.ts          ⚠️ REG |   83.52 |       75 |   88.23 |   85.52 | 82-84,225-237,275-276
  playAreaBoundaryConversion.ts       |   92.85 |     87.5 |     100 |    92.3 | 59
  usePinDrag.ts                       |   85.93 |    73.33 |   88.88 |   88.52 | 55-56,101-102,117,144,161
  useUserLocation.ts                  |   78.57 |       50 |   66.66 |   78.57 | 19-20,31
 features/playArea
  PlayAreaScreen.tsx                  |      76 |    55.55 |   53.84 |   73.91 | 59,137-141,153,182-186
  playAreaSearch.ts                   |   95.65 |     92.3 |      80 |      95 | 47
 features/questions
  AddQuestionScreen.tsx               |     100 |    66.66 |     100 |     100 | 36-55
  MatchingQuestionScreen.tsx          |   93.33 |    66.66 |     100 |     100 | 44-59
  QuestionDetailScreen.tsx            |     100 |    83.87 |     100 |     100 | 50-56,119,206
  QuestionsScreen.tsx                 |   81.25 |     62.5 |      80 |   81.25 | 19-20,68
  questionGeometry.ts                 |     100 |      100 |     100 |     100
  questionRegistry.ts                 |     100 |      100 |     100 |     100
 features/questions/components
  QuestionAnswerSelector.tsx          |     100 |     92.3 |     100 |     100 | 49
  QuestionLocationSelector.tsx        |    37.5 |       25 |      25 |    37.5 | 25-27,45-47
 features/questions/matching
  OsmMatchingQuestionDetailScreen.tsx |   79.26 |    66.66 |      80 |   82.27 | 52,72,92-97,111,123-124,208-209,324-325
  matchingCategories.ts               |     100 |    66.66 |     100 |     100 | 162-168
  matchingConfig.ts                   |   35.71 |    21.42 |      50 |   38.46 | 27-38
  matchingVoronoi.ts                  |    92.2 |    86.11 |   93.33 |   93.42 | 28,108-109,159,214
  osmMatching.ts               ⚠️ REG |   77.02 |    67.79 |   71.42 |    79.1 | 105-109,157-225
  osmMatchingCache.ts                 |   90.06 |    84.24 |   87.27 |    91.3 | 183-184,299,343,390-394,476,546,613-617,762-763,852-873,918-919
  osmMatchingGeometry.ts              |      75 |    61.53 |   66.66 |      75 | 50-64
  osmMatchingGrid.ts           🆕 NEW |   94.59 |    83.33 |   83.33 |   94.28 | 49,65
 features/questions/measuring
  measuringConfig.ts                  |      50 |      100 |       0 |      50 | 18
 features/questions/radar
  RadarQuestionDetailScreen.tsx       |   91.66 |    88.88 |   83.33 |   91.66 | 174-175
  radarConfig.ts                      |     100 |       75 |     100 |     100 | 21
  radarGeometry.ts             ⚠️ REG |   90.24 |    78.57 |    92.3 |    92.1 | 89-90,99
  useRadarDistanceDraftInput.ts       |   82.92 |    72.72 |      70 |   82.92 | 79,116-124
 features/questions/tentacles
  tentaclesConfig.ts                  |      50 |      100 |       0 |      50 | 18
 features/questions/thermometer
  thermometerConfig.ts                |      50 |      100 |       0 |      50 | 18
 features/questions/transitLine
  TransitLineQuestionDetailScreen.tsx |   43.47 |    11.11 |   23.07 |   45.45 | 32,55-159
  transitLineNormalization.ts         |     100 |      100 |     100 |     100
  transitLineQuestion.ts              |    87.5 |    80.55 |     100 |   92.85 | 24,84
 features/sheet
  AppBottomSheet.tsx                  |     100 |      100 |     100 |     100
  FabButton.tsx                       |     100 |       60 |     100 |     100 | 15,32
  MainDrawer.tsx                      |   91.07 |    83.78 |   86.48 |   94.17 | 139,181-182,196-197,359
  SettingsScreen.tsx                  |    90.9 |       50 |   83.33 |    90.9 | 63
  SheetScrollView.tsx                 |     100 |      100 |     100 |     100
  sheetNav.ts                         |     100 |      100 |     100 |     100
  sheetRoutes.ts                      |     100 |      100 |     100 |     100
 features/transit
  transitIdentity.ts                  |    87.5 |       75 |     100 |    87.5 | 26,49
 screens
  MapAppScreen.tsx                    |   94.11 |      100 |      80 |   94.11 | 42
 shared
  distanceUnits.ts                    |     100 |      100 |     100 |     100
  geojson.ts                          |   94.73 |    91.66 |     100 |     100 | 33
  location.ts                         |     100 |      100 |     100 |     100
  useDebouncedValue.ts         🆕 NEW |   85.71 |      100 |      75 |     100
 sharing
  errors.ts                           |       0 |        0 |       0 |       0 | 10-20
 sharing/export
  ShareSetupModal.tsx                 |   76.31 |    73.52 |   71.42 |   77.14 | 77,83-84,92,400-409
  buildEnvelope.ts                    |     100 |      100 |     100 |     100
 sharing/import
  ImportScreen.tsx                    |   80.76 |       50 |      75 |   86.95 | 42-43,117
  applyImport.ts                      |   82.35 |    66.66 |     100 |   82.35 | 29,36,55
  preview.ts                          |   88.88 |    66.66 |     100 |     100 | 20-25,30
 sharing/links
  buildLink.ts                        |     100 |      100 |     100 |     100
  parseLink.ts                        |   73.33 |       60 |     100 |   76.92 | 25,35-36
 sharing/qr
  QRCodeView.tsx                      |     100 |    76.92 |     100 |     100 | 14-15,67
 sharing/wire
  base64url.ts                        |   97.22 |    95.83 |     100 |   96.87 | 41
  canonicalize.ts                     |     100 |      100 |     100 |     100
  codec.ts                            |   76.92 |    58.33 |     100 |   83.33 | 38,45,50,57
  minified.ts                         |   99.15 |    90.54 |     100 |   99.13 | 268
  schema.ts                           |   93.33 |      100 |       0 |   93.33 | 131
 state
  AppStateProviders.tsx               |   93.05 |    78.26 |   88.23 |   95.58 | 128,178-179
  appState.ts                         |   94.87 |     92.1 |     100 |     100 | 228,254,273
  hidingZoneStore.tsx                 |   91.26 |       65 |   87.87 |   93.87 | 63,91,120,221-223
  persistence.ts                      |   79.68 |    84.61 |    90.9 |   77.19 | 64,69-70,79-80,87-88,102-103,108-109,152-153
  playAreaStore.tsx                   |   89.47 |       60 |   85.71 |   89.47 | 48-52,129
  queryClient.ts                      |     100 |      100 |     100 |     100
  questionStore.tsx                   |   90.47 |    78.94 |   95.45 |    90.9 | 46,77,86,121,141,196,382,390,451,507,520
```

---

## Priority Action Items

### P1 — Regressions introduced by recent commits (fix before merging)

1. **`osmMatching.ts` L157–225** — New Overpass query paths from the bbox-grid expansion
   are 0 % covered. These are network-facing branches; add tests that mock
   `fetchAndParseOverpassFeatures` for the new call sites.

2. **`playAreaBoundary.ts` L82–84, L225–237, L275–276** — New SWR/hook code paths from the
   TanStack Query migration (`ceb8bb9`) are uncovered. The existing
   `playAreaBoundary.test.ts` was written before the migration. Extend it to exercise the
   new `useQuery`-driven code paths (or add integration tests via a test `QueryClient`).

3. **`MapAppScreen.test.tsx` — persistent timeout** — one test times out in `afterEach`.
   The fix is a `jest.setTimeout` override or wrapping the render in a test `QueryClient`
   that does not attempt async rehydration. This blocks a clean test run.

### P2 — Long-standing gaps (unchanged from previous analysis)

4. **`hidingZoneData.ts` (0 %)** — The lazy async loader for the 294 KB hiding-zone preset
   JSON has no tests. Low complexity but a startup-critical path.

5. **`sharing/errors.ts` (0 %)** — Small error-code module, completely uncovered. Trivial
   to test.

6. **`matchingConfig.ts` (36 %)** — Only the type exports are exercised. The config object
   (L27–38) is never reached. One integration test through `getCategoryConfig` would cover
   it.

7. **`QuestionLocationSelector.tsx` (38 %)** — Component has two interactive branches
   (press + change handlers, L25–27, L45–47) untested.

8. **`TransitLineQuestionDetailScreen.tsx` (43 %)** — Only the component shell is covered;
   L55–159 (the entire interactive body) is dead in tests.

9. **`measuringConfig.ts`, `tentaclesConfig.ts`, `thermometerConfig.ts` (50 % each)** —
   All three have the same gap: only the exported type reaches tests, not the config object.
   One test per file, or a single shared config-validation test, would close them.

### P3 — Coverage that is good but has specific uncovered branches

10. **`osmMatchingCache.ts` branch coverage (84 %)** — Several new lines uncovered
    (L613–617, L762–763, L852–873, L918–919) from the spatial-cache expansion. These are
    edge paths (corrupt manifest recovery, eviction under specific conditions).

11. **`persistence.ts` lines (77 %)** — Error-recovery paths in state restore
    (L64, L69–70, L79–80, L87–88, L102–103, L108–109, L152–153) are unreachable under
    normal AsyncStorage mocks. Testing them requires mocking `AsyncStorage.getItem` to throw.

12. **`codec.ts` branch coverage (58 %)** — L38, L45, L50, L57 are error-path branches
    (base64 decode failure, inflate failure, JSON parse failure, schema mismatch). Each
    needs one test that injects the corresponding corrupt input.

---

## What Improved vs Last Run

| File | Before | After | Note |
| --- | --- | --- | --- |
| `playAreaSearch.ts` | 88.6 % stmts | 95.7 % | Refactored + better-tested in `ceb8bb9` |
| `questionGeometry.ts` | 100 % (but failing) | 100 % ✅ | Test fixed in `b5525d5` |
| `osmMatchingGrid.ts` | — | 94.6 % 🆕 | New file, well-covered from the start |
| `queryClient.ts` | — | 100 % 🆕 | New file, fully tested via framework |
| `useDebouncedValue.ts` | — | 85.7 % 🆕 | New utility, needs unmount-cleanup test |

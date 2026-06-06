# Epic Implementation Notes

Notes on deviations, gotchas, and design decisions encountered while working
through the question-impl tasks. Each task section is written after the task
lands; read it before starting the next task that depends on it.

---

## Task 01 — Foundation

**Completed:** 2026-06-06

### What was done

Wired the type system, registry, dispatch stubs, store integration, and
persistence/wire schemas so `measuring`, `thermometer`, and `tentacles` are
recognized throughout the codebase. All three types appear in
`AddQuestionScreen`, create correctly via `createQuestion`, and display stub
"Not yet implemented" detail screens. `updateQuestionCenter` works for
measuring/tentacles and no-ops for thermometer. Exhaustiveness guards are in
place (`assertNever` in `createDefaultQuestion`'s default branch).

### Files created (9)

| File                                                                     | Purpose                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/assertNever.ts`                                              | Exhaustiveness helper for switch default branches                                                                        |
| `src/shared/__tests__/assertNever.test.ts`                               | Unit test                                                                                                                |
| `src/features/questions/measuring/measuringTypes.ts`                     | `MeasuringQuestion`, `MeasuringRenderState`, `MeasuringCategory`, `EMPTY_MEASURING_RENDER_STATE`                         |
| `src/features/questions/thermometer/thermometerTypes.ts`                 | `ThermometerQuestion`, `ThermometerRenderState`, `EMPTY_THERMOMETER_RENDER_STATE`                                        |
| `src/features/questions/tentacles/tentaclesTypes.ts`                     | `TentaclesQuestion`, `TentaclesRenderState`, `TentaclesCategory`, `EMPTY_TENTACLES_RENDER_STATE`, distance lookup tables |
| `src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx`     | Stub screen                                                                                                              |
| `src/features/questions/thermometer/ThermometerQuestionDetailScreen.tsx` | Stub screen                                                                                                              |
| `src/features/questions/tentacles/TentaclesQuestionDetailScreen.tsx`     | Stub screen                                                                                                              |

### Files modified (15)

| File                                                      | Change                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/features/questions/coreTypes.ts`                     | Widened `ImplementedQuestionType` to 5 types                                                                              |
| `src/features/questions/questionTypes.ts`                 | Extended `QuestionState` union                                                                                            |
| `src/features/questions/radar/radarTypes.ts`              | Added `measuring`, `thermometer`, `tentacles` to `QuestionMapRenderState`                                                 |
| `src/features/questions/questionGeometry.ts`              | Populated new keys with `EMPTY_*` constants                                                                               |
| `src/state/questionStore.tsx`                             | Store integration: widened create, added `createDefaultQuestion` cases with `assertNever`, widened `updateQuestionCenter` |
| `src/features/questions/QuestionDetailScreen.tsx`         | Dispatch branches for 3 new types                                                                                         |
| `src/features/questions/AddQuestionScreen.tsx`            | 3 new type rows                                                                                                           |
| `src/features/questions/questionSharePrompt.ts`           | Type narrowing for new types                                                                                              |
| `src/state/appState.ts`                                   | Zod schemas for new types in persistence                                                                                  |
| `src/sharing/wire/schema.ts`                              | Wire schemas for new types                                                                                                |
| `src/sharing/wire/minified.ts`                            | Minify/unminify stubs + minified schemas for all 3 types                                                                  |
| `src/sharing/export/buildEnvelope.ts`                     | Strip candidates from measuring/tentacles too                                                                             |
| `src/features/questions/measuring/measuringConfig.ts`     | `implemented: true`, answer labels, summary                                                                               |
| `src/features/questions/thermometer/thermometerConfig.ts` | `implemented: true`, answer labels ("Hotter"/"Colder"), summary                                                           |
| `src/features/questions/tentacles/tentaclesConfig.ts`     | `implemented: true`, placeholder labels, summary, `TODO(task-02)` comment                                                 |

Plus 3 config test files updated to match new config values, 1 new config test
for assertNever, and extended questionStore/questionRegistry tests.

### Deviations from the task spec

**Minified wire format was out of scope in the task doc but broke anyway.**
The task spec focused on the store and type system. However, widening
`QuestionState` caused `buildEnvelope.ts` and `appState.ts` to fail typecheck
because those files had their own narrower question type definitions (separate
Zod schemas, separate union types). Adding the three new question schemas to
`appState.ts` (`appStateQuestionsSchema`) and `wire/schema.ts`
(`questionWireSchema`) was unavoidable — `pnpm typecheck` would not pass
otherwise.

The same change forced updates to `src/sharing/wire/minified.ts`: the
`minifyQuestion` / `unminifyQuestion` pair, the `questionMinifiedSchema` Zod
union, and a test (`minified.test.ts`) that accessed `.n` (center) on the
union. These were not mentioned in the task spec.

**`questionSharePrompt.ts` needed type narrowing.** The old code assumed
non-radar questions were always matching questions, accessing `.category`,
`.lineName`, `.targetName` directly. The wider union broke that assumption.
Added explicit checks for `measuring`, `tentacles`, and `thermometer` with
stub return strings.

**Config test updates.** The three config test files asserted on old
`implemented: false`, old answer labels (`"Warmer"` → `"Hotter"`, `"Hit"`/`"Miss"` →
`"Closer"`/`"Farther"`), and old `summary()` signatures (no-arg → takes
`QuestionState`). All three were rewritten.

### Gotchas

1. **`.includes()` doesn't narrow union types in TypeScript.** The original
   `updateQuestionCenter` used an allow-list with `.includes()`, but TS can't
   narrow through `Array.includes()`. Changed to explicit `!==` checks so the
   `{...question, center}` spread type-checks correctly (thermometer has no
   `center` field, so the spread would fail without narrowing).

2. **`questionType` marker collision in minified format.** The original stubs
   assigned `"m"` to both measuring and tentacles (same as matching), and
   `"t"` to thermometer (which FIELD_MAP maps to `questionType` itself,
   causing a confusing `{t: "t"}` shape). The unminify side had no handlers
   for these markers, causing silent data corruption (measuring/tentacles →
   matching) or crashes (thermometer → radar fallback). Fixed by assigning
   unique markers: `"g"` (measuring), `"h"` (thermometer), `"c"` (tentacles),
   with corresponding unminify stubs and Zod minified schemas.

3. **`questionMinifiedSchema` must cover all types in the union.** The
   `wireEnvelopeMinifiedSchema` is called at runtime by `decodeEnvelopePayload`
   in `codec.ts`. Without schemas for the new types, any envelope containing
   them would be rejected as schema-invalid. Added three stub minified schemas.

### Design decisions

- **Thermometer `previousPosition` and `currentPosition` both default to
  `center`** at creation time. The task spec says "co-located is acceptable"
  for Task 01; the two-pin selector in Task 04/09 will replace this.

- **Measuring/Tentacles default category** is `"rail-station"` for measuring and
  `"museum"` for tentacles. The category picker lands in Tasks 05/11.

- **`tentaclesCategoryDistance` lookup drives `distanceOption` and
  `distanceMeters` at creation time.** The distance is derived from the
  category, not chosen independently — matching the spec that 2 km group
  categories get 2 km and 25 km group categories get 25 km.

- **`TentaclesQuestion.answer` is `"unanswered" | "positive"`** (no
  `"negative"`). This matches the type's semantics — the answer is a named
  POI, not a binary. Task 02 formalizes the POI answer model.

- **`assertNever` placed in `src/shared/`** (not `@/features/questions/`).
  It's a general-purpose utility that any exhausted switch can use.

- **`getQuestionAnswerLabel("thermometer", "positive")` now returns
  `"Hotter"`** (was `"Warmer"`). This matches the task spec and the actual
  game terminology.

### Code review fixes (post-implementation)

The `/code-review high --fix` pass caught three critical bugs in the minified
wire format (see Gotcha #2 above) and one medium issue
(`buildQuestionRequestEnvelope` not stripping candidates from
measuring/tentacles). All were fixed before commit.

### For the next task

- Task 02 (answer model) depends on this task's types. The
  `TentaclesQuestion.answer` restriction (`"unanswered" | "positive"`) is
  already in place. Task 02 will add `getQuestionAnswerStatus`,
  `isPoiAnswerModel`, and the `selectTentaclesPoi` / `resetTentaclesAnswer`
  helpers.

- Task 03 (wire + persistence) should extract the duplicated Zod schemas
  (measuring, thermometer, tentacles appear identically in `appState.ts` and
  `wire/schema.ts`). The pre-existing matching/radar schemas follow the same
  duplication pattern, so this is a broader cleanup, not something Task 01
  should have introduced.

- The minified stubs (`"g"`, `"h"`, `"c"` markers) are deliberately minimal.
  Task 03 should replace them with full field serialization matching the full
  wire schemas.

- The three stub detail screens are byte-for-byte identical. When the first
  real detail screen lands (Task 05), consider extracting a shared placeholder
  component if the other two are still stubs.

---

## Task 02 — Answer Model (Binary vs POI)

**Completed:** 2026-06-06

### What was done

Added an explicit answer model (`"binary"` | `"poi"`) to `QuestionDefinition` so
question families can express whether their answer is a binary yes/no or a
named POI. Tentacles now uses the POI model with no `answerLabels`, and the
`answer` field is derived from canonical `selectedOsmId` — never authored
independently by UI code. Single-writer helpers (`selectTentaclesPoi`,
`resetTentaclesAnswer`) enforce the invariant. Normalization repairs
inconsistent payloads on load.

### Files created (0)

No new files — all changes were to existing files.

### Files modified (10)

| File                                                      | Change                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/questions/questionRegistry.ts`              | Added `QuestionAnswerModel` type, `answerModel` field to `QuestionDefinition`, `isPoiAnswerModel`, `getQuestionAnswerStatus` helpers; made `answerLabels` optional   |
| `src/features/questions/radar/radarConfig.ts`             | Added `answerModel: "binary"`                                                                                                                                        |
| `src/features/questions/matching/matchingConfig.ts`       | Added `answerModel: "binary"`                                                                                                                                        |
| `src/features/questions/measuring/measuringConfig.ts`     | Added `answerModel: "binary"`                                                                                                                                        |
| `src/features/questions/thermometer/thermometerConfig.ts` | Added `answerModel: "binary"`                                                                                                                                        |
| `src/features/questions/tentacles/tentaclesConfig.ts`     | Replaced placeholder `answerLabels` with `answerModel: "poi"`; updated summary to show `selectedName ?? "Unanswered"`                                                |
| `src/state/questionStore.tsx`                             | Added `selectTentaclesPoi`, `resetTentaclesAnswer`, `isPoiAnswerQuestion` helper; updated `normalizeQuestionState` to re-derive `answer` for poi-model questions     |
| `src/state/appState.ts`                                   | Added `.transform()` to `appStateTentaclesQuestionSchema` to repair drifted `answer` on persistence load                                                             |
| `src/sharing/wire/schema.ts`                              | Added same `.transform()` to `tentaclesQuestionWireSchema`                                                                                                           |
| Tests (3 files)                                           | Extended `questionRegistry.test.ts` with answer model assertions; updated `tentaclesConfig.test.ts` for poi model; added invariant tests to `questionStore.test.tsx` |

### Deviations from the task spec

**None significant.** The task spec called out:

1. Adding `answerModel` to configs — done for all 5 question types.
2. Making `answerLabels` optional for poi model — done; tentacles omits it.
3. `selectTentaclesPoi` / `resetTentaclesAnswer` helpers — done with anti-drift
   invariant (answer derived from selectedOsmId, never passed independently).
4. `getQuestionAnswerStatus` keys off `selectedOsmId` for poi model — done.
5. Normalize on restore — done in both `normalizeQuestionState` and Zod
   `.transform()` on the app-state and wire schemas (the persistence path uses
   Zod schemas, not `normalizeQuestionState`, so both needed the repair).

**Added wire schema transform.** The task spec only mentioned
`normalizeQuestionState`, but persistence loads go through Zod schemas in
`appState.ts`, not through `normalizeQuestionState`. Added a `.transform()` to
both `appStateTentaclesQuestionSchema` and `tentaclesQuestionWireSchema` to
repair inconsistent payloads wherever they're decoded.

### Gotchas

1. **Zod `.transform()` changes `z.infer`.** The output type of a transformed
   schema can differ from the input type, but since our transform only
   changes `answer` to a subset of the input type (`"unanswered" | "positive"`
   narrowed from the input), it's compatible.

2. **Persistence path ≠ import path.** `normalizeQuestionState` is called by
   `importQuestions` / `addImportedQuestion` (sharing/import flows), but
   persistence loads use `migratePersistedAppState` → Zod schemas. Both paths
   need the repair. The test verifies through persistence.

3. **`answerLabels` optional broke TypeScript narrowing.** `getQuestionAnswerLabel`
   couldn't access `questionDefinitions[type].answerLabels` because the union
   includes tentacles (which has no `answerLabels`). Added an early return for
   poi model types, then a type assertion for the binary path.

---

## Task 03 — Wire Format & Persistence

**Completed:** 2026-06-06

### What was done

Expanded the minified wire format stubs introduced in Task 01 to full
implementations. All three new question types (measuring, thermometer,
tentacles) now round-trip losslessly through both the full-key codec and the
minified codec. Added FIELD_MAP entries for new fields, expanded minified Zod
schemas, and completed the minify/unminify switch branches.

### Files created (0)

No new files.

### Files modified (4)

| File                                          | Change                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/sharing/wire/minified.ts`                | Added `distanceUnit`, `previousPosition`, `currentPosition`, `selectedName` to FIELD_MAP; expanded minified schemas for measuring/thermometer/tentacles from stubs to full field coverage; expanded `minifyQuestion` and `unminifyQuestion` switch branches; added `t: z.literal("r").optional()` to radar schema to prevent false matches against new types |
| `src/sharing/wire/__tests__/codec.test.ts`    | Added 4 round-trip tests: measuring, thermometer, tentacles, mixed (all 5 types)                                                                                                                                                                                                                                                                             |
| `src/sharing/wire/__tests__/minified.test.ts` | Added 8 round-trip tests covering full-field and default/null variants for all 3 types, plus mixed payload                                                                                                                                                                                                                                                   |
| `docs/question_impl/epic-impl-notes.md`       | Task 03 notes                                                                                                                                                                                                                                                                                                                                                |

### Deviations from the task spec

**None significant.** The task spec called out full wire/minified support and
round-trip tests for all three types, which is what was delivered.

**`normalizeQuestionState` not extended for new types.** The task spec mentioned
adding typed branches for new types that need defaulting. The existing
fall-through is correct because:

- All three new types have complete Zod schemas with `.default()` for nullable
  fields (e.g., `candidates: []`, `selectedOsmId: null`, etc.)
- No field defaulting is needed beyond what Zod already provides
- The tentacles `answer` re-derivation was added in Task 02 via `.transform()`
  on both `appStateTentaclesQuestionSchema` and `tentaclesQuestionWireSchema`

### Gotchas

1. **Radar minified schema discriminated against new types.** The radar
   minified schema (`radarQuestionMinifiedSchema`) had no `questionType` field,
   so Zod's `.object()` (which strips unknown keys by default) would match ANY
   object with `n` (center) and `r` (distance). A measuring question with
   `seekerDistanceMeters: 500` would set `r: 500`, causing the radar schema to
   match first in the union and strip the `t: "g"` discriminator — silently
   corrupting the question type to `"radar"` on decode. Fixed by adding
   `questionType: z.literal("r").optional()` to the radar schema so it rejects
   objects with `t: "g"`/`t: "h"`/`t: "c"`/`t: "m"`.

2. **FIELD_MAP single-letter exhaustion.** All 26 lowercase letters were already
   used by the FIELD_MAP. New entries use two-letter keys: `pp` (previousPosition),
   `cp` (currentPosition), `sn` (selectedName), `du` (distanceUnit). No
   collisions with existing keys (`qq`, `rq`, `cd`).

---

---

## Task 05 — Measuring Question (point categories)

**Completed:** 2026-06-06

### What was done

Implemented the Measuring question end-to-end for 13 point-based POI categories.
The seeker pins their position, the app finds nearby POIs of the chosen category,
the seeker selects their nearest POI, and the app auto-computes
`seekerDistanceMeters` and draws a circle **centered on the target POI** (not
the seeker pin). "Closer" → hider inside circle; "Farther" → hider outside.

The 5 line/polygon categories (`high-speed-rail`, `coastline`, `body-of-water`,
`admin-1st-border`, `admin-2nd-border`) remain in the type and category list
with `implemented: false`, filtered out of the picker — Task 06 will implement
them.

### Files created (6)

| File                                                                                | Purpose                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/features/questions/measuring/measuringCategories.ts`                           | 18 categories (13 implemented, 5 deferred) with section/implemented/osmQueryTags |
| `src/features/questions/measuring/measuringGeometry.ts`                             | `buildMeasuringRenderState` with LRU circle cache (200 entries)                  |
| `src/features/questions/measuring/useMeasuringSearch.ts`                            | Maps `MeasuringCategory` → `MatchingCategory`, delegates to `useMatchingSearch`  |
| `src/features/questions/measuring/__tests__/measuringCategories.test.ts`            | 11 tests for category config                                                     |
| `src/features/questions/measuring/__tests__/measuringGeometry.test.ts`              | 14 tests for render state correctness, circle centering, and LRU caching         |
| `src/features/questions/measuring/__tests__/MeasuringQuestionDetailScreen.test.tsx` | 12 tests for detail screen UX                                                    |

### Files modified (5)

| File                                                                 | Change                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx` | Full rewrite from placeholder to working detail screen                                          |
| `src/features/questions/measuring/measuringTypes.ts`                 | Changed `candidates` type from `OsmFeature[]` to `(OsmFeature & { distanceMeters?: number })[]` |
| `src/features/questions/QuestionDetailScreen.tsx`                    | Pass `question` and `updateQuestion` props to `MeasuringQuestionDetailScreen`                   |
| `src/features/questions/questionGeometry.ts`                         | Wire `buildMeasuringRenderState(questions)` replacing `EMPTY_MEASURING_RENDER_STATE`            |
| `src/shared/geojson.ts`                                              | Added `positionsEqual(a, b)` helper                                                             |

### Deviations from the task spec

**Category picker is inline, not a separate screen.** The task doc UX mockup
shows the category picker integrated into the detail screen. This differs from
matching (which has a separate `MatchingQuestionScreen.tsx`). The inline picker
is a sectioned list of `measuringCategoriesBySection` with radio-button style
selection — tapping a category immediately clears candidates and triggers a new
search.

**`rail-station` maps to `station-name-length` for search.** The task doc
suggested Option B: "ship `rail-station` for v1 via the live Overpass fallback
path." Instead, `MEASURING_TO_MATCHING_CATEGORY` maps `rail-station` →
`station-name-length`, which shares the exact same OSM tag
(`["railway"="station"]`) and is already bundleable. This means `rail-station`
works immediately with the spatial index — no Overpass dependency, no blocking
on Task 07.

**Reused `OsmMatchingCandidatesModal` and `OsmFeatureDetailModal`.** The "Show
more..." candidate modal and the POI detail modal accept generic `OsmFeature[]`
lists, so they work for measuring candidates without modification.

### Gotchas

1. **Search generation guard against stale results.** When the user changes
   category (e.g., "Museum" → "Park"), the old category's search may still be
   in-flight. If it completes during the 400ms debounce window before the new
   search starts, the old results would overwrite candidates — and the effect's
   center-equality check wouldn't catch it (the center didn't change, just the
   category). Fixed by adding a `searchGenerationRef` counter: incremented on
   every `searchAndUpdate` call and on `handleCategoryChange`. After `await
performSearch()`, if the generation has changed, results are discarded.

2. **Circle center is the target POI, not the seeker pin.** This is the
   fundamental geometric difference from Radar. The task doc calls it out
   explicitly; tests assert it by computing the polygon centroid and comparing
   it to both the target POI position (should match) and the seeker pin position
   (should differ).

3. **`measuringCategoriesBySection` Object.entries typing.** Needed an explicit
   type assertion `as [MeasuringCategorySection, (typeof measuringCategoriesBySection)[MeasuringCategorySection]][]`
   to satisfy TypeScript's `Record` index signature. The matching categories file
   uses a simpler pattern because its records are simpler.

### Design decisions

- **Answer model is `"binary"`** (not `"poi"`). The answer is Closer/Farther,
  not the POI selection. The POI is the _target_ for the circle, not the
  answer. This means `getQuestionAnswerLabel` returns "Closer"/"Farther" from
  the config's `answerLabels`, and `getQuestionAnswerStatus` keys off
  `question.answer === "unanswered"`.

- **LRU cache keyed by `(osmId, osmType, seekerDistanceMeters)`** — not by
  question ID. The same target POI at the same distance produces the same
  circle, so the cache can serve multiple questions with identical geometry
  parameters. This mirrors `radarGeometry.ts`'s pattern but with a different
  key space.

- **`centersEqual` extracted to `positionsEqual` in `src/shared/geojson.ts`.**
  The matching screen has its own copy; that was left in place (outside Task 05
  scope).

- **Unit toggle updates `seekerDistanceUnit` only** — never mutates
  `seekerDistanceMeters`. The stored meters are the canonical value; the unit
  only affects display via `fromMeters()`.

### Code review fixes (post-implementation)

The `/code-review high --fix` pass caught a stale-results race condition (see
Gotcha #1) and the duplicated `centersEqual` function. Both fixed before commit.

### For the next task

- Task 06 (Measuring line/polygon categories) should add the 5 deferred
  categories and implement line-distance / polygon-edge-distance measurement.
  The `measuringCategories` list already has all 18 entries; Task 06 just needs
  to flip `implemented: true` and add the geometry logic.

- Task 07 (rail-station selector) should add `rail-station` to
  `CATEGORY_SELECTORS` in `matchingSelectors.ts`, regenerate the bundle via
  `pnpm data:poi`, then update `MEASURING_TO_MATCHING_CATEGORY` to point
  `rail-station` → `rail-station` instead of → `station-name-length`.

---

## Task 06 — Measuring Line/Polygon-Distance Categories

**Completed:** 2026-06-06

### What was done

Implemented all 5 line/polygon-distance Measuring categories: `high-speed-rail`,
`coastline`, `body-of-water`, `admin-1st-border`, `admin-2nd-border`. Unlike
point categories (Task 05), these compute the nearest point on bundled line
geometry automatically — no candidate list, no POI selection. The target is
derived on render from `(center, category)` and never stored.

Key behavioral differences from point categories:

- **No search, no candidate list.** `isLineMeasuringCategory` gates the detail
  screen to `LineMeasuringResult`, which skips `useMeasuringSearch` entirely.
- **Answer enabled immediately.** No POI selection step.
- **Connector + marker drawn on map.** `MeasuringLayers.tsx` renders a dashed
  hairline from center to nearest point plus a circle marker.
- **Circle centers on nearest point** (not seeker center), matching the
  point-category behavior of "circle centers on target."
- **`nearestPoint` is derived, never stored.** No new question fields, no wire
  format changes.

### Files created (8)

| File                                                                       | Purpose                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/features/questions/measuring/lineBundleLoader.ts`                     | Lazy `require()`-based bundle loader with test seams                                                            |
| `src/features/questions/measuring/lineMeasuringGeometry.ts`                | `computeLineDistance()` with LRU cache, bbox pre-filter, `@turf/nearest-point-on-line`                          |
| `src/features/map/MeasuringLayers.tsx`                                     | Renders connector lines + nearest-point markers on the map                                                      |
| `src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts` | 13 tests for nearest-point geometry                                                                             |
| `data/geofabrik/scripts/extract-measuring-bundles.mjs`                     | Build pipeline: download japan-latest PBF → osmium extract → post-filter → bundle                               |
| `data/geofabrik/scripts/extract-measuring-bundles.test.mjs`                | Structural validator (65 tests, CI-safe)                                                                        |
| `assets/measuring/*.json` (5 files)                                        | Committed bundles: coastline (7k), high-speed-rail (4k), body-of-water (75k), admin-1st (666), admin-2nd (3.4k) |

### Files modified (13)

| File                                    | Change                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `measuringTypes.ts`                     | Added `nearestPointConnectors` + `nearestPointMarkers` to `MeasuringRenderState`                                                             |
| `measuringCategories.ts`                | Renamed `"Border"` → `"Borders & Lines"`, moved 3 categories, flipped all 18 to `implemented: true`, added `isLineMeasuringCategory()` guard |
| `measuringGeometry.ts`                  | Restructured `buildMeasuringRenderState` — removed `selectedOsmId` pre-filter, branches on `isLineMeasuringCategory()`                       |
| `MeasuringQuestionDetailScreen.tsx`     | Added `LineMeasuringResult` component with early return for line categories                                                                  |
| `NativeMap.tsx`                         | Added `<MeasuringLayers>` component before `QuestionPinLayer`                                                                                |
| `colors.ts`                             | Added `measuringLine: "#e46f4d"` token                                                                                                       |
| `config.yaml`                           | Added `measuring` block with whole-Japan source + Kantō+margin window                                                                        |
| `jest.config.js`                        | Added `@turf` to `transformIgnorePatterns` (needed for `@turf/nearest-point-on-line`)                                                        |
| `package.json`                          | Pinned `@turf/nearest-point-on-line`, added `data:measuring` script, wired validator into `pretest`                                          |
| `SIZES.md`                              | Added measuring bundle sizes section (total: 22.89 MB raw, 4.02 MB gzip)                                                                     |
| `__tests__/measuringCategories.test.ts` | Updated for section rename, all 18 implemented, `isLineMeasuringCategory`                                                                    |
| `__tests__/measuringGeometry.test.ts`   | Added line-category tests (regression guard, circle centering, connector/marker, mixed)                                                      |
| `pnpm-lock.yaml`                        | Bumped `@turf/invariant` and `@turf/meta` from 7.2.0 → 7.3.5 (transitive via new dep)                                                        |

### Bundle sizes

| Category         | Features   | Raw          | Gzip        |
| ---------------- | ---------- | ------------ | ----------- |
| coastline        | 7,045      | 1.41 MB      | 0.21 MB     |
| high-speed-rail  | 4,228      | 0.79 MB      | 0.10 MB     |
| body-of-water    | 74,539     | 16.14 MB     | 2.44 MB     |
| admin-1st-border | 666        | 0.50 MB      | 0.15 MB     |
| admin-2nd-border | 3,438      | 4.04 MB      | 1.13 MB     |
| **TOTAL**        | **89,916** | **22.89 MB** | **4.02 MB** |

### Deviations from the task spec

**`@turf/helpers` import avoided in `measuringGeometry.ts`.** The task doc
imports `lineString` and `point` from `@turf/helpers` to construct the connector
and marker GeoJSON features. Instead, manual `{ type: "Feature", geometry: {…},
properties: {} }` construction was used. This avoids adding `@turf/helpers` to
the `transformIgnorePatterns` dependency chain in `measuringGeometry.ts` (keeping
the Jest config change minimal — only `@turf` needed for `nearest-point-on-line`).

**`computeBboxFromCoords` walker uses `unknown` cast.** The recursive
coordinate walker in `lineMeasuringGeometry.ts` uses `(c as number[])?.[0]` to
detect coordinate pairs vs nested arrays. This is equivalent to the bbox
computation in `extract-measuring-bundles.mjs` but adapted for TypeScript's
`Geometry` union type (which doesn't have `.coordinates`).

### Gotchas

1. **`selectedOsmId` pre-filter was silently dropping line categories.** The
   original `buildMeasuringRenderState` filter required `selectedOsmId !== null`
   (from Task 05). Since line categories have `selectedOsmId: null`, every line
   question would be filtered out before reaching the loop body. The fix
   restructures to filter only on `type === "measuring"` and branch inside.

2. **Bbox pre-filter margin is uniform degree conversion.** The 50 km query
   margin uses `1° ≈ 111,320 m` for both latitude and longitude. At Tokyo's
   latitude (~35°N), the longitude margin is ~41 km instead of 50 km. In
   practice, nearest features are well within 50 km, and 41 km remains generous
   for the pre-filter. No user-visible impact expected.
   _(Noted in code review; not fixed — acceptable per the design doc's "slightly-too-large window" guidance.)_

3. **`require()` crash if bundle JSON is missing.** `lineBundleLoader.ts` uses
   hard `require()` calls in a switch statement. If a category's bundle JSON is
   missing from `assets/measuring/`, the app crashes at the `require()` site.
   Mitigated by: (a) bundles are committed, (b) the structural validator in
   `pretest` catches missing bundles, (c) `default: bundle = null` handles
   unrecognized categories.

4. **Non-admin temp dirs not cleaned up in extraction script.** The per-category
   temp directories (`measuring-coastline-<timestamp>/`, etc.) in the OS temp
   dir are never removed after the pipeline runs. Only the admin shared temp
   dir is cleaned. The OS will eventually clean them; minor untidiness.
   _(Noted in code review; not fixed.)_

### Design decisions

- **`nearestPoint` derived on render, never stored.** This removes an entire
  class of staleness bugs: moving the pin automatically updates the nearest
  point, the connector, the marker, and the circle — no write-back hook needed.

- **LRU cache keyed on `(version, category, center)`** — not question id. Two
  questions with the same center and category share a cache hit. 7-decimal-place
  rounding (~1.1 cm) prevents floating-point drift from creating duplicate
  entries.

- **Bbox pre-filter before `nearestPointOnLine`.** The 50 km query window
  filters out the vast majority of features, so `nearestPointOnLine` only
  iterates the survivors' segments. For `body-of-water` (75k features), only
  the few hundred within 50 km survive the filter.

- **Line-category circles NOT cached** (unlike point-category circles, which
  use an LRU cache keyed by osmId/osmType/distance). The circle parameters for
  line categories change with the nearest point, which is already cached by
  `computeLineDistance`. Recomputing a 32-step circle is negligible.

- **Structural validator is CI-safe** (no PBF required). It validates committed
  bundle structure: schemaVersion, geometry types, bbox intersection. The
  regeneration `--check` (which needs the PBF) is a local-only guard.

### Code review fixes (post-implementation)

The `/code-review max --fix` pass caught one issue:

- **Dead assignments in point-category path.** `circleCenter` and `radiusMeters`
  were set in the point-category branch of `buildMeasuringRenderState` but never
  consumed — the `continue` immediately followed, skipping past the line-category
  circle block. Fixed by removing the dead assignments and passing
  `q.seekerDistanceMeters` directly to `getMeasuringCircle`.

Additional findings noted but not fixed (all low-severity):

- **Measuring hit/miss masks not in `combinedInsideMask`.** Pre-existing gap
  from Task 05: `NativeMap.tsx`'s `buildCombinedEligibilityMask` doesn't
  include `questionMapRenderState.measuring.hitMaskFeatures` or
  `.missMaskFeatures`. Line categories make this more noticeable since circles
  are auto-derived, but fixing it would expand the diff scope beyond Task 06.

### For the next task

- Task 07 (rail-station data) can now treat `rail-station` as an independent
  `MatchingCategory` with its own selectors, since the 5 line categories no
  longer depend on the matching category mapping.

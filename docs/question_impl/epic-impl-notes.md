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

## Review fixes (2026-06-06)

Applied fixes from `docs/question_impl/review-task-02-03.md`.

### T2-1 — `addImportedQuestion` now clears selection for poi-model questions

`addImportedQuestion` in `questionStore.tsx` previously forced `answer: "unanswered"`
on imported questions but left `selectedOsmId`/`selectedOsmType`/`selectedName`
intact. For poi-model (Tentacles) questions, `normalizeQuestionState` then
re-derived `answer: "positive"` from the still-present `selectedOsmId`, defeating
the reset-on-import contract.

**Fix:** `addImportedQuestion` now checks `isPoiAnswerModel(question.type)` and
clears all three selection fields (`selectedOsmId`, `selectedOsmType`,
`selectedName` to `null`) for poi-model questions before passing through
`normalizeQuestionState`. Added a dedicated test: importing an answered
Tentacles question with `selectedOsmId: 123` / `selectedName: "Test POI"` now
asserts the imported question has all fields nulled and `answer: "unanswered"`.

### T3-1 — `pnpm check` gate fixed

`docs/question_impl/epic-impl-notes.md` had prettier formatting issues.
Ran `pnpm exec prettier --write`; `pnpm check` now passes.

### T3-2 — Decode path now re-derives Tentacles answer

`unminifyQuestion` for tentacles previously used `resolvedAnswer` (from the
minified `answer` field) directly, with only a guard against `"negative"`. A
hand-crafted minified payload with `e:"p"` but no `selectedOsmId` would decode
to a drifted `{ answer: "positive", selectedOsmId: null }`.

**Fix:** `unminifyQuestion` now reads `selectedOsmId` from the minified
payload first, then derives `answer` via `derivePoiAnswer(selectedOsmId)` —
symmetric with the Zod transforms on the full-key schemas and
`normalizeQuestionState` in the store. The decode → import path now has
redundant repair (unminify + normalize), which is correct defense-in-depth.

### T2-4 — `selectTentaclesPoi` uses `derivePoiAnswer`

`selectTentaclesPoi` previously hardcoded `answer: "positive"` rather than
calling `derivePoiAnswer(poi.osmId)`. The `osmId > 0` guard already ensured
`derivePoiAnswer` would return `"positive"`, but using the helper keeps the
derivation rule literally true at the single most important write site.

### Not yet addressed

- **T3-3**: `persistence.test.ts` not extended with measuring/thermometer/tentacles
  persistence round-trips. The `appState.ts` schemas are exercised indirectly
  through the store test (one tentacles persist→load test), but dedicated
  persistence tests per the written test plan are still missing.
- **T3-4**: Round-trip tests use `toMatchObject` (partial) rather than strict
  `encode(decode(encode(q))) === encode(q)` byte-stable assertions. Candidate
  `tags` are silently dropped on minified round-trip (documented lossy behavior
  inherited from matching), but no test pins this for measuring/tentacles.
- **T2-3**: `QuestionAnswerSelector.test.tsx` does not exist; the test plan
  called for binary/poi assertions there.
- **T3-5**: Candidate sub-schema still copy-pasted across matching/measuring/
  tentacles in both `schema.ts` and `appState.ts`.

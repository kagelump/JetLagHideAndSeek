# Task 02: Answer Model (Binary vs POI)

**Depends on**: Task 01
**Audience**: intern-friendly, but it touches shared config typing — keep the
change small and well-tested.

## Why

Today every question's answer is a `QuestionAnswer = "unanswered" | "positive" |
"negative"` with a `positive`/`negative` label pair. That fits Radar, Matching,
Measuring, and Thermometer (all genuinely binary). It does **not** fit
**Tentacles**, whose answer is *a named POI* — there is no "negative". Forcing it
into the binary model produced nonsense labels (`positive: "Answered"`,
`negative: "—"`).

This task introduces an explicit **answer model** so question families can be
either binary or POI-answered, and removes the placeholder Tentacles labels.

**Chosen model (Option A):** the POI fields (`selectedOsmId` / `selectedOsmType`
/ `selectedName`) are the **canonical** answer. The legacy `answer` string is kept
only as a coarse status for generic store/list code, and is **derived** from the
selection — never authored independently. We deliberately did *not* refactor the
shared `QuestionAnswer` union into a polymorphic per-family type; that's the right
move only if a second place-answer question type appears. To stop the canonical
fields and the derived status from drifting, see "Hardening" below — it is the
load-bearing part of this task, not optional polish.

## Test plan (write first)

### `src/features/questions/__tests__/questionRegistry.test.ts` (extend)

- `questionDefinitions.radar.answerModel === "binary"` (and matching, measuring,
  thermometer).
- `questionDefinitions.tentacles.answerModel === "poi"`.
- A new helper `getQuestionAnswerStatus(question)` returns `"answered"` /
  `"unanswered"` for both models:
  - binary: `answered` iff `answer === "positive" || answer === "negative"`.
  - poi: `answered` iff `selectedOsmId !== null`.
- A new helper `isPoiAnswerModel(type)` returns `true` only for `tentacles`.

### `src/features/questions/components/__tests__/QuestionAnswerSelector.test.tsx` (extend)

- For a binary question, the selector renders the positive/negative labels as
  today.
- The selector is **not** used for poi-model questions (Task 11 renders the POI
  list as the answer affordance instead). Assert the Tentacles detail path does
  not mount a positive/negative `QuestionAnswerSelector` (this can be asserted in
  Task 11's screen test; here, just make sure the component still works for
  binary and document the boundary).

## Implementation

### `src/features/questions/questionRegistry.ts`

Add an `answerModel` field to `QuestionDefinition`:

```typescript
export type QuestionAnswerModel = "binary" | "poi";

export type QuestionDefinition = {
    // ...existing fields...
    answerModel: QuestionAnswerModel;
};
```

Add helpers in the same module:

```typescript
export function isPoiAnswerModel(type: QuestionType): boolean {
    return questionDefinitions[type]?.answerModel === "poi";
}

export function getQuestionAnswerStatus(
    question: QuestionState,
): "answered" | "unanswered" {
    if (isPoiAnswerModel(question.type)) {
        return "selectedOsmId" in question && question.selectedOsmId !== null
            ? "answered"
            : "unanswered";
    }
    return question.answer === "unanswered" ? "unanswered" : "answered";
}
```

### Config updates

- `radarConfig`, `matchingConfig`, `measuringConfig`, `thermometerConfig`:
  `answerModel: "binary"`.
- `tentaclesConfig`: `answerModel: "poi"`. Remove the placeholder
  `positive: "Answered"` / `negative: "—"` labels — for the poi model the labels
  are not shown. Keep the field type-valid (e.g. set both to a short neutral
  string or make `answerLabels` optional in the definition type when
  `answerModel === "poi"`). Prefer making `answerLabels` optional and omitting it
  for Tentacles, so no fake labels exist anywhere.

### Replace `answer`-status assumptions

Audit list/summary code that currently checks `question.answer === "unanswered"`
to decide "answered?" and route it through `getQuestionAnswerStatus`. Grep:

```bash
rg 'answer === "unanswered"|answer !== "unanswered"' src
```

Update `QuestionsScreen` / any summary badge that shows answered/unanswered state
so Tentacles reports correctly off `selectedOsmId`.

### Tentacles config `summary`

`"Tentacles: ${categoryTitle} (${distanceOption}) — ${selectedName ?? 'Unanswered'}"`.
This reads `selectedName` (added to `TentaclesQuestion` in Task 01).

## Hardening: `answer` is derived, never authored

Option A's one weakness is two fields that can disagree (`answer: "positive"` but
`selectedOsmId: null`, or vice-versa). Close that with a **single-writer** rule so
the canonical fields and the derived status cannot drift:

1. **Single writer.** Define the selection helpers in `questionStore.tsx` **here,
   in this task** (Task 11 only wires them to the UI). They are the *only* code
   allowed to set a Tentacles `answer`:
   - `selectTentaclesPoi(question, { osmId, osmType, name })` sets all three
     selected fields **and** derives `answer: "positive"` in the same update.
   - `resetTentaclesAnswer(question)` clears all three selected fields **and**
     sets `answer: "unanswered"` in the same update.
   No UI component, detail screen, or generic action may write a Tentacles
   `answer` directly. There is no `QuestionAnswerSelector` for Tentacles (Task 11),
   so nothing in the UI should even have a reason to. Owning the helpers here lets
   the anti-drift invariant be tested before any UI exists.

2. **Derive, don't store a second truth.** Treat `selectedOsmId` as canonical.
   `answer` is a cache of "is a POI selected?". Implement the helpers so `answer`
   is computed from the selection (`selectedOsmId === null ? "unanswered" :
   "positive"`) rather than passed in — that makes a mismatched write
   *unrepresentable through the supported API*.

3. **Reads go through `getQuestionAnswerStatus`.** Nothing outside the helpers
   should branch on a Tentacles `answer` literal. `getQuestionAnswerStatus` keys
   off `selectedOsmId` for poi-model questions (already specified above), so even
   if a stale `answer` slipped in via an old persisted payload, reads stay
   correct.

4. **Normalize on restore.** In `normalizeQuestionState` (Task 03 / questionStore),
   re-derive `answer` for poi-model questions from `selectedOsmId` so any
   historically-inconsistent persisted/shared payload is repaired on load.

### Invariant test (add to the test plan)

`src/state/__tests__/questionStore.test.tsx` (extend):

- After `selectTentaclesPoi(...)`: `selectedOsmId !== null` **and**
  `answer === "positive"` **and** `getQuestionAnswerStatus(q) === "answered"`.
- After `resetTentaclesAnswer(...)`: all selected fields `null` **and**
  `answer === "unanswered"` **and** status `"unanswered"`.
- **Anti-drift invariant**: for any Tentacles question produced by the helpers,
  `(answer === "positive") === (selectedOsmId !== null)`. (A small property-style
  loop over create → select → reset → select is enough; no fuzzing needed.)
- `normalizeQuestionState` repairs a hand-crafted inconsistent payload
  (`answer: "positive"`, `selectedOsmId: null`) back to `answer: "unanswered"`.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test`, `pnpm check` pass
- No fake/empty Tentacles answer labels remain in the codebase
- `getQuestionAnswerStatus` is the single source of truth for "is this answered?"
  and Tentacles answers off `selectedOsmId`
- The anti-drift invariant `(answer === "positive") === (selectedOsmId !== null)`
  holds for every Tentacles question the helpers can produce; `answer` is written
  only by `selectTentaclesPoi` / `resetTentaclesAnswer`, and re-derived on restore
- No regressions to binary questions' answer UI

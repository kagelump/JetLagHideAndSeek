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

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test`, `pnpm check` pass
- No fake/empty Tentacles answer labels remain in the codebase
- `getQuestionAnswerStatus` is the single source of truth for "is this answered?"
  and Tentacles answers off `selectedOsmId`
- No regressions to binary questions' answer UI

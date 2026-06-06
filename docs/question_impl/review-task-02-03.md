# Review: Task 02 (Answer Model) & Task 03 (Wire / Persistence)

**Reviewer:** Claude (automated code review)
**Date:** 2026-06-06
**Branch:** `claude/question-impl-design-review-phJ9k`
**Scope:** Local uncommitted changes implementing
[task-02-answer-model.md](task-02-answer-model.md) and
[task-03-wire-persistence.md](task-03-wire-persistence.md).

> Note: the task-02/03 docs themselves only changed in markdown formatting
> (prettier); their content/spec is unchanged. This review compares the
> implementation against that spec.

## Verdict

Both tasks are **substantially and faithfully implemented**. The answer-model
abstraction, the binary/poi split, the single-writer Tentacles helpers, the
derive-on-restore repair, and the wire + persistence schemas for all three new
question types are present, well-structured, and pass typecheck/lint/tests.

There is **one latent correctness bug** (Tentacles import reset, finding T2-1),
one **acceptance-gate failure** (`pnpm check` is red, finding T3-1), a
**layering redundancy** worth documenting (finding T3-2), and several
**test-plan gaps** where the code is likely correct but under-verified relative
to the written test plan.

## Verification results

| Gate                      | Result  | Notes                                                            |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| `pnpm typecheck`          | ✅ pass | clean                                                            |
| `pnpm lint`               | ✅ pass | clean                                                            |
| `pnpm format:check`       | ❌ fail | only `docs/question_impl/epic-impl-notes.md` (untracked doc)     |
| `pnpm check`              | ❌ fail | fails at `format:check` step (see T3-1)                          |
| Targeted tests (8 suites) | ✅ pass | 146/146 — registry, store, codec, minified, persistence, configs |

Targeted run: `questionRegistry.test.ts`, `questionStore.test.tsx`,
`codec.test.ts`, `minified.test.ts`, `persistence.test.ts`, and the three config
tests.

---

## Task 02 — Answer Model

### Implemented correctly

- `QuestionAnswerModel` type + `answerModel` field on `QuestionDefinition`
  ([questionRegistry.ts:14-35](../../src/features/questions/questionRegistry.ts)).
- `isPoiAnswerModel` and `getQuestionAnswerStatus` per spec
  ([questionRegistry.ts:54-78](../../src/features/questions/questionRegistry.ts)).
  `getQuestionAnswerStatus` correctly keys poi questions off `selectedOsmId`, so
  a stale `answer` literal can't produce a wrong read.
- Nice extra factoring: `derivePoiAnswer(selectedOsmId)`
  ([questionRegistry.ts:63-67](../../src/features/questions/questionRegistry.ts))
  is reused by all three repair sites — good DRY for the
  `selectedOsmId → answer` rule.
- Configs: `binary` for radar/matching/measuring/thermometer, `poi` for
  tentacles. Tentacles **omits** `answerLabels` (now optional on the definition
  type); no fake `"Answered"`/`"—"` labels remain anywhere.
- `getQuestionAnswerLabel` guards poi-model → `"N/A"` before the only
  `answerLabels[...]` index site
  ([questionRegistry.ts:80-90](../../src/features/questions/questionRegistry.ts)),
  so the now-optional field can't blow up.
- Single-writer helpers `selectTentaclesPoi` / `resetTentaclesAnswer` live in
  the store and derive `answer` from the selection
  ([questionStore.tsx:565-600](../../src/state/questionStore.tsx)).
  `selectTentaclesPoi` adds an `osmId > 0` guard — sensible defensive extra.
- `normalizeQuestionState` re-derives `answer` for poi-model questions on
  restore ([questionStore.tsx:717-726](../../src/state/questionStore.tsx)).
- Tentacles `summary` reads `selectedName ?? "Unanswered"`
  ([tentaclesConfig.ts:17-20](../../src/features/questions/tentacles/tentaclesConfig.ts)).
- Boundary respected: Tentacles routes to `TentaclesQuestionDetailScreen`, which
  does **not** mount the binary `QuestionAnswerSelector`
  ([QuestionDetailScreen.tsx](../../src/features/questions/QuestionDetailScreen.tsx)).
  The selector is only used by radar/matching/transit-line.
- Strong invariant tests: select/reset field effects, `updatedAt` bump, the
  anti-drift loop `(answer === "positive") === (selectedOsmId !== null)`, and a
  drift read regression
  ([questionStore.test.tsx:1196-1283](../../src/state/__tests__/questionStore.test.tsx),
  [questionRegistry.test.ts:98-161](../../src/features/questions/__tests__/questionRegistry.test.ts)).

### Findings

#### T2-1 — `addImportedQuestion` silently fails to reset a Tentacles answer (severity: **medium**, latent)

[questionStore.tsx:283-302](../../src/state/questionStore.tsx)

```ts
const imported = normalizeQuestionState({
    ...question,
    answer: "unanswered", // <-- generic answer write
    createdAt: now,
    id: createQuestionId(),
    updatedAt: now,
});
```

`addImportedQuestion` forces `answer: "unanswered"` but does **not** clear
`selectedOsmId` / `selectedOsmType` / `selectedName`. For a Tentacles question
that still has a selection, `normalizeQuestionState` then re-derives
`answer: "positive"` from `selectedOsmId`
([questionStore.tsx:720-726](../../src/state/questionStore.tsx)) — so the
imported question stays **answered** with the original POI, defeating the
explicit "reset on import" contract (test name + intent at
[questionStore.test.tsx:1002](../../src/state/__tests__/questionStore.test.tsx)).

This is also a direct violation of Task 02's hardening rule: _"No UI component,
detail screen, or generic action may write a Tentacles `answer` directly."_
`addImportedQuestion` is exactly such a generic action.

**Reachability:** latent today — no UI sets a Tentacles selection yet (Task 11
not wired; `createDefaultQuestion` yields `selectedOsmId: null`). But it
activates as soon as Task 11 lets seekers pick a POI, or for any forwarded /
hand-crafted `question-request` link that carries a selection.
`buildQuestionRequestEnvelope`
([buildEnvelope.ts:64-85](../../src/sharing/export/buildEnvelope.ts)) only strips
`candidates`, not the selection/answer, so a shared answered Tentacles request
would carry the seeker's POI to the hider.

**Fix:** for poi-model questions, clear the selection on import (e.g. branch to
`resetTentaclesAnswer`, or null the selected fields) so `derivePoiAnswer` yields
`"unanswered"` consistently — instead of nulling only `answer`. Add a Tentacles
case to the "resets answer on import" test (it currently only covers radar).

#### T2-2 — `getQuestionAnswerStatus` has no production consumer (severity: low)

The spec wants it to be _"the single source of truth for 'is this answered?'"_
and to replace `answer === "unanswered"` checks in list/summary code. In
practice the only "answered/unanswered" surface is `QuestionsScreen`, which
renders each config's `summary()`, and Tentacles' summary already keys off
`selectedName`. So there's no generic badge to route, and `getQuestionAnswerStatus`
is currently used **only in tests**. The helper is correct and well-tested, but
the "single source of truth" intent isn't realized. Acceptable for now; route
any future generic answered indicator through it.

#### T2-3 — Missing `QuestionAnswerSelector.test.tsx` (severity: low, test-plan gap)

Task 02's test plan calls to extend
`src/features/questions/components/__tests__/QuestionAnswerSelector.test.tsx`
(binary labels render; assert it isn't used for poi). That file does not exist
(only `QuestionLocationSelector.test.tsx` is present). The boundary is upheld in
code, but the specified test was not added.

#### T2-4 — `selectTentaclesPoi` hardcodes `"positive"` (severity: nit)

[questionStore.tsx:574-581](../../src/state/questionStore.tsx) sets
`answer: "positive"` literally rather than `derivePoiAnswer(poi.osmId)`.
Harmless (osmId is validated `> 0`), but using `derivePoiAnswer` would keep the
"`answer` is always derived from the selection" rule literally true at the one
write site that matters most.

---

## Task 03 — Wire Format & Persistence

### Implemented correctly

- Three wire schemas (`measuring` / `thermometer` / `tentacles`) mirroring
  `matching`, union extended, inferred type `RadarQuestionWireV1` etc. exported
  ([schema.ts:165-264](../../src/sharing/wire/schema.ts)).
- Parallel **persistence** schemas in
  [appState.ts:166-267](../../src/state/appState.ts) with the union extended —
  this is the AsyncStorage path the wire spec's persistence bullet depends on.
- Minified codec: `FIELD_MAP` additions (`sn`, `pp`, `cp`; reuse of `r`/`d`/`du`
  for distance fields), per-type minified schemas, and symmetric
  `minify`/`unminify` branches reusing `compactCandidate`
  ([minified.ts:15-53, 137-200, 359-791](../../src/sharing/wire/minified.ts)).
- Tentacles `answer` re-derivation transform present in both the wire schema and
  the persistence schema
  ([schema.ts:247-255](../../src/sharing/wire/schema.ts),
  [appState.ts:248-256](../../src/state/appState.ts)).
- `tentacles` minified `answer` is `z.enum(["p"]).optional()` — correctly admits
  no `"negative"`.
- Round-trip tests for all three new types plus a mixed five-type payload exist
  in both codec and minified suites and pass; the persistence/normalize repair
  is exercised end-to-end by the store test
  ([questionStore.test.tsx:1285-1332](../../src/state/__tests__/questionStore.test.tsx)).

### Findings

#### T3-1 — `pnpm check` is red (severity: **medium** — acceptance gate)

Both tasks list `pnpm check` as an acceptance criterion. `check` runs
`format:check`, which fails on the new untracked file
`docs/question_impl/epic-impl-notes.md` (prettier style issues). No Task 02/03
**source** file is at fault. Fix: `pnpm exec prettier --write docs/question_impl/epic-impl-notes.md`
(or remove the file). Until then the gate is red.

#### T3-2 — Decode path never runs the wire-schema repair transform (severity: medium — layering)

[codec.ts](../../src/sharing/wire/codec.ts) `decodeEnvelopePayload` parses with
`wireEnvelopeMinifiedSchema` and then calls `unminifyEnvelope` (manual key
mapping), returning the result **directly** — it does not re-parse through
`wireEnvelopeSchema`. Consequently:

- The tentacles `.transform` repair in
  [schema.ts:247-255](../../src/sharing/wire/schema.ts) only fires on **encode**
  (`encodeEnvelope` → `wireEnvelopeSchema.parse`). On the encode path the store
  already guarantees consistency, so that transform is effectively
  belt-and-suspenders.
- `unminifyQuestion` for tentacles
  ([minified.ts:728-770](../../src/sharing/wire/minified.ts)) does **not**
  re-derive `answer` from `selectedOsmId`. A (forwarded/hand-crafted) minified
  payload with `e:"p"` but no `f` (selectedOsmId) decodes to a **drifted**
  `{ answer: "positive", selectedOsmId: null }`.

End-to-end this is still safe because every decode→import path runs through the
store's `normalizeQuestionState` (`addImportedQuestion` / `importQuestions`),
which repairs the drift. But the repair responsibility is split unintuitively
(wire-encode + persistence-load do it via zod transforms; wire-decode relies on
the store). Recommend either re-deriving inside `unminifyQuestion` for symmetry,
or a comment documenting that decode intentionally defers repair to store
normalization. Note that the codec-level drift case is not tested (see T3-4).

#### T3-3 — `persistence.test.ts` not extended (severity: low — test-plan gap)

Task 03 explicitly lists `src/state/__tests__/persistence.test.ts` (extend) and
the acceptance criteria require round-trip tests _"in AsyncStorage persistence."_
That file is unchanged (last touched in the share-link PR) and has **no**
measuring/thermometer/tentacles coverage. The `appState.ts` schemas are
exercised indirectly by one tentacles persist→load test in the store suite, but
there is no persist→load deep-equal for measuring/thermometer and no
"unknown/legacy field tolerated, defaults applied" persistence test as
specified.

#### T3-4 — Round-trip tests are weaker than the written test plan (severity: low)

The spec asks for `encode(decode(encode(q))) === encode(q)` (byte-stable) and
decoded questions that _"deep-equal the original (modulo documented defaults)."_
The added tests instead use `toMatchObject` (partial) on a subset of fields, and
the mixed-payload tests assert only length + sorted `type`s
([codec.test.ts:254-493](../../src/sharing/wire/__tests__/codec.test.ts),
[minified.test.ts:749+](../../src/sharing/wire/__tests__/minified.test.ts)).
They would not catch dropped/extra fields or a non-idempotent round-trip. Also,
candidate `tags` are silently dropped on minified round-trip (documented lossy
behavior inherited from matching), but no test pins that for measuring/tentacles.
Recommend at least one strict `encode(decode(encode(q))) === encode(q)`
assertion per new type, plus a deep-equal (with `tags: {}`) for an answered
measuring/tentacles question.

#### T3-5 — Candidate sub-schema still duplicated (severity: nit)

The spec suggested factoring `z.object({ lat, lon, name, osmId, osmType, tags })`
into a shared `candidateWireSchema` "rather than copy-pasting." It is now
copy-pasted across matching/measuring/tentacles in **both**
[schema.ts](../../src/sharing/wire/schema.ts) and
[appState.ts](../../src/state/appState.ts) (~4 copies). Minor maintainability
nit; a shared const would prevent the four from drifting.

---

## Prioritized actions

1. **(T3-1)** `prettier --write docs/question_impl/epic-impl-notes.md` so
   `pnpm check` goes green — required by both acceptance criteria.
2. **(T2-1)** Make `addImportedQuestion` clear the selection for poi-model
   questions (not just null `answer`), and add a Tentacles case to the
   reset-on-import test. Prevents an answered Tentacles question from surviving
   import once Task 11 lands.
3. **(T3-2)** Decide where wire-decode repair lives: re-derive in
   `unminifyQuestion` for symmetry, or document that the store normalizer owns
   it. Add a codec test for the drifted-input case.
4. **(T3-3 / T3-4 / T2-3)** Close the test-plan gaps: persistence round-trips
   for the new types, strict `encode(decode(encode(q)))` equality, and the
   `QuestionAnswerSelector` binary/poi test.
5. **(T3-5 / T2-2 / T2-4)** Optional cleanups: shared `candidateWireSchema`;
   route any future generic "answered?" badge through `getQuestionAnswerStatus`;
   use `derivePoiAnswer` inside `selectTentaclesPoi`.

None of the above blocks the happy path — normal serialize/restore round-trips
are stable and all run tests pass. T3-1 (gate) and T2-1 (latent reset bug) are
the two that should be addressed before this is considered done against the
written acceptance criteria.

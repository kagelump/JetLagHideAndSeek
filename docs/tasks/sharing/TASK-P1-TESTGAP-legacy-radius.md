# P1-TESTGAP: Legacy "radius" type normalization untested through question-request path

**Severity:** P1 — normalization gap could allow malformed questions into the
store.  
**Source:** [/code-review](/code-review)  
**Files:**

- `src/state/questionStore.tsx:573-597` (`normalizeQuestionState`)
- `src/sharing/wire/schema.ts:120-141` (`legacyRadiusQuestionWireSchema`)

## What

Two layers of legacy normalization exist for questions with
`type: "radius"` (the pre-rename format):

1. **Wire layer:** `legacyRadiusQuestionWireSchema` in `schema.ts` — a Zod
   schema with `.transform(...)` that converts `radiusMeters`/`radiusOption`/
   `radiusUnit` → `distanceMeters`/`distanceOption`/`distanceUnit` and
   `type: "radar"`.
2. **Store layer:** `normalizeQuestionState` in `questionStore.tsx` — a
   runtime type guard (`isLegacyRadiusQuestion`) with the same remapping.

No test exercises a legacy `type: "radius"` question through the full
question-request path: `buildQuestionRequestEnvelope` → `encodeEnvelope` →
`decodeEnvelopePayload` → `unminifyEnvelope` → `addImportedQuestion` →
`normalizeQuestionState`.

## Failure scenario

1. A question with `type: "radius"` enters the system (restored from old
   persisted state, or imported from a legacy share link).
2. It bypasses the Zod transform because `questionWireSchema` union order
   places `radarQuestionWireSchema` first — if it structurally matches radar
   (it does), Zod parses it as radar.
3. But if `type: "radius"` reaches `normalizeQuestionState` via a code path
   that skips the Zod parse, the `isLegacyRadiusQuestion` guard normalizes it.
   If BOTH are missed, the `return question as QuestionState` fallthrough on
   line 596 passes a non-conforming object into the store.

## Suggested fix

Add a test that constructs a legacy `type: "radius"` object with
`radiusMeters`, `radiusOption`, `radiusUnit` and sends it through the full
encode/decode/addImportedQuestion round-trip. Assert the result has
`type: "radar"` with `distanceMeters`/`distanceOption`/`distanceUnit`
correctly mapped.

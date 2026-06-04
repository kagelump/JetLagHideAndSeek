# P2-TESTGAP: Matching question through applyImport untested at store level

**Severity:** P2 — store integration for matching questions is only
component-tested, not store-tested.  
**Source:** [/code-review](/code-review)  
**File:** `src/sharing/import/__tests__/applyImport.test.ts`

## What

The `applyImport` tests for `question-request` only use radar questions. The
component test (`ImportScreenQuestionRequest.test.tsx`) verifies that a
matching question renders the add button, but never presses it to verify the
store mutation. There is no test that asserts:

- A matching question-request envelope goes through `applyImport` → calls
  `addImportedQuestion` with the matching question.
- The imported matching question preserves `category`, `targetName`,
  `targetOsmId`, `targetOsmType`.
- Play area / hiding zones remain untouched (same as radar path).
- `{ ok: true }` is returned.

## Failure scenario

A future change to `addImportedQuestion` strips matching-specific fields
(`category`, `targetName`) during normalization. The component test passes
(add button renders), but importing actually corrupts the question. No
store-level test catches it.

## Suggested fix

Add a test case in `applyImport.test.ts` that:

1. Creates a `buildQuestionRequestEnvelope` with a matching question
   (category: "park", targetName: "Ueno Park").
2. Calls `applyImport` with the envelope.
3. Asserts `addedQuestions[0].type === "matching"`.
4. Narrows and asserts `category`, `targetName` are preserved.
5. Asserts play area / hiding zone stores untouched.

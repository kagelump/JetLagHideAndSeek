# P1-TESTGAP: ShareQuestionButton has zero test coverage

**Severity:** P1 — entry point of the entire share flow is untested.  
**Source:** [/code-review](/code-review)  
**File:** `src/features/questions/ShareQuestionButton.tsx`

## What

`ShareQuestionButton` is the user-facing entry point for question sharing. It
has no test file. Untested behaviors:

- **Press triggers share flow:** Verifying that pressing the button calls
  `Share.share` with the expected message format (`${prompt}\n${url}`).
- **Prompt format in the share message:** The message is `${prompt}\n${url}` —
  no test asserts both parts.
- **URL is HTTPS mode:** The button always passes `mode: "https"`. No test
  verifies the link format.
- **Platform icon selection:** `Platform.OS === "ios" ? "share-outline" :
"share-social-outline"` — no test.
- **Share.share rejection:** The empty `catch` is intended for user dismissal.
  No test verifies this doesn't crash.
- **Accessibility:** `accessibilityLabel="Share question"` and
  `testID="question-share-button"` — no test verifies these exist.

## Suggested fix

Create `src/features/questions/__tests__/ShareQuestionButton.test.tsx`.
Mock `Share.share` (it's a React Native API already mockable in Jest — add to
`jest.setup.ts` if not already there). Test:

1. Renders with correct accessibility label and testID.
2. Pressing calls `Share.share` with `${prompt}\n${url}`.
3. When `Share.share` rejects (user dismisses sheet), no crash occurs.
4. Platform-specific icon name (mock `Platform.OS`).

The message content (`buildQuestionSharePrompt` output) is already tested in
`questionSharePrompt.test.ts` — no need to re-test the prompt building.

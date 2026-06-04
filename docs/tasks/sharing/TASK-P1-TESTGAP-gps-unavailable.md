# P1-TESTGAP: GPS "unavailable" status untested

**Severity:** P1 — distinct error path with different user-facing message has
zero coverage.  
**Source:** [/code-review](/code-review)  
**Files:**

- `src/sharing/import/QuestionRequestImport.tsx:59-60,158-162`
- `src/sharing/import/__tests__/ImportScreenQuestionRequest.test.tsx`

## What

The `LocateStatus` type has five states: `"idle"`, `"locating"`, `"answered"`,
`"denied"`, `"unavailable"`. The production code renders different messages for
each:

| Status          | Message                                                  |
| --------------- | -------------------------------------------------------- |
| `"denied"`      | "Location permission is needed to answer this question." |
| `"unavailable"` | "Couldn't read your current location."                   |

Only `"denied"` is tested. The `"unavailable"` path — which fires when
`requestUserCoordinate` catches an error from `getCurrentPositionAsync` or
`getForegroundPermissionsAsync` — has no test.

## Failure scenario

1. A bug is introduced that changes the `"unavailable"` message or omits the
   retry button.
2. No test catches it.
3. User on a device where GPS is unavailable (e.g., simulator without location
   simulation, airplane mode) sees broken UI.

## Suggested fix

Add a test case in `ImportScreenQuestionRequest.test.tsx` that mocks
`requestUserCoordinate` to return `{ coordinate: null, status: "unavailable" }`
and asserts:

- `question-request-answer` shows "Couldn't read your current location."
- `question-request-retry-button` is present.

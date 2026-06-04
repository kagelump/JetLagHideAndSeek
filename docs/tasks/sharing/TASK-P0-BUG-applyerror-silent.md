# P0-BUG: applyError silently swallowed for question-request imports

**Severity:** P0 — error is discarded with no user feedback; import silently
fails.  
**Source:** [/code-review](/code-review)  
**File:** `src/sharing/import/ImportScreen.tsx:48,54-62,87-89`

## What

`applyEnvelope` (line 37) sets `applyError` when `applyImport` returns
`{ ok: false }`. The `applyError` state is rendered at lines 87–89 inside the
app-state preview panel. But when the envelope `kind` is `"question-request"`,
the component early-returns at line 54 with `<QuestionRequestImport>` —
**before** reaching the JSX that displays `applyError`. The error is silently
discarded.

## Failure scenario

1. Hider opens a question-request link. `QuestionRequestImport` renders.
2. User taps "Add Question" → `applyEnvelope()`.
3. `applyImport` returns `{ ok: false }` (e.g., questions store unavailable).
4. `setApplyError(result.error)` fires — but nothing renders it.
5. User sees no feedback; the screen stays on the import panel with no
   indication anything went wrong.

## Suggested fix

Thread the error into `QuestionRequestImport` via a new prop, or pass the raw
error string and let the component display it below the buttons:

```tsx
if (parsed.ok && parsed.envelope.kind === "question-request") {
    return (
        <QuestionRequestImport
            envelope={parsed.envelope}
            onAddQuestion={applyEnvelope}
            onCancel={cancel}
            error={applyError}
        />
    );
}
```

Then render `{error ? <Text style={styles.error}>{error}</Text> : null}` inside
`QuestionRequestImport`.

# P0-BUG: ZodError unhandled rejection in ShareQuestionButton

**Severity:** P0 — unhandled promise rejection can crash the app.  
**Source:** [/code-review](/code-review)  
**File:** `src/features/questions/ShareQuestionButton.tsx:16-27`

## What

`handleShare` is `async`. It calls `buildImportLink` → `encodeEnvelope` →
`wireEnvelopeSchema.parse(envelope)`. The Zod `.parse()` call can throw
`ZodError`. The try/catch on lines 21–27 only wraps `Share.share` — the
encoding step is **outside** the try block. If schema validation fails,
`ZodError` propagates as an unhandled promise rejection.

## Failure scenario

1. The question store holds a question whose shape doesn't match the wire
   schema (e.g., a legacy `type: "radius"` value that evades TypeScript
   narrowing because `QuestionState` is a union).
2. User taps the share button.
3. `encodeEnvelope` → `wireEnvelopeSchema.parse` throws `ZodError`.
4. No catch handler — unhandled rejection, potential app crash.

## Suggested fix

Move the encoding inside the try block, or wrap it in its own try/catch that
shows a toast/alert:

```tsx
const handleShare = async () => {
    try {
        const url = buildImportLink({
            envelope: buildQuestionRequestEnvelope({ question }),
            mode: "https",
        });
        const message = `${buildQuestionSharePrompt(question)}\n${url}`;
        await Share.share({ message });
    } catch {
        // User dismissed, sharing unavailable, or encoding failed — no-op.
    }
};
```

Note: `buildQuestionSharePrompt` is already in the try scope above since it's
part of the `message` construction.

# P2-QUALITY: Empty catch in handleShare swallows programming errors

**Severity:** P2 — anti-pattern; masks bugs during development.  
**Source:** [/code-review](/code-review)  
**File:** `src/features/questions/ShareQuestionButton.tsx:21-27`

## What

```tsx
try {
    await Share.share({ message });
} catch {
    // User dismissed the sheet, or sharing is unavailable — no-op.
}
```

The empty `catch` catches ALL errors, including programming errors that happen
to be thrown inside `Share.share`'s arguments or by React Native internals.
The comment says "User dismissed the sheet" but the catch block doesn't
discriminate between dismissal (expected) and unexpected failures (bugs).

## Cost

During development, if `Share.share` throws due to a platform-specific issue
or a missing native module, the error is silently swallowed. The developer
sees no feedback — the share button simply does nothing. This wastes debugging
time.

## Suggested fix

Check for the dismissal error code where available:

```tsx
try {
    await Share.share({ message });
} catch (err) {
    // Android throws { dismissedAction: true } on dismissal. iOS rejects
    // with an error when no share target is available. Both are expected.
    if (err && typeof err === "object" && "dismissedAction" in err) {
        return; // user dismissed — no-op
    }
    // Unexpected error — log it so we can debug.
    console.warn("ShareQuestionButton: share failed", err);
}
```

Alternatively, scope the try/catch tighter so only `Share.share` is inside.

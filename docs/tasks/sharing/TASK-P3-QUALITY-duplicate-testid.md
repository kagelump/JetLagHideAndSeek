# P3-QUALITY: Duplicate testID on different element types

**Severity:** P3 — cosmetic test fragility; no runtime impact.  
**Source:** [/code-review](/code-review)  
**File:** `src/sharing/import/QuestionRequestImport.tsx:146,159`

## What

`testID="question-request-answer"` is placed on two different React Native
element types depending on which branch renders:

- **Line 146:** `<View style={styles.answerCard} testID="question-request-answer">`
  (in the "answered" branch)
- **Line 159:** `<Text style={styles.detail} testID="question-request-answer">`
  (in the denied/unavailable error branch)

`getByTestId` returns a `<View>` in one state and a `<Text>` in another. If a
future test calls `fireEvent.press` on this element, the behavior differs
depending on which branch rendered.

## Suggested fix

Use a consistent element type. Easiest: wrap both in a `<View>` with the
testID:

```tsx
{
    /* "answered" branch: */
}
<View style={styles.answerCard} testID="question-request-answer">
    <Text style={styles.verdict}>{isHit ? "Yes" : "No"}</Text>
    ...
</View>;

{
    /* error branch: */
}
<View style={styles.answerCard} testID="question-request-answer">
    <Text style={styles.detail}>
        {status === "denied" ? "Location permission..." : "Couldn't read..."}
    </Text>
    ...
</View>;
```

Alternatively, use unique testIDs: `question-request-answer-verdict` and
`question-request-answer-error`.

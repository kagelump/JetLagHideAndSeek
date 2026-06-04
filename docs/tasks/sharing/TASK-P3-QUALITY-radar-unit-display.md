# P3-QUALITY: formatRadarDistance always appends "m" regardless of distanceUnit

**Severity:** P3 — display ambiguity; no test documents the contract.  
**Source:** [/code-review](/code-review)  
**File:** `src/features/questions/questionSharePrompt.ts:6-9`

## What

```ts
function formatRadarDistance(question: RadarQuestion): string {
    return question.distanceOption !== "other"
        ? question.distanceOption
        : `${Math.round(question.distanceMeters)}m`;
}
```

When `distanceOption === "other"`, the function always appends `"m"` (meters)
regardless of the question's `distanceUnit` field. While `distanceMeters` is
always in meters (so `"m"` is technically correct), a question configured with
`distanceUnit: "km"` or `"mi"` will display the meter-value with `"m"`.

Example: a radar question with `distanceMeters: 1609` (1 mile) and
`distanceUnit: "mi"` shows `"Are you within 1609m of ...?"` — correct but
potentially confusing.

## Suggested fix

If the current behavior is correct (display meters for "other"), add a test
that documents the contract:

```ts
it("displays meter value for 'other' option regardless of distanceUnit", () => {
    const prompt = buildQuestionSharePrompt(
        makeRadarQuestion({
            distanceOption: "other",
            distanceMeters: 1609,
            distanceUnit: "mi",
        }),
    );
    expect(prompt).toContain("1609m");
});
```

If the behavior should show the user's configured unit, use `fromMeters`:

```ts
import { fromMeters } from "@/shared/distanceUnits";
return `${fromMeters(question.distanceMeters, question.distanceUnit)}`;
```

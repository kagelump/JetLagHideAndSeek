# P1-BUG: Stale GPS closure can overwrite answer if envelope prop changes

**Severity:** P1 — silent data corruption (wrong answer shown). Unlikely in
normal usage but real given React's concurrent features.  
**Source:** [/code-review](/code-review)  
**File:** `src/sharing/import/QuestionRequestImport.tsx:51-64`

## What

`runLocate` captures `question` in its closure via `useCallback([question])`
(line 64). If the `envelope` prop changes while a GPS request is in-flight:

1. The old `runLocate` promise continues executing with the old `question`
   closure.
2. The effect on line 66 re-fires with the new `runLocate`, starting a
   **second** GPS call.
3. Both promises race. Whichever resolves last calls `setAnswer(...)` and
   `setStatus(...)` — potentially overwriting a correct answer computed from
   the new question with one computed from the old question's center and
   `distanceMeters`.

The `mountedRef` only guards against unmount, not prop changes.

## Failure scenario

1. `QuestionRequestImport` mounts with envelope A (radar question, 5km).
2. Before GPS resolves, the parent re-renders with envelope B (different
   radar question, 2km).
3. The old closure computes distance against question A's center. The new
   closure computes against question B's center.
4. Old closure resolves last → UI shows answer for question A, but the
   envelope shown is B.

## Suggested fix

Use a ref for the current question so `runLocate` always reads the latest
value, or cancel the in-flight request when `envelope` changes:

```tsx
const questionRef = useRef(question);
questionRef.current = question;

const runLocate = useCallback(async () => {
    const q = questionRef.current;
    if (q.type !== "radar") return;
    // ... use q instead of question throughout
}, []); // stable reference — effect only re-fires on shouldAnswer changes
```

This makes `runLocate` stable (no stale closure) while always reading the
latest question via the ref.

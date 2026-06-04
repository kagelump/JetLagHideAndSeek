# P2-TESTGAP: mountedRef unmount-during-GPS guard untested

**Severity:** P2 — no "setState on unmounted component" warning coverage.  
**Source:** [/code-review](/code-review)  
**File:** `src/sharing/import/QuestionRequestImport.tsx:43-55`

## What

`QuestionRequestImport` uses a `mountedRef` pattern to prevent `setState`
calls after unmount:

```tsx
const mountedRef = useRef(true);
useEffect(() => {
    mountedRef.current = true;
    return () => {
        mountedRef.current = false;
    };
}, []);
```

`runLocate` checks `if (!mountedRef.current) return;` after the GPS await
(line 55). No test verifies this guard works:

1. Component mounts in hider+radar mode.
2. `requestUserCoordinate()` starts (async).
3. Component unmounts (user taps "Return to Map").
4. `requestUserCoordinate()` resolves.
5. The guard prevents the state update.

## Failure scenario

A refactoring removes or weakens the `mountedRef` check. Unmounting during
GPS causes "setState on unmounted component" warning (React Native log spam)
and a potential memory leak if the state update triggers a side effect.

## Suggested fix

Add a test in `ImportScreenQuestionRequest.test.tsx`:

1. Render in hider+radar mode with GPS mock that doesn't resolve immediately
   (use a deferred promise).
2. `await waitFor` the import panel.
3. Press "Return to Map" → component unmounts.
4. Resolve the deferred GPS promise.
5. Assert no crash/warning (can spy on `console.error` for the setState
   warning).

May need `jest.useFakeTimers()` or a manually controlled promise.

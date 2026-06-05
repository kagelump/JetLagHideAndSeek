# P1-BUG: Double GPS request in React Strict Mode

**Severity:** P1 — wastes battery/bandwidth in development; could trigger
permission prompts twice on some platforms.  
**Source:** [/code-review](/code-review)  
**File:** `src/sharing/import/QuestionRequestImport.tsx:66-68`

## What

React Strict Mode (development only) double-invokes effects: mount → unmount →
mount. The effect on line 66 calls `void runLocate()` on every mount. This
means `requestUserCoordinate()` is called **twice** in rapid succession:

1. First mount: `runLocate()` starts GPS request #1.
2. Strict Mode unmount: `mountedRef.current = false`.
3. Strict Mode remount: `mountedRef.current = true`, `runLocate()` starts GPS
   request #2.
4. GPS request #1 resolves → `mountedRef.current` is true again (set by step 3) → state is written.
5. GPS request #2 resolves → state is written again.

Both results compete for `setAnswer`/`setStatus`. Wasteful double query.

## Failure scenario

1. Run app in dev build with Strict Mode.
2. Open a radar question link in hider mode.
3. Two GPS requests fire.
4. Both may trigger the system location-permission dialog if not yet granted.
5. Battery drain from redundant GPS acquisition.

## Suggested fix

Abort the previous request when the effect cleanup runs. Track an
`abortController` or a generation counter:

```tsx
const generationRef = useRef(0);

useEffect(() => {
    if (!shouldAnswer) return;
    const gen = ++generationRef.current;
    const run = async () => {
        // ... after await requestUserCoordinate():
        if (generationRef.current !== gen) return; // stale
        // ... setState
    };
    void run();
    return () => {
        generationRef.current++; // invalidate in-flight
    };
}, [shouldAnswer]);
```

This pattern handles both Strict Mode double-fire and legitimate prop changes.

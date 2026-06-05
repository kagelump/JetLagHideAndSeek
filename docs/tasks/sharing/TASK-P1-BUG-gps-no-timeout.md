# P1-BUG: GPS hangs indefinitely with no timeout in QuestionRequestImport

**Severity:** P1 — user sees perpetual spinner and can't proceed.  
**Source:** [/code-review](/code-review)  
**Files:**

- `src/sharing/import/QuestionRequestImport.tsx:54`
- `src/shared/location.ts:42-44`

## What

`runLocate` calls `await requestUserCoordinate()` which internally calls
`expo-location`'s `getCurrentPositionAsync` with no timeout option. On weak
GPS signal or when the device can't get a fix, this can hang indefinitely. The
UI shows a spinner ("Checking your location…") with no way to cancel or retry.

The retry button is only rendered **after** a `"denied"` or `"unavailable"`
result arrives — which never happens when the request hangs.

## Failure scenario

1. Hider opens a radar question link in hider mode.
2. Device has weak/no GPS signal (indoors, tunnel).
3. `getCurrentPositionAsync` blocks indefinitely.
4. User sees spinner forever. "Return to Map" button is available, but no
   location answer or "Try Again" option appears.

## Suggested fix

Wrap `requestUserCoordinate` in a timeout:

```tsx
const TIMEOUT_MS = 15_000;

const result = await Promise.race([
    requestUserCoordinate(),
    new Promise<UserCoordinateResult>((resolve) =>
        setTimeout(
            () => resolve({ coordinate: null, status: "unavailable" }),
            TIMEOUT_MS,
        ),
    ),
]);
```

Alternatively, pass a `timeout` option to `getCurrentPositionAsync` if the
Expo Location API supports it. The `setTimeout` approach also needs cleanup on
unmount (store the timer id and `clearTimeout` in the effect cleanup).

# P3 — Move heavy measuring derivation off the synchronous render path

**Status:** ready · **Priority:** resilience (do after P0/P1 remove the worst
cost) · **Risk:** medium (touches render-state plumbing) · **Quality cost:**
brief first-frame latency on heavy categories

## Problem

`useQuestionMapRenderState`
(`src/features/questions/questionGeometry.ts`, ~line 80) builds **all** question
geometry — radar, matching, tentacles, thermometer, **and measuring** — inside a
single synchronous `useMemo`, on the JS thread, whenever any dependency changes:

```ts
return useMemo(() => buildQuestionMapRenderState(...), [questions, ...]);
```

Because it's synchronous, a slow measuring category doesn't render a slow frame —
it **freezes the whole UI and gesture handling** until it finishes (the
"softlock + hot phone" symptom). P0/P1 make each build fast, but P3 is the
structural guarantee that _no_ future heavy category can ever lock the UI.

## Goal

Make measuring (and any heavy) geometry derivation **non-blocking**: the UI stays
responsive and the heavy mask appears a beat later, rather than the app freezing.
Cheap categories (radar, the existing fast paths) keep rendering synchronously.

**Non-goal:** changing the geometry algorithms themselves (P0/P1/P2).

## Design

Two viable approaches; pick one. Prefer **A** for the smallest blast radius.

### Approach A — Deferred state with `InteractionManager` (recommended)

- Keep the cheap synchronous derivations as-is.
- Move the **measuring** slice into its own hook that computes asynchronously:
  it returns the last-good measuring render state immediately and schedules a
  recompute via `InteractionManager.runAfterInteractions(...)` (or
  `requestIdleCallback`-style deferral) when inputs change. While recomputing,
  it keeps showing the previous mask (or an empty mask on first run).
- Debounce rapid input changes (e.g. repeated closer/farther taps) with a short
  trailing delay (~120 ms) so only the final tap triggers a build.
- Guard against stale writes: tag each scheduled build with an incrementing
  token and ignore results whose token is no longer current.

Sketch:

```ts
function useMeasuringRenderStateAsync(questions, playAreaBbox, boundary) {
    const [state, setState] = useState(EMPTY_MEASURING_STATE);
    const tokenRef = useRef(0);
    useEffect(() => {
        const token = ++tokenRef.current;
        const handle = InteractionManager.runAfterInteractions(() => {
            const next = buildMeasuringRenderState(
                questions,
                playAreaBbox,
                boundary,
            );
            if (token === tokenRef.current) setState(next);
        });
        return () => handle.cancel();
    }, [questions, playAreaBbox, boundary]);
    return state;
}
```

Then `useQuestionMapRenderState` composes this async slice with the synchronous
ones.

### Approach B — Yield/chunk inside the builder

Split `buildMeasuringRenderState` into a generator that yields between questions
/ between the distance and buffer phases, driven by an idle scheduler. More
invasive; only worth it if a single question's build is itself too heavy after
P0/P1 (it shouldn't be).

> A web worker is **not** recommended here: the bundles are large JS objects and
> the geometry libs (turf/JSTS/polyclip) aren't trivially worker-friendly in this
> RN setup. Revisit only if A/B prove insufficient.

## Implementation steps (Approach A)

1. Add `EMPTY_MEASURING_STATE` constant (all empty FeatureCollections) in
   `measuringTypes.ts`.
2. Add `useMeasuringRenderStateAsync` in `questionGeometry.ts` (or a new
   `measuring/useMeasuringRenderStateAsync.ts`).
3. In `useQuestionMapRenderState`, build the non-measuring slices synchronously
   and merge the async measuring slice into the returned object.
4. Add the debounce + stale-token guard.
5. Verify `NativeMap` already tolerates an initially-empty measuring slice (it
   keeps `ShapeSource`s mounted with empty collections — see
   `MeasuringLayers.tsx`; it does).

## Testing

> **Orientation.** This is React state/timing logic, so test it with jest +
> React hooks, and lean on fake timers. The geometry is already covered by
> P0/P1/P2 tests — here you're testing _scheduling_, not geometry. Jest setup
> already mocks Reanimated/MapLibre/AsyncStorage (`jest.setup.ts`); you may need
> to add an `InteractionManager` mock (see below).

### Mock setup

`InteractionManager.runAfterInteractions` runs its callback asynchronously. In
tests, either:

- use `jest.useFakeTimers()` and a mock that defers the callback to a timer you
  flush with `jest.runAllTimers()`, or
- `jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation(cb => { cb(); return { cancel(){} }; })`
  for synchronous execution when you only care about correctness, not timing.

Add the mock once in `jest.setup.ts` (per AGENTS.md: extend the shared mocks,
don't recreate ad hoc).

### Tests (new file `__tests__/useMeasuringRenderStateAsync.test.tsx`)

Use `@testing-library/react-native`'s `renderHook` (already available via
`jest-expo`).

1. **Initial render returns the empty state synchronously.** Mount the hook;
   before flushing timers, assert it returns `EMPTY_MEASURING_STATE` (no freeze,
   no geometry yet).
2. **After interactions, it returns the computed state.** Flush
   timers/interactions; assert the measuring render state now contains the
   expected `hitMaskFeatures` for a positive question (use a small injected
   bundle via `__setLineBundleForTest`).
3. **Debounce: only the last input computes.** Re-render the hook 5 times with
   changing `questions` within the debounce window; spy on
   `buildMeasuringRenderState` (or count its console log) and assert it ran
   **once** after the window, with the final input.
4. **Stale-token guard: out-of-order results are ignored.** Trigger build A,
   then build B before A "completes," resolve A last; assert the hook holds B's
   result, not A's. (Drive ordering with manual mock control over the scheduled
   callbacks.)
5. **Previous mask is retained during recompute.** After a first successful
   build, change inputs; assert that _before_ the new build flushes, the hook
   still returns the previous (non-empty) state, not empty. (Proves no fl‑to‑empty
   flicker.)

### Integration / manual check (the real win)

This is fundamentally a "does the UI stay responsive" change, so a device check
is the meaningful acceptance signal:

1. `pnpm exec expo start --dev-client -c`; open on a device.
2. Add a Measuring **Body of Water** question (with P0/P1 in place it's fast;
   to test the async path specifically, temporarily revert P1 or pick the
   heaviest category) and answer it.
3. While the mask computes, **drag/pan the map and the bottom sheet**.
4. **Pass:** map and sheet keep moving smoothly; the mask pops in a moment later.
   Pre-P3 the gestures would stall until geometry finished.

For CI without a device, run the Maestro stack
(`pnpm test:e2e:stack` / `pnpm test:e2e:ios:stack`) or the GitHub Actions
workflow `Maestro E2E` and confirm the measuring flow still passes — this is a
native-interaction change, so per AGENTS.md treat Maestro as its integration
test.

### Commands

```bash
pnpm test -- useMeasuringRenderStateAsync
pnpm test -- measuringGeometry           # ensure geometry output unchanged
pnpm typecheck && pnpm check
# native:
pnpm test:e2e:stack    # or: gh workflow run "Maestro E2E" --ref <branch> -f platform=android
```

## Acceptance criteria

- [ ] First render returns empty measuring state without computing geometry
      synchronously.
- [ ] Computed state appears after interactions; debounce collapses rapid input
      changes to one build.
- [ ] Stale results are dropped (token guard test passes).
- [ ] No flicker-to-empty during recompute (previous state retained).
- [ ] Manual/Maestro: map + sheet stay responsive while a heavy mask computes.
- [ ] `pnpm test` + `pnpm check` pass.

## Rollback

Swap the async measuring slice back for the synchronous call in
`useQuestionMapRenderState`. No data or bundle changes.
</content>

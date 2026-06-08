# P1 — Runtime input budget for the line buffer

**Status:** ready · **Priority:** ship first (cheapest softlock-killer) ·
**Risk:** low · **Quality cost:** negligible (sub-pixel features dropped)

## Problem

`computeLineBuffer` (`src/features/questions/measuring/lineMeasuringGeometry.ts`,
~line 385) hands **every** window feature straight to `@turf/buffer` (JSTS).
For `body-of-water` that is ~1,533 line rings; JSTS buffers each and unions them,
which freezes the JS thread and heats the device. From the field log:

```
[lineBuffer] 1533 features in window, 1533 segments, 8189 total coords
[lineBuffer] after dedup: 1533 segs, 8189 coords → simplify(23m): 8189 coords
(softlock)
```

The current `simplifyCoords` step does nothing useful here because the cost is
the **number of segments**, not vertices-per-segment, and per-feature
simplification can't drop a whole feature. There is no upper bound on the work.

## Goal

Make the buffer's input size **bounded** so no category can softlock, with no
visible change to the mask. This is a pure runtime guard — it does not change the
bundle or the algorithm's output shape.

**Non-goals:** changing the bundle (that's P0), the nearest-point scan (P2), or
threading (P3).

## Design

Add a bounded pre-processing stage inside `computeLineBuffer`, before the
`@turf/buffer` call, with three levers (apply in this order):

1. **Higher min-feature-length floor.** Today `minFeatureLenM =
Math.min(radiusMeters * 0.1, 500)`. Raise the floor so tiny ponds/segments
   that are sub-pixel at the buffer scale never enter. Suggested:
   `Math.min(Math.max(radiusMeters * 0.25, 250), 2000)`. Tunable constant.

2. **Segment/coord budget.** After dropping short features, if
   `segmentCount > MAX_BUFFER_SEGMENTS` (suggest **400**) or
   `totalCoords > MAX_BUFFER_COORDS` (suggest **4000**), escalate: re-run
   simplification at a larger tolerance and re-apply the length floor until under
   budget, dropping the smallest features first. Keep the largest/longest
   features (they dominate the visible band). Log the before/after counts.

3. **Lower buffer fidelity.** Pass `steps: 4` to `@turf/buffer` (the point path
   already uses `steps: 8`; the mask is intersected + difference-d afterward, so
   circle resolution on the band is imperceptible).

Expose the budgets as named module constants so they're easy to tune and assert
in tests:

```ts
const MAX_BUFFER_SEGMENTS = 400;
const MAX_BUFFER_COORDS = 4000;
const BUFFER_STEPS = 4;
```

### Suggested shape

```ts
// inside computeLineBuffer, after building `cleanBufLines`:
let working = cleanBufLines;
let tol = Math.max(radiusMeters * 0.05, 10);

// Escalate until under budget (bounded number of rounds).
for (let round = 0; round < 6; round++) {
    const segs = working.length;
    const coords = working.reduce((s, l) => s + l.length, 0);
    if (segs <= MAX_BUFFER_SEGMENTS && coords <= MAX_BUFFER_COORDS) break;
    tol *= 2;
    const lenFloor = tol * 4; // drop features shorter than the new tolerance band
    working = working
        .filter((l) => lineLengthMeters(l) >= lenFloor)
        .map((l) => simplifyCoords(l, tol));
}
// ...then multiLineString(working) and buffer(..., { units: "meters", steps: BUFFER_STEPS })
```

Keep the existing NaN/dedup cleaning. The escalation loop is bounded (≤6 rounds)
so it can never spin.

## Implementation steps

1. In `lineMeasuringGeometry.ts`, add the three constants near the other buffer
   constants (~line 339).
2. Bump `LINE_BUFFER_CACHE_VERSION` (currently `3`) so any persisted/in-memory
   cached buffers from the old algorithm are invalidated.
3. Insert the budget/escalation block in `computeLineBuffer` between the
   dedup/simplify step and the `@turf/buffer` call.
4. Add `steps: BUFFER_STEPS` to the `buffer(merged, radiusMeters, {...})` call.
5. Keep the existing `console.log` lines; add one logging the final segment/coord
   count and round count so field logs show the budget worked.

## Testing

> **Orientation.** Tests live in
> `src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts`.
> They inject synthetic bundles with `__setLineBundleForTest(category, bundle)`
> and clear caches in `beforeEach`. Reuse the existing `makeLineFeature` /
> `makeBundle` helpers at the top of that file. Run a single suite with
> `pnpm test -- lineMeasuringGeometry`.

### Unit tests (add to the existing suite)

Add a `describe("computeLineBuffer input budget")` block. `computeLineBuffer` is
exported and pure — call it directly with an array of features.

1. **Stays under the segment budget.**

    - Build **1,000** tiny square-ring features spread across a 0.5° box (a loop
      generating `makeLineFeature` rings ~50 m apart). Each ring is short.
    - Call `computeLineBuffer(features, 2000)`.
    - Assert it **returns non-null** and **does not throw**.
    - To assert the budget engaged, refactor the escalation into a small exported
      helper `applyBufferBudget(lines, radiusMeters): Position[][]` and unit-test
      _that_: assert `applyBufferBudget(thousandLines, 2000).length <= 400`.
      (Testing the helper is more robust than asserting on buffer output.)

2. **Short features dropped.**

    - `applyBufferBudget([oneLongLine, oneTinyLine], radius)` returns only the
      long line when the tiny line is below the floor. Assert length === 1.

3. **Large input completes quickly (perf guard).**

    - Wrap the 1,000-feature call in `performance.now()` timing and
      `expect(elapsed).toBeLessThan(1000)` (ms). This is the regression guard for
      the softlock — pre-fix this test would hang.

4. **Output unchanged for small input (no regression).**
    - For a single long line well under budget, assert the returned polygon's
      bbox matches the pre-fix bbox within a tolerance (buffer at `steps: 4` vs
      default is slightly less round but the bbox is essentially identical —
      assert each bbox edge within ~`radius * 0.05`).

### Real-bundle smoke test (the actual softlock)

Add to the existing `describe("real bundles")` block:

```ts
it("buffers the real body-of-water window without softlocking", () => {
    const bundle = require("../../../../../assets/measuring/body-of-water.json");
    __setLineBundleForTest("body-of-water", bundle);
    const cat = computeLineCategory(
        [139.75, 35.68],
        "body-of-water",
        [139.0, 35.0, 140.0, 36.0],
    );
    expect(cat).not.toBeNull();
    const t0 = performance.now();
    const buf = computeLineBuffer(cat!.windowFeatures, cat!.distanceMeters);
    const ms = performance.now() - t0;
    expect(buf).not.toBeNull();
    expect(ms).toBeLessThan(1500); // pre-fix: never returns
});
```

> If this test currently hangs CI, that _is_ the bug — it should pass after P1.

### Commands to run

```bash
pnpm test -- lineMeasuringGeometry      # the unit + smoke tests above
pnpm typecheck
pnpm check                              # lint/format/perf-typecheck
```

### Manual device check (optional but recommended)

1. `pnpm exec expo start --dev-client -c`, open the app on a device.
2. Add a Measuring question, category **Body of Water**, answer it positive.
3. Tap **closer/farther** repeatedly.
4. **Pass:** the mask updates within ~1 s each tap, the app stays responsive,
   the device does not heat. Watch Metro logs for
   `[lineBuffer] ... buffer done` with a segment count ≤ 400.

## Acceptance criteria

- [ ] `computeLineBuffer` on the real `body-of-water` window returns in < 1.5 s.
- [ ] `applyBufferBudget` caps segments ≤ `MAX_BUFFER_SEGMENTS` and coords ≤
      `MAX_BUFFER_COORDS`.
- [ ] No visible change to the mask for small categories (HSR, coastline,
      admin borders) — existing measuring tests stay green.
- [ ] `LINE_BUFFER_CACHE_VERSION` bumped.
- [ ] `pnpm test` and `pnpm check` pass.

## Rollback

Pure runtime change behind one function. Revert the commit; the cache-version
bump means no stale geometry survives.
</content>

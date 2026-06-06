# Task 04: Two-Pin Map Interaction (Thermometer prep)

**Depends on**: Task 01
**Audience**: senior / careful. This generalizes load-bearing map-drag
infrastructure. Build it test-first, in isolation, before the Thermometer UI.

## Why this is its own task

Thermometer is the first question with **two** independently-draggable map pins
(`previousPosition` P1 and `currentPosition` P2) and **no** single `center`. The
existing single-pin system can't express it:

- `NativeMap` computes `activeQuestionCenter` from `"center" in activeQuestion`.
  Thermometer has no `center`, so no pin shows and nothing drags.
- `usePinDrag` resolves the dragged point via `getQuestionCenter(question)`
  (`usePinDrag.ts`), which returns `question.center` or `null`.
- `ActivePinLayer` renders exactly one active pin.

Rather than special-casing Thermometer inside `NativeMap`, generalize the
active-pin model to **N named pins per question**, with today's single-`center`
case becoming the degenerate "one pin named `center`" case. This keeps Radar /
Matching / Measuring / Tentacles working unchanged and gives Thermometer (and any
future multi-pin question) a clean primitive.

> Answer to the question "does this need a separate prep task?": **yes.** It's a
> reusable interaction primitive with its own correctness surface (which pin is
> active, drag commit routing, rendering both pins). Splitting it lets it be
> built and unit-tested without the Thermometer screen, and keeps the
> Thermometer UI task (09) focused on layout + planning read-outs.

## Design

Introduce a small abstraction in `src/features/map/`:

```typescript
// One draggable handle on the map.
export type MapPin = {
    key: string; // "center" | "start" | "end"
    position: Position;
    isActive: boolean; // only the active pin responds to drag
};

// Resolve the pins for a question, given which pin key is active.
export function getQuestionPins(
    question: QuestionState | null,
    activePinKey: string | null,
): MapPin[];
```

- For questions with a single `center` (radar/matching/measuring/tentacles):
  return one pin `{ key: "center", position: center, isActive: true }`.
  `activePinKey` is ignored (treated as `"center"`).
- For `thermometer`: return two pins — `start` (`previousPosition`) and `end`
  (`currentPosition`) — with `isActive` set from `activePinKey` (default
  `"end"`, since the user typically drags the destination). Pins with a `null`
  position are omitted.

`usePinDrag` changes from "drag the center" to "drag the active pin":

- Accept `activePinKey` (or the resolved active `MapPin`) as input.
- On drag start, resolve the active pin's position via `getQuestionPins`.
- `onCommit(questionId, pinKey, position)` — note the added `pinKey`.

`NativeMap` changes:

- Replace the `activeQuestionCenter` derivation with `getQuestionPins(activeQuestion, activePinKey)`.
- Render **all** returned pins; mark the active one draggable, inactive ones
  fixed/dimmed (extend `ActivePinLayer` to take a feature collection of pins with
  an `isActive` property and style accordingly).
- `handlePinCommit(questionId, pinKey, position)` routes to a per-pin commit:
    - `center` → existing `updateQuestionCenter`.
    - `start` / `end` → new thermometer pin updaters (defined in Task 09, e.g.
      `updateThermometerPin(question, "start" | "end", position)`). For this task,
      a thin commit callback prop is enough; Task 09 supplies the updater.

`activePinKey` state: add it to the question-derived/UI state that already tracks
`activeQuestion`. A single nullable `activePinKey: string | null` is enough (the
detail screen sets it via a Start/End toggle in Task 09). Default `null` ⇒ map
treats single-pin questions normally and thermometer as "end" active.

## Test plan (write first)

### `src/features/map/__tests__/getQuestionPins.test.ts` (new)

- Radar/Matching/Measuring/Tentacles question → one pin, key `"center"`,
  `isActive: true`, position equals `center`. `activePinKey` is ignored.
- Thermometer with both positions set + `activePinKey: "end"` → two pins;
  `end` active, `start` inactive.
- Thermometer with `activePinKey: "start"` → `start` active, `end` inactive.
- Thermometer with `activePinKey: null` → defaults to `end` active.
- Thermometer with `currentPosition: null` → only the `start` pin returned.
- `null` question → `[]`.

### `src/features/map/__tests__/usePinDrag.test.ts` (extend)

- Dragging commits the **active** pin's key (a thermometer drag with active
  `"end"` calls `onCommit(id, "end", coord)`; switching active to `"start"`
  commits `"start"`).
- Single-`center` questions still commit `("center", coord)` — regression guard.
- `canMove === false` suppresses drag (unchanged behavior).

### `src/features/map/__tests__/ActivePinLayer.test.tsx` (extend or add)

- Renders N pins from the feature collection.
- Active pin carries the draggable/unlocked styling property; inactive pins
  carry the fixed styling property.

## Implementation order

1. Red: write the three test files above.
2. Add `getQuestionPins` + `MapPin` (green the first file).
3. Generalize `usePinDrag` to the active pin (green the second file).
4. Extend `ActivePinLayer` + wire `NativeMap` to render all pins (green the
   third file). Keep MapLibre child ordering conservative (pins stay in the
   marker layer region, after shape layers — see AGENTS.md).
5. Refactor: ensure single-pin questions produce byte-identical behavior
   (snapshot/regression check on Radar pin drag).

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test` pass
- Radar / Matching / Measuring / Tentacles single-pin drag behaves exactly as
  before (no visual or commit-routing regression)
- A two-pin question renders both pins; only the active one drags; commits carry
  the correct pin key
- No Thermometer-specific logic leaks into the generic primitive beyond the
  `getQuestionPins` thermometer branch

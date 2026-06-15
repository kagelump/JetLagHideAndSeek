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
- `usePinDrag` resolves the dragged point via `getQuestionCenter(question)`,
  which returns `question.center` or `null`.
- `ActivePinLayer` renders exactly one active pin.

Rather than special-casing Thermometer inside `NativeMap`, generalize the
pin model to **N named pins per question**, with today's single-`center`
case becoming the degenerate "one pin named `center`" case. This keeps Radar /
Matching / Measuring / Tentacles working unchanged and gives Thermometer (and any
future multi-pin question) a clean primitive.

## Design Decisions (evolved during implementation)

### Both pins are draggable — no pin selector

When a thermometer question is active and unlocked, **both** pins respond to
drag. The drag gesture resolves which pin to move by proximity hit-testing
(closest pin within 50px radius; tie-break prefers `"end"`). There is no
`activePinKey` state and no "which pin am I editing?" UI toggle in the sheet.

### Per-question lock (`isLocked`)

The global `isPinLocked` state has been replaced with `isLocked: boolean` on
`BaseQuestion` (so every question type has it). The lock toggle in
`QuestionDetailScreen` writes to the active question via `updateQuestion`.
`NativeMap` reads `activeQuestion?.isLocked` to determine drag enablement.

### `NativeMap` is a presenter; `MapAppScreen` is the container

`NativeMap` no longer imports `updateQuestionCenter`, `useQuestionDerived`, or
`useIsPinLocked`. It receives:

- `pins: MapPin[]` — all pins to render
- `canMove: boolean` — whether any pin is draggable
- `onPinCommit` — callback when drag completes
- `questionId` — for routing the commit

`MapAppScreen` derives `pins` from `activeQuestion` via `getQuestionPins`,
computes `canMove`, and passes everything down.

### Map tap behavior

- Single-pin questions (radar/matching/measuring/tentacles): map tap collapses the sheet. Pins are set via the "Set to My Location" button and repositioned by long-press dragging.
- Thermometer: map tap does nothing. Pins are drag-only.

### Thermometer default positions

On creation, `previousPosition` (start pin) is set to the user location (or
play area center fallback), and `currentPosition` (end pin) is offset ~2km
east via `offsetPosition()`.

## Pin Abstraction

```typescript
// src/features/map/getQuestionPins.ts
export type MapPin = {
    key: string; // "center" | "start" | "end"
    position: Position; // [lon, lat]
};

export function getQuestionPins(question: QuestionState | null): MapPin[];
```

- Single-center questions → one pin, key `"center"`.
- Thermometer → `"start"` from `previousPosition`, `"end"` from `currentPosition`.
  `null` positions are omitted.
- `null` question → `[]`.

## Drag Architecture

`usePinDrag` accepts `pins: MapPin[]` and `questionId` instead of
`activeQuestion`. On drag start:

1. Project all `pins` to screen coordinates.
2. Find the pin whose screen distance to the touch is ≤ `PIN_HIT_RADIUS_PX`.
3. If multiple pins are within radius, pick the **closest**.
4. **Tie-break:** If equidistant, prefer `"end"` over `"start"`.

`PinDragState` gains `draggedPinKey: string | null` so the layer knows which
pin's draft coordinate to use.

## Render Layer

`ActivePinLayer` has been renamed to `QuestionPinLayer`. It renders all pins
from a single `FeatureCollection<Point>` inside one `MLShapeSource`. Feature
properties include `pinKey` and `isDragging`.

Style strategy (AGENTS.md compliant):

- Base glow layer: orange, 24px radius, for all pins.
- Drag glow layer: white, 60px radius, filtered to `isDragging === true`.
- Both layers adjust opacity based on `canMove`.

## Test Plan

### `src/features/map/__tests__/getQuestionPins.test.ts`

- Radar/matching/measuring/tentacles → one `"center"` pin.
- Thermometer both positions set → two pins (`"start"`, `"end"`).
- Thermometer with one `null` position → only the other pin.
- `null` question → `[]`.

### `src/features/map/__tests__/usePinDrag.test.ts`

- Single-pin questions still commit `("center", coord)` — regression guard.
- Thermometer: commits closest pin's key.
- Thermometer tie-break: equidistant overlapping pins commits `"end"`.
- `canMove === false` suppresses drag.

### `src/features/map/__tests__/QuestionPinLayer.test.tsx`

- Renders N pins from feature collection.
- Uses draft coordinate for the dragged pin.

## Implementation Order

1. **Subtask 0 — No-op refactor:** Lift `handlePinCommit` out of `NativeMap`
   into `useMapPinCommit()`. `NativeMap` receives `onPinCommit` as a prop.
   Zero behavior change.
2. **Subtask 1 — Per-question lock:** Move `isLocked` from global app state to
   `BaseQuestion`. Update persistence schema, import/export, maintenance,
   `QuestionDetailScreen`, and all test fixtures.
3. **Subtask 2 — `MapPin` + `getQuestionPins`:** Create the abstraction and
   `offsetPosition` helper. Update thermometer default creation to place end
   pin ~2km east.
4. **Subtask 3 — `usePinDrag` proximity hit-testing:** Generalize drag start
   to test all visible pins. Add `draggedPinKey` to `PinDragState`.
5. **Subtask 4 — `QuestionPinLayer` + `NativeMap` wiring:** Rename layer,
   render multiple pins, style by lock state. `MapAppScreen` derives pins and
   passes them to `NativeMap`.
6. **Subtask 5 — Acceptance:** Flip `usesMovableAnchor` for thermometer. Run
   full test suite and typecheck.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test` pass
- Radar / Matching / Measuring / Tentacles single-pin drag behaves exactly as
  before (no visual or commit-routing regression)
- A thermometer question renders both pins; both are draggable when unlocked;
  commits carry the correct pin key
- Map tap on thermometer does not move pins
- No `movablePinKey` or `activePinKey` state exists anywhere in the codebase
- `usesMovableAnchor: true` for thermometer
- No thermometer-specific logic leaks into generic pin primitives beyond the
  `getQuestionPins` thermometer branch and the map-tap skip

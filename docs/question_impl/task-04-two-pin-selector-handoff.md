# Task 04 Handoff: Two-Pin Map Interaction

**Status:** Subtasks 0–2 complete. Subtasks 3–5 remaining.

---

## What Has Been Done

### Subtask 0 — No-op refactor (committed)

- Created `src/features/map/useMapPinCommit.ts` — hook that returns `onPinCommit`.
- `NativeMap` now receives `onPinCommit` as a prop instead of defining `handlePinCommit` inline.
- `MapAppScreen` uses `useMapPinCommit()` and passes it to `NativeMap`.
- `NativeMap.test.tsx` updated to pass `onPinCommit={jest.fn()}`.
- **Behavior is byte-identical.** All existing tests pass.

### Subtask 1 — Per-question lock (in working tree, not committed)

- Added `isLocked: boolean` to `BaseQuestion` in `src/features/questions/coreTypes.ts`.
- Added `isLocked: z.boolean().default(false)` to all 5 question schemas in `src/state/appState.ts`.
- Removed `isPinLocked` from `appStateQuestionSettingsSchema`, `createAppStateV1`, `addMissingV1Slices`, and `appStateQuestionSettingsToImportState`.
- Removed `IsPinLockedContext`, `useIsPinLocked`, and `setPinLocked` from `src/state/questionStore.tsx`.
- Added `isLocked: false` to every `createDefaultQuestion` case.
- Updated `QuestionDetailScreen` lock toggle to use `activeQuestion.isLocked` via `updateQuestion`.
- The "Set pin to my location" button is now only shown for center-based questions.
- Updated wire format schemas (`src/sharing/wire/schema.ts`, `minified.ts`) to include `isLocked`.
- Fixed 20+ test files to add `isLocked: false` to inline question literals.
- `NativeMap` now reads `activeQuestion?.isLocked ?? false` instead of `useIsPinLocked()`.

### Subtask 2 — MapPin + getQuestionPins + offsetPosition (in working tree, not committed)

- Created `src/features/map/getQuestionPins.ts` with `MapPin` type and `getQuestionPins(question)`.
- Created `src/features/map/__tests__/getQuestionPins.test.ts` (8 tests, all passing).
- Added `offsetPosition()` to `src/shared/geojson.ts` with haversine math.
- Added `src/shared/__tests__/geojson.test.ts` with offset test.
- Updated `createDefaultQuestion` for thermometer: `previousPosition = center`, `currentPosition = offsetPosition(center, 2000, 90)`.
- Updated `questionStore.test.tsx` to assert the ~2km offset.

---

## What Remains

### Subtask 3 — usePinDrag proximity hit-testing

**Goal:** Change `usePinDrag` from "drag the single center pin" to "drag the closest visible pin".

**Current state of `src/features/map/usePinDrag.ts`:**

- Takes `activeQuestion: QuestionState | null`.
- Uses `getQuestionCenter(activeQuestion)` for hit-testing.
- `onCommit` signature: `(questionId: string, center: Position) => void`.
- `PinDragState` has no `draggedPinKey`.

**Required changes:**

1. Change `UsePinDragOptions`:
    - Replace `activeQuestion: QuestionState | null` with `pins: MapPin[]`.
    - Replace `onCommit: (questionId, center)` with `onCommit: (questionId, pinKey, position)`.
    - Add `questionId: string | null`.
2. Change `PinDragState`:
    - Add `draggedPinKey: string | null`.
3. In `handleDragStart`:
    - Project **all** `pins` to screen coordinates via `getPointInView`.
    - Find the closest pin within `PIN_HIT_RADIUS_PX`.
    - Tie-break: if equidistant, prefer `"end"` over `"start"`.
    - Store the winning pin's key in `draggedPinKeyRef`.
4. In `handleDragEnd`:
    - Call `onCommit(questionId, draggedPinKeyRef.current, draftPinCoordinateRef.current)`.
5. Remove `getQuestionCenter` helper at bottom of file.
6. Update `src/features/map/__tests__/usePinDrag.test.ts`:
    - Change all calls to pass `pins` + `questionId` instead of `activeQuestion`.
    - Update `onCommit` mock assertions to expect `(questionId, pinKey, position)`.
    - Add tests for multi-pin proximity selection and tie-break.

**Verification:** `pnpm test -- usePinDrag.test.ts` should pass.

### Subtask 4 — QuestionPinLayer + NativeMap wiring

**Goal:** `NativeMap` becomes a pure presenter receiving `pins`, `canMove`, and `questionId`. `MapAppScreen` derives everything and passes it down. The layer renders all pins.

**Current state:**

- `NativeMap.tsx` still derives `activeQuestionCenter` internally, builds `activePinFeature` memo, and renders `<ActivePinLayer>`.
- `MapAppScreen.tsx` does not derive `pins` or pass them to `NativeMap`.
- `ActivePinLayer.tsx` still exists and renders a single pin.

**Required changes:**

#### A. Rename `ActivePinLayer` → `QuestionPinLayer`

1. Rename `src/features/map/ActivePinLayer.tsx` to `src/features/map/QuestionPinLayer.tsx`.
2. Update the component:
    - Props: `pins: MapPin[]`, `canMove: boolean`, `pinDrag: PinDragState`, `onPress?`.
    - Build `FeatureCollection<Point>` from `pins`, using `draftCoordinate` for the dragged pin.
    - Use a single `MLShapeSource` (id: `"question-pins"`) with:
        - Base glow `MLCircleLayer` (orange, 24px) for all pins.
        - Drag glow `MLCircleLayer` (white, 60px) filtered to `isDragging === true`.
        - `MLSymbolLayer` for the pin icon.
    - Both glow layers adjust opacity based on `canMove`.
3. Create `src/features/map/__tests__/QuestionPinLayer.test.tsx`.

#### B. Update `NativeMap.tsx`

1. Remove the `activeQuestionCenter` / `shouldShowActivePin` / `canMoveActivePin` / `movableActiveQuestion` derivation.
2. Add `pins`, `canMove`, `questionId` to `NativeMapProps`.
3. Remove `activePinFeature` memo.
4. Pass `pins` to `usePinDrag` instead of `activeQuestion`.
5. Replace `<ActivePinLayer ...>` with `<QuestionPinLayer ...>`.
6. `handleMapPress` becomes a simple passthrough to `onPress` (the map-tap logic moves to `MapAppScreen`).

#### C. Update `MapAppScreen.tsx`

1. Import `getQuestionPins`, `getEventCoordinate`.
2. Import `useQuestionDerived`, `useQuestionActions`.
3. Derive:
    ```typescript
    const { activeQuestion } = useQuestionDerived();
    const pins = useMemo(
        () => getQuestionPins(activeQuestion),
        [activeQuestion],
    );
    const questionId = activeQuestion?.id ?? null;
    const isLocked = activeQuestion?.isLocked ?? false;
    const canMove = isQuestionDetailRoute && !isLocked && pins.length > 0;
    ```
4. Update `handleMapPress`:
    ```typescript
    const handleMapPress = useCallback(
        (event?: unknown) => {
            const coordinate = getEventCoordinate(event);
            if (
                coordinate &&
                activeQuestion &&
                "center" in activeQuestion &&
                !isLocked &&
                isQuestionDetailRoute
            ) {
                handlePinCommit(activeQuestion.id, "center", coordinate);
            }
            if (sheetIndexRef.current === SHEET_SNAP_INDEX.large) {
                bottomSheetRef.current?.snapToIndex(SHEET_SNAP_INDEX.compact);
            }
        },
        [activeQuestion, handlePinCommit, isLocked, isQuestionDetailRoute],
    );
    ```
5. Pass `canMove`, `pins`, `questionId` to `<NativeMap>`.

#### D. Update `NativeMap.test.tsx`

- All `<NativeMap>` renders need the new props: `canMove`, `pins`, `questionId`.
- The test for active pin should pass actual pins instead of relying on internal derivation.

**Verification:** `pnpm test -- NativeMap.test.tsx QuestionPinLayer.test.tsx usePinDrag.test.ts` should pass.

### Subtask 5 — Acceptance

1. Flip `usesMovableAnchor: true` in `src/features/questions/thermometer/thermometerConfig.ts`.
2. Run `pnpm typecheck` — expect 0 errors.
3. Run `pnpm test` — expect all suites pass.
4. Run `pnpm check` — expect lint, format, typecheck all pass.
5. Commit everything.

---

## Architecture Reminders

- **MapLibre child ordering:** Keep pins after shape layers and before `UserLocation`. The current order in `NativeMap` is correct; just swap `ActivePinLayer` for `QuestionPinLayer` in the same position.
- **AGENTS.md expression caution:** Use separate filtered `MLCircleLayer`s with literal style values. Do not use complex `case` expressions for numeric radii on iOS.
- **No `activePinKey` / `movablePinKey` state:** Both pins are equally draggable. The drag gesture decides which pin to move by proximity. Do not add any state for "selected pin."

## How to Pick Up

1. Review the current working tree changes (`git diff`, `git status`).
2. Commit the existing Subtask 1 & 2 changes if you want a clean slate, or leave them uncommitted and build on top.
3. Start with Subtask 3 (`usePinDrag`).
4. Then Subtask 4 (`QuestionPinLayer` + `NativeMap` + `MapAppScreen`).
5. Finish with Subtask 5 (acceptance).

## Verification Commands

```bash
pnpm test -- usePinDrag.test.ts
pnpm test -- QuestionPinLayer.test.tsx
pnpm test -- NativeMap.test.tsx
pnpm test
pnpm typecheck
pnpm check
```

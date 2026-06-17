# Measuring Question Flow Redesign — Implementation Plan

Status: ready to implement. Self-contained for a fresh agent. Read this whole
file before editing.

## Goal

Redesign the "choose a measuring question" flow reached via **Add question →
Measuring**, fixing six reported issues plus several found during triage. The
core move: **replace the bolted-on `Modal` category picker with a real
bottom-sheet route**, mirroring the existing **Matching** flow, and unify the
in-detail "Change category" affordance.

## Background / root causes (verified)

The measuring picker is the odd one out: every other "add question" sub-flow
(notably Matching) is a real bottom-sheet **route**, but measuring uses a
free-floating React Native `Modal` (`SlideUpModal`) rendered inside
`AddQuestionScreen`. That one choice causes issues #1–#4.

| #   | Symptom                                     | Root cause                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Modal doesn't reach the bottom              | `MeasuringCategoryModal` is a `maxHeight: "80%"` panel over a scrim with no safe-area handling — a partial sheet, not the app's persistent bottom sheet. `src/features/questions/measuring/MeasuringCategoryModal.tsx:130-136`                                                                                                                                                                               |
| 2   | "Done" should be Back                       | The dismiss control says "Done" but tapping a row already commits the choice (`onSelect` then `onClose`), so there is no separate confirm step. `MeasuringCategoryModal.tsx:44`, `:82-85`                                                                                                                                                                                                                    |
| 3   | Radio buttons don't fit                     | Rows act on tap (navigation semantics), so a radio (deferred-commit semantics) is wrong; should be disclosure rows with a chevron. Compounded by `AddQuestionScreen.tsx:218` hardcoding `selectedCategory="rail-station"`, so a fresh add always shows Rail Station pre-selected.                                                                                                                            |
| 4   | Next sheet flies in from the wrong side     | `getNavDirection` derives direction from static route **depth**. `add-question` and `question-detail` are both depth 2, so `2 > 2` is false → `"back"` → the detail screen enters from the **left**. `src/features/sheet/sheetNav.ts:48-55`, consumed at `src/features/sheet/MainDrawer.tsx:242-243`. Affects radar/thermometer/tentacles too.                                                               |
| 5   | Coastline (line categories) has no "Change" | The line/polygon branch renders a **static** readout; only the point-category branch gets a Change control. `src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx:237-259` vs `:265-313`                                                                                                                                                                                                       |
| 6   | Calc freezes until you move the pin         | In `MeasuringAutoResult`, distance is a `useMemo` keyed on `[question.center, question.category, distanceResolver]`. Line bundles load **async** (`loadLineBundle` in a `useEffect`) but the resolver reads them **synchronously**; when the load finishes nothing in the memo deps changes, so it never recomputes — until `question.center` changes. `MeasuringQuestionDetailScreen.tsx:50-60`, `:201-210` |

Additional issues to fix opportunistically:

- **Location race**: `openMeasuringModal` fires `requestUserCoordinate` but if a
  category is picked before it resolves, the question keeps play-area center
  forever. Other types patch center _after_ create. `AddQuestionScreen.tsx:77-100`
- **Un-answerable while computing**: answer selector is disabled when distance is
  null (`MeasuringQuestionDetailScreen.tsx:95-96`); combined with #6 a line
  category can be stuck un-answerable. Fixing #6 resolves it; keep showing
  "Computing…" as the loading state.
- **Dead code**: the modal filters `implemented` but every measuring category is
  `implemented: true`. `MeasuringCategoryModal.tsx:58-65`
- **A11y mismatch**: close button label "Close category picker" vs visible text
  "Done"; rows carry radio `accessibilityState={{ selected }}` for a navigation
  action.

## Design decision

- **Add flow → real route.** New `measuring` sheet route (parent `add-question`),
  mirroring `matching`. The "Measuring" card navigates to it; tapping a category
  creates the question and navigates to `question-detail`. Fixes #1, #2, #3, and
  #4 (with the nav fix).
- **In-detail "Change" → inline expandable list**, not a modal and not a second
  route. Tapping "Change" expands the shared category list in place; selecting
  collapses it and updates the question. Works for **both** point and line
  categories (fixes #5), drops the modal, and avoids threading add-vs-change
  intent through the param-less navigation system.
- Both surfaces share one presentational `MeasuringCategoryList` component.
- **Nav-direction fix**: treat detail/leaf routes (`question-detail`,
  `station-detail`) as always-forward-on-enter / always-back-on-leave, since the
  parent-depth model cannot express sibling→leaf forward navigation.

Do **not** delete `SlideUpModal` — it is still used by `SeekTimeModal`,
`ShareSetupModal`, and `OfflinePackModal`. Only `MeasuringCategoryModal` is
removed.

## Reference: the pattern to mirror

`MatchingQuestionScreen` (`src/features/questions/MatchingQuestionScreen.tsx`) is
the template for the new route screen: `SheetScrollView` + sectioned disclosure
rows + `createQuestion(...)` + `onNavigate("question-detail")`. Match its styles
(row/chevron/section) for visual consistency.

Route wiring reference: how `matching` is registered —

- union member: `src/features/sheet/sheetRoutes.ts:5`
- graph node: `src/features/sheet/sheetNav.ts:7` (`{ name: "matching", parent: "add-question" }`)
- render case: `src/features/sheet/MainDrawer.tsx:320-325`

---

## Step-by-step

### Step 1 — Shared `MeasuringCategoryList` component

New file: `src/features/questions/measuring/MeasuringCategoryList.tsx`

Presentational only. Props:

```ts
type MeasuringCategoryListProps = {
    /** When set, the matching row shows a checkmark (used by the in-detail
     *  change flow). Omit in the add flow (no pre-selection). */
    selectedCategory?: MeasuringCategory;
    onSelect: (category: MeasuringCategory) => void;
    /** Prefix for row testIDs; default "measuring-category". */
    testIDPrefix?: string;
};
```

- Iterate sections in an explicit order:
  `["Transit", "Borders & Lines", "Natural", "Places of Interest", "Public Utilities"]`,
  reading `measuringCategoriesBySection` from `./measuringCategories`.
- Drop the `implemented` filter (all are implemented) — or keep it harmlessly;
  prefer dropping the dead branch.
- Each row: a `Pressable` styled like `MatchingQuestionScreen`'s `optionRow`
  (card bg, border, radius, `minHeight` ~58, chevron `›`). **No radio.**
- When `selectedCategory === config.category`, render a checkmark (e.g. a `Text`
  "✓" in `colors.tint`) instead of / alongside the chevron, and apply a subtle
  selected background (`colors.buttonSubtle`).
- testIDs: `` `${testIDPrefix}-${config.category}` `` (default
  `measuring-category-<cat>`). `accessibilityRole="button"`,
  `accessibilityLabel={`${config.title} measuring category`}`,
  `accessibilityState={{ selected }}` only when `selectedCategory` is provided.
- Do **not** wrap in a ScrollView — callers provide scrolling (route uses
  `SheetScrollView`; in-detail it lives inside the detail `SheetScrollView`).

### Step 2 — New route screen `MeasuringCategoryScreen`

New file: `src/features/questions/measuring/MeasuringCategoryScreen.tsx`

Model it on `MatchingQuestionScreen` **and** the old `openMeasuringModal` /
`handleMeasuringCategoryPick` logic in `AddQuestionScreen`:

```tsx
type Props = { onNavigate: (route: SheetRouteName) => void };

export function MeasuringCategoryScreen({ onNavigate }: Props) {
    const { playArea } = usePlayArea();
    const { createQuestion, updateQuestion } = useQuestionActions();

    const handlePick = useCallback((category: MeasuringCategory) => {
        const question = createQuestion("measuring", {
            center: playArea.center,
            category,
        });
        onNavigate("question-detail");

        // Patch center post-create like radar/thermometer/tentacles do
        // (fixes the location race).
        requestUserCoordinate().then((result) => {
            const center = result.coordinate ?? getLastKnownMapCenter();
            if (center) {
                updateQuestion(question.id, (current) =>
                    updateQuestionCenter(current, center),
                );
            }
        });
    }, [createQuestion, onNavigate, playArea.center, updateQuestion]);

    return (
        <SheetScrollView contentContainerStyle={...}>
            <MeasuringCategoryList onSelect={handlePick} />
        </SheetScrollView>
    );
}
```

Imports: `requestUserCoordinate` from `@/shared/location`,
`getLastKnownMapCenter` from `@/features/map/mapCenter`, `updateQuestionCenter` +
`useQuestionActions` from `@/state/questionStore`, `usePlayArea` from
`@/state/playAreaStore`, `SheetScrollView`, `SheetRouteName`.

### Step 3 — Register the `measuring` route

1. `src/features/sheet/sheetRoutes.ts` — add `| "measuring"` to `SheetRouteName`
   (place after `"matching"`).
2. `src/features/sheet/sheetNav.ts` — add to `ROUTE_GRAPH`:
   `{ name: "measuring", parent: "add-question" }` (next to the `matching` node).
3. `src/features/sheet/MainDrawer.tsx`:
    - import `MeasuringCategoryScreen`.
    - add a render case mirroring `matching`:
        ```tsx
        case "measuring":
            return (
                <ChildSheetShell onBack={() => onNavigate("add-question")}>
                    <MeasuringCategoryScreen onNavigate={onNavigate} />
                </ChildSheetShell>
            );
        ```
    - (Optional, for parity with `play-area`/`matching` snapping) if measuring
      should open at the large snap, add it to `getRouteSnapIndex` in
      `src/features/sheet/AppBottomSheet.tsx:111-115`. Matching is listed there;
      do the same for `measuring` so the long list has room.

### Step 4 — Fix nav direction (#4)

`src/features/sheet/sheetNav.ts`, in `getNavDirection`:

```ts
// Detail/leaf routes are always entered "forward" and left "back",
// regardless of parent depth. The depth model can't express sibling→leaf
// forward navigation (e.g. add-question → question-detail, both depth 2).
const LEAF_ROUTES = new Set<SheetRouteName>([
    "question-detail",
    "station-detail",
]);

export function getNavDirection(from, to) {
    if (LEAF_ROUTES.has(to) && !LEAF_ROUTES.has(from)) return "forward";
    if (LEAF_ROUTES.has(from) && !LEAF_ROUTES.has(to)) return "back";
    return (routeDepthMap.get(to) ?? 0) > (routeDepthMap.get(from) ?? 0)
        ? "forward"
        : "back";
}
```

Verify the previously-correct cases still hold: `questions`(1)→`question-detail`
= forward; `question-detail`→`questions` = back; `main`→`station-detail` =
forward. Add/adjust a unit test (see Step 8).

### Step 5 — Point the Add card at the route

`src/features/questions/AddQuestionScreen.tsx`:

- Delete `showMeasuringModal`, `pendingMeasuringCenter`, `openMeasuringModal`,
  `handleMeasuringCategoryPick`, and the `<MeasuringCategoryModal …>` element.
- Change the Measuring `Pressable` `onPress` to `() => onNavigate("measuring")`.
- Remove now-unused imports (`MeasuringCategoryModal`, `MeasuringCategory`, and
  any of `useState`/`requestUserCoordinate`/`getLastKnownMapCenter` no longer
  referenced — check; radar/thermometer/tentacles still use the latter two and
  `useState` may no longer be needed).
- Keep `testID="add-measuring-question-row"`.

### Step 6 — In-detail "Change" → inline list, unify line + point, fix freeze

`src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx`:

**6a. Remove the modal.** Delete the `MeasuringCategoryModal` import,
`showCategoryModal` state, and the `<MeasuringCategoryModal …>` element.

**6b. Unify the Category section** so all categories (point _and_ line) render
the same control: current title + a "Change" pressable that toggles an inline
`MeasuringCategoryList`. Sketch:

```tsx
const [isChanging, setIsChanging] = useState(false);

// Category section (replaces both the line static-readout branch and the
// point picker/collapsed branches):
<View style={styles.section}>
    <Text style={styles.sectionTitle}>Category</Text>
    <Pressable
        accessibilityLabel={`${categoryTitle} — tap to change category`}
        accessibilityRole="button"
        onPress={() => setIsChanging((v) => !v)}
        style={[styles.categoryPicker, styles.changeHeader]}
        testID="measuring-category-change"
    >
        <Text style={styles.changeHeaderText}>{categoryTitle}</Text>
        <Text style={styles.changeHint}>{isChanging ? "Done" : "Change"}</Text>
    </Pressable>
    {isChanging ? (
        <View style={styles.inlineList}>
            <MeasuringCategoryList
                selectedCategory={question.category}
                onSelect={(category) => {
                    handleCategoryChange(category);
                    setIsChanging(false);
                }}
            />
        </View>
    ) : null}
</View>;
```

`handleCategoryChange` already exists (`:212-234`) and handles the
`loadLineBundle` pre-warm — keep it, it now serves line→point and point→line
switches. Then render the shared `MeasuringAutoResult` once, choosing the
resolver by category:

```tsx
const distanceResolver = isLineMeasuringCategory(question.category)
    ? computeLineDistance
    : computeNearestPoiDistance;
```

This collapses the two top-level `return`s (`:237-258` and `:265-314`) into one,
removing the line/point divergence that caused #5.

> Note: the `isChanging ? "Done"` label here is the _toggle/collapse_ control
> for the inline list, which is a real confirm/collapse action — distinct from
> the old modal "Done". Acceptable; alternatively use a chevron that rotates.

**6c. Fix the freeze (#6).** Drive a recompute when the async line bundle
finishes loading, using the existing revision hook:

```ts
import { useEnsureMeasuringBundles } from "./useEnsureMeasuringBundles";

// In MeasuringQuestionDetailScreen:
const bundleRevision = useEnsureMeasuringBundles(
    isLineMeasuringCategory(question.category) ? [question] : [],
);
```

Pass `bundleRevision` into `MeasuringAutoResult` as a prop and add it to the
`result` `useMemo` dependency array (`MeasuringQuestionDetailScreen.tsx:50-60`):

```tsx
const result = useMemo(() => {
    try {
        return distanceResolver(question.center, question.category);
    } catch (err) { console.warn(...); return null; }
}, [question.center, question.category, distanceResolver, bundleRevision]);
```

The existing `loadLineBundle` `useEffect` (`:201-210`) can stay or be removed;
`useEnsureMeasuringBundles` already fires the load for pack-backed categories and
bumps `bundleRevision` on completion. Removing the redundant effect is cleaner —
but confirm `useEnsureMeasuringBundles` covers the same categories (it loads when
`hasPackSources(category)` and the bundle isn't cached). Keep the effect if in
doubt; the revision dep is what actually fixes the freeze.

`MeasuringAutoResult` keeps showing `"Computing…"` while `result` is null, which
is now a transient state instead of a permanent one.

### Step 7 — Delete `MeasuringCategoryModal`

Delete `src/features/questions/measuring/MeasuringCategoryModal.tsx`. Confirm no
remaining importers:

```bash
grep -rn "MeasuringCategoryModal" src
```

(Only the deleted file, its former importers, and tests should appear; clean all
up.)

### Step 8 — Tests

Run the existing suites and update for the new shape.

1. **`src/features/questions/__tests__/AddQuestionScreen.test.tsx`**

    - The test "opens measuring modal when GPS is denied…" (`:134-149`) asserts
      pressing the measuring row does **not** navigate. Update it: pressing
      `add-measuring-question-row` now calls `onNavigate("measuring")`. Rename the
      test accordingly.

2. **`src/features/questions/measuring/__tests__/MeasuringQuestionDetailScreen.test.tsx`**

    - Replace modal-based assertions (`measuring-category-modal-*`) with the
      inline-list flow: press `measuring-category-change`, then expect
      `measuring-category-park` (and friends) to appear.
    - "shows collapsed box when answer is selected" / "opens modal from collapsed
      box": rework to the unified control — the Category header now always shows
      title + Change; pressing it reveals `measuring-category-<cat>` rows.
    - Line-category block: the test "shows static category readout instead of
      picker" asserted `measuring-category-coastline` **throws**. Invert it — line
      categories now expose the same Change control; pressing
      `measuring-category-change` reveals the list (this is the #5 fix). Keep the
      coastline distance test.
    - Add a **freeze regression test**: register a coastline pack source that
      resolves asynchronously (or use the revision hook path) such that the first
      render shows "Computing…" and, after the bundle resolves (advance
      timers/`waitFor`), `measuring-auto-distance` shows a real value **without**
      changing `question.center`. If async pack FS is hard to simulate, at minimum
      assert that bumping the bundle revision recomputes — the key is that no pin
      move is required.

3. **New: `MeasuringCategoryList` test** — sections render, tapping a row calls
   `onSelect(category)`, and `selectedCategory` shows the selected state (no
   radio). Mirror `MatchingQuestionScreen` test conventions if one exists.

4. **`sheetNav` test** — if `src/features/sheet/__tests__` lacks a nav test, add
   one asserting `getNavDirection("add-question", "question-detail") === "forward"`,
   `getNavDirection("matching", "question-detail") === "forward"`,
   `getNavDirection("measuring", "question-detail") === "forward"`,
   `getNavDirection("question-detail", "questions") === "back"`, and the
   existing `questions → question-detail === "forward"`.

### Step 9 — Verify

```bash
pnpm typecheck
pnpm test
pnpm check     # lint + format:check + typecheck + perf:typecheck + POI-selector drift
```

`pnpm check` does **not** run jest — run `pnpm test` too. This is a UI/state
change, so run all three.

Native sanity (no geometry/native-module changes here, so Jest + check are the
gate). If a simulator/dev build is handy, smoke the Add → Measuring → pick →
detail → Change path; otherwise the Maestro GH workflow is the optional final
check:

```bash
gh workflow run "Maestro E2E" --ref <branch> -f platform=android -f flow=smoke
gh run watch
```

## Gotchas / project rules to respect

- **Never conditionally mount/unmount a native child of `MapView`, and never put
  a dynamic `key` on an `ML*` primitive.** This change is sheet/route UI only and
  must not touch `NativeMap` layer mounting. Keep map layers permanently mounted.
- **Markdown/prettier**: write prettier-stable markdown; `lint-staged --write`
  can be non-idempotent on nested lists. Run `pnpm format:check` before
  committing and re-run `pnpm check` so CI stays green.
- **Distances stay in meters** internally; display units (`m`/`km`/`mi`) are
  presentation only. Don't change the stored model.
- **Question terminology**: this is the `measuring` family; keep that name.
- Don't reorder `ShapeSource`/layer children or touch MapLibre style expressions.
- The new route screen reads state via hooks (like `MatchingQuestionScreen`),
  not via props threaded through `renderRouteContent` — that function only passes
  `onNavigate`.

## File-change summary

| File                                                                                | Change                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/features/questions/measuring/MeasuringCategoryList.tsx`                        | **new** — shared sectioned disclosure list                                           |
| `src/features/questions/measuring/MeasuringCategoryScreen.tsx`                      | **new** — add-flow route screen                                                      |
| `src/features/sheet/sheetRoutes.ts`                                                 | add `"measuring"` to `SheetRouteName`                                                |
| `src/features/sheet/sheetNav.ts`                                                    | add `measuring` graph node; LEAF_ROUTES forward fix                                  |
| `src/features/sheet/MainDrawer.tsx`                                                 | import + render case for `measuring`                                                 |
| `src/features/sheet/AppBottomSheet.tsx`                                             | (optional) add `measuring` to large-snap set                                         |
| `src/features/questions/AddQuestionScreen.tsx`                                      | Measuring row → `onNavigate("measuring")`; remove modal + handlers                   |
| `src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx`                | inline Change list (point+line), freeze fix via `useEnsureMeasuringBundles` revision |
| `src/features/questions/measuring/MeasuringCategoryModal.tsx`                       | **delete**                                                                           |
| `src/features/questions/__tests__/AddQuestionScreen.test.tsx`                       | measuring row now navigates                                                          |
| `src/features/questions/measuring/__tests__/MeasuringQuestionDetailScreen.test.tsx` | inline list + line Change + freeze regression                                        |
| `src/features/sheet/__tests__/sheetNav.test.ts`                                     | **new/extend** — forward direction to detail                                         |
| `src/features/questions/measuring/__tests__/MeasuringCategoryList.test.tsx`         | **new**                                                                              |

## Issue → fix traceability

- #1 (bottom) → Steps 2–3 (real route owns the sheet/safe area).
- #2 (Done→Back) → Step 3 (`ChildSheetShell` Back button).
- #3 (radio) → Step 1 (disclosure rows, no radio; no hardcoded pre-selection).
- #4 (wrong side) → Step 4 (LEAF_ROUTES forward).
- #5 (coastline no Change) → Step 6b (unified inline Change for line + point).
- #6 (freeze) → Step 6c (`bundleRevision` in memo deps).
- Location race / un-answerable / dead code / a11y → Steps 2, 5, 6, 1.
  </content>

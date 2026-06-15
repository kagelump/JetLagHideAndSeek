# Phase 1 — Main sheet & first-run state

Parent: `epic.md`. Independent; fastest visible win. The first-run fork and the
setup nudge (Phase 2) hang off this surface.

## Goal

Turn the bare main route into a welcoming identity + persistent game HUD, and
give it a first-run state that forks the user into **Set up a game** or **Join a
game**.

## Current state

- `MainDrawer.tsx` default case renders two `DrawerAction` rows ("Questions",
  "Settings") with **empty descriptions** and no header. It even defines
  `header`/`title`/`eyebrow` styles (~`:570-586`) that are **never rendered**.
- `QuestionsScreen.tsx` defines `emptyCard`/`emptyTitle` styles (~`:149-161`)
  that are **never used** — zero-question state shows only the Add row.
- Map controls (`MapControls.tsx:25-26`) are bare emoji with
  `accessibilityRole="button"` but **no `accessibilityLabel`**.
- Pin placement is a 300ms long-press-drag (`usePinDrag.ts:200`); nothing tells
  the user. `QuestionLocationSelector.tsx` shows coords + "Set to My Location"
  only.

## Scope

### Main-sheet identity + HUD (persistent, all-game)

Follows the `MainSheet` HUD mock (`design-reference/screens.mock.jsx`). Treat the
main sheet as a lightweight **game HUD**:

- **Header:** Eyebrow "Current game" + the play-area label as the title, with a
  **Seeker/Hider mode chip** top-right (the one navy-filled control; toggles
  mode).
- **Hero stat `Card`:** three big 900-weight, tabular-number stats —
  **Questions · Stations left · Operators**. Placeholder content for now (final
  metric set TBD; the "stations left" figure is the perf-gated eligibility
  number, see below).
- **Primary action:** **"+ Add Question" spans full width** (teal). Per the
  design review there is **no Re-share button beside it** — the slot is gone, not
  repurposed.
- **Nav rows below:** `ListRow` "Questions" (`N asked · tap to review`) and
  "Settings" (`Play area, hiding zones, sharing`).
- _(Marquee follow-up, perf-gated)_ the **"Stations left"** figure is live
  eligibility ("~37 of 412 still possible"), updating as answers shade the map.
  See epic risks before making it always-on; until then show a static/derived
  count.

### First-run state (welcome + fork)

When there is **no configured game yet** and onboarding hasn't completed, the
main sheet shows its first-run face instead of the plain HUD (per the `MainSheet`
first-run mock):

- Eyebrow "Hide & Seek Mapper" + title **"Set up your game"** + one-line pitch:
  _"You're the seeker. Ask the hider questions, record their answers, and watch
  the map narrow down where they can be."_
- Two stacked full-width actions: primary **Set up a game** (→ Phase 2 setup
  checklist) and subtle **Join a game** (→ Phase 3 paste-link import).
- Centered subtext **"…or just explore the map."** — no button; the gentle
  setup nudge persists until setup completes (Phase 2).
- Suppressed on imported/returning games (already set up).

### Empty-questions state

Wire up the existing unused `emptyCard` styles: _"No questions yet — add one and
the map starts narrowing down the hider."_ + the existing Add CTA.

### Discoverability fixes

- **Long-press pin hint:** a muted line in the question-detail location section,
  e.g. _"Long-press a pin to drag it."_
- **Map-control a11y labels:** "Fit play area" / "Go to my location" on the two
  `MapControls` buttons.

## Teal token setup

Phase 1 is the first phase to use the teal accent on interactive controls.
**Add the teal tokens to `src/theme/colors.ts` now** — `teal` (`#1f6f78`),
`tealTintBg` (`#e6f2ef`), and `accentPress` (`#195a62`) — so Phase 1
components reference theme tokens rather than hardcoded hex values. Phase 4
then only needs to reconcile the segmented-control **selected-fill** behavior
(teal instead of navy); it does not re-introduce the tokens.

## Files likely touched

- `src/theme/colors.ts` (add teal / tealTintBg / accentPress tokens)
- `src/features/sheet/MainDrawer.tsx` (main route content + first-run state)
- `src/features/questions/QuestionsScreen.tsx` (empty state)
- `src/features/map/MapControls.tsx` (a11y labels)
- `src/features/questions/components/QuestionLocationSelector.tsx` (pin hint)
- New small components for HUD rows/chips (reuse `SheetListRow` where possible)
- Reads from `playAreaStore`, `questionStore`, `hidingZoneStore`

## Acceptance criteria

- Cold first launch shows the welcoming first-run state with a clear fork.
- A configured/imported game shows the HUD (summary + quick actions), not the
  welcome.
- Zero-question list shows a helpful empty state.
- VoiceOver/TalkBack announces meaningful labels for both map controls.
- The long-press-to-drag-pin affordance is discoverable in question detail.
- Tests: render tests for first-run vs HUD vs empty states; a11y label
  assertions for map controls. `pnpm test` + `pnpm check`.

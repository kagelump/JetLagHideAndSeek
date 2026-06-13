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
Render a real header (app name + one-line tagline) and a **game-summary card**:
`{playArea.label} · {N} questions · {N} stations`, tappable into the relevant
screens. Treat the main sheet as a lightweight **game HUD**:

- **Live game summary** (above) — the always-visible anchor.
- **Quick "Add Question"** action — the most frequent in-play action; don't make
  users drill Questions → Add every time.
- **Re-share / Show QR** quick action — for late joiners / re-syncing.
- **Seeker/Hider mode chip** — visible since it changes link behavior.
- *(Marquee follow-up, perf-gated)* **Eligibility progress** —
  e.g. "~37 of 412 stations still possible" / "~12% of zone left," updating as
  answers shade the map. See epic risks before making this always-on.

### First-run state (welcome + fork)
When there is **no configured game yet** and onboarding hasn't completed, the
main sheet shows its first-run face instead of the plain HUD:

- Warm header + one-line pitch: *"You're the seeker. Ask the hider questions,
  record their answers, and watch the map narrow down where they can be."*
- Two primary actions: **Set up a game** (→ Phase 2 setup checklist) and
  **Join a game** (→ Phase 3 paste-link import).
- Implicit third path: just use the app ("Just explore") — no button needed;
  the gentle setup nudge persists until setup completes (Phase 2).
- Suppressed on imported/returning games (already set up).

### Empty-questions state
Wire up the existing unused `emptyCard` styles: *"No questions yet — add one and
the map starts narrowing down the hider."* + the existing Add CTA.

### Discoverability fixes
- **Long-press pin hint:** a muted line in the question-detail location section,
  e.g. *"Long-press the map to drop or drag the pin."*
- **Map-control a11y labels:** "Fit play area" / "Go to my location" on the two
  `MapControls` buttons.

## Files likely touched

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
- The long-press-to-place-pin affordance is discoverable in question detail.
- Tests: render tests for first-run vs HUD vs empty states; a11y label
  assertions for map controls. `pnpm test` + `pnpm check`.

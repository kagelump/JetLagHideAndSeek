# Phase 8 — Question-sheet compaction (later phase)

Parent: `epic.md`. **Sequenced last** — lands after the setup-critical sheets
(Phases 1–6). Applies the Phase 4 compact system to the question detail
screens.

## Goal

Bring the question detail sheets to the same "compact, feature-rich, 42%-resting"
bar as Play Area / Hiding Zone, and tidy the nested-modal awkwardness noted in
the UX assessment.

## Principle

Keep the **primary control + the answer selector above the fold at 42%**; push
everything secondary into drill-ins. The map behind the sheet shows the
geometry (radar circle, candidate pins, measuring lines), so the sheet stays a
thin control surface.

## Per-type targets

- **Radar:** distance preset **chips** (horizontal scroll) + Hit/Miss answer
  visible at 42%; "Other distance" custom input as a drill-in/disclosure.
- **Matching (OSM):** top-3 candidates + answer above the fold; "Show more
  candidates" and the candidate detail open as **drill-ins**, replacing the
  current nested-modal stacking (the code currently defers ~300ms "so they don't
  stack" — a drill-in removes the workaround).
- **Measuring:** category picker as chips/drill-in; distance + unit + answer
  compact; "Computing…" inline.
- **Thermometer:** Start/End pin toggle + distance + answer compact; keep the
  "pins too close" guard.
- **Tentacles:** category grid → drill-in; candidate list compact with
  selection; keep the Reset affordance but de-emphasize its destructive-looking
  red (it only clears the answer).
- **Transit line:** line list compact with closest-station info; drill-in for
  long lists.

## Related assessment cleanups to fold in

- **Question delete confirmation / undo** (swipe + actions-menu delete are
  currently instant and irreversible) — add a confirm or an undo affordance.
  Pairs well with a HUD "undo last answer" (Phase 1 follow-up).
- **Surface cost/time metadata** (`questionRegistry.ts` `cost`/`time` exist but
  are never shown) in the Add-Question list and/or detail.
- Remove remaining debug `console.log`s in the matching search path
  (`useMatchingSearch.ts` `[search] …`).

## Files likely touched

- `src/features/questions/**` detail screens + `components/`
- `src/features/questions/AddQuestionScreen.tsx`, `QuestionsScreen.tsx`
- Phase 4 shared components

## Acceptance criteria

- Each question type's primary control + answer is usable at 42%.
- Matching candidate detail no longer relies on stacked modals.
- Deleting a question is confirmable/undoable.
- Tests: per-type render tests at the compact layout; delete-confirm/undo path;
  answer-polarity tests preserved. `pnpm test` + `pnpm check`.

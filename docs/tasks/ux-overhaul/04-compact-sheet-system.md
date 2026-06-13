# Phase 4 — Compact sheet system

Parent: `epic.md`. Shared foundation for Phases 5, 6, 8.

## Goal

Make every sheet **compact, feature-rich, and friendly enough that most
operations are doable at the 42% (medium) snap point** — without bespoke
per-sheet layouts. Stop treating the sheet as a scroll surface; treat it as a
**fixed control frame** with a few reusable patterns.

Snap points today: `["18%", "42%", "88%"]` (`AppBottomSheet.tsx`), indices
`compact / medium / large`. **42% is the resting state** for common ops; **88%
is reserved for deep browse** (global search, browse-all-regions).

## The pattern system

1. **Sticky context header + sticky action footer; scroll only the middle.**
    - Top: a one-line state summary (e.g. "Tokyo · 3 operators · 412 stations ·
      500 m").
    - Bottom: the single primary action (Continue / Apply / Add), always visible
      at 42% so the user never expands just to find the button.
    - `ChildSheetShell` already owns the header; add an **optional sticky footer
      slot** — one reusable component used across sheets.
2. **Drill-in over expand.** Hierarchies (operator→lines, browse-all,
   show-more) **push a short sub-screen** (reuse MainDrawer's existing slide
   transition + edge-swipe-back) instead of growing the current list. Avoid
   inline accordions — they balloon height and force 88%.
3. **Condensed single-line rows.** Replace tall "label + meta + Add/Remove
   button" rows with one-line toggle rows: `title · count chip · trailing ✓`.
   Roughly doubles items visible at 42%.
4. **Chips & segmented controls** for small/non-exclusive sets. Horizontally
   scrolling chips show many presets/categories in one row's height. Radius unit
   already uses a segmented control — extend the idiom.
5. **Search to shorten, not scroll.** A filter field collapses long lists to a
   handful of rows. Only while the keyboard/search is active does the sheet pop
   to 88%, then settle back to 42%.
6. **Map carries geometry.** Because the sheet rests at 42%, the live-shading
   map stays visible behind it; the sheet never renders previews. This is _why_
   42% is the target and what makes trial-and-error editing (e.g. toggling a
   transit line and watching zones update) feel good.

## Deliverables

- A **sticky-footer slot** on `ChildSheetShell` (`MainDrawer.tsx`).
- Shared **condensed-row** and **chip / segmented** style/components in
  `src/components/` (or `src/features/sheet/`), reused by all sheets.
- A small helper for **transient snap expansion** (pop to 88% on
  search/keyboard, return to 42%) coordinated with `AppBottomSheet`.
- Document the "42% resting / 88% deep-browse" rule in `implementation_notes.md`.
- **Teal selected-fill reconciliation:** update `src/theme/colors.ts` and the
  segmented/answer controls so the **selected segment fills teal** (today's
  selected state uses the dark navy fill). Navy is retained only for the
  Seeker/Hider mode chip. Mirrors `design-reference/colors.css`
  (`--fill-control: var(--teal)`).

## Design system mapping

The mock composes a component vocabulary that maps onto our primitives — build
or align these (`design-reference/`): `SheetHeader` (= `ChildSheetShell` header,

- "…" menu accessory), `BottomSheet` sticky-footer slot, `ListRow`
  (= `SheetListRow`, condensed), `ChipGroup`, `AnswerSelector`, `QuestionMeta`,
  `SegmentedControl`, `Badge`, `Chip`, `Fab` (••• mark), `MapControlButton`.

## Constraints (from `AGENTS.md`)

- Keep `enableDynamicSizing={false}` and fixed snap points (v5 misbehaves
  otherwise).
- Drawer screens that can overflow must use `SheetScrollView` (owns bottom
  padding, `flex: 1`, `keyboardShouldPersistTaps`).
- Keep `ShapeSource`/layer children before marker overlays in `NativeMap`.

## Acceptance criteria

- Play Area and Hiding Zone (Phases 5–6) complete their **common** operations at
  42% without manual expansion; only deep browse/search uses 88%.
- The sticky footer's primary action is visible at 42% on both sheets.
- Tests: footer-slot render test; snap-behavior unit tests for the
  expand-on-search helper. `pnpm test` + Maestro bottom-sheet flow as final
  check.

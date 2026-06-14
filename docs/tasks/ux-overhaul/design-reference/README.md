# Design reference

Captured from the Claude Design handoff bundle **"Hide & Seek Mapper Design
System"** (claude.ai/design), reverse-engineered from this repo + the UX-overhaul
plan. Persisted here because the design-file URL is ephemeral. These are the
durable source-of-truth for the visual spec the epic implements.

| File                     | What it is                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-system-guide.md` | The full design-system guide — voice/tone, color, type, spacing, **the bottom-sheet anatomy + 42% rule**, and the **question-sheet table** (per-type primary control / answer / map reaction / cost).                         |
| `colors.css`             | Canonical color tokens. Accent is **teal `#1f6f78`**; `--fill-control: var(--teal)` (primary buttons + **selected segments fill teal**); navy `#111827` is `--fill-control-strong`, kept only for the Seeker/Hider mode chip. |
| `screens.mock.jsx`       | Mock of `MainSheet` (first-run + live HUD), `SettingsSheet`, `PlayAreaSheet`, `HidingZoneSheet`.                                                                                                                              |
| `questions.mock.jsx`     | Mock of the questions list, Add Question, and the five detail sheets.                                                                                                                                                         |

## Decisions on which mock elements we adopt

Captured from the design review (see `../epic.md` decisions log):

**Adopt as-is**

- Teal accent + **teal-filled primary buttons and selected segments** (one
  accent; navy only for the mode chip).
- `QuestionMeta` "Draw 2, pick 1 · 5 min" on Add-Question rows and detail
  headers (Eyebrow + "{distance} radar" title + meta).
- Questions list: compact rows, answer as a color-coded `Badge`
  (Miss=danger, Hotter=success, POI=neutral); "swipe to delete" hint.
- Main-sheet hero stat box (3 tabular-number stats; placeholder content for now).
- Play Area sheet: search + "Bundled areas" list ("In use" badge) + Advanced
  disclosure hiding the OSM relation-ID.
- Hiding Zones operator rows: color dot + name + "N lines · N stations" meta +
  Add/Added chip + active wash; Suggested vs Browse-all sections.
- First-run welcome + Set up / Join fork + "…or just explore the map."
- Component vocabulary: `SheetHeader`, `AnswerSelector` (3-segment, type-aware
  polarity), `ChipGroup` (scrolling distance presets), `QuestionMeta`, `ListRow`,
  `BottomSheet` (sticky footer slot), `MapControlButton`, `Fab` (••• mark).

**Adopt with a change**

- **Main HUD second button removed.** No Re-share next to "+ Add Question";
  **Add Question spans full width.**
- **Share lives as the culminating row** of the "Set up your game" group
  (activating on completion) — NOT the top-right header button the mock shows.
- **Radius removed from the Hiding Zones body** → behind a "…" header overflow
  menu, as a **number input + m/km/mi unit toggle** (canonical meters).
- **Hiding Zones operator rows gain a drill-in chevron** (tap body = toggle
  operator; tap chevron = pick specific lines) — see `../06-hiding-zone-sheet.md`.

**Ignore**

- The **thermometer detail mock is wrong.** Adapt the current app's thermometer
  layout into the compact 42% pattern instead. See `../08-question-sheets-compaction.md`.

## Note on the live app's tokens

The mock's `colors.css` is the target. Phase 1 adds the teal tokens to
`src/theme/colors.ts` (`teal`, `tealTintBg`, `accentPress`); Phase 4
reconciles the segmented-control **selected-fill** treatment (teal instead
of today's dark fill). Map palette + paper surfaces already match.

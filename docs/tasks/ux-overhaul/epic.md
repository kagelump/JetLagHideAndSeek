# Epic: OOTB & Sheet UX Overhaul

Status: **Planning complete — ready to implement**
Branch: `claude/expo-app-ux-assessment-v59xm4`

## Why

A UX assessment of the Expo app found the app is architecturally clean and
accessible, but has no first-run experience and several discoverability gaps.
A brand-new user boots straight into default Tokyo with a bottom sheet showing
two unlabeled rows ("Questions", "Settings") and no sense of what the app is or
what to do. The app's "aha" — watching the map shade away as answers are
recorded — is never demonstrated.

This epic delivers a welcoming out-of-the-box (OOTB) experience and a compact,
feature-rich sheet system, **without** building a parallel set of throwaway
wizard components. Onboarding is expressed as *states and affordances layered on
the real sheets*, so the same work that guides newcomers also improves everyday
use.

### North star

> A first-time user reaches **one answered question — and therefore one shaded
> map — as fast as possible.** Everything else is progressive disclosure.

### The asymmetric flows

OOTB is asymmetric. One person organizes and shares; everyone else imports and
plays.

- **Organizer:** Welcome → choose where you're playing → choose which stations
  (trial-and-error, live map) → Share (link or QR).
- **Player (most users):** tap shared link → import preview → Replace Setup →
  play. Cold opens get a "Join a game" paste path.

Good news from discovery: the **sharing/import machinery already exists**
(`ShareSetupModal` builds link + QR + native share; `ImportScreen` is a
deep-link route with an overwrite-preview confirm; deep links are wired via the
`jetlag-hide-seek-v2` scheme + `applinks:jetlag.hinoka.org`). This epic is
mostly guided UX glue around those, plus a first-run fork and sheet polish.

## Design principles

1. **No dedicated one-time-only screens.** Welcome/fork/commit/join all become
   states on components we already build (main sheet) or that already exist
   (Settings, Play Area, Hiding Zone, `ImportScreen`, `ShareSetupModal`).
2. **The "wizard" is a checklist + nudge**, not a stepper engine. Settings
   doubles as the setup hub; per-row status + an activating Share CTA provide
   the guided feel. (See `02-setup-checklist-and-nudge.md`.)
3. **Sheets rest at the 42% snap.** Most operations are doable without expanding
   to 88%; 88% is reserved for deep browse (global search, browse-all).
   (See `04-compact-sheet-system.md`.)
4. **The map carries geometry; the sheet is a thin control surface.** Because
   the sheet sits at 42%, the live-shading map stays visible behind it.
5. **Invest in the real sheets, not duplicates.** Sheet improvements benefit
   normal Settings use, not just OOTB.

## Decisions log

| Decision | Choice |
|---|---|
| First-run heaviness | Baseline polish + lightweight setup (checklist/nudge), **clean start, no demo game** |
| Wizard form | Reuse existing sheets; checklist + completion nudge; zero dedicated wizard screens |
| Presets in setup | Downloadable curated **rule-pack** catalog (mirrors offline packs). **UI stub only this epic** — model designed in docs, not wired |
| Rule-pack ↔ data-pack | **Hard dependency** (applying a rule pack requires its region data pack) — documented for when rule packs are implemented |
| Join method (v1) | **Paste link only** — no in-app QR scanner; in-person QR relies on the phone camera + universal link |
| Settings layout | Reordered around the setup CUJ: "Set up your game" group first, Share as culminating row |
| Hiding-zone granularity | Add **operator → line drill-down** with per-operator route selection |
| Setup completion | **Play Area confirmed + ≥1 hiding-zone preset** (default Tokyo still needs an explicit confirm) |
| Question-sheet compaction | **Later phase in this epic** (after setup-critical sheets) |
| Visual accent | **Teal `#1f6f78`** — primary buttons **and selected segments fill teal** (one accent); navy `#111827` only for the Seeker/Hider mode chip |
| Main HUD actions | "+ Add Question" spans **full width** — no Re-share button beside it |
| Radius control | Removed from the Hiding Zones body; lives behind a "…" header menu (number input + m/km/mi unit toggle) |
| Thermometer detail | Mock is wrong — **adapt the current app's layout** into the compact pattern |

## Visual design system

The visual spec comes from the Claude Design handoff bundle, persisted under
`design-reference/` (the design URL is ephemeral). Read
`design-reference/README.md` for the per-element adopt/change/ignore list and
`design-reference/design-system-guide.md` for the foundations (voice, color,
type, spacing, **bottom-sheet anatomy + 42% rule**, and the question-sheet
table). Component vocabulary to mirror: `SheetHeader`, `AnswerSelector`
(3-segment, type-aware polarity), `ChipGroup` (scrolling distance presets),
`QuestionMeta` (cost · time), `ListRow`, `BottomSheet` (sticky footer slot),
`MapControlButton`, `Fab`. `src/theme/colors.ts` must gain a teal selected-fill
treatment (reconcile in Phase 4).

## Phases & task list

Phases are ordered so each lands independently. Part 1 is the fastest visible
win and the surface the nudge/fork hang off of.

- [ ] **P0 — Assessment fixes (DONE, landed on branch)**
  - [x] Remove `[detailTap]` debug `console.log`s in matching candidate paths
  - [x] Fix offline `update-available` snapshot label (installed → available)
- [ ] **Phase 1 — Main sheet & first-run state** — `01-main-sheet-and-first-run.md`
  - [ ] Main-sheet identity (render the unused header/title styles)
  - [ ] Live game-summary HUD (area · questions · stations)
  - [ ] First-run state: welcome copy + **Set up / Join** fork
  - [ ] Quick "Add Question" + "Re-share" actions; mode chip
  - [ ] Real empty-questions state (wire up unused `emptyCard` styles)
  - [ ] Long-press pin hint; map-control accessibility labels
- [ ] **Phase 2 — Setup checklist & nudge** — `02-setup-checklist-and-nudge.md`
  - [ ] `setupMode` + completion state (Play Area confirmed + ≥1 preset)
  - [ ] Settings reorder: "Set up your game" group + Share as culminating row
  - [ ] Per-row ✓/status; activating Share CTA
  - [ ] Accent dot + progress nudge; self-clearing; never on imported games
- [ ] **Phase 3 — Join & Share glue** — `03-join-and-share.md`
  - [ ] Paste-link "Join a game" on `ImportScreen` empty state
  - [ ] Setup summary line in `ShareSetupModal`
- [ ] **Phase 4 — Compact sheet system** — `04-compact-sheet-system.md`
  - [ ] Sticky-footer slot in `ChildSheetShell`; condensed row + chip styles
  - [ ] 42%-resting / 88%-deep-browse snap behavior
- [ ] **Phase 5 — Play Area sheet** — `05-play-area-sheet.md`
  - [ ] Rule-pack preset picker (stub) + use-my-location + search/no-results
  - [ ] Collapse OSM relation-ID into Advanced; sticky Continue
- [ ] **Phase 6 — Hiding Zone sheet** — `06-hiding-zone-sheet.md`
  - [ ] Compact layout; suggested-operators hero; surface browse-all
  - [ ] **Operator → line drill-down** + per-operator route selection state
- [ ] **Phase 7 — Rule packs (design only)** — `07-rule-packs-design.md`
  - [ ] Document catalog/installed/payload model + hard data-pack dependency
  - [ ] (No pipeline/client wiring this epic — picker is a stub)
- [ ] **Phase 8 — Question-sheet compaction (later)** — `08-question-sheets-compaction.md`
  - [ ] Apply the compact system to question detail screens; tidy nested modals

## Risks & open items

- **Eligibility-progress HUD perf:** counting "stations still possible" is
  point-in-polygon over all stations vs. the combined mask each turn. Treated as
  a marquee follow-up in Phase 1, gated on a perf check — not always-on until
  validated.
- **Selection-state migration:** per-operator route selection grows the hiding
  zone state and the share/wire schema. Pre-launch the schema is free to break
  (no migration shims required), but update `sharing/wire/schema.ts` and the
  Zod app-state schema together.
- **Native rebuild:** none expected — v1 deliberately avoids `expo-camera`
  (no in-app QR scanner). Revisit only if in-app scanning is later prioritized.

## Testing expectations

Per `AGENTS.md`: run `pnpm typecheck` + `pnpm test` for code changes, and
`pnpm check` for UI/state/config changes. For bottom-sheet / accessibility /
app-start changes, run the Maestro stack (or the GitHub Actions workflow) as the
final check. Keep happy-path tests off the live Photon/Overpass networks.

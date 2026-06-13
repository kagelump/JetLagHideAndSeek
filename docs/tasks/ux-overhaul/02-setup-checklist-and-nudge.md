# Phase 2 — Setup checklist & completion nudge

Parent: `epic.md`. Depends on Phase 1 (first-run state lives on the main sheet).

## Goal

Provide the guided "set up your game" experience as a **checklist + low-grade
completion nudge** that reuses the Settings sheet — no stepper engine, no
progress-dot footer, no dedicated wizard screens.

This is the well-known "finish setting up" pattern (iOS Apple-ID banner,
Slack/Notion onboarding checklists, game "complete your profile" badges): a
persistent, non-modal nudge that points at the next required step and
**vanishes for good once everything is done.**

## Model

A thin `setupMode` is derived/persisted state, not a flow controller.

### Completion criteria (when the nudge clears)

**Play Area confirmed + ≥1 hiding-zone preset selected.**

- Play Area defaults to Tokyo, so it is "set" but **not confirmed**. Setup
  requires an explicit confirm tap so newcomers don't unknowingly play in Tokyo.
  Track a `playAreaConfirmedAt` (or equivalent) flag.
- ≥1 hiding-zone preset is the real gating step (no presets ⇒ no eligible
  stations ⇒ no game). Derive from `selectedPresetIds.length > 0`.
- Questions are an in-play action, **not** part of setup.
- Persist `onboardingCompletedAt` once both are satisfied (or when the user
  explicitly dismisses). Add the field to `appState.ts` (additive; schema free
  to break pre-launch) and `persistence.ts`.

### Never nudge when

- The game was **imported** (shared link / `ImportScreen` apply) — it's already
  set up by definition.
- `onboardingCompletedAt` is set.

## Settings as the setup hub (reorder)

`SettingsScreen.tsx` currently opens with a detached top-right **Share** button,
then Play Area / Hiding Zones / Offline Data, then Mode / Display / Maintenance.
Reorder so the sheet **reads top-to-bottom as the setup flow**:

1. **"Set up your game"** group, in dependency order:
   - **Play Area** — carries ✓ / "set this up" status in `setupMode`.
   - **Hiding Zones** — carries ✓ / status.
   - **Share** — moved out of the floating corner to be the **culminating row**;
     **activates** (enabled/emphasized) once the checklist completes.
2. **Supporting:** Offline Data.
3. **Secondary/admin:** Mode, Display, Admin Divisions, Maintenance, attribution.

Outside `setupMode`, this is simply a better-grouped Settings screen — no
separate mode UI required beyond the per-row status indicators.

## The nudge (style & placement)

- **Style:** an **accent-colored dot + a progress count** (e.g. `Setup · 1 of
  2`), *not* an alarm-red badge. Red reads as error/unread; a soft progress chip
  reads as "almost there." Reserve red for real problems.
- **Placement:** on the main-sheet "Set up a game" affordance (Phase 1) and
  mirrored as per-row status inside Settings. Both are derived from the same
  completion state — no new components beyond a small badge/dot.
- **Behavior:** shown only while incomplete; cleared permanently on completion.

## Files likely touched

- `src/features/sheet/SettingsScreen.tsx` (reorder, per-row status, Share row)
- `src/features/sheet/MainDrawer.tsx` (nudge on the setup affordance)
- `src/state/appState.ts`, `src/state/persistence.ts` (`onboardingCompletedAt`,
  `playAreaConfirmedAt`)
- A small `useSetupStatus()` selector deriving completion from play-area +
  hiding-zone state

## Acceptance criteria

- New game: nudge visible; Share row inactive until both steps done.
- Confirming a play area + selecting a preset clears the nudge and activates
  Share; it stays cleared across restarts.
- Imported games never show the nudge.
- Tests: completion-state unit tests (each step toggling), Settings render order,
  nudge visibility matrix (new vs imported vs complete). `pnpm test` + `pnpm
  check`.

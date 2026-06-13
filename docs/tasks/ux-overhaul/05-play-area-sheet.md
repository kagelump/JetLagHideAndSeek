# Phase 5 — Play Area sheet

Parent: `epic.md`. Applies the Phase 4 compact system. Reused as the first step
of the setup checklist (Phase 2).

## Goal

Make Play Area selection friendly and compact for first-run while keeping
power-user capability. Resting at 42%.

## Current state (`PlayAreaScreen.tsx`)

- City search (Photon, ~350ms debounce) with loading + error states, but **no
  "no results" message** — an empty result looks identical to still-loading.
- A power-user **direct OSM relation-ID input** sits prominently in the flow.
- A current-selection card.
- Resolution order (per `AGENTS.md`): bundled Tokyo/Osaka → caches → installed
  packs → Overpass.

Layout follows the `PlayAreaSheet` mock (`design-reference/screens.mock.jsx`):
search field → **"Bundled areas"** section (Tokyo "In use" badge, Osaka) →
**Advanced** disclosure hiding the OSM relation-ID. The "rule-pack preset
picker" below is the stub form of "Bundled areas."

## Scope (top-to-bottom, 42%-resting)

1. **Sticky summary header:** current area ("Tokyo 23 Wards").
2. **Rule-pack preset picker (stub):** friendly prompt "Where are you playing?"
   + a chip/short-list of presets. **Stub this epic** — list the bundled cities
   (Tokyo, Osaka) as built-in entries; the downloadable catalog is design-only
   (see `07-rule-packs-design.md`). Architect the picker so a real catalog can
   populate it later without layout churn.
3. **Use my location (center):** centers/suggests from the device fix. v1 may
   simply center the map / bias search; full reverse-geocode-to-relation is a
   fast-follow (don't block first impression on a flaky reverse lookup).
4. **Search:** Photon city search; **add the missing "No matches found" state.**
   Results replace the list inline (short).
5. **Advanced (collapsed):** move the **direct OSM relation-ID input** into a
   collapsed "Advanced" disclosure — intimidating and irrelevant first-run, but
   retained for power users.
6. **Sticky footer:** in `setupMode`, a **Continue** action; otherwise the
   normal apply/confirm. Confirming sets `playAreaConfirmedAt` (Phase 2
   completion criteria).

Only search (keyboard) and Advanced should ever need 88%.

## Files likely touched

- `src/features/playArea/PlayAreaScreen.tsx`
- `src/features/playArea/` Photon search mapping (no-results state)
- `src/state/playAreaStore.ts` / `appState.ts` (`playAreaConfirmedAt`)
- Phase 4 shared row/chip/sticky-footer components

## Acceptance criteria

- A zero-result search shows an explicit "No matches found."
- The relation-ID input is present but tucked under Advanced.
- Common selection (preset tap / search-and-pick / use-my-location) completes at
  42%.
- Confirming a play area marks the play-area step complete (Phase 2).
- Tests: no-results state; preset/search/relation paths off the live network
  (mock Photon/Overpass); confirm-sets-flag. `pnpm test` + `pnpm check`.

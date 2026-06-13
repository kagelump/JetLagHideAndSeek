# Phase 3 — Join & Share glue

Parent: `epic.md`. Small, high-value, almost entirely reuse.

## Goal

Close the two gaps in the otherwise-complete share/import machinery: a cold-open
**Join a game** path (no tapped link in hand) and a **setup summary** at the
moment of sharing.

## What already exists (do not rebuild)

- **Share (organizer):** `ShareSetupModal` builds the app-state envelope, renders
  a **QR code** (`QRCodeView`), and fires the native `Share` sheet (link via any
  chat app). Reachable today as the Settings "Share" button (Phase 2 moves it
  into the setup group as the culminating row).
- **Import (player):** `ImportScreen` is a deep-link route reading the `d` param.
  It parses the payload, shows a **preview card** ("Review this shared setup
  before replacing your current starting state"), and offers **Replace Setup /
  Cancel**. It already handles invalid/missing payloads ("Invalid Share Link").
- **Deep links:** custom scheme `jetlag-hide-seek-v2` + universal links
  `applinks:jetlag.hinoka.org`. A tapped link (or a QR scanned by the other
  phone's camera app) opens straight to the import preview.

## Scope

### Join-a-game (paste link) — v1, no scanner
Most players just tap a link and bypass everything. The gap is the **cold open**:
someone opens the app first, or wants to paste a link from chat.

- Extend the **`ImportScreen` empty/no-payload state** to accept a **pasted
  link** (a text field + "Import" action) that runs the same
  `parseImportPayload` → preview → Replace Setup path. No new screen.
- Entry point: the main-sheet **Join a game** button (Phase 1) routes here.
- **No in-app QR scanner in v1** (deliberately avoids an `expo-camera` native
  dep + dev-client rebuild). In-person QR works via the recipient's phone camera
  opening the universal link. Revisit scanning only if in-person play becomes a
  priority.

### Setup summary at Share
Add a compact summary line to the top of `ShareSetupModal`:
`{playArea.label} · {N} lines/presets · {N} stations`. This makes Share double as
the "commit" moment — no separate Commit screen is needed.

## Files likely touched

- `src/sharing/import/ImportScreen.tsx` (paste field on empty state)
- `src/sharing/export/ShareSetupModal.tsx` (summary line)
- `src/features/sheet/MainDrawer.tsx` (Join a game entry → import route)
- Reuse `src/sharing/links/parseLink.ts`, `applyImport.ts`, `preview.ts`

## Acceptance criteria

- Pasting a valid link into Join a game shows the existing preview and replaces
  setup on confirm; invalid links show the existing error copy.
- A tapped deep link still goes straight to the preview (unchanged).
- Share shows an accurate setup summary before sending.
- Tests: paste → parse → preview path (valid + invalid), reusing existing
  `ImportScreen` tests; summary-line rendering. `pnpm test`.

# T10 — Coverage UX: status selector, badge, prompt, updates

## Context

The last mile: the app should _tell_ the player when their play area isn't
covered offline, offer the right pack, and surface updates — instead of
silently falling back to flaky Overpass. This resolves the buglist items
"automatic find and download offline data pack for the play area (or loudly
error)" and the permanent red (!) settings badge.

Read first: design.md → "Coverage UX", `SettingsScreen.tsx` +
`MainDrawer.tsx` (where badges can render), T5's catalog/installed-index
APIs, and the play-area store (`playAreaStore.tsx`) for where play-area
changes are observable.

## What to build

### 1. Coverage selector — `src/features/offline/coverage.ts` (new)

Pure function + hook:

```ts
type CoverageStatus =
    | { state: "covered"; packId: string; updateAvailable: boolean }
    | { state: "partial"; packId: string; missingKinds: ArtifactKind[] } // incomplete install
    | { state: "available"; pack: CatalogPack } // catalog has it, not installed
    | { state: "uncovered" } // no catalog pack intersects
    | { state: "unknown" }; // catalog never fetched, nothing installed

export function getCoverageStatus(
    playAreaBbox: Bbox,
    catalog: PackCatalog | undefined,
    installed: InstalledPack[],
): CoverageStatus;
```

Rules: bundled Japan regions count as covered (use the bundled region
bboxes from `bundledPois.ts` — Japan must never show the badge); bbox
intersection decides candidacy; `updateAvailable` = catalog `osmSnapshot`
newer than installed. Keep it a pure function — all I/O stays in the hook
(`useCoverageStatus()` composes the play-area store, catalog query, and
installed index query).

The function returns exactly **one** status (it drives one badge and one
prompt), so multi-pack overlap needs a deterministic pick:

1. Any _installed_ intersecting pack ⇒ the result is `covered`/`partial`
   for one of them — available-but-not-installed packs are ignored
   entirely (no prompt while something installed already covers you).
2. Among several installed candidates, pick the smallest bbox area. Yes,
   that prefers a city pack over a country pack even when the play area
   leans country-sized — that's intended: smaller = more specific, and
   both are installed anyway so the only thing at stake is whose
   `updateAvailable` flag is shown.
3. No installed candidate but catalog candidates exist ⇒ `available` with
   the smallest-area catalog pack (the most tailored download to offer).

The Offline Data screen is unaffected by this pick — it always lists every
pack.

### 2. Badge + prompt

- **Settings badge**: red (!) on the Settings row in `MainDrawer` and on the
  Offline Data row inside Settings when state is `uncovered`, `available`,
  or `partial`. Persistent — it reflects current state, not a dismissible
  notification. Accessibility label spells it out ("Offline data missing
  for current play area").
- **Prompt on play-area change**: when the play area changes and the state
  is `available`, show a one-time-per-(playArea, packId) inline banner on
  the play-area screen / sheet (not a modal): "Download Netherlands pack
  (28 MB) for offline play?" → installs via T5 with its progress UI.
  Persist the dismissed set in AsyncStorage (small map, prune to last 20).
- **`uncovered`**: banner says offline data isn't available for this area
  and gameplay needs network (link to Offline Data screen). No nagging
  re-prompt — it renders as state on the screens, same as the badge.

### 3. Update flow

In `OfflineDataScreen` (extends T5's "update available" state): an
"Update" action per pack = `installPack` over the new catalog entry
(artifact-by-artifact replace; per-kind unregister/re-register — T5's
install already does registration, just make sure replace unregisters
first), keeping the old files until each new artifact verifies (the
existing tmp-gz → verify → write flow already guarantees this per
artifact). A "Check for updates" affordance refetches the catalog ignoring
staleTime.

### 4. Wire the buglist

Mark the two resolved items in `docs/buglist1.md` (offline pack
auto-discovery + badge) with a pointer to this epic.

## How to test

Jest:

- `getCoverageStatus` table-driven: every state reachable; Japan bundled
  bbox → covered with no catalog; multi-pack overlap prefers installed then
  smallest; snapshot comparison drives `updateAvailable`.
- Badge rendering: drawer + settings rows show/hide per mocked status
  (follow the existing screen-test patterns; stable testIDs for Maestro).
- Prompt: appears once for (playArea, pack), not after dismissal, again for
  a different play area; install tap routes into the T5 mutation (mock).
- Update: replace flow unregisters old then registers new (spies), files
  swapped only after verification (reuse T5's failure-injection fixtures —
  a failed update leaves the old pack working).

Manual (M3 exit criterion): device with NL installed — move play area to
Berlin: badge appears, banner offers the Germany pack (add `europe-germany`
to `regions.yaml` and publish it, or use a second small published region);
republish NL with a new tag → "Check for updates" shows and applies the
update.

## Out of scope

- Auto-downloading without user consent, background downloads, push-style
  update notifications.

## Done when

- Badge/prompt/update behaviors all demonstrated on device per the M3 exit
  criterion; coverage selector fully unit-tested.
- Buglist updated.
- `pnpm test` + `pnpm check` green.

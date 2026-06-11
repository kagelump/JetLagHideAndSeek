# T5 — App: multi-artifact pack install + Offline Data screen v2

## Context

`regionPacks.ts` installs exactly one artifact kind (POI `RawRegion`) from a
v1 manifest, storing files under `Document/poi/`. The v2 catalog (T4) groups
several artifacts per pack. This task upgrades the app to install/remove
whole packs, registers each artifact kind with its loader, and rebuilds the
Offline Data screen around the catalog. It finishes M1: the pilot region
becomes installable on a phone.

No users → no migration: the v1 manifest types, the `Document/poi/` layout,
and the old installed index can be deleted outright. Old `Document/poi/`
files on a dev device are abandoned in place — **do not write cleanup
code** for them; wipe-and-reinstall the app if the space bothers you.

Read first: `regionPacks.ts` end to end (the download/verify mechanics are
all reusable), `OfflineDataScreen.tsx`, T3's `registerMeasuringSource`,
and design.md → "App-side changes".

## What to build

### 1. Catalog types + fetch — `src/features/offline/packCatalog.ts` (new)

Move/replace the v1 `PackManifest` types with the v2 catalog schema from T4
(Zod-validate the fetch result — follow the schema style in
`src/state/appState.ts`). `usePackCatalog()` replaces `usePackManifest()`;
`MANIFEST_URL` moves to `src/config/appConfig.ts` as `OFFLINE.catalogUrl`.
The URL is deterministic even before the one-time Pages setup in T4 has
happened: `https://<github-user>.github.io/JetLagHideAndSeek/catalog.json`
— hardcode it, don't block on T4's manual step.

A new `src/features/offline/` feature folder is the home for pack/catalog
code from here on; `regionPacks.ts` moves into it (update imports — keep
the git history with `git mv`).

### 2. Install/remove a pack (N artifacts)

Storage layout: `Document/packs/<packId>/<kind>[-<category>].json`
(uncompressed, same as today's post-install convention). Installed index v2
(AsyncStorage, new key — delete the old `installed-poi-packs` key):

```ts
type InstalledPack = {
    id: string;
    osmSnapshot: string;
    installedAt: string;
    artifacts: {
        kind: ArtifactKind;
        category?: string;
        bytes: number;
        status: "installed" | "failed";
    }[];
};
```

`installPack(pack: CatalogPack)`:

- Sequential loop over `pack.artifacts` (skip `meta` last? no — install
  `meta` first; later steps may want `adminLevels`).
- Per artifact, reuse the existing flow verbatim: download `.gz` → verify
  bytes + md5 → gunzip with the bomb guard → verify sha256 → payload
  `schemaVersion` guard → write plain `.json` → delete `.gz`.
- Per-kind registration after write:
    - `poi` → `registerRegion(packId, raw)` (unchanged behavior).
    - `measuring` → `registerMeasuringSource(packId, category, path)` (T3).
    - `boundaries` / `transit` → no-op for now; T7/T9 fill these in. Leave a
      `switch` with TODO-referencing-task comments.
- A failed artifact marks that artifact `failed` and continues; the pack
  ends up "incomplete". `retryPack(id)` re-downloads only non-installed
  artifacts.
- Progress callback `(done, total, currentKind)` for the UI.

`removePack(id)`: unregister per kind (`unregisterRegion`,
`unregisterMeasuringSources`), delete `Document/packs/<packId>/`
recursively, drop the index entry.

`loadInstalledPacks()` on startup: read index; for each installed pack,
register `poi` (parse the file — small) and `measuring` (register the file
_path only_ — no parsing; that's the lazy contract from T3). Keep the
existing resilience: a broken pack logs + skips, others still load.

### 3. Offline Data screen v2

Rebuild `OfflineDataScreen.tsx` on the catalog:

- Sections from `regionPath[0]` (continent), rows per pack: label, total
  size, state — not installed / downloading (n/m + kind) / installed
  (snapshot date) / incomplete (retry affordance) / update available
  (catalog `osmSnapshot` ≠ installed).
- Actions: install, retry, remove (destructive confirm — modal, per sheet
  rules), "check for updates" = refetch catalog (respect the existing
  staleTime config).
- Catalog fetch failure with installed packs present: show installed state
  plus a stale-catalog banner (design.md → "Failure modes").
- Keep `SheetScrollView`, follow accessibility/E2E selector guidance in
  AGENTS.md (stable `testID`s on rows + primary buttons).

## How to test

Jest (extend the existing `regionPacks`/`OfflineDataScreen` suites rather
than starting over; mock fetch + expo-file-system via `jest.setup.ts`):

- Catalog Zod parse: valid v2 fixture passes; v1-shaped manifest fails
  loudly.
- `installPack`: all-success path registers poi + measuring and writes the
  index; one-artifact-failure path yields `incomplete` and `retryPack`
  downloads only the failed one; hash mismatch on any artifact never leaves
  a partial file behind.
- `removePack` unregisters and clears.
- Startup `loadInstalledPacks`: poi parsed, measuring registered by path
  without reading the file (assert no `.text()` call on the measuring mock).
- Screen: render states for each pack status from a fixture catalog.

Manual / E2E:

- Dev build on simulator: install the published NL pack from the real
  catalog, then with Wi-Fi off run a matching question and a coastline
  measuring question with a Netherlands play area (set the play area while
  online — offline setup is T7). This is the **M1 exit criterion**.
- Add a Maestro flow for the install happy path if the existing Offline
  Data flow has one; otherwise note it in the PR as follow-up.

## Out of scope

- Boundaries/transit artifact consumption (T7/T9), coverage badges and
  download prompts (T10), background/parallel downloads.

## Done when

- M1 exit criterion above passes on a device/simulator.
- Old v1 manifest path and `Document/poi/` layout are gone.
- `pnpm test` + `pnpm check` green.

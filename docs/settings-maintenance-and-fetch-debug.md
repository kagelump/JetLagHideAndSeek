# Design: Settings maintenance actions + question fetch-debug line

Status: proposed · Date: 2026-06-03

Two related developer/UX features:

1. **Settings → maintenance actions**: a user-facing **Reset Game** button (for
   starting a fresh game when the current one ends) and a developer-facing
   **Clear Cache** button (to drop fetched/derived data without uninstalling).
2. **Question fetch-debug line**: small gray text at the bottom of any question
   sheet that fetches data, e.g. `fetched 4 items from overpass (3.0s)` or
   `fetched 9 items from local bundle`, designed so a _new_ question-sheet type
   can't easily ship without it.

---

## 1. Background — storage & sheet architecture

### 1.1 Persisted AsyncStorage surface

| Namespace            | Keys                                                                                                                                                              | Owner                                                                         | Clear API today                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| Game state           | `app-state:metadata:v1`, `app-state:play-area:v1`, `app-state:hiding-zones:v1`, `app-state:question-settings:v1`, `app-state:questions:v1`, legacy `app-state:v1` | [persistence.ts](../src/state/persistence.ts)                                 | ✅ `clearPersistedAppState()`                        |
| OSM matching cache   | `osm-matching-cache:*` (radius + `…:cell:*`), `osm-matching-manifest`, `osm-matching-manifest:cell`                                                               | [osmMatchingCache.ts](../src/features/questions/matching/osmMatchingCache.ts) | ⚠️ memory only — **no disk clear exists**            |
| React-Query cache    | `REACT_QUERY_OFFLINE_CACHE` (play-area boundaries + `osm-matching` queries)                                                                                       | [queryClient.ts](../src/state/queryClient.ts)                                 | partial (`queryClient.clear()` clears memory)        |
| Play-area boundaries | `play-area-boundary:*` direct backstops                                                                                                                           | [playAreaBoundary.ts](../src/features/map/playAreaBoundary.ts)                | per-key `cleanOrphanedBoundaryKeys()`                |
| Offline region packs | filesystem (expo-file-system), **not** AsyncStorage                                                                                                               | [regionPacks.ts](../src/features/questions/matching/regionPacks.ts)           | per-pack `useRemovePack()` / `removeInstalledPack()` |

Game state is written by a debounced effect in
[AppStateProviders.tsx:195](../src/state/AppStateProviders.tsx) that reads the
three stores and calls `createAppStateV1(...)`. Resetting the in-memory stores
therefore _also_ rewrites disk on the next debounce — but reset should clear disk
explicitly too, to avoid a race where the app is killed before the debounce
fires.

### 1.2 Stores (React Context + `useState`, not Zustand)

- [questionStore.tsx](../src/state/questionStore.tsx) — `importQuestions`,
  `importQuestionSettings`, `setActiveQuestionId`, `setPinLocked`.
- [hidingZoneStore.tsx](../src/state/hidingZoneStore.tsx) — `replaceSetup`.
- [playAreaStore.tsx](../src/state/playAreaStore.tsx) — `importPlayArea`,
  initial `defaultPlayArea`.

[applyImport.ts](../src/sharing/import/applyImport.ts) already composes these
three setters to apply a whole game setup atomically. **Reset is the same
operation with default values** — we reuse this seam rather than inventing a new
one.

### 1.3 Question sheet dispatcher

[QuestionDetailScreen.tsx](../src/features/questions/QuestionDetailScreen.tsx)
is the single dispatcher. It wraps every concrete screen in one
`SheetScrollView`:

```tsx
<SheetScrollView ...>
  {type === "radar" ? <RadarQuestionDetailScreen .../>
   : transit-line  ? <TransitLineQuestionDetailScreen .../>
   : matching       ? <OsmMatchingQuestionDetailScreen .../>
   : <NotImplemented/>}
</SheetScrollView>
```

Today only the matching screen fetches data:
`searchMatchingFeaturesProgressive` → `findMatchingFeaturesWithCellCache` →
`resolveBboxFeatures` (`source: "local" | "overpass"`). Radar does no fetch;
transit-line derives from already-loaded hiding-zone presets. **The dispatcher
wrapping every screen is the seam that makes the debug line enforceable** (§2.3).

---

## 2. Feature 2 — question fetch-debug line

(Designed first because its data model also informs the cache work in Feature 1.)

### 2.1 What it shows

Small gray text pinned at the bottom of the question sheet:

| Situation         | Text                                     |
| ----------------- | ---------------------------------------- |
| Network only      | `fetched 4 items from overpass (3.0s)`   |
| Bundle only       | `fetched 9 items from local bundle`      |
| Served from cache | `9 items from cache`                     |
| Mixed cells       | `9 from bundle · 4 from overpass (3.0s)` |
| In flight         | `searching…`                             |
| No fetch (radar)  | _(line absent)_                          |

Rules: count = features returned to the UI; duration shown only when a network
round-trip happened; `local bundle`/`cache` need no timing.

### 2.2 The "hard to forget" problem

We want: _if a future question sheet fetches from Overpass or the bundle, the
line appears — even if the author never thinks about it._ Three enforcement
levers, increasing strength:

- **A. Convention** — export `useReportFetchDebug(info)`, ask screens to call it.
  Rejected: trivially forgettable; exactly the failure mode to avoid.
- **B. Instrument the data seam + render centrally** _(recommended core)_ — the
  only sanctioned way to fetch features records debug events automatically, and
  the **dispatcher** (not the screen) renders the line. An author gets the line
  for free; _omitting_ it requires bypassing the standard fetch layer.
- **C. Type-enforced registry** _(optional reinforcement)_ — screens are
  registry entries whose type _requires_ a fetch-debug provider, so a missing
  one fails `tsc`.

Recommendation: **B as the backbone, plus a lint guard and a dev-only
diagnostic.** Add C later if we want a compile-time guarantee.

### 2.3 Recommended design

**(1) Centralized rendering.** The footer lives in the dispatcher, so screens
never render it themselves:

```tsx
// QuestionDetailScreen.tsx
<FetchDebugScope questionId={activeQuestion.id}>
  <SheetScrollView ...>
    {/* concrete screen */}
    <QuestionFetchDebugLine />   {/* reads context; renders null when empty */}
  </SheetScrollView>
</FetchDebugScope>
```

`QuestionFetchDebugLine` renders `null` when no fetch was recorded — so radar
shows nothing, automatically and correctly.

**(2) Instrument the seam.** A `FetchDebugRecorder` carried in context, written
by the shared search hook every screen already (and should) use:

```ts
export type FetchOrigin = "overpass" | "local-bundle" | "memory" | "disk";

export type FetchDebugInfo = {
    totalCount: number;
    origins: Partial<Record<FetchOrigin, number>>; // per-origin item counts
    durationMs: number; // wall-clock of the resolve
    networkMs?: number; // present iff any overpass round-trip
    status: "loading" | "done" | "error";
    at: number;
};
```

`resolveBboxFeatures` already returns `source: "local" | "overpass"` per cell;
[findMatchingFeaturesWithCellCache](../src/features/questions/matching/osmMatchingCache.ts:833)
already tracks `memory | disk | stale | network` per cell. We thread a
per-origin tally out of the cell loop, surface it from
`searchMatchingFeaturesProgressive` as `{ candidates, source, debug }`, and have
the shared hook drop `debug` into the recorder. Because the hook is the only
blessed fetch path, **any future screen that fetches through it lights up the
line without writing UI.**

**(3) Make bypass hard.**

- A shared hook, e.g. `useFeatureFetch()` / `useMatchingSearch()`, is the public
  fetch API; it owns abort + debounce + debug recording. Today's matching screen
  inlines this in `performSearch`
  ([OsmMatchingQuestionDetailScreen.tsx:53](../src/features/questions/matching/OsmMatchingQuestionDetailScreen.tsx)) —
  extract it so the pattern is reusable.
- ESLint `no-restricted-imports` blocks screens from importing the low-level
  fetchers (`fetchAndParseOverpass*`, `resolveBboxFeatures`) directly — they
  must go through the hook. "Forgot the debug line" becomes a lint error.
- `__DEV__` diagnostic: if a screen mounts and calls a raw fetcher outside an
  open `FetchDebugScope`, render a magenta `⚠ fetch not instrumented` line so
  the omission is impossible to miss while developing.

### 2.4 Plumbing changes

| File                                  | Change                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `matching/fetchDebug.ts` _(new)_      | `FetchDebugInfo`, `FetchDebugContext`, `FetchDebugScope`, `useFetchDebug`, `useReportFetchDebug`, `formatFetchDebug(info): string`. |
| `featureSource.ts`                    | `resolveBboxFeatures` already returns `source`; optionally add `fetchMs` for network calls.                                         |
| `osmMatchingCache.ts`                 | `findMatchingFeaturesWithCellCache` returns per-origin `origins` tally + `durationMs` alongside `source`.                           |
| `progressiveSearch.ts`                | bubble `debug: FetchDebugInfo` up through `ProgressiveSearchResult`.                                                                |
| `useMatchingSearch.ts` _(new)_        | extracted hook; records `debug` into context; owns abort/debounce.                                                                  |
| `QuestionDetailScreen.tsx`            | wrap children in `FetchDebugScope`; render `<QuestionFetchDebugLine/>`.                                                             |
| `OsmMatchingQuestionDetailScreen.tsx` | consume `useMatchingSearch`; drop the inline `cacheSource` plumbing.                                                                |
| `.eslintrc`                           | `no-restricted-imports` for raw fetchers in `**/questions/**/*DetailScreen.tsx`.                                                    |

### 2.5 Visibility

Always render in `__DEV__`. In production, gate behind a “Developer mode” flag
(see §3.5) — it's tiny gray text, but it references internal sources, so
defaulting it off in release builds is safer. **Open question §5.**

---

## 3. Feature 1 — Reset Game + Clear Cache

### 3.1 UX

A new **Maintenance** section at the bottom of
[SettingsScreen.tsx](../src/features/sheet/SettingsScreen.tsx), below
Data & Attribution, using the existing `SheetListRow` + a destructive style
borrowed from the question-actions `ActionSheetButton`:

- **Reset Game** (always visible, destructive, confirm dialog) —
  "Start a new game? This clears all questions and resets your play area and
  hiding zones."
- **Clear Cache** (dev-mode only, confirm dialog) —
  "Clear cached map/POI data? Downloaded offline packs are kept."

Both use RN `Alert.alert` for confirmation. Show a brief toast/inline result
("Game reset", "Cleared 142 cached items").

### 3.2 Reset Game — semantics

Return the app to a fresh-install state:

| Slice                | Reset to                                         | Lever                                                     |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Questions            | `[]` + default settings (no active id, unlocked) | `importQuestions([])`, `importQuestionSettings(defaults)` |
| Hiding zones         | default radius/unit, no selected presets         | `replaceSetup(defaultHidingZoneSetup)`                    |
| Play area            | `defaultPlayArea`                                | `importPlayArea(defaultPlayArea)`                         |
| Persisted game state | removed                                          | `clearPersistedAppState()`                                |
| Matching cache       | cleared (new game ⇒ new area)                    | `clearOsmMatchingCache()` (§3.4)                          |

Offline region packs are **kept** (expensive to re-download; not part of "the
game"). Implement as a coordinator hook `useResetGame()` that calls the three
store setters, then `clearPersistedAppState()`, then the cache clear — mirroring
`applyImport` so the two paths can't drift.

### 3.3 Clear Cache — semantics

Developer affordance to drop derived/fetched data without touching game setup:

- `clearOsmMatchingCache()` — memory **and disk** (§3.4).
- React-Query: `queryClient.clear()` + `AsyncStorage.removeItem("REACT_QUERY_OFFLINE_CACHE")`.
- Boundary backstops: `cleanOrphanedBoundaryKeys()` (and/or prefix sweep).
- **Keep** game state and downloaded offline packs.

Return a count of removed keys for the result toast.

### 3.4 New API: `clearOsmMatchingCache()`

The disk-clear gap is real today: only `clearOsmMatchingMemoryCache()` and
`clearOsmMatchingCellMemoryCache()` exist, and neither removes the AsyncStorage
rows. New export in
[osmMatchingCache.ts](../src/features/questions/matching/osmMatchingCache.ts):

```ts
export async function clearOsmMatchingCache(): Promise<number> {
    clearOsmMatchingMemoryCache();
    await clearOsmMatchingCellMemoryCache();
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter(
        (k) =>
            k.startsWith(CACHE_KEY_PREFIX) ||
            k === MANIFEST_KEY ||
            k === `${MANIFEST_KEY}:cell`,
    );
    await AsyncStorage.multiRemove(ours);
    return ours.length;
}
```

This is also the **manual workaround for the stale-airport bug** (see §4).

### 3.5 Developer mode flag

Clear Cache and production visibility of the debug line both need a "dev mode"
gate. Options: `__DEV__` only (simplest; hides Clear Cache from TestFlight), or a
persisted `developerMode` boolean toggled by tapping a version string N times.
**Recommend `__DEV__`-only for v1**, add the hidden toggle if we need it on
release builds. **Open question §5.**

---

## 4. Relationship to the stale-airport cache bug

Earlier we traced an airport (Tokyo Heliport, OSM way 172627190 — `aeroway=aerodrome`,
no `iata`) that kept matching after the `commercial-airport` selector gained an
`["iata"]` condition. Root cause: the cell cache key
`osm-matching-cache:cell:<category>:<cellId>`
([osmMatchingCache.ts:456](../src/features/questions/matching/osmMatchingCache.ts:456))
encodes **category + cell, not the selector**, and entries live 90 days, so a
result fetched under the old selector is served unchanged.

- **`clearOsmMatchingCache()` (§3.4) is the manual lever** that fixes it now and
  is exactly what Clear Cache invokes.
- **Proper fix (out of scope, cross-linked):** make the cell key selector-aware
  (append a short hash of the category's query tags) or bump
  `CELL_SCHEMA_VERSION` on selector changes, so edits self-invalidate.
- **Watch-out:** `commercial-airport` is `isBundleableCategory` = true but is
  absent from every region pack, so after a cache clear `resolveBboxFeatures`
  returns empty `local` for Tokyo cells _without_ an Overpass fallback — real
  airports vanish too. Track separately; Clear Cache will surface it.

---

## 5. Open questions

1. **Debug line in production** — `__DEV__`-only, or behind a hidden developer
   toggle? (Affects §2.5 and §3.5.)
2. **Reset Game scope** — also clear downloaded offline packs, or keep them?
   (Proposed: keep.)
3. **Reset → navigation** — after reset, route back to the map/onboarding, or
   stay in Settings? (Proposed: pop to map.)
4. **Mixed-source string** — show the per-origin breakdown
   (`9 from bundle · 4 from overpass`) or just the dominant source? (Proposed:
   breakdown in `__DEV__`, dominant in prod.)

---

## 6. Phased task list

1. **Cache disk-clear** — `clearOsmMatchingCache()` + unit test. _(also unblocks
   the airport workaround.)_
2. **Reset/Clear plumbing** — `useResetGame()`, `clearAppCaches()`; default-state
   factories for the three stores.
3. **Settings UI** — Maintenance section, confirm dialogs, dev-mode gate.
4. **Fetch-debug data model** — `fetchDebug.ts`; thread `origins`/`durationMs`
   through cell cache → progressive search.
5. **Shared search hook** — extract `useMatchingSearch`, record debug.
6. **Centralized footer** — `FetchDebugScope` + `QuestionFetchDebugLine` in the
   dispatcher; migrate the matching screen.
7. **Guardrails** — `no-restricted-imports` lint + `__DEV__` "not instrumented"
   diagnostic.

## 7. Testing

- `clearOsmMatchingCache` removes only `osm-matching-*` keys; leaves
  `app-state:*` and `REACT_QUERY_OFFLINE_CACHE` (unless Clear Cache) intact.
- `useResetGame` empties questions, restores `defaultPlayArea`/default hiding
  zones, and clears `app-state:*`.
- `formatFetchDebug` snapshots for each row in §2.1.
- Render test: matching screen shows the line; radar screen does not.
- Guard test: importing a raw fetcher in a `*DetailScreen.tsx` fails lint.

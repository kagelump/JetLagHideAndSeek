# Review 1 — Offline Data Packs epic

Reviewed: the uncommitted working tree on `master` as of 2026-06-12, against
[epic.md](epic.md), [design.md](design.md), and task docs T1–T10.

## Verdict

**All four formal gates are green** — `pnpm typecheck`, `pnpm test` (85 jest
suites / 1036 tests + 124 `node --test` pipeline tests), and `pnpm check` all
pass. **But the epic is not in the state the task docs' "Done when" sections
claim.** The work is roughly: T1/T4/T5 substantially built, T2/T2b/T3/T6
built with significant spec deviations, T7/T8/T9/T10 half-built — app-side
modules exist but the installer never wires them, so they are dead code at
runtime.

More importantly, there is hard evidence that **neither the pipeline nor the
device paths were ever exercised end-to-end**: at least five independent
defects each crash the very first real run of their command (broken import
paths, a missing `import`, an ESM import of a non-exported symbol, a
hashes-layout mismatch between producer and both consumers, and a runtime
file-read API that throws on device). Each is individually trivial to fix;
collectively they mean the M1/M2/M3 exit criteria were not demonstrated, and
`docs/buglist1.md` annotations claiming T8/T10 "resolved" overstate reality.

The unit-test surface is genuinely good — what's missing is the integration
layer the milestone criteria were designed to force.

---

## Critical findings (each blocks a milestone exit criterion)

### C1. All lazy pack file reads throw on device — `expo-file-system` legacy API

`readAsStringAsync` is imported from the `expo-file-system` **main entry** in
three places:

- [lineBundleLoader.ts:293](src/features/questions/measuring/lineBundleLoader.ts) (`readFileText`)
- [boundaryStore.ts:213](src/features/offline/boundaryStore.ts) (`getBoundaryPolygon`)
- [hidingZoneData.ts](src/features/hidingZone/hidingZoneData.ts) (`loadPackTransitBundle`)

In Expo SDK 54 (`expo-file-system@19`), the main entry's `readAsStringAsync`
is a **stub that throws** ("use `expo-file-system/legacy`") — see
`node_modules/expo-file-system/src/legacyWarnings.ts:34`. The new
`jest.setup.ts` mock provides a _working_ `readAsStringAsync`, so every test
passes while every on-device read fails. Net effect: pack measuring bundles,
boundary polygons, and transit bundles can never load in production.
`boundaryStore` and `hidingZoneData` additionally swallow the error
(`catch → null` / `catch → cache []`), so the failure would be silent.

Fix: use the new `File` API (`new File(path).text()` — which
[regionPacks.ts](src/features/offline/regionPacks.ts) already uses correctly)
or import from `expo-file-system/legacy`, and make the Jest mock match the
API the code actually uses. T3's doc explicitly said `File.text()`.

### C2. The installer never registers boundaries, transit, or admin levels — T7/T8/T9/T10 are dead code

[regionPacks.ts:137-148](src/features/offline/regionPacks.ts) and
[regionPacks.ts:542-553](src/features/offline/regionPacks.ts) still contain
the T5 placeholder `// TODO(T7)` / `// TODO(T9)` switch cases. Nothing in the
app ever calls:

- `registerBoundarySource` ([boundaryStore.ts:77](src/features/offline/boundaryStore.ts)) — so offline play-area search ([playAreaSearch.ts](src/features/playArea/playAreaSearch.ts)), pack relation loading ([playAreaBoundary.ts](src/features/map/playAreaBoundary.ts)), and pack admin matching ([adminBoundaryLoader.ts](src/features/questions/matching/adminBoundaryLoader.ts)) can never see data.
- `registerTransitSource` ([hidingZoneData.ts](src/features/hidingZone/hidingZoneData.ts)) — pack transit presets never appear.
- `registerPackAdminLevels` ([adminLevelDefaults.ts](src/features/offline/adminLevelDefaults.ts)) — the whole module is **imported by nothing**.

The T7 install-time split (parse the boundaries artifact once, write
`boundaries-index.json` + `boundaries-polygons.json`, delete the combined
file) is entirely absent. `removePack`'s `unregisterArtifacts` likewise only
unregisters POI + measuring. The consumer-side wiring was built; the producer
side never happened, and no test catches it because no test exercises
install→search→load as one flow.

### C3. `pnpm data:pack` crashes building POIs — broken import path

[build-packs.mjs:95-97](data/packs/scripts/build-packs.mjs):

```js
await import("../../data/geofabrik/scripts/lib/extractPois.mjs");
```

resolves relative to `data/packs/scripts/` →
`data/data/geofabrik/scripts/lib/extractPois.mjs`, which does not exist
(verified by resolution). The first `pnpm data:pack -- --region …` run with a
`poi` artifact enabled dies with `ERR_MODULE_NOT_FOUND`. Should be
`../../../data/geofabrik/...` (as `buildMeasuring.mjs` correctly does).

### C4. `pnpm data:measuring` crashes — `writeFileSync` import dropped in the T2b refactor

[extract-measuring-bundles.mjs:272](data/geofabrik/scripts/extract-measuring-bundles.mjs)
calls `writeFileSync`, but the refactor removed it from the `node:fs` import
(line 4; the pre-refactor file imported it at its line 8). Any run including
an admin category throws `ReferenceError`. This is decisive evidence the T2b
"run `pnpm data:measuring`, confirm clean `git status` under
`assets/measuring/`" verification step was never performed. The committed
assets are unchanged only because the command was never run.

### C5. `hashes.json` layout is incompatible with both of its consumers

[build-packs.mjs:271](data/packs/scripts/build-packs.mjs) writes measuring
hashes **nested**: `{ "measuring": { "measuring-coastline": {…} } }`. But:

- [pack-lint.mjs:70](data/packs/scripts/pack-lint.mjs) iterates top-level
  entries and reads `entry.bytes` → for the `measuring` key it looks for
  `measuring.json.gz` / `measuring-measuring.json.gz` and **fails lint** for
  every pack that has any measuring artifact.
- [build-catalog.mjs:158](data/packs/scripts/build-catalog.mjs)
  (`buildArtifacts`) expects **flat** `measuring-<category>` keys, so the
  nested entry becomes one artifact with `kind: "measuring"`,
  `bytes: undefined` — caught by its own validator → catalog generation
  fails. [publish.mjs:137](data/packs/scripts/publish.mjs) (`collectUploads`)
  has the same flat-key assumption.

The T1 doc warned exactly about this ("These field names are copied verbatim
into the T4 catalog… don't invent variants"). The unit tests pass because
catalog/lint tests construct their own flat fixtures rather than consuming
`build-packs` output. Flatten the producer.

### C6. `publish.mjs` cannot run outside its mocks

Three independent breakers in [publish.mjs](data/packs/scripts/publish.mjs):

1. Line 214: `import("./pack-lint.mjs")` destructures `lintRegion`, but
   [pack-lint.mjs](data/packs/scripts/pack-lint.mjs) **exports nothing** —
   ESM throws `SyntaxError: ... does not provide an export named
'lintRegion'`. Tests pass `skipLint: true`, masking it.
2. `exec()` (line 38) splits the command on whitespace and passes tokens to
   `execFile` — so `gh release upload <tag> "<path>" --clobber` sends a
   literal `"<path>"` (quotes included), and
   `git commit -m "Update packs catalog for X [skip ci]"` shreds the message
   into separate args. Every real `gh`/`git` invocation with quoting fails.
3. The first-publish orphan-branch path (lines 391-414) does `git init`
   inside the repo + `remote add` — that's a **nested repo**, not a worktree;
   the `finally` block's `git worktree remove` can't clean it up. The
   leftover `data/packs/.gh-pages-worktree/` directory (containing NOTICE +
   index.html) sitting in the working tree is the residue — and it is **not
   git-ignored**, so it would be committed with this changeset.

Also: tests wrote `data/packs/dist/catalog.json` with fixture data
(`test-region`, `custom-org`) into the _real_ dist directory — point the test
output at a temp dir.

### C7. The CI catalog guard fails on every trigger

[.github/workflows/packs-catalog.yml](.github/workflows/packs-catalog.yml)
checks out **`gh-pages`** and then imports
`./data/packs/scripts/lib/catalogSchema.mjs` — which doesn't exist on the
orphan branch (it only has `catalog.json`, `NOTICE`, `index.html`). Needs a
second checkout of the default branch (or vendoring the validator).

### C8. Pipeline and app normalizers disagree — CJK/diacritic search will miss

T7 required porting the pipeline normalizer exactly. They differ:

- Pipeline [normalizeNames.mjs:26](data/packs/scripts/lib/normalizeNames.mjs):
  strips only U+0300–U+036F (Combining Diacritical Marks block).
- App [boundaryStore.ts:121](src/features/offline/boundaryStore.ts)
  (`normalizeForSearch`): strips **all** `\p{Mark}`.

Any name whose NFKD form contains marks outside U+0300–U+036F — Japanese
dakuten/handakuten (U+3099/309A, e.g. 飯田橋's ば), Hebrew/Arabic/Thai marks —
is indexed _with_ the mark but queried _without_ it, so exact/prefix matches
fail. This lands squarely on the M2 "non-Latin pilot (Taiwan)" exit
criterion. Pick one rule, define it in one place, and add the cross-format
fixture test T7 demanded (see C10).

### C9. `loadLineBundle` duplicates features on every repeat call

[lineBundleLoader.ts:175-260](src/features/questions/measuring/lineBundleLoader.ts):
when a category has pack sources, `loadLineBundle` skips the cache check,
seeds `merged` from `getLineBundle(category)` — which after the first call
returns the **previously merged** bundle (bundled + pack features) — and then
appends the pack features again. Every call grows the cached bundle by one
copy of each pack file's features.
[MeasuringQuestionDetailScreen.tsx](src/features/questions/measuring/MeasuringQuestionDetailScreen.tsx)
fires `loadLineBundle` on every mount and category change, so this compounds
in normal use (memory + wrong geometry density). It also re-reads and
re-parses the pack files (potentially tens of MB) each time. Fix: return the
cached merge when present and only rebuild after (un)registration
invalidates; merge from the _pristine_ bundled require, never from cache.

### C10. Coverage selector can't work offline, and nothing renders it

[coverage.ts](src/features/offline/coverage.ts):

- An installed pack with no catalog entry is filtered out (line 106
  `if (!catPack) return false`), because `InstalledPackInfo` carries no bbox.
  With the catalog unreachable, an installed-and-covering pack yields
  `unknown`/`uncovered` — directly contradicting design.md's failure mode
  ("catalog unreachable: installed packs are unaffected"). Persist the bbox
  in the installed index at install time.
- The Japan bboxes are hardcoded duplicates (lines 48-57); T10 said to use
  the bundled region bboxes from `bundledPois.ts`. These will drift.
- The promised `useCoverageStatus()` hook, the Settings/MainDrawer badge, the
  play-area download prompt, the dismissed-prompt persistence, and the
  update flow are all **absent** — `getCoverageStatus` has zero callers and
  zero tests. Yet `docs/buglist1.md` now marks the badge/auto-discovery item
  "✅ Resolved (T10)". Revert or soften both buglist annotations (the T8 one
  has the same problem, see C11).

### C11. T8 is scaffolding only

- `queryAdminBoundaryAsync`
  ([adminBoundaryLoader.ts](src/features/questions/matching/adminBoundaryLoader.ts))
  has **no callers** — `osmMatchingCache.ts` was never touched, so admin
  matching still goes bundled-Japan-or-Overpass.
- The sync `queryAdminBoundary` pack branch is a no-op: it filters entries,
  loops over them with a comment-only body, and falls through to `null`.
  Delete it or implement it; as written it's misleading.
- The spec's `registerAdminBoundarySource` API, the sticky per-relation
  manual override, the `AdminDivisionScreen` "(from <pack label>)" UI, and
  all the T8 tests are absent. `buildPackAdminDivisionPack` ends in
  `as unknown as AdminDivisionNamePack`, a sign the shape doesn't actually
  match `adminDivisionConfig.ts`.

---

## Major spec deviations (won't crash, but contradict the task docs)

### T2 — POI artifacts

- `pnpm data:poi` was **not** refactored to call the new
  [extractPois.mjs](data/geofabrik/scripts/lib/extractPois.mjs) — nothing
  outside the packs pipeline imports it. The "byte-identical Japan output"
  requirement is vacuously satisfied (the Japan path is untouched), but the
  task's actual goal — one shared extraction core — became two parallel
  copies.
- No golden-output snapshot test, no fixture PBF (explicitly "first, before
  refactoring" in the doc). There are no `node --test` assertions on
  `extractPoisFromPbf` at all.
- pack-lint's POI rules (columnar length == count, coords within bbox+slop,
  total > 0) were never added.
- The data-viewer `--pack` flag exists but only serves
  `/api/pack/regions` and `/api/pack/<id>/boundaries/<level>` — the
  `/api/pack/poi` and `/api/pack/measuring/<category>` routes T2/T3 specified
  are missing, so pack POIs/measuring can't be eyeballed.

### T2b — measuring refactor

- Helpers moved to `lib/` ✓ and the old test still passes against the
  re-exports, but: no golden-output test was added, and the script's admin
  branch (lines 238-325) still contains the inline three-step osmium
  pipeline instead of calling
  [osmiumPipeline.mjs](data/geofabrik/scripts/lib/osmiumPipeline.mjs)'s
  `assembleAdminBoundaries`. That pipeline now exists in **three** places
  (the script, `buildMeasuring.mjs`, and the lib).
- The lib seams the doc demanded direct tests for (`applyPostFilter`,
  `polygonDissolve`, `stitchSegments`, `assembleAdminBoundaries`) have no new
  `node --test` coverage; `assembleAdminBoundaries` is tested by nothing.

### T3 — measuring artifacts + lazy loader

- [buildMeasuring.mjs](data/packs/scripts/lib/buildMeasuring.mjs) is a ~900
  line near-verbatim copy of `extract-measuring-bundles.mjs`'s `main()`
  orchestration (including the inline admin pipeline). The task said
  "compose the T2b helpers… should not need to touch the helpers' internals"
  — composing helpers is fine, but duplicating the orchestration means every
  future tuning change must be made twice and will silently diverge.
- App side: `useEnsureMeasuringBundles` + the `revision` memo dependency
  follow the spec nicely, but see C9 (cache bypass/duplication) and C1
  (the read throws on device). The `questions` array passed to the hook is
  rebuilt every render in
  [questionGeometry.ts](src/features/questions/questionGeometry.ts), so the
  effect re-runs each render — harmless today (guarded by cache checks) but
  worth memoizing.

### T9 — transit artifacts

- [buildTransit.mjs](data/packs/scripts/lib/buildTransit.mjs) re-implements
  station extraction ("simplified version of mapOsmNode") instead of
  invoking `data/transit/`'s OSM path as the doc required: no operator
  normalization, no clustering (`maxClusterMeters` ignored;
  `transitOverrides` validated in config but never read), raw
  `operator` tag → one preset per distinct string (will explode into dozens
  of junk presets in dense regions), no routes, `hsl()` colors where bundled
  data uses hex. Presets have no station membership — `buildPresets` gives
  every preset only a bbox, so the app cannot know which stations belong to
  which preset.
- The transit pack-lint rules (coords in bbox, preset references ≥1 station,
  `:`-free preset ids) were not added.
- App side: the in-flight marker is set under the synthetic
  `${packId}:${presetId}` cache key but `loadPackTransitBundle` caches under
  `packId` ([hidingZoneData.ts:94-131](src/features/hidingZone/hidingZoneData.ts)).
  Consequences: N presets → N parallel reads of the same file on first load,
  and after `removePack` + reinstall the stale `null` entries under the
  prefixed keys block loading **forever** (only `clearTransitBundleCache()`
  recovers). `unregisterTransitSource` must also purge the prefixed keys.
- Removing a pack does not drop its selected preset ids from
  `hidingZoneStore`, and the shared-station invariant test the doc (and
  AGENTS.md) requires was not written.

### T7 — offline play-area setup

- The wiring that _was_ built routes through `buildPlayAreaFromBoundary`
  correctly (same conversion path as Overpass ✓, AsyncStorage cache seeded ✓,
  AGENTS.md updated ✓). But:
- `cacheSource` is reported as `"bundled"` for pack loads
  ([playAreaBoundary.ts](src/features/map/playAreaBoundary.ts), both call
  sites) — add a `"pack"` source rather than mislabeling.
- [boundaryStore.ts:194-233](src/features/offline/boundaryStore.ts) re-reads
  and re-parses the **entire** polygons file on every cache miss (the parsed
  `Record` is never kept, only individual decoded polygons, LRU cap 8). For a
  multi-MB file that's a jank generator; the T7 design was parse-once-lazily.
  The decode-performance guard (measure on Taiwan, record in PR) was not
  done.
- `searchBoundaries` results drop `nameEn`/admin context from the UI mapping
  in `playAreaSearch` (label only), and no "offline" tag is rendered on pack
  rows (spec: subtle badge).
- `usePlayAreaSearch` swallows Photon errors **unconditionally** — offline
  with no packs installed now yields a silent empty list instead of an error
  state (spec: "no error state _when local results exist_"). Local results
  also don't render until Photon settles, since both run in one `queryFn`.
- Zero tests: no decoder fixture-vector round-trip against the pipeline
  encoder (the committed-fixture requirement), no `searchBoundaries` ranking
  tests, no merge/dedupe tests, no pack-path test for
  `loadPlayAreaByRelationId` (`playAreaSearch.test.ts` and
  `playAreaBoundary.test.tsx` are untouched).
- Edge case: pipeline omits the `normalized` key when empty
  ([buildBoundaries.mjs:186](data/packs/scripts/lib/buildBoundaries.mjs)) but
  the app iterates `entry.normalized` unguarded
  ([boundaryStore.ts:150](src/features/offline/boundaryStore.ts)) —
  TypeError if it ever happens. Make the field required (always ≥1 variant —
  name is guaranteed) and guard anyway. Also `relationId` can be `null` if
  `@id` is missing (no guard before `polygons[String(relationId)]`).

### T1 / T4 — scaffold and catalog (the strongest pipeline work)

Mostly faithful: config validation matches the spec (incl. the
matching⊆extract rule), hashing helpers are correct and tested, meta schema
validates bbox sanity, catalog generator + `--base` merge + validator are
solid and well-tested, `publish` is properly dependency-injected for tests.
Remaining gaps beyond C3/C5/C6/C7:

- `ensurePbf` ([build-packs.mjs:177](data/packs/scripts/build-packs.mjs))
  never refreshes a cached PBF (no `If-Modified-Since` as T1 specified) and
  `osmSnapshot` uses file mtime, not the `Last-Modified` header.
- The build CLI does **not** run pack-lint at the end (T1: "runs lint
  automatically").
- `meta.json` is never entered into `hashes.json`, so the catalog never
  lists a `meta` artifact → even after C2 is fixed, the app would have no
  `adminLevels` to register for T8. (Publish uploads `<region>-meta.json` as
  a release asset, but the catalog doesn't reference it.)
- `meta.bbox` falls back to `[0, 0, 0, 0]` when the POI builder is skipped —
  which then fails meta validation. Compute the bbox independently of the
  POI builder (both builders already shell out to `osmium fileinfo`; hoist
  that into one place).

### T5 — app install v2 (the strongest app work)

`installPack`/`retryPack`/`removePack`, the v2 index, meta-first ordering,
progress callback, startup `loadInstalledPacks` with path-only measuring
registration, and the rebuilt screen (sections, per-state rows, stale-catalog
banner, destructive confirm) are all in good shape, with the best test suite
in the changeset (incl. the "no `.text()` for measuring" assertion). Minor
issues:

- A payload `schemaVersion` mismatch throws **after** download/verify but
  skips the `.gz` cleanup every other failure path does
  ([regionPacks.ts:341-349](src/features/offline/regionPacks.ts)).
- `export const usePackManifest = null as never` is a trap for any future
  import; just delete the v1 names (no users — the docs say so).
- Only one `testID` in the screen; T5 asked for stable ids on rows + primary
  buttons for Maestro.
- The decompression-bomb "guard" inflates fully before checking the limit
  (`gunzipSync` then compare) — same as v1, but worth noting the guard is
  detection, not prevention.

---

## Milestone assessment

| Milestone                                 | Claimed scope | Actual state                                                                                                                                                                          |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 (pilot region, POI+measuring, hosting) | T1–T5         | **Not met.** Pack build crashes (C3), lint/catalog reject measuring (C5), publish crashes (C6), device measuring reads throw (C1). No `packs-*` release or live Pages catalog exists. |
| M2 (boundaries + offline setup)           | T6–T8         | **Not met.** Boundaries artifact builds (T6 pipeline is genuinely decent), but install never registers it (C2), normalizers diverge on CJK (C8), T8 unwired (C11).                    |
| M3 (transit + coverage UX)                | T9–T10        | **Not met.** Transit artifact emitted but unregistered (C2) and presets carry no station membership; no badge/prompt/update UI (C10).                                                 |

## What's genuinely good

- The delta encoding is consistent across all three implementations
  (pipeline encoder/decoder, TS port, viewer CJS copy) — I verified the
  length-prefixed format math matches; the T6 amendment was honored.
- `data/packs/` module layout, config validation, hashing, meta/catalog
  schemas, and their 124 node tests are house-style and thorough at the
  unit level.
- `regionPacks.ts` v2 (mutex-guarded index, per-artifact failure isolation,
  retry semantics) and its test suite.
- The pack play-area load reuses `buildPlayAreaFromBoundary` so downstream
  code can't tell pack from Overpass — exactly the T7 intent.
- AGENTS.md resolution-order update shipped with the change, as T7 required.
- `useEnsureMeasuringBundles` + `revision` memo dependency implements the T3
  hoist pattern faithfully (modulo C1/C9).

## Process notes

- This tree mixes the epic with unrelated work: regenerated
  `assets/transit/*.json`, `transitBundles.generated.ts` (with a
  quote-style diff suggesting it wasn't emitted through the normal
  generator/prettier path), and new `stopOrderRepair`/`config` transit tests.
  The epic's house rule is one task per PR; at minimum, separate the transit
  regen from the offline work.
- `data/packs/.gh-pages-worktree/` must be git-ignored (or the orphan-branch
  flow fixed to use `git worktree add --orphan`).
- `data/packs/dist/catalog.json` is committed-adjacent test residue (ignored
  by the new `.gitignore` rule, but the tests should write to a temp dir).
- The `notImplemented` stub builder in `build-packs.mjs` is now dead code.

## Recommended fix order

1. **P0 — make it real**: C1 (legacy FS API + fix the jest mock to match),
   C2 (installer switch for boundaries/transit/meta-adminLevels +
   `removePack` unregistration), C3, C4, C5. Then actually run
   `pnpm data:pack -- --region europe-netherlands` → `pnpm data:pack:lint` →
   install on a simulator with Wi-Fi off. That single loop would have caught
   every P0 here.
2. **P1 — publish path**: C6 (export `lintRegion`, replace the string-split
   `exec` with arg arrays, `git worktree add --orphan`), C7, meta artifact in
   hashes/catalog, run one real publish.
3. **P1 — correctness**: C8 (one normalizer, shared fixture test), C9
   (cache-respecting merge), C10 (installed bbox in index + hook + badge), T9
   cache-key fix + preset station membership.
4. **P2 — close the test gaps** the task docs enumerate: decoder fixture
   vectors from the pipeline encoder, `searchBoundaries` ranking,
   search-merge/dedupe, pack-path `loadPlayAreaByRelationId`,
   coverage table-driven states, hiding-zone shared-station invariant,
   golden-output snapshots for T2/T2b.
5. **P2 — de-duplicate**: route `pnpm data:poi` through `extractPois.mjs`;
   extract the measuring orchestration so `buildMeasuring.mjs` and
   `extract-measuring-bundles.mjs` share it; make both use
   `assembleAdminBoundaries`; reuse `data/transit` osmStations for T9.
6. Correct the two `docs/buglist1.md` annotations until the features are
   actually reachable on device.

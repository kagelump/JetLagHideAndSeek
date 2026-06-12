# Review 2 — Offline Data Packs epic

Reviewed: commits `7dc9da0` ("address review1 critical findings C1-C11") and
`a30621f` ("pipeline E2E fixes + add tests"), on a clean tree at `a30621f`,
against [review1.md](review1.md), the task docs, and the freshly built
`dist/europe-netherlands/` pack.

## Verdict

**Genuine, verifiable progress.** All eleven review-1 criticals were
addressed, and — the important part — the pipeline was actually run this
time: `dist/europe-netherlands/` contains all 9 artifacts, and I re-ran
`pnpm data:pack:lint -- --region europe-netherlands` myself: **PASSED**.
Gates are green (87 jest suites / 1080 tests incl. 48 new
coverage/boundaryStore tests, 124+ node tests, `pnpm check` clean).

That said, the epic is **not yet at any milestone exit criterion**. Four
findings from this round block them — one new regression in the C2 fix
(boundaries are lost on app restart), one config error (the app points at
the wrong catalog URL), one schema mismatch (pack transit presets are not
loadable by the app's preset type), and one data-quality issue in the pilot
region itself (NL's admin-level mapping maps `admin-2nd` to a level that has
zero relations in the Netherlands). Hosting (T4's release + gh-pages) has
still never been exercised — there is no `packs-*` release and no `gh-pages`
branch. And the T8/T10 UI layers remain unbuilt, as the corrected buglist
annotations now honestly state.

---

## Review-1 criticals — verification results

| #                           | Status                               | Verified how                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1 (legacy FS API)          | ✅ Fixed                             | All three readers use `new File(...).text()`; jest mock now models `File`.                                                                                                                                   |
| C2 (installer wiring)       | ⚠️ Fixed, with one regression        | Install path registers all five kinds incl. the boundaries index/polygons split and meta→adminLevels. **But the startup path re-loses boundaries — see N1.**                                                 |
| C3 (import path)            | ✅ Fixed                             | `../../../`; the built NL `poi.json.gz` proves the path runs.                                                                                                                                                |
| C4 (`writeFileSync`)        | ✅ Fixed                             | Import restored; NL admin measuring artifacts built through the shared code path.                                                                                                                            |
| C5 (hashes layout)          | ✅ Fixed                             | Real `hashes.json` is flat, includes `meta`; lint passes against the real pack; `meta.bbox` is real (osmium fileinfo).                                                                                       |
| C6 (publish breakers)       | ✅ Fixed in code, ❌ still never run | `lintRegion` exported, quote-aware tokenizer, `git worktree add --orphan`. No release/`gh-pages` exists (verified `gh release list` + `git branch -a`), so the publish path remains exercised only by mocks. |
| C7 (CI workflow)            | ✅ Fixed                             | Dual checkout (`repo/` for validator, `pages/` for catalog). Will first run for real on the first gh-pages push.                                                                                             |
| C8 (normalizer)             | ✅ Fixed                             | Identical regex both sides (verified character-for-character), dakuten preserved, cross-format fixture vectors added on both sides.                                                                          |
| C9 (merge duplication)      | ✅ Fixed                             | `mergedCache` set + `requirePristineBundle`; invalidation on register/unregister; covered by updated tests.                                                                                                  |
| C10 (coverage offline)      | ⚠️ Half fixed                        | `bbox` persisted in the installed index and used as fallback (verified in `coverage.ts`). The hook, badge, prompt, and update UI still don't exist — `getCoverageStatus` has no production caller.           |
| C11 (admin matching wiring) | ✅ Fixed                             | `queryAdminBoundaryAsync` called from [osmMatchingCache.ts:641](src/features/questions/matching/osmMatchingCache.ts); sync no-op loop removed.                                                               |

Housekeeping from review 1 also landed: `.gh-pages-worktree/` git-ignored and
deleted, v1 deprecated exports and the `notImplemented` stub removed, buglist
annotations corrected to "in progress".

---

## New critical findings (round 2)

### N1. Boundaries are lost on app restart — regression in the C2 fix

[regionPacks.ts:651-652](src/features/offline/regionPacks.ts): the startup
loop guards every artifact with

```ts
const file = jsonFile(packId, artifact.kind, artifact.category);
if (!file.exists) continue;
```

For `boundaries` (no category) that is `boundaries.json` — **which the
install path intentionally deletes** after splitting it into
`boundaries-index.json` + `boundaries-polygons.json`
([regionPacks.ts:191-196](src/features/offline/regionPacks.ts)). So the
`continue` fires before the `case "boundaries"` (which correctly reads the
split index file) is ever reached. Net effect: offline play-area search,
pack relation loading, and pack admin matching all work in the install
session and **silently vanish after the app restarts** — which is exactly
the M2 exit criterion ("full reset, airplane mode … search Utrecht").

No test catches it: `regionPacks.test.ts`'s `loadInstalledPacks` suite still
covers only poi/measuring (zero `boundaries` mentions). Fix the guard (skip
the exists-check for boundaries, or check `boundaries-index.json`) and add
the startup-after-split test.

### N2. The app fetches the catalog from the wrong host

[appConfig.ts:177](src/config/appConfig.ts) hardcodes
`https://ryantseng.github.io/JetLagHideAndSeek/catalog.json`, but `origin`
is `github.com/kagelump/JetLagHideAndSeek` (and publish/build-catalog
default to `--repo kagelump/JetLagHideAndSeek`, matching origin). GitHub
Pages for that repo serves at `kagelump.github.io/JetLagHideAndSeek` — the
app will 404 the catalog forever, even after a successful publish. One of
the two names is wrong; they must agree (and ideally be derived from a
single constant the publish script and app config share, or at least
cross-referenced in comments).

### N3. Pack transit presets don't match the app's preset schema — T9's core contract

The app's `HidingZonePreset`
([hidingZoneTypes.ts:26-37](src/features/hidingZone/hidingZoneTypes.ts))
requires `defaultColor`, `operator`, `routes: TransitRoute[]`, `source`, and
`stations: TransitStationContribution[]` — committed bundles nest the
station list _inside each preset_ (verified against
`assets/transit/japan-kanto.json`). The NL artifact's presets are
manifest-style summaries only: `{id, label, kind, bbox, stationCount,
routeCount}` with a separate flat `stations` array that nothing links to a
preset. [hidingZoneData.ts:235-239](src/features/hidingZone/hidingZoneData.ts)
blind-casts `bundle.presets` to `HidingZonePreset[]`, so a selected pack
preset has `stations: undefined` → zone rendering breaks or silently draws
nothing. T9 explicitly said "same schema as committed transit bundles" and
"every preset references ≥1 station" (a pack-lint rule that also still
doesn't exist — it would have caught this).

Data quality compounds it: with the raw `operator` tag as the grouping key,
NL produces 45 presets where the largest is `other` (1354 of 1977 stations —
operator tags are sparse), HTM's 413 entries are tram stops, and the tail is
one-off heritage railways. This is the consequence of re-implementing a
"simplified" extractor instead of reusing `data/transit/`'s OSM path
(operator normalization, clustering, preset thresholds) — review 1's
deviation, still open, now with concrete evidence.

### N4. The pilot region's admin-level mapping is wrong for the pilot region

The NL boundaries artifact contains, per level: **4 → 12, 7 → 0, 8 → 346,
9 → 9, 10 → 2506**. `regions.yaml` maps `matching: [4, 7, 9, 10]` — so
`admin-2nd` (level 7) has **zero candidates** in the Netherlands, and the
`measuring-admin-2nd-border` artifact is correspondingly absent from
`meta.categories.measuring`. Dutch municipalities live at level 8. This is
precisely the per-region override case design.md called out (DE/US
examples); the pilot should ship `matching: [4, 8, 9, 10]` (or 4/8/10/…
after a human look at what levels 9/10 mean in NL — 9 has only 9 rows).
Add a pack-lint warning when a `matching` level has zero index rows — that
turns this class of misconfiguration into a build-time signal.

Related: the epic's M2 criterion also names a Taiwan pack ("stress the name
index"); `asia-taiwan` is in `regions.yaml` but `dist/` contains only
`europe-netherlands` — Taiwan hasn't been built yet.

### N5. Transit cache keys still mismatched (carried from review 1, unfixed)

[hidingZoneData.ts](src/features/hidingZone/hidingZoneData.ts): the
in-flight marker is set under the synthetic `${packId}:${presetId}` key
(line 102) but `loadPackTransitBundle` caches under bare `packId` (line
243), and `unregisterTransitSource` deletes only `packId` (line 66).
Consequences unchanged from review 1: N parallel reads of the same file on
first load, and within a session remove→reinstall leaves stale `null`
markers under the prefixed keys so the pack's presets never reload. The fix
commits only touched this file for the File API.

---

## Still open from review 1 (acknowledged-but-deferred or missed)

App side:

- **T10 UI**: no `useCoverageStatus` hook, no Settings/MainDrawer badge, no
  play-area download prompt, no update/check-for-updates flow. `coverage.ts`
  is now well-tested (22 tests) but still unreachable by users. The Japan
  bboxes are still hardcoded duplicates rather than derived from
  `bundledPois.ts`.
- **T8 country defaults**: `findPackForPlayArea` / `buildPackAdminDivisionPack`
  still have no consumers; no sticky per-relation override; no
  `AdminDivisionScreen` integration. (Pack-backed admin _matching_ is now
  wired — that half of T8 is real.)
- `getBoundaryPolygon` still re-reads and re-parses the **entire** polygons
  file on every LRU miss (~5.7 MB raw for NL, cap 8 decoded polygons) —
  the parsed `Record` should be cached per pack. The decode path test is an
  `it.todo` ("dynamic import mock not working"), and there are still no
  committed pipeline-encoder fixture vectors for the TS decoder (T7's
  explicit requirement) — `deltaDecode.ts` has no direct test.
- `usePlayAreaSearch` still swallows Photon errors even when there are zero
  local results (silent empty list when offline with no packs), local
  results still wait for Photon to settle, and there's no "offline" tag on
  pack rows. Pack loads still report `cacheSource: "bundled"`.
- Still zero tests for: the play-area pack path
  (`playAreaBoundary.test.tsx` untouched), search merge
  (`playAreaSearch.test.ts` untouched), `queryAdminBoundaryAsync`, and the
  hidingZoneData pack transit path.
- Minor: payload `schemaVersion` mismatch still leaves the downloaded `.gz`
  behind ([regionPacks.ts:467-476](src/features/offline/regionPacks.ts));
  `OfflineDataScreen` still has a single `testID`; no Maestro flow.

Pipeline side:

- `publish()` still writes `catalog.json` to the **real**
  `data/packs/dist/` even when `distDir` is overridden for tests
  ([publish.mjs:351](data/packs/scripts/publish.mjs)) — which is why
  `dist/catalog.json` currently contains the `test-region` fixture instead
  of a Netherlands catalog. Derive the output path from `distDir`.
- `pnpm data:poi` still doesn't route through `extractPois.mjs` (the
  shared-core refactor T2 asked for), and there's still no golden-output
  snapshot test for either T2 or T2b. Whether `pnpm data:poi` /
  `pnpm data:measuring` still reproduce the committed Japan assets remains
  unverified (the C4 crash is fixed, but nobody has shown a clean
  `git status` run).
- `buildMeasuring.mjs` still duplicates ~900 lines of
  `extract-measuring-bundles.mjs`'s orchestration, including a third copy of
  the admin osmium pipeline that `osmiumPipeline.mjs` exists to own.
- The viewer still lacks `/api/pack/poi` and `/api/pack/measuring/<category>`
  (T2/T3 scope) — only the regions + boundaries routes exist, so the NL POIs
  and coastline can't be eyeballed the way the task docs' manual checks
  require.
- pack-lint still lacks the T2 POI rules (columnar length == count, coords
  in bbox, nonzero total) and all T9 transit rules.

---

## Milestone assessment (updated)

| Milestone                                 | Round 1     | Now                                                                                                                                                                                                                     |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 — pilot pack, POI + measuring, hosting | Nothing ran | **Build + lint demonstrated locally** (big step). Hosting still not stood up (no release, no gh-pages, app catalog URL wrong — N2). Device validation (matching + measuring offline on a phone) still not evidenced.    |
| M2 — boundaries + offline setup           | Dead code   | Install-session offline search/load is plausibly working, but N1 (lost on restart) breaks the stated criterion ("full reset, airplane mode"), N4 breaks admin-2nd for the pilot, and the Taiwan pack hasn't been built. |
| M3 — transit + coverage UX                | Dead code   | Transit presets register but are schema-incompatible (N3) and cache-fragile (N5); coverage UX has logic + tests but no UI.                                                                                              |

## T11 (proposed) — Test hardening: catch this class of bug before review does

Every critical found in both rounds slipped through a green test suite. None
of them were subtle logic errors — they were **seam failures**: a mock that
flattered the code, a producer and consumer tested against separate
fixtures, a lifecycle (restart, reinstall) no test replayed, a config value
nothing cross-checked. Each pattern below names the finding it would have
caught; together they'd have caught all of them. Worth running as its own
task with the same one-PR discipline as the rest of the epic.

### 1. One pipeline E2E test on a tiny fixture PBF (would have caught C3, C4, C5, N4)

A `node --test` suite that runs the _real_ chain on a committed ~100 KB
fixture PBF (a few POIs, two admin relations, a coastline way, three
stations):

```
build-packs (all builders) → pack-lint → build-catalog → validateCatalog
```

— asserting exit codes and that every artifact in `hashes.json` resolves to
a file the linter accepts. The point is that **the consumers eat the
producer's actual output**, not hand-built fixtures: the C5 hashes-layout
mismatch and the C3 broken import were both invisible precisely because
lint/catalog tests constructed their own inputs. Add the zero-candidate
`matching`-level warning (N4) to lint and assert it fires on a fixture
region configured with an empty level. This is also where T2/T2b's missing
golden-output snapshot belongs: serialize the fixture build's `poi` and
`measuring-*` outputs and `assert.strictEqual` against committed snapshots.

### 2. Cross-format fixture files shared by pipeline and app (would have caught C8, N3)

The normalizer fix established the right pattern — identical fixture vectors
asserted on both sides. Generalize it:

- **Delta polygons**: a pipeline script flag emits `fixtures/delta-vectors.json`
  (encoded arrays + expected coordinates, incl. a multipolygon with a hole);
  commit it; the pipeline test round-trips it with `deltaEncode.mjs` and a
  jest test decodes it with `deltaDecode.ts`. This is T7's original
  requirement and `deltaDecode.ts` still has zero direct tests.
- **Artifact schemas**: commit one tiny _pipeline-built_ artifact per kind
  (the fixture-PBF build from §1 can emit them) under app test fixtures, and
  have jest feed each through its real consumer: `registerRegion` for poi,
  `loadLineBundle` for measuring, the boundaries install split +
  `searchBoundaries`/`getBoundaryPolygon`, and `registerTransitSource` +
  preset selection for transit. The transit one fails **today** — that's N3
  caught by a test instead of a reviewer. When a payload schema changes,
  regenerating the fixture is the explicit, reviewable act.

### 3. Lifecycle replay tests: restart and reinstall (would have caught N1, N5)

The install-session tests pass because module state is still warm. Add, in
`regionPacks.test.ts` and `hidingZoneData` tests:

- **Restart replay**: install a full pack against the mock FS, then simulate
  app relaunch — reset every in-memory registry (boundary sources, measuring
  sources, transit sources, admin levels) _without_ resetting the mock FS or
  AsyncStorage, run `loadInstalledPacks()`, and assert every kind is
  registered again. This fails today for boundaries (N1) because the mock FS
  faithfully deleted `boundaries.json` — the bug is reachable, just never
  replayed.
- **Remove → reinstall in one session**: assert the pack's presets load
  again after reinstall (fails today, N5) and that a still-selected preset
  from another pack keeps its stations (the AGENTS.md hiding-zone
  invariant, still untested).

### 4. Mock-parity guard for `expo-file-system` (would have caught C1)

C1 happened because the jest mock implemented an API the real module ships
as a throwing stub. Add one jest test that imports the **real** module's
export surface (`jest.requireActual("expo-file-system")`) and asserts parity
with the mock: every property the mock exposes exists on the real module
_and is not one of the known legacy-stub names_ (`readAsStringAsync`, etc. —
assert those throw in the actual module so the day the mock grows one, the
guard fires). Cheap, and it converts "mock drifted from reality" from a
device-only failure into a unit failure. While here, fix the dynamic-import
mocking issue so `getBoundaryPolygon`'s `it.todo` becomes a real test — the
single most important decode path in T7 is currently unexercised.

### 5. Config consistency assertions (would have caught N2)

A trivial jest test that derives the expected Pages origin from a single
shared constant (or from `package.json` `repository`) and asserts
`OFFLINE.catalogUrl` starts with it; a `node --test` twin asserts
`publish.mjs`/`build-catalog.mjs` defaults use the same slug. Hardcoded
URL/slug pairs that must agree but live in different files should always
have a test pinning them together.

### 6. Integration tests for the wired-but-untested app paths (review-1 P2, still open)

The three integration seams that exist in production code but have zero
coverage:

- `loadPlayAreaByRelationId`: relation present in a registered boundary
  source short-circuits Overpass (assert the fetch mock is not called),
  produces a play area shape-equal to the Overpass fixture, seeds the
  AsyncStorage cache, and reports a truthful `cacheSource`.
- `usePlayAreaSearch`: Photon rejection with pack results → results render,
  no error; Photon rejection with **no** pack results → error state (fails
  today — errors are swallowed unconditionally); dedupe by relation id with
  pack-first ordering.
- `findMatchingFeaturesWithIndex` admin path: a pack-source hit at level N
  returns before Overpass; a level-8 query never decodes level-4 polygons
  (decode-spy on the boundary store).

### 7. Device-reality checks that CI can't fake

Two things no jest test can prove, so make them explicit checklist items
with artifacts: a Maestro flow for the Offline Data install happy path
(T5 flagged this as follow-up; still missing — and the screen's single
`testID` needs expanding first), and the M1/M2 manual runs recorded in the
PR description (airplane-mode screenshots, the T7 decode-time measurement on
the Taiwan pack). The epic's exit criteria are device criteria; the review
gap both rounds was treating green CI as a proxy for them.

## Suggested order

1. **N1** — fix the startup guard + add the boundaries restart test (small,
   unblocks M2's core demo).
2. **N2** — reconcile the catalog URL with the real repo slug (one line, but
   nothing works end-to-end until it's right).
3. **N4** — set NL `matching: [4, 8, 9, 10]` (or curate properly), rebuild,
   and add the zero-candidates lint warning; build `asia-taiwan` while at it.
4. **T4 finish line** — run one real publish (release + gh-pages), watch the
   C7 workflow pass, then do the M1 device check. Fix the `publish()`
   catalog output path so test residue stops landing in the real dist.
5. **N3 + N5** — emit committed-bundle-schema presets (reuse the transit
   pipeline's preset builder) and unify the transit cache keys; add the
   pack-lint preset rules.
6. **T11** — the test-hardening task above, ideally interleaved: §3's
   lifecycle replay lands with the N1 fix, §2's transit fixture with the N3
   fix, §5's config assertion with the N2 fix, so each fix arrives with the
   test that would have caught it.
7. Then the deferred T8/T10 UI work, and the review-1 P2 dedup list.

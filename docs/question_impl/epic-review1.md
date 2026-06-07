# Review 1: Measuring / Thermometer / Tentacles Epic (Tasks 01–11)

**Reviewer:** Claude (automated code review)
**Date:** 2026-06-07
**Branch:** `claude/kind-albattani-ozv6p` (38 commits over `master`; base = epic
design PR #11)
**Scope:** The full epic ([epic.md](epic.md)) — all 11 tasks. Builds on the
earlier [review-task-02-03.md](review-task-02-03.md) and re-checks its findings.

## Verdict

The epic is **substantially and correctly implemented**. All 11 tasks landed,
are wired end-to-end, and the test-first discipline clearly held — the geometry
suites contain the spec-mandated anti-inversion (Thermometer) and radius-overflow
(Tentacles) assertions. The high-risk geometry (the epic's stated danger zone) is
**correct**.

This review pass landed **one fix** — the Measuring bundles were being
pretty-printed and shipped at ~2× their real size (R1-1, fixed). The other gate
issue — a single failing `MapAppScreen` navigation test (R1-2) — turned out **not**
to be a quick fix: it is a genuine, **pre-existing** teardown-hook hang, not the
borderline timeout it first looked like. Two fix attempts (raising the timeout;
refactoring the test's teardown) were verified ineffective/harmful and reverted;
R1-2 is documented for a proper follow-up. It is not caused by the epic and does
not impugn the epic's logic, but it does keep `pnpm test` red where the hang
triggers.

## Verification results (this environment, after `pnpm install`)

| Gate                | Before pass | After pass        | Notes                                                          |
| ------------------- | ----------- | ----------------- | -------------------------------------------------------------- |
| `pnpm typecheck`    | ✅ pass     | ✅ pass           | clean                                                          |
| `pnpm lint`         | ✅ pass     | ✅ pass           | clean                                                          |
| `pnpm format:check` | ✅ pass     | ✅ pass           | new ignore rule + minified bundles + this doc all conform      |
| `pnpm test`         | ⚠️ 819/820  | ⚠️ 819/820 (R1-2) | one pre-existing cleanup-hook hang; **not** fixed in this pass |

The bundle-validator (`extract-measuring-bundles.test.mjs`, run by `pretest`)
passes 65/65 against the re-minified bundles, and `typecheck` is clean — so the
R1-1 fix is safe.

---

## Fixed in this pass

### R1-1 — Measuring line bundles were pretty-printed, ~doubling their size (was: medium) — FIXED

`.prettierignore`, `assets/measuring/*.json`

`.prettierignore` listed `assets/poi` but **not** `assets/measuring`, so Prettier
reformatted the generated bundles. The generator emits minified JSON
(`JSON.stringify(bundle)` in
`data/geofabrik/scripts/extract-measuring-bundles.mjs`), and the POI bundle is
correctly minified — but the committed measuring bundles shipped indented:

| File                  | Committed (pretty) | Minified     |
| --------------------- | ------------------ | ------------ |
| `body-of-water.json`  | 31.90 MB           | **16.14 MB** |
| all 5 bundles (total) | 45.22 MB           | **22.89 MB** |

The minified totals exactly match the figures already documented in
`data/geofabrik/SIZES.md` and `epic-impl-notes.md` — i.e. the docs were right and
the files were wrong. Because `lineBundleLoader.ts` `require()`s these into the
Metro/Hermes bundle, the ~22 MB of pure whitespace inflated the app binary and
roughly doubled the first-query JSON parse cost.

**Fix applied:**

1. Added `assets/measuring` to `.prettierignore` (with a comment).
2. Re-minified all five bundles in place (`JSON.parse` → `JSON.stringify` +
   trailing `\n`, matching the generator's exact output). Each file was verified
   **semantically identical** to the committed version (whitespace-only change)
   and the structural validator still passes 65/65.

Repo + bundle savings: **22.33 MB**. SIZES.md / impl-notes figures now match the
on-disk files again, so no doc edit was needed.

---

## Remaining findings

### R1-2 — `pnpm test` red: a pre-existing cleanup-hook hang (severity: medium — NOT fixed)

`src/screens/__tests__/MapAppScreen.test.tsx`

`MapAppScreen › maintains correct direction across forward and back navigation
cycles` fails deterministically. It first looked like a borderline timeout (~5.19
s vs the 5000 ms default), but investigation showed it is a genuine **hang in the
teardown hook**, not slow-by-a-hair:

- The error is **"Exceeded timeout of 5000 ms for a hook"**, with the stack at
  testing-library's auto-registered `afterEach(cleanup)` — the _cleanup hook_
  overruns, not the test body.
- The file itself already documents the root-cause class: the query-client
  persister subscription "bleeds past fake-timer boundaries and causes afterEach
  timeouts" (it stubs the persister to mitigate). The heaviest nav test (full
  render + four navigation cycles) still trips it.
- **Pre-existing, not epic-caused:** the test exists on `master` and was touched
  by exactly one branch commit (the multi-pin `NativeMap` refactor). (A clean
  full-suite master run could not be completed in this resource-constrained
  sandbox to confirm directly, but every other signal points to pre-existing.)

**Two fixes were attempted and reverted** (verified counter-productive):

1. Per-test `it(..., 15000)` — ineffective: a per-test timeout does not cover
   hooks; still failed at ~5.2 s.
2. File-level `jest.setTimeout(15000)` — proved it is a true hang: the cleanup
   then ran to **15192 ms** and failed at the new ceiling. Raising the timeout
   only moves the failure later.
3. Refactoring teardown (drain pending timers + explicit `screen.unmount()`
   under fake timers before `useRealTimers`) — made it **worse**: 3 failures
   instead of 1 (test pollution into neighboring cases).

**Recommendation:** do **not** mask this with a timeout. Chase the actual open
handle with `jest.config` `--detectOpenHandles` (likely an un-`unref`'d real
timer / subscription left by a provider or the bottom sheet that only the heavy
nav-end state exposes). This is test-infra debt orthogonal to the epic; it should
be fixed so the DoD "`pnpm test` passes" gate is green without `--forceExit`.

### R1-3 — `body-of-water` bundle (16 MB even minified) is heavy for a synchronous `require()` (severity: low–medium)

`src/features/questions/measuring/lineBundleLoader.ts`,
`src/features/questions/measuring/lineMeasuringGeometry.ts`

The bbox pre-filter (`computeLineDistance`) runs **after** the whole file is
parsed into memory, so the first `body-of-water` Measuring query parses a 16 MB
JSON on the JS thread (blocking + a memory spike) before filtering down to the
few hundred in-window features. This is an accepted Task 06 trade-off (committed
bundles + a 50 km query window), and R1-1 already halved the parse cost. Worth
tracking for low-end devices; a future option is spatial sharding loaded on
demand, or a columnar format like the POI bundle.

### R1-4 — Open test-plan gaps from the prior Task 02/03 review remain (severity: low — coverage debt)

The earlier review's two **blocking** items are fixed (T3-1 format gate green;
T2-1 — `addImportedQuestion` now clears the full POI selection for poi-model
questions, `questionStore.tsx:330-341`). These **non-blocking** gaps are still
open:

- **T3-3** — `src/state/__tests__/persistence.test.ts` has no
  measuring/thermometer/tentacles round-trip coverage. The `appState.ts` schemas
  exist and are exercised indirectly by one tentacles persist→load store test,
  but the spec asked for explicit persist→load round-trips per new type.
- **T3-4** — round-trip tests use `toMatchObject` (partial) rather than the
  spec's strict `encode(decode(encode(q))) === encode(q)` byte-stability and
  deep-equal-modulo-defaults. They would not catch a dropped/extra field or a
  non-idempotent round-trip.
- **T2-3** — `QuestionAnswerSelector.test.tsx` (binary labels render; assert it
  is not used for poi) was not added. The boundary is upheld in code.

Happy-path serialize/restore round-trips pass, so this is coverage debt, not a
known bug.

### R1-5 — Tentacles geometry cache key omits answer state (severity: low — latent)

`src/features/questions/tentacles/tentaclesGeometry.ts:64-80`

`questionStateCacheKey` is keyed on `(center, distanceMeters, candidateSnapshot,
selectedOsmKey, boundaryId)` but not on `answer` / the derived `isAnswered`. It
is safe **today** only because the answer-model invariant ties `answer` to
`selectedOsmId` (changing the answer changes `selectedOsmKey`, which changes the
key). If that invariant ever drifts, a stale answered/unanswered mask could be
served from cache. Cheap hardening: fold `isAnswered` into the key.

### R1-6 — `poiFeatures.isSelected` compares `osmId` only, not `osmType` (severity: nit)

`src/features/questions/tentacles/tentaclesGeometry.ts:221`

`isSelected: c.osmId === q.selectedOsmId` ignores `osmType`, so a node and a way
sharing the same numeric id would both flag as selected. This matches Matching's
loose convention and the risk is very low, but a `makeOsmKey`-based comparison
(as used for the hit/miss filter) would be exact.

### R1-7 — Out-of-epic scope on the branch (informational)

Commit `8eb927d "configurable admin division matching categories"`
(`AdminDivisionScreen.tsx` + `adminDivisionConfig.ts` + matching wiring,
~460 lines) is **not part of this epic's three question types** — it is a
separate Matching feature riding the same branch. Not a defect, but flag it for
PR scoping so reviewers know to evaluate it on its own merits.

### R1-8 — Task 07 (rail-station data regen) is environment-gated (informational)

Regenerating the bundled POIs needs the ~450 MB Geofabrik PBF, unavailable in
CI/sandbox, so the data-regen half of Task 07 appears deferred. `rail-station` is
wired for Measuring via the live-Overpass / local-tag path, which the epic
explicitly permits as the v1 fallback. No action needed unless/until someone with
the PBF regenerates the bundle.

---

## What's correct (verified)

- **Thermometer half-plane sign convention is right**
  (`thermometer/thermometerGeometry.ts`): bisector through the projected
  midpoint; `sign=+1` extends toward P2 for Hotter (H₂), `−1` toward P1 for
  Colder (H₁); a `__DEV__` side-check guards against inversion. The spec's
  keystone anti-inversion test (`thermometerGeometry.test.ts` test 4 — hider near
  P2 is in Hotter, absent from Colder) is present and green.
- **Tentacles mirrors Matching correctly**: Voronoi over _in-radius_ candidates →
  clipped to the radius circle → hit/miss split by `osmKey`. Confirmed
  `computeVoronoiCells` attaches `osmKey` to each cell's `properties`
  (`matchingVoronoi.ts:100/118`), so the filter is sound; the radius-overflow
  test is present.
- **Measuring centers the circle on the target POI, not the seeker pin**
  (`measuring/measuringGeometry.ts:148`) — the one geometric requirement the spec
  stressed. Line/polygon categories (Task 06) derive the nearest point on render
  via `@turf/nearest-point-on-line`, never storing it (avoids staleness).
- `assertNever` exhaustiveness guard is in place (`questionStore.tsx:829`);
  `NativeMap` wires both `ThermometerPreviewLayer` and the Tentacles
  masks/radius; the new `@turf/nearest-point-on-line` dependency is properly
  declared in `package.json`, plus a Metro ESM-resolution fix landed for the new
  ESM turf packages.
- All LRU geometry caches follow the `Map`-insertion-order pattern with 7-dp
  rounding and `WeakMap` boundary identities, per the epic's caching constraint.
- Per-task implementation notes (`epic-impl-notes.md`) are thorough and accurate.

## Prioritized remaining actions

1. **(R1-2)** Investigate the MapAppScreen teardown hang with
   `--detectOpenHandles`; fix the leaking handle rather than masking it. This is
   the only thing keeping the `pnpm test` gate red.
2. **(R1-4)** Close the persistence / strict round-trip / answer-selector
   test-plan gaps so the Task 03 serialization DoD is fully met.
3. **(R1-5 / R1-6)** Optional hardening: fold `isAnswered` into the Tentacles
   cache key; use `makeOsmKey` for `isSelected`.
4. **(R1-3)** Track `body-of-water` runtime cost on low-end devices; consider
   sharding or a columnar format if it becomes a problem.
5. **(R1-7)** Confirm the admin-division feature is intended to ship on this
   branch / PR.

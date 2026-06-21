# Code Health & Tech-Debt Audit — June 21, 2026

A fresh whole-codebase pass focused on **fragility** (things stitched together
that would be sturdier "done right from the start") and **debt that makes
correctness or performance hard to validate**. This audit deliberately does
**not** re-litigate the [June 15 audit](code-quality-audit-2026-06.md) —
items #1–#16 there are mostly landed (see the
[5–16 review](code-quality-audit-2026-06-review-5-16.md)). It re-measures the
codebase as it stands today and surfaces what is **new, regressed, or still
open**.

Method: cross-cutting greps for debt signals + targeted reads of the
largest/hottest files. Tests were read to judge fragility, not audited for their
own quality.

---

## Re-measured metrics (non-test `src/`, 2026-06-21)

| Signal                                 | June 15 | Today   | Trend                                                    |
| -------------------------------------- | ------- | ------- | -------------------------------------------------------- |
| `console.*` in production paths        | 143     | **177** | 🔴 **regressed +34** — no abstraction to hold the line   |
| `as any` / `as unknown` / `@ts-ignore` | 53      | **29**  | 🟢 nearly halved; residue is mostly legit boundary casts |
| Non-test files > 600 lines             | 9       | **10**  | 🟡 `regionPacks.ts` grew 956 → **1211**                  |
| Empty `catch {}` blocks                | many    | **0**   | 🟢 item #5/#7 follow-through landed                      |
| `eslint-disable` directives            | —       | **0**   | 🟢 clean                                                 |
| Skipped tests (`.skip`)                | —       | **11**  | 🟡 mostly active body-of-water WIP; one parity hole      |

Files over 600 lines today: `measuring/parityHarness.ts` (1354),
`offline/regionPacks.ts` (**1211**), `hidingZone/HidingZoneScreen.tsx` (1030),
`state/questionStore.tsx` (921), `sharing/wire/minified.ts` (888),
`matching/osmMatchingCache.ts` (712), `offline/OfflineDataScreen.tsx` (688),
`thermometer/thermometerGeometry.ts` (657), `hidingZone/hidingZone.ts` (624),
`measuring/lineBufferComputation.ts` (608).

The headline: the unsafe-cast and silent-swallow debt the last audit targeted has
genuinely improved. **Observability debt moved the other way** — and because
there is still no logging primitive, every new hot-path file re-introduces raw
`console.log`.

---

## Top-line ranking

| #   | Finding                                                                                    | Severity    | Subsystem            |
| --- | ------------------------------------------------------------------------------------------ | ----------- | -------------------- |
| 1   | No logging abstraction → 177 `console.*`, hot-path logs ungated, regressing per-file       | **High**    | cross-cutting / perf |
| 2   | `regionPacks.ts` god file (1211, +255) at the on-device network/install boundary           | **High**    | offline / data       |
| 3   | wasm GEOS oracle can't validate GeometryCollection ops (golden fixtures skipped)           | **Medium**  | geometry             |
| 4   | `parityHarness.ts` (1354 lines of test scaffolding) still physically in `src/`             | **Medium**  | questions            |
| 5   | Admin-division config still a module-level mutable global synced from 4 sites              | **Medium**  | state                |
| 6   | Three measuring "computation" god files re-spawned after the item-9 split                  | **Medium**  | questions            |
| 7   | `pluralize` / inline `=== 1 ? "" : "s"` duplicated ~10×; residual magic numbers            | **Low**     | UI                   |
| 8   | `HidingZoneScreen.tsx` (1030) + `OfflineDataScreen.tsx` (688) untyped-heavy view god files | **Low–Med** | UI                   |

---

## 1. No logging abstraction; hot-path logs ungated — **High** ⟵ #1 priority

**The problem.** There is no `logger` / `devLog` primitive anywhere in `src/`.
Every diagnostic is a raw `console.log` / `console.warn`. The June audit's item
#12 ("gate hot-path logs") was applied _by hand, file by file_ —
`geosGeometryBackend.ts` is now exemplary (13 `console.log`, all wrapped in 32
`__DEV__` checks). But with no shared primitive, the gating discipline does not
survive new code. Production `console.*` rose **143 → 177** since that audit.

Files with `console.log` in production hot paths and **zero `__DEV__` gating**:

| File                                   | logs | Hot path?                              |
| -------------------------------------- | ---- | -------------------------------------- |
| `matching/progressiveSearch.ts`        | 9    | per search iteration                   |
| `shared/geometry/jsGeometryBackend.ts` | 8    | per geometry op (JS fallback)          |
| `measuring/lineBufferComputation.ts`   | 7    | per line-buffer escalation round       |
| `matching/useMatchingSearch.ts`        | 6    | per matching query                     |
| `measuring/lineDistanceComputation.ts` | 5    | per measuring recompute                |
| `matching/osmMatchingCache.ts`         | 5    | per match lookup                       |
| `map/useStationElimination.ts`         | 5    | per elimination recompute (mask loop)  |
| `shared/useDeferredComputation.ts`     | 5    | per deferred derivation                |
| `shared/geometry/geometryBackend.ts`   | 4    | backend selection                      |
| `measuring/lineBundleLoader.ts`        | 4    | per bundle load                        |
| `map/maskBuilder.ts`                   | 4    | partially gated (4 logs / 2 `__DEV__`) |

Each `console.*` in React Native is a **synchronous bridge call**. Firing them
unconditionally inside mask/dissolve/search loops over many polygons does two bad
things at once:

1. **Ships log spam to production** users' JS console.
2. **Corrupts the very performance measurements** the project relies on — the
   measuring-perf and distance-field epics are all about millisecond budgets, and
   there is no master switch to silence diagnostics while profiling. This is
   exactly the "debt that makes performance hard to validate" the audit brief
   calls out.

`lineBufferComputation.ts` is the sharpest example — its budget-escalation logs
(`:197,212,304,347,354,396,435`) run on the body-of-water measuring path that the
docs already flag as a multi-second hot spot.

**Remediation (what "done right from the start" looks like).** Introduce one tiny
`src/shared/logger.ts`: `createLogger(namespace)` returning
`{ debug, info, warn, error }`, where `debug`/`info` are `__DEV__`-gated (with a
per-namespace runtime enable hook for targeted profiling) and `warn`/`error`
always pass through. Migrate the ungated hot-path `console.log` calls to
`log.debug`. This makes gating the **default**, gives profilers a single off
switch, and stops the per-file regression. **This is the item implemented in this
pass** — see "Work done" below.

## 2. `regionPacks.ts` god file at the network/install boundary — **High**

`src/features/offline/regionPacks.ts` is now **1211 lines** (956 at the last
audit — the single largest growth in the tree). It is simultaneously: the catalog
fetcher, the installed-index store, the per-artifact downloader + integrity
verifier, the install/uninstall state machine, the bbox-based resolver consumed by
play-area/POI/measuring/transit, and the admin-level registrar. Item #7 correctly
added Zod at the boundary (`packSchemas.ts`), so the _validation_ gap is closed —
but the file is the riskiest single module in the app (on-device mutation of
installed data, multi-artifact transactional install) and it keeps accreting.

**Remediation.** Split along its natural seams: `packCatalog` (already partly
extracted), `packInstall` (download + verify + index mutation), `packResolve`
(bbox → artifact selection), `packRegistry` (the `registerRegion` /
`registerMeasuringSource` / `registerTransitSource` wiring). Keep each independently
testable; the install state machine especially deserves isolation so its
transactional correctness can be unit-tested without the resolver in scope.

## 3. wasm GEOS oracle can't validate GeometryCollection ops — **Medium**

Flagged as "track" (F2) in the 5–16 review and **still open**.
`geosWasmNode.ts:189-193` documents that it does **not** apply the native
`to_polygonal` filter, so the wasm oracle and native runtime diverge precisely on
mixed-type GeometryCollection outputs from `Difference`/`Intersection`/
`unaryUnion`. The host parity gate (`pnpm test:geos`) can't catch it because the
GC-producing golden cases are `test.skip`-ped via `hostUnsupportedResult`
(`geosGolden.geos.test.ts:163`). Net: the "wasm oracle matches native" guarantee
has a hole exactly where GC handling matters, and CI is green over the hole.

**Remediation.** Mirror the polygonal extract in `geosWasmNode` so the oracle and
native agree, then un-skip the GC golden fixtures — or, if intentional, replace the
silent skip with an explicit asserted-divergence test so the gap is visible.

## 4. `parityHarness.ts` still physically in `src/` — **Medium**

Item #8's `lazy(() => import("GeometryParityScreen"))` (`MainDrawer.tsx:44`) is in
place and _should_ split the 1354-line harness into an async chunk. But the file
still lives under `src/features/questions/measuring/` next to production geometry,
so (a) bundle exclusion depends entirely on Metro tree-shaking the lazy chunk out
of release builds — unverified — and (b) it inflates the measuring directory and
muddies "what is production geometry vs. test scaffolding." It also still owns 4 of
the tree's `as` casts.

**Remediation.** Move it under a `__dev__/` or `__tests__/`-adjacent path that is
unambiguously non-production, and confirm release-bundle exclusion with a
source-map analyzer once. Low effort, removes an ongoing "is this shipping?"
question.

## 5. Admin-division config: module-level mutable global — **Medium**

`matchingCategories.ts:152` keeps `_defaultAdminDivisionPack` /
`_defaultLabelLanguage` as module-level mutable singletons, written by
`setDefaultAdminConfig` from **4 sites** (`AppStateProviders.tsx:206`,
`questionStore.tsx:419,444,477`) to keep non-React Overpass-QL generation in sync
with React state. To its credit it is now **documented** (a clear JSDoc explaining
the React-context-inaccessible constraint), and `labelLanguage` was correctly
hoisted into its own `@/state/labelLanguage` module. But the state is still
duplicated between context and a module variable, kept consistent only by
call-site discipline — a class of bug (forgotten sync site → stale admin levels)
that no test can catch structurally.

**Remediation.** Replace the mutable global with a passed-in accessor /
dependency-injected getter that reads the single source of truth, or have the
non-React path import a stable selector. The documentation is a good interim
mitigation; it is not a fix.

## 6. Measuring "computation" files re-spawned after the item-9 split — **Medium**

Item #9 split the 1486-line `lineMeasuringGeometry.ts` into a thin facade + focused
modules — good. But the focused modules have themselves grown into a cluster of
large files: `lineBufferComputation.ts` (608), `thermometerGeometry.ts` (657),
`lineDistanceComputation.ts`, `measuringGeometry.ts`, `pointMeasuringGeometry.ts`.
The measuring subsystem is again the densest corner of the questions tree. This is
not a regression of the split (the facade is healthy) but a sign the domain is
genuinely complex and would benefit from the planned line/point pipeline
unification (open-work P3 "P5 — unify line/point pipeline").

**Remediation.** Land the line/point pipeline unification rather than splitting
further; a single buffer/distance/mask pipeline parameterized by geometry kind
would shrink the cluster more than another file split.

## 7. `pluralize` + magic-number residue — **Low**

Item #16 added `error`/`success` tokens and an `appConfig` animation section and a
shared `SheetListRow` — but the `pluralize` helper it recommended was never
extracted. The inline `count === 1 ? "" : "s"` pattern is duplicated ~10× across
`HidingZoneScreen.tsx` (5×), `preview.ts`, `ShareSetupModal.tsx`,
`SettingsScreen.tsx`. Trivial, but it's the kind of copy that drifts (e.g. a future
"1 entry / N entries" irregular plural).

**Remediation.** Add `pluralize(n, singular, plural?)` to `src/shared/` and replace
the inline ternaries.

## 8. View god files: `HidingZoneScreen` / `OfflineDataScreen` — **Low–Medium**

`HidingZoneScreen.tsx` (1030, grew from 873) and `OfflineDataScreen.tsx` (688) are
the two largest view files. Both mix derived-data computation, list rendering, and
multiple sub-sections in one component. Not urgent, but they are where the
`pluralize`/`SheetListRow`/derived-stats duplication concentrates, so they're the
natural place to apply #7 and extract presentational sub-components.

---

## Recommended sequencing

1. **#1 logging abstraction** — cheap, zero production-behavior risk, immediately
   stops the regression and unblocks trustworthy perf profiling. **(done in this
   pass.)**
2. **#3 wasm GC parity** — small, closes a correctness-validation hole that CI
   currently hides.
3. **#2 `regionPacks` split** — larger, but it's the riskiest growing file; do it
   before it grows again.
4. **#5 admin global**, **#4 parityHarness relocation** — de-fragilize.
5. **#6 measuring unification**, **#7/#8 UI dedup** — hygiene / planned epics.

## Healthy areas worth preserving as models (still true)

- `MapAppScreen.tsx` — thin coordinator.
- `questionRegistry.ts` / `coreTypes.ts` — clean non-leaky type registry.
- `geosGeometryBackend.ts` logging discipline — the template the #1 logger should
  generalize.
- `MASK_RULES` / `buildEligibilityConstraints` single-sourcing — the polarity bug
  class is structurally prevented.
- `as any` reduction (53 → 29) and zero empty `catch {}` — real follow-through from
  the last audit.

---

## Work done in this pass (#1)

Implemented the logging primitive, **migrated every production `console.*` in
`src/`**, made the config-file demotion knob, and locked it in with an eslint
ban. See the working tree:

- **`src/shared/logger.ts`** (+ `__tests__/logger.test.ts`) —
  `createLogger(namespace)` returning `{ debug, info, warn, error }`. Levels are
  ordered `debug < info < warn < error < silent`; `debug`/`info` are dev-only
  with a hard **production floor** (never emitted outside `__DEV__` regardless of
  config), `warn`/`error` always emit unless a namespace is `silent`. The tag is
  folded into the leading string arg, so output reads `[ns] message` exactly as
  the old inline prefixes did (no log-format churn, string assertions still
  match).
- **`src/config/logging.ts`** — the editable `LOGGING_CONFIG` blacklist/demote
  knob the user asked for: `namespaces: { lineBuffer: "silent", search: "warn" }`
  quiets a namespace once you're done debugging it, with no call-site edits.
  `setLoggerNamespaceLevel(ns, level)` does the same at runtime (dev menu).
- **eslint `no-console: error`** for `src/**/*.{ts,tsx}` (exempting tests and
  `logger.ts`) — raw `console` can no longer regress back in. This is what makes
  the gating permanent rather than another hand-maintained convention.
- **Migrated all ~37 production files** off raw `console` onto namespaced loggers
  (geometry, measuring, matching, offline/packs, state/persistence, sheet, map,
  hiding-zone, sharing). Inline `[ns]`/`LOG_PREFIX` prefixes were folded into the
  logger namespace; meaningful sub-tags (e.g. `[adminBoundary]`) were kept as
  message content.
- **Production raw `console.*`: 177 → 0** in `src/` (excluding the logger itself
  and tests).
- **AGENTS.md** gained a "Logging" section documenting the rule, the
  `createLogger` usage, level semantics, and both demotion paths.
- `pnpm lint` (with the new rule), `pnpm typecheck`, and `pnpm test` (103 suites,
  1251 passing) are green. `pnpm check`'s format step reports only **3
  pre-existing** warnings in files untouched by this pass
  (`data/geofabrik/scripts/lib/osmiumPipeline.mjs`, `docs/README.md`,
  `site/packs/index.html`) — confirmed pre-existing via `git status`.

---

_Generated 2026-06-21. Line references are against this revision; re-grep before
acting on any single citation._

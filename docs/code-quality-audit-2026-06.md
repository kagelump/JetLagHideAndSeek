# Code & Architecture Quality Audit — June 2026

A whole-codebase audit for **tech debt, fragility, and simplification
opportunities**. Findings are ranked by impact across the whole project, then
detailed per subsystem with `file:line` references and concrete remediations.

Scope covered: `src/state`, `src/sharing`, `src/features/questions`,
`src/shared/geometry` + `modules/native-geometry`, `src/screens` +
`src/features/{map,sheet,playArea,hidingZone}`, `src/features/offline`, and the
`data/` pipelines.

Method: parallel focused reads of the largest/most-coupled files plus
cross-cutting greps. Tests (`__tests__`) were read only to judge fragility, not
audited for their own quality.

---

## Cross-cutting metrics (non-test `src/`)

| Signal                                    | Count   | Read                                                     |
| ----------------------------------------- | ------- | -------------------------------------------------------- |
| `console.*` calls in production paths     | **143** | Many in geometry/question hot paths, not `__DEV__`-gated |
| `as any` / `as unknown as` / `@ts-ignore` | **53**  | Concentrated at geometry + wire-codec boundaries         |
| Source files > 600 lines (non-test)       | **9**   | Listed below; 4 are > 850 lines                          |

Files over 600 lines: `measuring/lineMeasuringGeometry.ts` (1486),
`measuring/parityHarness.ts` (1404), `sheet/MainDrawer.tsx` (1041),
`offline/regionPacks.ts` (956), `state/questionStore.tsx` (904),
`hidingZone/HidingZoneScreen.tsx` (873), `sharing/wire/minified.ts` (871),
`matching/osmMatchingCache.ts` (712), `hidingZone/hidingZone.ts` (622).

---

## Top-line ranking

| #   | Finding                                                                               | Severity       | Subsystem         |
| --- | ------------------------------------------------------------------------------------- | -------------- | ----------------- |
| 1   | Question schemas + normalization triplicated across persistence/wire/minified         | **Critical**   | state / sharing   |
| 2   | Eligibility-mask pipeline duplicated `MainDrawer` ↔ `NativeMap` (polarity-sensitive) | **Critical**   | sheet / map       |
| 3   | GEOS op pipeline reimplemented in 4 languages → 3-surface parity tax                  | **High**       | geometry / native |
| 4   | Hand-maintained 871-line wire codec full of unchecked double-casts                    | **High**       | sharing           |
| 5   | Persistence migrator wipes **all** state on any single validation failure             | **High**       | state             |
| 6   | `MainDrawer` god module + hand-rolled router/animation state machine                  | **High**       | sheet             |
| 7   | Network-boundary data (catalog/pack payloads) parsed with raw casts, no Zod           | **High**       | offline / data    |
| 8   | `parityHarness.ts` (1404 lines of test scaffolding) lives in production `src/`        | **High**       | questions         |
| 9   | `lineMeasuringGeometry.ts` god file (1486 lines)                                      | **High**       | questions         |
| 10  | 53 unsafe casts erase type safety at the riskiest (geometry) boundaries               | **High**       | cross-cutting     |
| 11  | WKB decoder discards correct native results on GeometryCollection output              | **Medium**     | geometry          |
| 12  | Unconditional `console.*` (143) in geometry/question hot paths                        | **Medium**     | cross-cutting     |
| 13  | Data pipelines (geofabrik/transit/packs) duplicate extraction logic                   | **Medium**     | data              |
| 14  | ABI / version constants hand-synced across 4 files; silent JS degradation             | **Medium**     | geometry / state  |
| 15  | Cross-store coupling + module-level mutable globals                                   | **Medium**     | state             |
| 16  | UI/animation magic numbers bypass `appConfig` + `colors` tokens                       | **Low–Medium** | UI                |

---

## 1. Single-source-of-truth: schema & normalization triplication — **Critical**

Status: Done

## 2. Eligibility-mask pipeline duplicated, polarity-sensitive — **Critical**

Status: Done

## 3. GEOS op pipeline reimplemented in 4 languages — **High**

Status: Done — extracted the shared C core
`modules/native-geometry/ios/geos_ops.{h,cpp}` (the one
parse→validate→MakeValid→op→write→free state machine, `extern "C"`). It is the
single source compiled into the iOS pod, the SPM test package, and the Android
`.so` (symlinked into `Sources/CGEOS/` + `android/src/main/cpp/`; wired into the
podspec, `Package.swift`/CGEOS auto-discovery, and `CMakeLists.txt`).
`GeosCore.swift` and `native-geometry-jni.cpp` are now thin marshalling shims
(`Data`/`jbyteArray` ⇄ `GeosWkbBuffer`); `GeosBridge.kt` and
`NativeGeometryModule.swift` are unchanged. The wasm helper
(`geosWasmNode.ts`) now applies the **same** MakeValid recovery
(`parseAndValidate`) so the geos-wasm oracle matches native runtime behavior on
invalid input — closing the divergence called out below. ABI stays at 2 (the
WKB function surface is unchanged). Native rebuild + the iOS XCTest / Android
instrumented suites validate the binary side; the host geos-wasm parity gate
(`pnpm test:geos`) passes. The residual GeometryCollection decode gap is audit
item #11.

The identical "parse WKB → `GEOSisValid_r` → `GEOSMakeValid_r` recovery → run op
→ `GEOSGeomToWKB_buf` → free" sequence is hand-written in Swift
(`GeosCore.swift:164-346`), Kotlin/C++ JNI
(`native-geometry-jni.cpp:51-291`), **and** wasm-JS
(`geosWasmNode.ts:134-205`). This is the root cause of the 3-parity-surface tax
(iOS XCTest + Android instrumented + geos-wasm golden) — every behavioral change
must be made and re-tested in four places. Worse, the wasm "oracle" path
**omits the MakeValid recovery** the native paths perform
(`geosWasmNode.ts:165-178`), so golden fixtures don't match runtime native
behavior on invalid input.

**Remediation:** extract the parse/validate/op/write/free state machine into one
C++ core (`geos_ops.cpp`) compiled into both the iOS pod and the Android `.so`,
exposing a single `runOp(opcode, wkbA, wkbB) -> wkb`. Swift/Kotlin become
~10-line marshalling shims. Align the wasm helper's validity policy or document
the divergence explicitly. Collapses 3 native logic surfaces toward 1.

## 4. Hand-maintained 871-line wire codec, unchecked double-casts — **High**

Status: Done

## 5. Persistence migrator wipes everything on one bad slice — **High**

`migratePersistedAppState` (`appState.ts:359-362`) does a single `safeParse` and
returns `null` on any failure; `persistence.ts:109-123` responds by **deleting
the persisted slices**, and every error is swallowed by empty `catch {}`
(`persistence.ts:44,55,120,160,169`). `persistAppState` also silently ignores
write failures. A single forward-incompatible question (exactly the drift in #1)
wipes play area + hiding zones + all questions on next launch, with no log.

**Remediation:** validate slices independently and drop only the failing slice;
`safeParse` per-question so unknown types are skipped, not the whole array.
Surface failures (`console.warn`/dev assert) instead of silent `catch {}`.
Centralize version detection/migration in one `migrate(value)` chain (today
version handling is split across `codec.ts:48-72`, `minified.ts:235-238`,
`appState.ts:359-387`, and a future v2 blob fails parse → data wipe).

## 6. `MainDrawer` god module + hand-rolled router — **High**

`src/features/sheet/MainDrawer.tsx` (1041 lines) owns a hand-rolled slide
transition state machine (`:78-203`, with `transitionIdRef`/`cleanupTimerRef`
race guards and a `setTimeout` cleanup that can leave stale state on fast
double-navigation), the route switch (`:271-341`), the first-run + active-game
HUD with elimination math (`:343-626`), and geometry helpers — a _navigation
shell_ importing `buildCombinedEligibilityMask` and `geomAreaM2`. The route graph
has **three** sources of truth that must be hand-synced: the `SheetRouteName`
union, the `routeDepth` map (`sheetNav.ts:3-15`), and the `getBackTarget` switch.

**Remediation:** split into `MainDrawer` (route container + transition),
`MainSheetContent` (own file), and shared geometry utils. Encode the route graph
as one `{ name, parent }[]` structure and derive depth + back-target from it.
Evaluate replacing the bespoke transition machine with expo-router nested
navigation (Reanimated is already present). Note: `MapAppScreen.tsx` (111 lines)
is by contrast a healthy thin coordinator — leave it.

## 7. Network-boundary data parsed with raw casts, no Zod — **High**

`src/features/offline/regionPacks.ts` ingests the GitHub Pages catalog, the
installed index, and pack payloads via `JSON.parse(...) as ...`
(`:127,451,564,778,808,831,859`) — no Zod validation, contrasting sharply with
the careful schemas everywhere else in the app. The file does correctly verify
sha256 + MD5 integrity (`:421-447,493,538-552`), so blob _corruption_ is caught,
but a **schema-shaped** change in catalog/payload structure flows straight into
typed code as unchecked `any`-ish data. Empty `catch {}` blocks abound
(`:128,199,361,428,...`).

**Remediation:** define Zod schemas for the catalog, installed index, and each
artifact payload; `safeParse` at the network boundary and reject/log on
mismatch. Reuse the pipeline-side `catalogSchema.mjs`/`metaSchema.mjs` shapes so
producer and consumer share one contract.

## 8. `parityHarness.ts` test scaffolding in production `src/` — **High**

`src/features/questions/measuring/parityHarness.ts` (1404 lines) is parity/fuzz
/stress test scaffolding imported by `GeometryParityScreen.tsx` — a `__DEV__`
-gated dev screen. But the screen is a permanent member of the `SheetRouteName`
union and `renderRouteContent` (`MainDrawer.tsx:306-311`), so unless
tree-shaking is perfect the harness + its fixtures ship in production bundles.

**Remediation:** lazy-`import()` `GeometryParityScreen` so it (and
`parityHarness`) is fully excluded from production, or move the harness under a
`__tests__`/dev-only path. Confirm bundle exclusion with a source-map analyzer.

## 9. `lineMeasuringGeometry.ts` god file — **High**

`src/features/questions/measuring/lineMeasuringGeometry.ts` (1486 lines) is the
largest non-test file. Combined with `parityHarness.ts` (1404) and
`pointMeasuringGeometry.ts` (425), the measuring geometry is the densest,
hardest-to-navigate corner of the questions subsystem.

**Remediation:** decompose by concern (line stitching, distance computation,
mask emission, render-state derivation) into focused modules; the existing
`measuringGeometry.ts` / `pointMeasuringGeometry.ts` split shows the seams. The
matching subsystem (`osmMatchingCache.ts` 712 lines) deserves the same
treatment. Note: `questionRegistry.ts` (88 lines) and `coreTypes.ts` (28) are
genuinely thin — the registry abstraction is **not** leaky and is a good model.

## 10. 53 unsafe casts at geometry boundaries — **High**

15 `as any` casts live in `MainDrawer.tsx`'s elimination `useMemo` alone
(`:376-413`), plus `geomAreaM2(feature.geometry as any)` (`:642`) — defeating the
compiler on the most polarity-sensitive code. Geometry backend methods each
re-declare the native surface via inline `require("native-geometry") as {…}`
(`geosGeometryBackend.ts:209,357,399,434,472`), repeating an unchecked assertion
6× and re-resolving the module registry per op.

**Remediation:** align `GeoJsonFeatureCollection`/render-state types with what
`buildCombinedEligibilityMask` and `geomAreaM2` accept so the casts vanish (one
typed adapter if real variance exists). Import the typed native surface once from
`modules/native-geometry/src/index.ts` and keep a single injectable test seam.

## 11. WKB decoder discards correct native results on GC output — **Medium**

`wkb.ts:374-418` cannot skip unknown sub-geometry bytes, so **any** non-polygon
member in a GeometryCollection throws `WkbError`, which the backend routes to the
slow full-JS polyclip fallback (`geosGeometryBackend.ts:386-393`). GEOS
legitimately emits mixed collections from `Difference`/`Intersection` on touching
geometries, so a correct native result is silently recomputed in JS.

**Remediation:** strip to polygonal output on the **native** side before
serialization (`GEOSGeom_extractUniqueComponents` / collection filtering), so the
JS decoder only ever sees Polygon/MultiPolygon; then delete the GC branch.

## 12. Unconditional `console.*` in hot paths — **Medium**

143 production `console.*` calls. In geometry, the `[geos] … in Xms` summaries
(`geosGeometryBackend.ts:318,332,374,410,448,526`) and native `NSLog`/`LOGD`
fire on **every** op regardless of `__DEV__`, inside mask-building loops over
many polygons — each is a synchronous RN bridge call. `hidingZone.ts:540-543`
logs station counts on every `getPresetPlayAreaStats` call (invoked from a
`useMemo`). The questions subsystem alone has 84.

**Remediation:** gate all summary/perf logs behind `__DEV__` or a
`DEBUG_GEOMETRY` flag; drop success-path native logs.

## 13. Data pipelines duplicate extraction logic — **Medium**

`data/geofabrik/scripts/lib`, `data/transit/scripts/lib`, and
`data/packs/scripts/lib` each carry overlapping OSM-extraction concerns (line
stitching / way-stitch, polygon dissolve, operator/name normalization, OSM route

- station extraction). `osmRoutes.mjs` (1318) and `extract-measuring-bundles.mjs`
  (1211) are god files; the packs pipeline reportedly mirrors transit. The repo
  already deprecated `data/odpt/` for `data/transit/` — same drift risk here.

**Remediation:** factor a shared `data/lib/osm/` (stitching, dissolve,
normalization, route/station extraction) consumed by all three pipelines; the
packs builders become thin orchestrators over it. Break the two 1200+-line
extractors into staged steps.

## 14. ABI / version constants hand-synced; silent degradation — **Medium**

The native ABI version (`2`) is hardcoded in **four** places —
`geometryBackend.ts:221-238`, `src/index.ts:15`,
`NativeGeometryModule.swift:14`, `GeosBridge.kt:29` — bumped in manual lockstep.
On mismatch the code only `console.warn`s once and silently runs overlay ops in
JS, which per the project docs can **hard-lock ~25s** on body-of-water dissolve.
The single most user-impactful failure (stale dev binary) surfaces as one
easily-missed log.

**Remediation:** generate the Swift/Kotlin/TS ABI constants from one shared JSON
(or assert equality in a test). Surface a persistent in-app **dev banner** when
`nativeAbi < expected`, since the consequence is a multi-second lock.

## 15. Cross-store coupling + module-level mutable globals — **Medium**

`hidingZoneStore` imports `useLabelLanguage` from `questionStore`
(`hidingZoneStore.tsx:17,216`), forcing fragile provider ordering — i18n state
lives in the wrong store. Admin-division config is mutated through a module-level
singleton `setDefaultAdminConfig` called from 4 sites
(`questionStore.tsx:381,405,435`, `AppStateProviders.tsx:199-204`) to keep
non-React paths in sync — state duplicated between context and a module variable.

**Remediation:** hoist `labelLanguage` + admin-division config into a dedicated
settings/i18n context both stores consume; replace the mutable global with a
passed-in accessor or derived selector.

## 16. UI/animation magic numbers bypass config + theme — **Low–Medium**

`appConfig.ts` and `colors.ts` exist, yet `TRANSITION_MS=300`, swipe thresholds
`80`/`500` (`MainDrawer.tsx:61,198`), camera factors `0.48/120/40`
(`camera.ts:75-78`), timers `400/100/350` (`PlayAreaScreen.tsx`), and hardcoded
error/success hex (`#b42318`, `#d32f2f`, `#2e7d32`) stay inline. `colors.ts` has
no `error`/`success` token despite 3 screens needing one. Empty `container: {}`
styles (`HidingZoneScreen.tsx:645`, `PlayAreaScreen.tsx:470`) and unused style
keys add noise.

**Remediation:** add `error`/`success`/`danger` tokens; move animation/timer
constants into an `appConfig` `ui`/`animation` section; drop empty/unused styles.
Also extract repeated `pluralize(n, noun)` and a shared `<PressableCard>`/
`<ListRow>` (re-implemented in 4 screens).

---

## Recommended sequencing

**Phase 1 — stop the bleeding (correctness/data-loss).** #1 schema
consolidation, #5 resilient per-slice migration, #2 single mask hook. These three
remove the realistic data-loss and silent-divergence paths and are mutually
reinforcing.

**Phase 2 — de-fragilize boundaries.** #4 generated wire codec, #7 Zod at the
pack network boundary, #10 kill the geometry casts, #14 single-source ABI +
visible degradation banner.

**Phase 3 — structural simplification.** #3 unify the GEOS core (biggest
long-term parity-tax win), #6 split `MainDrawer` + data-driven route graph, #8
exclude `parityHarness` from prod, #9/#13 break up the geometry/pipeline god
files.

**Phase 4 — hygiene.** #11 native polygonal WKB, #12 gate logs, #15 store
decoupling, #16 tokens + magic numbers.

### Healthy areas worth preserving as models

- `MapAppScreen.tsx` (111 lines) — a genuinely thin coordinator.
- `questionRegistry.ts` / `coreTypes.ts` — a clean, non-leaky type registry.
- Native memory management — every error path frees its GEOS handles across all
  three native impls (the geometry debt is duplication + silent fallback, not
  leaks).
- Pack blob integrity — sha256 + MD5 verification is in place (the gap is
  _schema_ validation, not corruption).

---

_Generated 2026-06-15. Line references are against the audited revision; re-grep
before acting on any single citation._

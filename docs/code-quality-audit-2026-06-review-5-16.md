# Review — Code Quality Audit items 5–16

Branch: `code-audit-4-16` (working tree, uncommitted). Reviewed against
`docs/code-quality-audit-2026-06.md` items **5–16**. Items 1–4 were already
landed on prior commits.

## Verdict

**Solid, ship-able work.** All gates pass locally:

- `pnpm typecheck` ✅
- `pnpm test` ✅ (90 suites pass, 1 skipped; 1150 pass)
- `pnpm test:geos` ✅ (host parity gate; 6 suites)
- `pnpm check` ✅ (lint, format, perf-typecheck, POI-selector drift, **0 circular deps**)

Every targeted item shows a real, on-point change rather than a cosmetic
touch. Two genuine defects and a handful of partial-scope / consistency notes
below — only the first is worth fixing before merge.

---

## Per-item assessment

| # | Item | Status | Notes |
|---|------|--------|-------|
| 5 | Per-slice resilient migration | ✅ Strong | `safeParse*` per slice; per-question filter; warnings replace silent `catch {}` |
| 6 | Split `MainDrawer` + data-driven route graph | ✅ Strong | 1041→360 lines; `ROUTE_GRAPH` single-sources depth+back-target |
| 7 | Zod at pack network boundary | ✅ Good | `packSchemas.ts` for index/payloads; catalog already validated. One soft spot (below) |
| 8 | Exclude `parityHarness` from prod | ✅ Good | `lazy()`/`Suspense` + `if (!__DEV__) return null` |
| 9 | Break up `lineMeasuringGeometry.ts` | ✅ Strong | 1486→276 facade; 3 focused modules; no runtime cycle |
| 10 | Kill geometry casts | ✅ Strong | `MaskFeatureCollection`/`NativeGeometryModule` types erase the `as any`s |
| 11 | Native polygonal WKB | ✅ Good | `to_polygonal` strips GC members natively; one parity gap (below) |
| 12 | Gate hot-path logs | ✅ Good | `__DEV__`-gated across geometry/regionPacks/measuring |
| 13 | Share data-pipeline extraction | 🟡 Partial | Only haversine/bbox shared; god files untouched |
| 14 | Single-source ABI + degradation banner | ✅ Strong | `abi-version.json` + `AbiMismatchBanner` mounted in `MapAppScreen` |
| 15 | Decouple stores / kill mutable global | 🟡 Mixed | `labelLanguage` extracted cleanly; admin-config global **kept** + a buggy guard |
| 16 | UI tokens / magic numbers | ✅ Good | `colors` error/success/warning tokens; `appConfig` animation/camera/search sections |

---

## Findings to address

### F1 — `setDefaultAdminConfig` dev guard cries wolf (item 15) — **should fix**

`matchingCategories.ts` keeps the module-level mutable global (the audit asked
to replace it) and instead adds a `_initialized` guard:

```js
if (__DEV__ && _initialized) { console.warn("...called after first initialization..."); }
_initialized = true;
```

But the function is *designed* to be called on every admin-pack / label-language
change — its own JSDoc says "Call this … whenever the admin division pack or
label language changes," and `questionStore.setLabelLanguage`
(`questionStore.tsx:393`), `setAdminDivisionPack` (`:418`), and the
`AppStateProviders` sync effect all call it on legitimate user action. Since
`_initialized` is set on the first call and never reset, **every legitimate
runtime settings change after the first emits this warning.** The guard fires on
exactly the path it claims is illegal, so it trains developers to ignore it.

Pick one:
- Drop the guard (it's guarding against a non-problem), or
- Re-scope it to detect a real misuse — e.g. only warn on calls from outside the
  state layer, which the current flag can't distinguish.

Dev-only severity, but it's a defect this branch introduces, not pre-existing.

### F2 — wasm oracle doesn't mirror native `to_polygonal` (item 11) — **track**

`geos_ops.cpp` now strips non-polygonal members from GeometryCollection results
before WKB serialization. The wasm oracle (`geosWasmNode.ts`) does **not** apply
the same step — its `differenceWKB`/`unionWKB`/`intersectionWKB`/`unaryUnionWKB`
serialize the raw GEOS result. For pure-polygonal outputs (the vast majority)
`to_polygonal` is an identity clone, so they agree; the two engines only diverge
on mixed-type GC outputs — which is precisely the case item 11 was about.

This re-opens, in the opposite direction, the native-vs-wasm divergence that
item 3 closed for MakeValid. The host parity gate does **not** catch it because
the GC-producing golden cases (`unaryUnion/water-cluster-dissolve`,
`parse/tokyo-rail-linestring`, `parse/osaka-stations-multipoint`) are currently
**skipped**. Latent and narrow, but it undercuts the "wasm oracle matches native
runtime" guarantee. Recommend mirroring the polygonal-extract in `geosWasmNode`
(or documenting the divergence where the skipped fixtures live).

### F3 — meta `adminLevels` is `z.unknown()` then raw-cast (item 7) — **minor**

In `packSchemas.ts`, `metaPayloadSchema.adminLevels` is `z.unknown().optional()`,
and `regionPacks.registerArtifact` casts it to `{ matching?: number[] }` and
reads `adminLevels.matching`. So the one consumed nested field is **not**
actually schema-validated — the Zod pass doesn't cover the field whose
correctness matters most. Tighten to
`z.object({ matching: z.array(z.number()).optional(), extract: z.array(z.number()).optional() }).optional()`.
(`categories`/`attribution` staying `z.unknown()` is fine — not consumed.)

### F4 — duplicate payload validation (item 7) — **trivial**

Boundaries/transit/meta payloads are validated twice: once via
`validateParsedPayload` in `installSingleArtifact` and again via
`<kind>PayloadSchema.safeParse` inside `registerArtifact`. Harmless, just
redundant work + a second error surface. Consider validating once (e.g. have
`registerArtifact` trust an already-validated payload, or drop the install-path
call).

---

## Partial-scope notes (not blockers)

- **Item 13** delivers only the shared geometry primitives (`data/lib/geo/`:
  `haversineKm`, `computeBbox`, `bboxesIntersect`, `padBbox`). The audit's larger
  ask — sharing stitching / dissolve / normalization / route-station extraction
  and breaking up `osmRoutes.mjs` (1318) and `extract-measuring-bundles.mjs`
  (1211) — is untouched. The haversine refactor is numerically equivalent
  (old `R=6371000` m ≡ `haversineKm × 1000`), verified.
- **Item 10** redeclares the native surface as a local `NativeGeometryModule`
  type in `geosGeometryBackend.ts` rather than importing it from
  `modules/native-geometry/src/index.ts` (the audit's suggested single source).
  The `require()` is still needed for the Jest mock seam, but the *type* could be
  imported to avoid a second drift point. Small.
- **Item 6** route-graph change shifts `question-detail` depth 4→2 (now parent
  `questions`). Back-targets are byte-for-byte preserved; only `getNavDirection`
  could differ, and only for a direct `matching`↔`question-detail` transition,
  which the route graph doesn't allow. Cosmetic at most; no observed regression.

---

## Things done well

- Item 5 is the standout: independent per-slice `safeParse`, per-question filter
  so one bad question can't wipe the array, `__DEV__` warnings replacing the
  silent `catch {}` blocks, and a clear comment distinguishing user-initiated
  "Clear All Data" from per-slice recovery. Test coverage extended
  (`persistence.test.ts`).
- Item 14 is complete and matches the audit's prescription exactly:
  `abi-version.json` as the TS source of truth, native constants asserted in the
  iOS/Android suites, and a persistent non-dismissible `AbiMismatchBanner`
  surfacing the ~25 s-lock degradation in `__DEV__`.
- Item 11's `to_polygonal` correctly handles ownership: clones pass-through,
  `createCollection` takes ownership on the union path, and the failure branch
  frees the clones. Memory discipline preserved.
- Item 9 keeps a thin re-export facade so every existing import path still
  resolves, and the type-only back-import (`LineOrPolygonFeature`) avoids a
  runtime cycle (confirmed by `check:circ` = 0 cycles).
- Item 10's cast removal in the polarity-sensitive elimination path (`MASK_RULES`
  / `buildEligibilityConstraints`) is type-only; polarity logic unchanged and the
  render-state polarity tests still pass.

---

_Reviewed 2026-06-16 against the working-tree diff. Re-run `pnpm test:geos` and
the native XCTest/Android suites before merging the geometry changes per
AGENTS.md._

---

## Round 2 — deeper correctness pass

A second pass focused on whether the large mechanical extractions (items 6, 9)
preserved behavior, whether the item 5 fix is genuinely exercised, and edge
cases. Net: confidence raised on the big refactors, one new minor finding (F5),
and F3 sharpened with a concrete failure mode.

### Verification evidence (refactors are faithful)

- **Item 5 is the strongest change in the branch.** Confirmed the *old* code wiped
  **all** persisted state on (a) any missing slice key
  (`entries.some(null) → clearSplitPersistedAppState`), (b) any slice failing
  `JSON.parse` (the whole `rawState` build was in one `try`), and (c) any single
  invalid question (whole-object `safeParse`). The new per-slice path removes all
  three. The old `clearSplitPersistedAppState` helper is fully deleted (no dead
  refs). The tests **invert** the old wipe assertions: the "some slice keys are
  missing (no wipe)" and "invalid JSON in a slice" tests now assert
  `result).not.toBeNull()`, that surviving slices keep their values, and that the
  existing key is **not** removed. Directly covers the audit #5 data-loss path.
- **Item 9 extraction is byte-faithful.** Diffed the two heaviest moved functions
  against `HEAD`: `computeLineDistance` is identical, and `computeLineBuffer`
  differs only by Prettier object-literal reflowing (0 logic changes). All 146
  measuring tests pass. Caveat: several previously module-private helpers
  (`metersToDegLon/Lat`, `simplifyCoords`, `featureBbox`, …) are now exported to
  cross module boundaries — acceptable, but they widen the module's public
  surface; fine to leave.
- **Item 6 transition machine is byte-faithful.** Diffed the
  `transitionIdRef`/`startedTransitionIdRef`/`cleanupTimerRef` race-guard block
  old vs new — the only deltas are the magic-number→token swaps
  (`TRANSITION_MS`→`ANIMATION.sheetTransitionMs`, `80/500`→threshold/velocity
  tokens). The bespoke state machine itself is unchanged; values match the
  originals exactly.

### F5 — `AbiMismatchBanner` ordering + dead guard (item 14) — **minor**

```js
const nativeAbi = typeof nativeAbiVersion === "function" ? nativeAbiVersion() : 0;
if (!__DEV__) return null;
if (nativeAbi >= EXPECTED_NATIVE_ABI) return null;
```

Two small things:
1. `nativeAbiVersion()` (a native bridge call) runs on **every** render *before*
   the `if (!__DEV__) return null` guard — so production builds pay a wasted
   bridge call each `MapAppScreen` render and then return null. Move the
   `__DEV__` check to the first line.
2. `typeof nativeAbiVersion === "function"` is dead defensive code —
   `nativeAbiVersion` is a static named import, always a function. The real
   unavailable-native case is already handled inside it (returns `0`). Drop the
   `typeof` guard.

Functionally correct (banner does show ABI 0 when native is unlinked, which is
the desired signal); this is pure hygiene.

### F3 sharpened — concrete failure mode

The `metaPayloadSchema.adminLevels = z.unknown()` gap isn't just theoretical. In
`registerArtifact`'s meta branch:

```js
const adminLevels = data.adminLevels as { matching?: number[] } | undefined;
if (adminLevels?.matching && data.bbox) {
    registerPackAdminLevels({ ..., matchingLevels: adminLevels.matching.slice(0, 4) as [...] });
}
```

If `adminLevels.matching` is truthy but **not** an array (e.g. a string from a
malformed pack), `z.unknown()` lets it through, `.slice(0, 4)` returns a string,
and it's cast to `[number, number, number, number]` — garbage admin levels
registered with no error. Tightening `adminLevels` to a real Zod object closes
exactly the field the validation is supposed to protect.

### Re-confirmed, no issue

- `to_polygonal` (item 11) ownership is correct on all branches: pass-through
  clone, single-member transfer, `createCollection` ownership transfer, and the
  `createCollection`-failure path that frees the orphaned clones. No double-free,
  no leak.
- Item 9 facade re-exports everything external consumers used (whole-repo
  `typecheck` + `check:circ` would have failed otherwise; both pass). The
  type-only back-import of `LineOrPolygonFeature` is erased and creates no
  runtime cycle.
- Route-graph (`buildMaps`) back-targets match the old hand-written switch
  exactly; the only depth shift (`question-detail` 4→2) cannot change any
  reachable transition's forward/back direction.

### Updated bottom line

Unchanged from round 1: **F1** (the `_initialized` guard that warns on legitimate
settings changes) is the one worth fixing before merge. **F2** (wasm oracle not
mirroring native `to_polygonal`) should be tracked. **F3/F4/F5** are minor
hygiene. Everything else verified faithful and well-tested.

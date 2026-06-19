# Body-of-water dark-circle — root cause found (handoff 4)

> Naming note: this is the **fourth** investigation pass (handoffs 1–3 live in
> `water-bundle-notes-handoff1.md`). It's filed as `handoff2.md` per request.
> It **supersedes the root-cause conclusions of handoffs 1–3** for the
> Nakameguro dark circle: those each blamed an _input_ layer (giant dissolved
> geometry, aggressive simplification, degenerate slivers). With fixes A+B and
> the handoff-3 degenerate filter all live in the shipped artifact, the bug
> still reproduces — and the real cause is in the **buffer-dissolve step**, not
> the inputs.

## TL;DR

For a **Body of Water / Closer** question near Nakameguro, the eligibility hit
mask has a large dark hole right on the Meguro river junction
(`~[139.701994, 35.642352]`) where it should be light. Reproduced through the
**real runtime code path** (`buildMeasuringRenderState → computeLineBuffer`)
with the genuine `geosGeometryBackend` running on geos-wasm.

**Root cause:** `computeLineBuffer` merges all buffer pieces (polygon-area
buffers + river-line buffer) into one **overlapping-members MultiPolygon**, then
calls `geosGeometryBackend.unaryUnion(merged)`. Every GEOS op runs
`parse → validate → MakeValid → op` (`geos_ops.cpp`, mirrored in
`geosWasmNode.ts:parseAndValidate`). The merged blob is **invalid** (members
overlap), so **`GEOSMakeValid` runs before the union**. MakeValid's default
_linework_ method reconstructs area under an even-odd rule, so regions covered
by an **even** number of overlapping pieces — exactly the polygon-buffer ∩
line-buffer overlap at the river junction — become **holes**. `unaryUnion` then
returns that already-holed geometry. The pre-dissolve set-union covers the
point; the post-dissolve result does not.

This is **not a wasm artifact**: native GEOS on device uses the same
`parse→validate→MakeValid→op` pipeline, so the device hits the identical cause.

## Reproduction

Test: `src/features/questions/measuring/__tests__/darkCircleRepro.geos.test.ts`

```bash
pnpm test:geos darkCircleRepro
```

It loads features from the on-disk pack artifact
(`data/packs/dist/asia-japan-kanto/measuring-body-of-water.json.gz`), injects
them via `__setLineBundleForTest`, swaps the native-geometry WKB ops for the
geos-wasm oracle (same trick as `geosParity.test.ts`), sets the real
`geosGeometryBackend` (`name === "geos"`, so the dissolve path runs), and drives
`buildMeasuringRenderState` with the device's seeker pin and play area.

### Fixtures (from the device report + screenshot)

```text
seeker center : [139.6948, 35.64628]   (the Measuring sheet's pin)
notch         : [139.701994, 35.642352]
play area     : Tokyo 23-Wards bbox [139.563, 35.523, 139.919, 35.818]
resolved radius (seeker→nearest water) : 172.5 m
```

### Artifact identity (the trap that wasted handoff-3 effort)

The device runs the **published** blob. It is byte-identical to the on-disk
`dist/` file: the catalog's `sha256` (`af750ac5…`) is the hash of the
**decompressed** payload; the gzip on disk (`fe966466…`) decompresses to exactly
that. So `tools/repro-dark-circle.mjs` tested the _right bytes_ and still printed
"CLEAN" — because **that script re-implements the pipeline inline and never runs
the GEOS `unaryUnion` dissolve** (it concatenates pieces and does its own
point-in-polygon, which is a set-union by membership — i.e. the _correct_
coverage the bug destroys). The inline script is a false oracle for this bug;
always exercise the real `geosGeometryBackend` path.

## Stage-by-stage isolation

Each handoff-1/2/3 hypothesis is an input layer; the repro test walks every
stage and clears all of them:

| Stage (real code path)                                                                                                |       Covers notch?       |
| --------------------------------------------------------------------------------------------------------------------- | :-----------------------: |
| Channel survives prep (`filterFeaturesByBboxMargin` → `filterPolygonMembersByBbox` → `simplifyPolygonBufferFeatures`) | ✅ stays 2.4 m from notch |
| Buffer the near-notch channel **member alone**                                                                        |            ✅             |
| Buffer each prepared **feature whole** → merge → unaryUnion (**polygon path only**)                                   |            ✅             |
| River-**line** buffer alone                                                                                           |            ✅             |
| **Merged set-union of (polygon buffers + line buffer)** (membership PIP)                                              |            ✅             |
| **`geosGeometryBackend.unaryUnion(merged)`** (the production final step)                                              |      ❌ **drops it**      |
| Pieces unioned **pairwise via binary `GEOSUnion`** (no MakeValid)                                                     |            ✅             |

So: prep is fine, the per-member buffer is fine, the polygon-only dissolve is
fine, the line buffer is fine, and the merged set-union is fine. The **only**
lossy operation is `unaryUnion(merged)` — and replacing it with pairwise binary
union (which never triggers MakeValid because each input is individually valid)
restores coverage.

### Magnitude

Over a ±150 m grid at 5 m around the notch (geos-wasm):

```text
cells within radius of water (should be light) : 3686
  kept by unaryUnion                            :  344
  dropped by unaryUnion                         : 3342   (~90%)
```

The dissolve doesn't punch a hairline notch — it removes ~90% of the local
river-band coverage, which is why the user sees a sizeable dark blob ("circle").
The exact magnitude is geos-wasm-specific; the device (native GEOS 3.14) shows
the same _kind_ of dark region via the same code path, but its extent may
differ. Confirm on-device extent via the parity harness if precise numbers
matter.

## Precise mechanism

1. `computeLineBuffer` buffers each prepared polygon feature and the merged
   river lines separately (correct — overlapping pieces are expected, see its
   own `:461` comment).
2. It combines them via `mergeBuffersToMultiPolygon` — a **concatenation** of
   all member coordinate arrays into one MultiPolygon. Members overlap, so the
   result is an **invalid** MultiPolygon (this is by design; the comment notes
   the members overlap and are dissolved next).
3. `getGeometryBackend().unaryUnion(merged)` is called to dissolve it
   (`lineBufferComputation.ts:485`). The GEOS op core runs
   `parse → validate → MakeValid → op`. Because `merged` is invalid,
   **`GEOSMakeValid` runs first**.
4. Default `GEOSMakeValid` uses the **linework** method: it nodes all rings and
   reconstructs polygons, assigning area by an even-odd-style rule. A region
   covered by 2 overlapping pieces (even) is reconstructed as a **hole**. The
   polygon-area buffer and the river-line buffer overlap heavily right at the
   junction → that doubly-covered band becomes a hole.
5. `GEOSUnaryUnion` then unions the (already holed) geometry and returns it with
   the hole intact. `unaryUnion` itself is innocent — its purpose is exactly to
   dissolve overlapping polygons; the corruption is the MakeValid **pre-step**
   forced by the invalid input.

Code anchors:

- Merge + dissolve: `src/features/questions/measuring/lineBufferComputation.ts`
  `mergeBuffersToMultiPolygon` (`:501`) and the dissolve at `:469`–`:491`.
- Validity policy: `src/shared/geometry/geosWasmNode.ts` `parseAndValidate`
  (`:84`) → `GEOSMakeValid` at `:88`; `unaryUnionWKB` (`:199`). Native mirror:
  `modules/native-geometry/ios/geos_ops.cpp` (parse→validate→MakeValid→op).

## Fix options

Validated by the repro test (`[repro6]`), the family that works is "**don't feed
an invalid overlapping MultiPolygon to a MakeValid-prefixed op**." Ranked:

### A1 — Incremental binary union of individually-valid pieces (recommended)

Replace `mergeBuffersToMultiPolygon` + `unaryUnion` with a fold over
`backend.union(acc, piece)`. Each buffer piece (and the running accumulator) is
individually valid, so `parseAndValidate` never calls MakeValid; the result is a
true OR with no even-odd holes.

- **Pros:** runtime-only, no native/codec change, uses an existing backend op,
  directly validated (`[repro6]` → notch covered). Works on device (native
  binary union skips MakeValid on valid inputs too).
- **Cons:** N−1 binary unions instead of one unaryUnion (body-of-water ≈ a few
  dozen pieces → cheap; watch piece counts for very water-dense play areas). A
  balanced pairwise _tree_ fold keeps the accumulator small if N grows.
- **Cache:** bump `LINE_BUFFER_CACHE_VERSION` (7 → 8).

### A2 — GeometryCollection of valid polygons → single unaryUnion

A `GEOMETRYCOLLECTION` whose members are each _valid_ polygons is itself valid →
`GEOSisValid` returns 1 → MakeValid is skipped → `GEOSUnaryUnion` dissolves the
overlaps correctly (its actual job) in one call.

- **Pros:** one op (fastest), semantically the "right" call. A GC of
  individually-valid (but mutually-overlapping) polygons passes `GEOSisValid`
  (collections have no inter-member non-overlap constraint) → MakeValid skipped.
- **Cons / scope:** the only gap is **`encodeWkb` has no GeometryCollection
  case** (`wkb.ts` encode handles LineString/MultiLineString/Polygon/
  MultiPolygon/MultiPoint only). `decodeWkb` **already unpacks** GC (it's how
  `unaryUnion` output is read, `:373`+), and GEOS `GEOSGeomFromWKB_buf` parses
  GC natively — so this is a **JS-only** addition (emit a GC WKB), not a native
  `geos_ops` change. Lower risk than first assumed; still slightly more than A1.

### B — Switch MakeValid to the STRUCTURE method

`GEOS_MAKE_VALID_STRUCTURE` keeps polygonal area (unions overlaps) instead of
even-odd holing. A flag change in `geos_ops.cpp` + `geosWasmNode.parseAndValidate`.

- **Pros:** fixes the corruption at its source for _every_ op.
- **Cons:** **global blast radius** — changes validity semantics for buffer,
  difference, intersection everywhere; will shift golden fixtures and needs the
  full GEOS parity + XCTest/Android regen. Overkill for this bug; only do it if
  even-odd MakeValid is judged wrong project-wide.

### C — Post-process hole fill (the "second pass" instinct)

Keep the lossy `unaryUnion`, then detect holes in the result that are actually
covered by the pre-dissolve **merged** set (i.e. spurious MakeValid holes) and
fill them.

- **Pros:** localized; doesn't touch the union strategy.
- **Cons:** needs the ground-truth coverage (the merged set) to tell a spurious
  hole from a _legitimate_ land gap (an island of land within the water band is
  a real hole that must survive). Heuristic, more code, and more failure modes
  than simply not corrupting the geometry (A1). A naive second `unaryUnion` pass
  does **not** help — the area is already gone, and re-unioning a now-valid
  result triggers no MakeValid and recovers nothing.

### D — Skip the dissolve entirely

Return the un-dissolved `merged`. The dissolve exists only so the downstream
polyclip `difference(playArea, eligible)` doesn't explode on overlapping ribbons
(`:469` comment: ~25 s hard-lock on the JS oracle). On device the mask
difference is GEOS (handles overlap), but the JS backend would regress. Not
viable without also changing the mask builder's backend assumptions.

### Recommendation

Ship **A1** (incremental/tree binary union) — smallest, runtime-only, validated
by `[repro6]`. **A2** is a clean perf win (one op) and only needs a JS-side
`encodeWkb` GeometryCollection case, so it's a reasonable alternative if the
per-piece union count is ever a concern. Avoid **B** unless changing MakeValid
globally is independently desired. **C** (the second-pass idea) is a viable
fallback but strictly more complex and more error-prone than A1.

### Regression guard

`darkCircleRepro.geos.test.ts` is the regression test. It drives the real path
and also isolates every stage; after the fix all assertions pass (and `[repro5]`
logs the OLD-vs-FIX contrast for the record).

## Implemented (A1)

Shipped the binary-union fold.

- `lineBufferComputation.ts`: the multi-piece combine no longer concatenates the
  buffer pieces into one overlapping MultiPolygon and `unaryUnion`s it. For the
  GEOS backend it now calls **`dissolveBuffersByBinaryUnion(allBuffers, backend)`**
  — a balanced pairwise fold over `backend.union`, so every op input is
  individually valid and `MakeValid` never fires. The non-GEOS (JS oracle) path
  is unchanged (returns the un-dissolved merge to avoid the ~25 s polyclip
  union); the un-dissolved merge also remains the fallback if any binary union
  fails. `LINE_BUFFER_CACHE_VERSION` bumped **7 → 8**.
- `dissolveBuffersByBinaryUnion` is exported (and re-exported via
  `lineMeasuringGeometry.ts`) for the regression test.
- Verified: `pnpm test:geos darkCircleRepro` — `[repro]` now reports
  `notchInsideMask=true`, `gapCells=0` (was 3342); `[repro5]` shows
  `OLD unaryUnion(merged)=false (lossy) → FIX binaryUnionFold=true`. Full
  `pnpm test:geos` (7 suites) and `pnpm test` (95 suites / 1204 tests) green;
  `pnpm typecheck` clean.

Not done (no artifact change needed — this is a pure runtime dissolve fix; the
shipped pack bundle is unaffected, so no rebuild/republish). A2
(GeometryCollection + single unaryUnion) remains available as a perf refinement
if per-piece union counts ever matter.

# T15 — GEOS-backed body-of-water dissolve (fix pack-build OOM)

**Status:** design + validated prototype
**Owner:** —
**Problem:** `pnpm data:pack -- --region europe-netherlands` OOMs in the
measuring body-of-water dissolve, even with `--max-old-space-size=8192`. Raising
the heap is the wrong direction — we want the pipeline to run on _more_
resource-constrained machines, not fewer.

## Root cause

The water dissolve unions polygons with **polyclip-ts** in two places:

- per-tile union — `unionAllCoords()` in
  [`data/geofabrik/scripts/lib/polygonDissolve.mjs`](../../../data/geofabrik/scripts/lib/polygonDissolve.mjs)
  (`polygonDissolve()` calls it per tile).
- the **cross-tile final merge** — `unionAllCoords(features.map(...))` in
  [`data/packs/scripts/lib/buildMeasuring.mjs:798`](../../../data/packs/scripts/lib/buildMeasuring.mjs#L798),
  which unions every per-tile water polygon into one global MultiPolygon.

polyclip-ts holds the entire input coordinate set plus its sweep-line state and
the result simultaneously; on a water-dense region (NL) that single allocation
is what tips over. The final merge is the dominant peak.

### Why we can't just skip the merge

Adjacent dissolve tiles deliberately overlap (`overlapDeg: 0.01`), and raw OSM
water polygons share edges, so the un-merged set is a MultiPolygon whose member
interiors intersect — an **invalid** geometry. Downstream, the overlap region is
covered by two outer rings; under an even-odd fill/winding interpretation that
doubly-covered area reads as a **hole**, which propagates through
`buffer(water)` → `difference(playArea, eligibleArea)` as a spurious patch of
mask. (This is the "false mask around the overlap" symptom.) `unaryUnion`
rewrites the boundary so every area is wound exactly once, eliminating the hole.
So the union is **required for correctness** — the lever is making it cheap, not
removing it.

## Decision: replace polyclip-ts union with `GEOSUnaryUnion`

`geos-wasm@3.1.1` is already a dependency, with a working WKB round-trip and a
`unaryUnionWKB` helper used by the geometry parity tests. GEOS runs the union in
C++ with a fixed WASM linear-memory pool — predictable on a constrained box —
and emits a valid, interior-disjoint result (the exact operation the _runtime_
already trusts at [`lineMeasuringGeometry.ts:804`](../../../src/features/questions/measuring/lineMeasuringGeometry.ts#L804)).

### Prototype results

`scripts/geos-union-prototype.mts` (kept in-repo) unions a grid of overlapping
many-vertex "water" squares through both backends and measures Δrss + time:

| Grid | Input coords | GEOS unaryUnion    | polyclip-ts union  |
| ---- | ------------ | ------------------ | ------------------ |
| 24²  | 24k          | 18 MB / 43 ms      | 102 MB / 432 ms    |
| 48²  | 94k          | 30 MB / 113 ms     | 316 MB / 1.3 s     |
| 72²  | 212k         | **38 MB / 231 ms** | **604 MB / 3.1 s** |

GEOS stays ~flat (~30–40 MB, ~linear time) and returns a single clean `Polygon`;
polyclip grows to **~16× the memory** even on this trivially-collapsible case
(real water doesn't collapse, so its true intermediate is worse). This is the
allocation that OOMs NL at 8 GB.

Reproduce: `node --expose-gc --import tsx scripts/geos-union-prototype.mts`
(set `COLS=72 ROWS=72` to scale).

## Integration plan

1. **Promote a Node-usable GEOS helper.** The geos-wasm init currently lives in
   the test-only shim
   [`src/shared/geometry/__tests__/helpers/geosWasmShim.ts`](../../../src/shared/geometry/__tests__/helpers/geosWasmShim.ts).
   Extract the init (`initGeosWasm`) + `unaryUnionWKB` into a non-test module
   (e.g. `src/shared/geometry/geosWasmNode.ts`) and have the shim re-export it,
   so test and pipeline share one path. The dynamic-`import("geos-wasm")` trick
   is unnecessary outside Jest — a plain ESM `import` works in `.mjs`/tsx.

2. **Run the packs pipeline under tsx** so it can reuse the existing TS WKB
   codec ([`src/shared/geometry/wkb.ts`](../../../src/shared/geometry/wkb.ts) —
   already encodes/decodes MultiPolygon and unpacks GEOS GeometryCollection
   output) and the helper from step 1. Change `package.json`:
   `"data:pack": "node --import tsx data/packs/scripts/build-packs.mjs"`. tsx is
   already a devDep used by the `perf:*` scripts. _Fallback if we want the
   pipeline to stay pure-node:_ port just the Polygon/MultiPolygon subset of the
   WKB codec into a `data/packs/scripts/lib/wkb.mjs` (~80 lines) — but tsx reuse
   is preferred (no duplicated codec).

3. **Add `geosUnaryUnionCoords(coordsList) -> coords` to `polygonDissolve.mjs`**
   (or a sibling `lib/geosUnion.mjs`): wrap `coordsList` as one MultiPolygon →
   `encodeWkb` → `unaryUnionWKB` → `decodeWkb` → `.coordinates`. Replace both
   `unionAllCoords` call sites (per-tile and the `buildMeasuring.mjs:798`
   cross-tile merge) with it. Keep `unionAllCoords` (polyclip) as a fallback only
   if GEOS init fails, mirroring the runtime's GEOS-or-bust posture.

4. **Optional follow-up — drop the manual tiling.** With GEOS, the per-tile
   partition in `polygonDissolve()` exists mainly to keep polyclip's per-call
   input small. GEOS can dissolve the whole water set in one bounded
   `unaryUnion`, so tiling + `overlapDeg` + cross-tile re-merge could collapse
   into a single call. Land step 3 first (smaller diff, proven), then evaluate
   removing the tiling once NL builds clean.

5. **Schema:** the body-of-water bundle is `schemaVersion: 2`
   ([`buildMeasuring.mjs:1056`](../../../data/packs/scripts/lib/buildMeasuring.mjs#L1056)).
   GEOS output is the same shape (dissolved MultiPolygon), so no bump is
   required; if step 4 changes feature granularity, bump then. Pre-launch
   "Compatibility: none required" applies regardless.

## Validation

- `pnpm test:data:packs` + `pnpm test:data:geofabrik` (dissolve unit tests).
- Rebuild NL + TW: `pnpm data:pack -- --region europe-netherlands` (must finish
  under a constrained heap, e.g. `--max-old-space-size=2048`) then
  `pnpm data:pack:lint`.
- Eyeball the dissolved water in `tools/data-viewer/` — confirm no holes at
  former tile seams.
- In-app: body-of-water measuring mask shows no spurious patch over overlaps
  (the original symptom). Add/extend a render-state polarity test if not covered.

## Risks / notes

- geos-wasm bundles GEOS 3.13.x vs the app's vendored 3.14.1 — fine for build-time
  dissolve (validity + topology are stable across 3.x; we're not parity-gating
  bytes here).
- WASM has its own memory ceiling; if a future mega-region exceeds it, fall back
  to GEOS **per-tile** union + a final GEOS union over tile results (two-level,
  peak ≈ one tile + seam set). Step 4's single-call simplification should be
  gated on this not regressing.
- Keep `scripts/geos-union-prototype.mts` as the benchmark harness for tuning.

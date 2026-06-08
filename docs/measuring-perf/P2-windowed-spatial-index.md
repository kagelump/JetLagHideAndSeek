# P2 — Windowed spatial index for the nearest-point scan

**Status:** ready · **Priority:** after the softlock is gone (P0/P1) ·
**Risk:** low · **Quality cost:** none

## Problem

`computeLineDistance`
(`src/features/questions/measuring/lineMeasuringGeometry.ts`, ~line 586) finds
the nearest point on the bundled geometry by:

1. bbox-filtering features to a **fixed ±50 km** box around the seeker, then
2. concatenating all survivors into one `MultiLineString` and running
   `@turf/nearest-point-on-line` over the whole thing.

For `body-of-water` that is ~45k coords → **~1,440 ms** per uncached center
(field log: `[lineDistance] 45052 coords → simplify(10m): 45051 coords, turf in
1440ms`). The 50 km window is far larger than any realistic answer, and the scan
is linear over every vertex. This is separate from the softlock — even after
P0/P1 it's a ~1.4 s hitch the first time a center is seen.

> Note: P0 shrinks `body-of-water` to a few polygons, which _also_ shrinks this
> scan. P2 still matters for `coastline` (2,620 features) and as the principled
> fix; do P2 if P0 slips or for the other line categories.

## Goal

Replace the linear nearest-point scan with an **indexed** query that touches only
geometry near the seeker, cutting `computeLineDistance` from ~1,440 ms to
single-digit ms, with an identical result.

## Design

Use the existing `kdbush` + `geokdbush` (already deps; see
`src/features/questions/matching/spatialIndex.ts` for the established pattern).

- Build a per-`(category)` index over **every vertex** of the bundle, lazily on
  first query, cached in a module `Map`. Store, alongside each vertex, the index
  of the feature (and segment) it belongs to so you can recover the owning line.
- Query: `geokdbush.around(index, lon, lat, K)` for the nearest K vertices
  (K ≈ 16). Collect the **distinct owning features** of those vertices — that's a
  tiny candidate set (usually 1–4 lines).
- Run the existing `nearestPointOnLine` only over those candidate features. This
  preserves exact behavior (nearest point can be on a segment between vertices —
  including the candidate features guarantees the true nearest segment is
  considered, because its endpoints are among the nearest vertices for any
  realistic geometry).
- Keep the existing NaN/dedup cleaning on the candidate lines.

### Optional: bundle the index (perf-audit follow-up)

The index can be **precomputed at extraction time** and shipped in the bundle
(serialize `kdbush`'s flat `ArrayBuffer`). That removes the lazy first-build cost
entirely. Treat this as a later optimization — build lazily at runtime first,
measure, and only bundle if the first-build cost is material. **The index never
fixes the buffer softlock** (that's P0/P1); it only fixes this scan.

### Edge cases

- Seeker far from all geometry: `around` returns the nearest K regardless of
  distance; the existing "no features in window → null" behavior is replaced by
  "if nearest candidate distance > some sanity bound (e.g. 200 km) → null."
- Polygon features (after P0): index their boundary-ring vertices; the
  `booleanPointInPolygon` distance-0 check from P0 runs first.

## Implementation steps

1. Add `lineSpatialIndex.ts` next to `spatialIndex.ts` (or extend it) with
   `getLineVertexIndex(category)` returning `{ index, featureOf: Int32Array }`,
   built from `getLineBundle(category)` and cached in a `Map`. Add a
   `__clearLineIndexForTest()` seam.
2. Rewrite the body of `computeLineDistance` to: query the index → gather
   candidate features → run `nearestPointOnLine` on candidates only. Keep the
   LRU result cache and its key.
3. Bump `LINE_DISTANCE_CACHE_VERSION` and `LINE_CATEGORY_CACHE_VERSION`.
4. Clear the index in the test `beforeEach` alongside the existing cache clears.

## Testing

> **Orientation.** Same suite as P1:
> `src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts`,
> using `__setLineBundleForTest` + `makeLineFeature`/`makeBundle`. The golden
> rule for P2: **the indexed result must equal the old brute-force result.**

### Correctness (equivalence) tests

The existing `describe("computeLineDistance")` block already covers single
segment, two disjoint segments, bbox prefilter, MultiLineString, dedup, NaN
resilience, and real bundles. **These must all still pass unchanged** — that is
your primary correctness signal. Do not weaken them.

Add:

1. **Index result matches a hand-computed nearest.** For the existing horizontal
   line fixture, assert `nearestPoint` and `distanceMeters` match the same
   numbers the current test asserts (the index must not change them).
2. **Many-segment correctness.** Build 200 parallel horizontal lines at
   increasing latitudes; put the seeker just above line #137. Assert the nearest
   point lands on line #137's latitude. (Proves candidate selection picks the
   right feature among many.)
3. **Tie / between-vertices.** A line whose nearest point is the _midpoint_ of a
   long segment (seeker perpendicular to the segment middle, far from both
   endpoints). Assert the nearest point is ~the perpendicular foot, not an
   endpoint. (Guards the "nearest can be between vertices" reasoning — if this
   fails, raise K or include both endpoints of candidate segments.)
4. **Far-away → null.** Seeker 400 km from all geometry returns null (existing
   "Osaka feature, Tokyo center" test).

### Differential test (strongest guard)

If feasible, keep the old implementation under a renamed export
`computeLineDistanceBruteForce` (test-only) and add:

```ts
it("indexed result equals brute-force on the real coastline bundle", () => {
    const bundle = require("../../../../../assets/measuring/coastline.json");
    __setLineBundleForTest("coastline", bundle);
    for (const center of SAMPLE_CENTERS /* ~10 Tokyo-area points */) {
        const a = computeLineDistance(center, "coastline");
        const b = computeLineDistanceBruteForce(center, "coastline");
        expect(a!.distanceMeters).toBeCloseTo(b!.distanceMeters, 0); // within ~1 m
    }
});
```

This is the most convincing proof the index is exact. Delete the brute-force
export once shipped, or keep it behind `__DEV__` for future diffs.

### Performance test

```ts
it("indexed nearest-point on body-of-water is fast", () => {
    const bundle = require("../../../../../assets/measuring/body-of-water.json");
    __setLineBundleForTest("body-of-water", bundle);
    computeLineDistance([139.75, 35.68], "body-of-water"); // warm index build
    clearLineDistanceCache(); // keep index, drop result cache
    const t0 = performance.now();
    computeLineDistance([139.76, 35.69], "body-of-water");
    expect(performance.now() - t0).toBeLessThan(50); // was ~1440 ms
});
```

Optionally add a `perf/scenarios/measuring.mts` scenario mirroring the existing
`perf/scenarios/matching.mts` style, then `pnpm perf:test` to track it against a
baseline.

### Commands

```bash
pnpm test -- lineMeasuringGeometry
pnpm typecheck && pnpm check
pnpm perf:test            # only if you add a perf scenario
```

## Acceptance criteria

- [ ] Every existing `computeLineDistance` test passes unchanged.
- [ ] Differential test: indexed vs brute-force within ~1 m across sample
      centers on a real bundle.
- [ ] Warm-index nearest-point query on `body-of-water` < 50 ms.
- [ ] `LINE_DISTANCE_CACHE_VERSION` / `LINE_CATEGORY_CACHE_VERSION` bumped.
- [ ] `pnpm test` + `pnpm check` pass.

## Rollback

Self-contained: revert to the linear scan (keep it in git or behind the
`computeLineDistanceBruteForce` export). No bundle change required unless you
opted into the bundled-index extra — that part rolls back with the bundle.
</content>

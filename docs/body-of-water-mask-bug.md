# Body-of-Water Measuring Mask — Off-Shape Bug

_2026-06-10. One-pager: why the body-of-water measuring mask renders wrong, and
how to fix it._

## Symptom

On a `measuring` / `body-of-water` question (observed at 161 m), the eligibility
mask is visibly wrong while the red reference line is correct:

1. **Missing rivers.** Areas next to the Meguro river are masked the wrong way —
   the river's contribution is absent from the buffer, so its banks fall on the
   wrong side of the mask.
2. **Straight capsules.** Tachiaikawa (立会川) renders as a straight capsule mask
   while a neighboring river renders as the expected squiggly shape. Same
   category, same render pass, completely different fidelity.

The red **reference line** follows the true river path in both cases — only the
**mask buffer** is corrupted. (The reference line is clipped to the play area
independently, so it keeps full fidelity; the buffer does not.)

## Root cause: the buffer runs over a 50 km window, not a 161 m one

`computeLineCategory` selects window features with a **50 km margin**
(`minWindowMarginM: 50_000`, [`src/config/appConfig.ts`](../src/config/appConfig.ts)).
That wide window is required to _find the nearest water_ for the connector/marker.
But the same `windowFeatures` set is then handed straight to the buffer without
re-scoping ([`src/features/questions/measuring/measuringGeometry.ts`](../src/features/questions/measuring/measuringGeometry.ts)):

```ts
buf = computeLineBufferCached(
    q.category,
    q.center,
    lineCat.distanceMeters,
    lineCat.windowFeatures,
);
```

A 161 m buffer only needs features within ~161 m of the play area; anything
farther cannot reach inside it. Feature counts against the Tokyo 23-wards bbox in
the committed `assets/measuring/body-of-water.json`:

| margin             | line features | line coords | polygons |
| ------------------ | ------------- | ----------- | -------- |
| **161 m** (needed) | 165           | 5,125       | 6        |
| **50 km** (used)   | **1,498**     | **53,164**  | 40       |

The buffer budget is `maxBufferSegments: 400` / `maxBufferCoords: 20_000`. At
50 km the line path is ~4× over the segment cap and ~2.6× over the coord cap, so
`applyBufferBudget`
([`src/features/questions/measuring/lineMeasuringGeometry.ts`](../src/features/questions/measuring/lineMeasuringGeometry.ts))
exhausts all 6 escalation rounds and hits the hard-cap fallback, which does two
destructive things:

1. **Drops whole rivers** — sorts by length, keeps only the top 400 segments,
   discards the rest → the Meguro contribution is dropped (symptom #1).
2. **Truncates survivors to a coordinate prefix** —
   `l.slice(0, Math.max(2, Math.floor(l.length * ratio)))`. Slicing a polyline to
   its first N points lops off the rest of the river; sliced toward 2 points it
   becomes a straight capsule → Tachiaikawa straight while an un-truncated
   neighbor stays squiggly (symptom #2).

At the correctly-scoped 161 m window (165 lines / 5,125 coords) the budget loop
returns immediately with **no dropping and no truncation** — both symptoms
disappear.

## Two defects

- **A (primary, trigger).** Buffer input is not re-scoped to the buffer radius;
  it reuses the 50 km nearest-search window.
- **B (latent, corruptor).** `applyBufferBudget`'s hard-cap fallback truncates
  polylines with a prefix `slice`, which corrupts shape (straight capsules)
  rather than uniformly subsampling. Fixing A removes the trigger for Tokyo, but
  B will resurface for any genuinely dense window (e.g. a large radius).

## Recommended fixes

1. **Scope buffer input to the radius (fixes A).** Pre-filter `windowFeatures` by
   bbox distance to the play area `≤ radiusMeters` (+ small ε) before buffering —
   either inside `computeLineBuffer` / `computeLineBufferCached` (thread
   `playAreaBbox` through) or at the call site in `measuringGeometry.ts`. Keep the
   50 km window only for the nearest-point/distance computation.
2. **Make the budget fallback shape-preserving (fixes B).** Replace the prefix
   `slice` in `applyBufferBudget` with uniform subsampling (or drop whole
   features) so an over-budget polyline degrades in resolution, never collapses to
   a straight segment.

## Verification

- Add a regression test asserting the body-of-water buffer follows the river
  vertices (containment near interior vertices) rather than collapsing to a
  capsule. The existing `bodyWaterMask` / line-buffer suites in
  `src/features/questions/measuring/__tests__/` are the home for it.
- Confirm scoping keeps the 161 m window at ≤ budget (165 lines / 5,125 coords),
  so no escalation rounds run.
- `pnpm test` + `pnpm typecheck`.

## Related

- [`docs/native-geometry/PLAN-body-of-water-mask-parity.md`](native-geometry/PLAN-body-of-water-mask-parity.md)
  — GEOS-vs-JS containment parity for the same pipeline.
- [`docs/measuring_perf_audit.md`](measuring_perf_audit.md) — measuring buffer
  budget background.
  </content>
  </invoke>

# Body-of-Water Mask — Riverbank Gaps (Issue #1)

_2026-06-10. One-pager: why riverbanks are still masked after the straight-capsule
fix, and the verified fix. Companion to
[`body-of-water-mask-bug.md`](body-of-water-mask-bug.md)._

**Status: resolved.** Fix applied in `measuringGeometry.ts` (buffer input scoped
to `radius + ε` via `filterFeaturesByBboxMargin`). Regression tests pass
(76/76 in `lineMeasuringGeometry.test.ts`). See [Verification](#verification).

## Symptom

On a `measuring` / `body-of-water` question (161 m), the strip along the Meguro
river near 中目黒 is masked even though it sits within the measured distance of
the water. The red **reference line** follows the river correctly; only the
**eligibility buffer** has gaps. This is the residual of the original report after
symptom #2 (straight capsules) stopped rendering.

> Symptom #2 went away after a dev-client rebuild — the GEOS `unaryUnion` dissolve
> hides the prefix-slice artifact. It did **not** fix the riverbank gaps; those
> have the same root cause but a different visible failure mode.

## Root cause

Identical to defect A in the companion doc: the 161 m line buffer is computed over
the **50 km nearest-search window**, not a radius-scoped one. The window holds far
more geometry than the buffer budget allows, so `applyBufferBudget`
([`src/features/questions/measuring/lineMeasuringGeometry.ts`](../src/features/questions/measuring/lineMeasuringGeometry.ts))
**drops and over-simplifies** the river lines:

- Window: **1,498 lines / 53,164 coords** (budget caps: 400 segs / 20,000 coords).
- All 6 escalation rounds exhaust (still 690 lines) → hard cap keeps
  **400 lines / 2,093 coords**, with tolerance doubled to ~640 m.
- The Meguro line is dropped or coarsened past usefulness, so its 161 m buffer no
  longer covers the banks.

The polygon path can't fill the gap: the 50 km polygon window (~132 k coords)
trips the 20 k budget and simplifies water polygons at ~50 m, which **collapses
the ~15 m-wide river channel** — the surviving polygon buffers miss the banks too.

### Evidence (reproduced against the committed bundle)

Coverage of the 21 Meguro-river vertices near 中目黒 (`box ≈
139.685,35.625 → 139.715,35.655`):

| pipeline                                     | input                                  | uncovered river vertices |
| -------------------------------------------- | -------------------------------------- | ------------------------ |
| 50 km window + budget (line buffers)         | 400 lines / 2,093 coords               | **10 / 21**              |
| 50 km window, polygon-only (50 m simplify)   | —                                      | **17 / 21**              |
| full-fidelity (no budget) lines + polys      | —                                      | 0 / 21                   |
| **radius-scoped (`radius + ε`) + no budget** | **167 lines / 5,179 coords / 6 polys** | **0 / 21**               |

## Fix (verified)

**Scope the buffer input to the buffer radius.** Before calling
`computeLineBufferCached` in
[`src/features/questions/measuring/measuringGeometry.ts`](../src/features/questions/measuring/measuringGeometry.ts),
bbox-filter `lineCat.windowFeatures` to `playAreaBbox` expanded by
`radiusMeters + ε` (~50 m). `playAreaBbox` is already in scope at that call site.
Keep the 50 km window only for the nearest-point/distance computation.

This drops the line count from 1,498 to ~167 and the coord count from 53,164 to
~5,179 — **under budget**, so no escalation, no dropping, no over-simplification.
Verified coverage: **0 / 21 uncovered**.

Alternative placement: thread `playAreaBbox` into
`computeLineBuffer` / `computeLineBufferCached` and filter there, so every caller
benefits. Same effect; broader blast radius.

> Defect B (the prefix-`slice` in `applyBufferBudget`) is now moot for Tokyo once
> the input is scoped, but remains a latent shape-corruptor for genuinely dense
> windows — see the companion doc for the subsampling fix.

## Verification

- [x] `filterFeaturesByBboxMargin` implemented in
      [`lineMeasuringGeometry.ts:122`](../src/features/questions/measuring/lineMeasuringGeometry.ts#L122)
      — filters features by bbox expanded by marginMeters.
- [x] Buffer input scoping applied in
      [`measuringGeometry.ts:121`](../src/features/questions/measuring/measuringGeometry.ts#L121)
      — `lineCat.windowFeatures` filtered to `playAreaBbox + distanceMeters` before
      `computeLineBufferCached`.
- [x] Regression test: "covers the upstream Meguro River (P7 regression guard)"
      in [`lineMeasuringGeometry.test.ts:523`](../src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts#L523).
- [x] Unit tests for `filterFeaturesByBboxMargin` (inside/outside/edge cases)
      in [`lineMeasuringGeometry.test.ts:1063`](../src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts#L1063).
- [x] `pnpm test` — 76/76 passing in `lineMeasuringGeometry.test.ts`.

## Related

- [`docs/body-of-water-mask-bug.md`](body-of-water-mask-bug.md) — original
  investigation (both symptoms, defects A & B).
- [`docs/native-geometry/PLAN-body-of-water-mask-parity.md`](native-geometry/PLAN-body-of-water-mask-parity.md)
  — GEOS-vs-JS containment parity for this pipeline.

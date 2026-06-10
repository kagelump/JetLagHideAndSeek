# Plan — Body-of-Water Dissolve→Mask Integration Parity

_2026-06-09. Part of the G5 overlay-op parity test coverage. Covers W3 from the master plan._

## Scope

One end-to-end scenario that runs the real body-of-water pipeline (`computeLineCategory` → `computeLineBuffer` → `buildCombinedEligibilityMask`) under both GEOS and JS backends, asserting containment parity.

## Why

This is the exact case that broke during the G5 body-of-water blank-mask incident. The dissolve (`unaryUnion`) and mask (`difference`) paths must be locked together so a future regression in either stage is caught.

## Work

### W3 — `bodyWaterMask.geos.test.ts`

New suite at `src/features/questions/measuring/__tests__/bodyWaterMask.geos.test.ts`.

**Setup**

- Load the committed `assets/measuring/body-of-water.json` bundle (same as `measuringDissolve.geos.test.ts`).
- Point `native-geometry` at the geos-wasm shim and force `geosGeometryBackend`.
- Clear caches (`clearLineCategoryCache`, `clearLineDistanceCache`, `clearLineBufferCache`, `__clearLineBundlesForTest`) in `beforeEach`.

**Test**

- Run `computeLineCategory` → `computeLineBuffer` → `buildCombinedEligibilityMask` under both backends.
- Assert **containment parity** (not just "returns").

See master PLAN §W3 for full details.

## Files

- `src/features/questions/measuring/__tests__/bodyWaterMask.geos.test.ts` — new

## Verification

- `pnpm test:geos` runs green.
- A future GEOS-vs-JS divergence in this pipeline is caught.

## Reference

- Master plan: [`PLAN-geos-overlay-parity-test.md`](./PLAN-geos-overlay-parity-test.md) §W3

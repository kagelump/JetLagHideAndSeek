# Plan — Mask Builder GEOS Parity Test

_2026-06-09. Part of the G5 overlay-op parity test coverage. Covers W2 from the master plan._

## Scope

A `*.geos.test.ts` suite that drives the **real GEOS engine** through `buildCombinedEligibilityMask` and asserts parity with the JS oracle on **area and point-containment**.

## Why

After G5, `difference` / `union` / `intersection` have zero GEOS-backed test coverage. The existing `maskBuilder.test.ts` exercises only the JS backend. This suite closes the gap by building the same mask under both backends and comparing results.

## Work

### W2 — `maskBuilder.geos.test.ts`

New suite at `src/features/map/__tests__/maskBuilder.geos.test.ts`.

**Setup**

- Point `native-geometry` at the geos-wasm shim (bufferWKB + all four overlay ops).
- Force `geosGeometryBackend` via `__setGeometryBackendForTest`.
- Reset to `null` in `afterAll`.

**Scenarios** (cover structural cases radar never produces):

- Required-only, single constraint fully inside → Polygon-with-hole
- Excluded-only, single constraint → farther
- **Band that splits the play area** → multi-member MultiPolygon result
- **Constraint with a hole** (e.g. a ring buffer) → exercises inner-ring round-trip
- Multi-required (≥2) → the `reduceOverlay(intersection)` path
- Multi-excluded (≥2) → the `reduceOverlay(union)` path

**Parity assertions per scenario**

- `|areaGeos − areaJs| / areaJs < 0.01`
- **Point-containment grid**: sample a grid; `pointInMask(geos) === pointInMask(js)` for ≥95% of points (even-odd rule over all rings).

See master PLAN §W2 for full scenario descriptions and assertion details.

## Files

- `src/features/map/__tests__/maskBuilder.geos.test.ts` — new

## Verification

- `pnpm test:geos` runs green against real GEOS.
- Deliberately breaking an overlay adapter (e.g. swapping `difference`↔`intersection`) makes the suite fail.

## Reference

- Master plan: [`PLAN-geos-overlay-parity-test.md`](./PLAN-geos-overlay-parity-test.md) §W2

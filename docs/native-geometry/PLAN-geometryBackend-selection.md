# Plan — Geometry Backend Selection Unit Test

_2026-06-09. Part of the G5 overlay-op parity test coverage. Covers W4 from the master plan._

## Scope

A default-jest unit test covering backend selection logic (`js` / `geos` / `auto`) and the stale-binary fallback path, without requiring the real GEOS engine.

## Why

A future `isAvailable()` regression or stale-binary mismatch should be caught by the fast default test suite, not only by the slow GEOS-wasm suite.

## Work

### W4 — `geometryBackend.selection.test.ts`

New suite at `src/shared/geometry/__tests__/geometryBackend.selection.test.ts`.

**Cases**

- `backend = "js"` → `jsGeometryBackend`
- `backend = "geos"` + mock `isAvailable() → true` → `geosGeometryBackend`
- `backend = "geos"` + `isAvailable() → false` → JS fallback (+ assert the loud warn)
- `backend = "auto"` mirrors availability
- **Stale binary**: native present, `bufferWKB` a function but `differenceWKB` undefined → backend still GEOS, `backend.difference(...)` returns a valid result via the per-op JS fallback (assert it does NOT throw / does NOT return null for a valid non-empty difference)

**Cleanup**

- Reset memoized selection with `__setGeometryBackendForTest(null)` in `afterEach`.

See master PLAN §W4 for full case descriptions.

## Files

- `src/shared/geometry/__tests__/geometryBackend.selection.test.ts` — new

## Verification

- `pnpm test` runs green with native mocked-absent.
- A future `isAvailable()` regression is caught here.

## Reference

- Master plan: [`PLAN-geos-overlay-parity-test.md`](./PLAN-geos-overlay-parity-test.md) §W4

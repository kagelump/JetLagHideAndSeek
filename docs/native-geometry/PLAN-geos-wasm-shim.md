# Plan — GEOS-Wasm Shim Extension & Test Wiring

_2026-06-09. Part of the G5 overlay-op parity test coverage. Covers W1 + W5 from the master plan._

## Scope

1. **Extend the geos-wasm test shim** with the three binary overlay ops (`difference`, `union`, `intersection`) so that `.geos.test.ts` suites can drive the real GEOS engine through the full `maskBuilder` overlay pipeline.
2. **Keep the Jest mock contract intact** so default `pnpm test` continues to exercise JS fallback paths, while `pnpm test:geos` overrides with the real wasm engine.

## Why

The existing `geosWasmShim.ts` only exposes `bufferWKB` and `unaryUnionWKB`. The mask builder's overlay ops (`difference`, `union`, `intersection`) have no GEOS-backed test coverage. This plan wires up the missing native bindings.

## Work

### W1 — Extend `geosWasmShim.ts`

Add `differenceWKB`, `unionWKB`, `intersectionWKB` to `src/shared/geometry/__tests__/helpers/geosWasmShim.ts`.

- Signature: `(a: Uint8Array, b: Uint8Array) => Uint8Array | null`
- Pattern: factor the WKB↔geometry marshalling (malloc / `GEOSGeomFromWKB_buf` / `GEOSGeomToWKB_buf` / free) once, then wrap `GEOSDifference`, `GEOSUnion`, `GEOSIntersection`.
- See master PLAN §W1 for the validated code sketch.

### W5 — Wire-up & hygiene

- **No new script needed**: `jest.config.geos.js` `testMatch` already includes `**/__tests__/**/*.geos.test.{ts,tsx}`.
- **Mock integrity**: `jest.setup.ts` must keep returning `null` for the four overlay ops (`differenceWKB`, `unionWKB`, `intersectionWKB`, `unaryUnionWKB`) so the default suite exercises JS fallback. `.geos.test.ts` suites override this at runtime (see `measuringDissolve.geos.test.ts` pattern).
- **No duplication**: marshalling helpers stay in `geosWasmShim.ts`, not duplicated per test.

## Files

- `src/shared/geometry/__tests__/helpers/geosWasmShim.ts` — add three binary ops
- `jest.setup.ts` — verify mock already returns `null` for overlay ops (no change expected)

## Verification

- `pnpm test:geos` runs the new shim without errors.
- `pnpm test` still passes with native mocked-absent.

## Reference

- Master plan: [`PLAN-geos-overlay-parity-test.md`](./PLAN-geos-overlay-parity-test.md) §W1, §W5

# Dispatcher Instructions — GEOS Overlay Parity Test Coverage

_2026-06-09. Orchestrator prompt for implementing the 5 child plans derived from `PLAN-geos-overlay-parity-test.md`._

## Goal

Close the GEOS-vs-JS overlay-op test coverage gap left after G5, and add regression guards for the all-NaN body-of-water incident. Read the master plan first, then execute the child plans in dependency order.

## Context

- Expo SDK 54 React Native app with a native MapLibre map.
- Geometry operations live in `src/shared/geometry/` with a swappable backend (`jsGeometryBackend` / `geosGeometryBackend`).
- The native `native-geometry` Expo module is mocked in Jest; real GEOS is available in `*.geos.test.ts` suites via `geos-wasm`.
- Run `pnpm check` (lint + format + typecheck + perf:typecheck + poi-selector drift) and `pnpm test` (jest) for default validation.
- Run `pnpm test:geos` for GEOS-wasm suites.

## Plan docs (read in order)

1. `docs/native-geometry/PLAN-geos-wasm-shim.md` — W1 + W5
2. `docs/native-geometry/PLAN-maskBuilder-geos-parity.md` — W2
3. `docs/native-geometry/PLAN-body-of-water-mask-parity.md` — W3
4. `docs/native-geometry/PLAN-geometryBackend-selection.md` — W4
5. `docs/native-geometry/PLAN-regression-guards.md` — W6 + W7

Master reference: `docs/native-geometry/PLAN-geos-overlay-parity-test.md`

## Implementation order and dependencies

```
Phase 1: W1 + W5  →  Phase 2: W2  →  Phase 3: W3  →  Phase 4: W4 + W6  →  Phase 5: W7
```

- **W2 and W3 require W1** (the extended geos-wasm shim). Do not start W2/W3 until W1 lands.
- **W4 and W6** are independent default-jest tests. They can run in parallel with Phase 2–3 or after.
- **W7** is a CI / `pnpm check` tooling change. Land it last.

## Key patterns to replicate

### geos-wasm shim pattern

See `src/shared/geometry/__tests__/helpers/geosWasmShim.ts`. Already has `bufferWKB` and `unaryUnionWKB`. Add `differenceWKB`, `unionWKB`, `intersectionWKB` using the same `malloc → GEOSGeomFromWKB_buf → GEOS{Op} → GEOSGeomToWKB_buf → free` pattern.

### GEOS test suite pattern

See `src/features/questions/measuring/__tests__/measuringDissolve.geos.test.ts`. Standard setup:

- `beforeAll`: `await initGeosWasm();` then patch `require("native-geometry")` with shim functions, then `__setGeometryBackendForTest(geosGeometryBackend)`.
- `afterAll`: `__setGeometryBackendForTest(null)`.
- `beforeEach`: clear any relevant caches.

### Jest mock contract

`jest.setup.ts` returns `null` for all `native-geometry` overlay ops. `.geos.test.ts` suites override at runtime. Do **not** change `jest.setup.ts` to return real values.

### Backend selection test pattern

Mock `native-geometry` via `jest.mock` or `require` mutation. Reset memoized selection with `__setGeometryBackendForTest(null)` in `afterEach`.

### maskBuilder parity

Build masks under both `jsGeometryBackend` and `geosGeometryBackend` (via `__setGeometryBackendForTest`) and assert area ratio + point-containment grid parity.

### Body-of-water integration

Load `assets/measuring/body-of-water.json` via `require`. Use `computeLineCategory`, `computeLineBuffer`, `buildCombinedEligibilityMask`. Compare GEOS vs JS paths.

## Files to create / modify

| Plan | File                                                                    | Action                                        |
| ---- | ----------------------------------------------------------------------- | --------------------------------------------- |
| W1   | `src/shared/geometry/__tests__/helpers/geosWasmShim.ts`                 | Add three binary ops                          |
| W2   | `src/features/map/__tests__/maskBuilder.geos.test.ts`                   | New suite                                     |
| W3   | `src/features/questions/measuring/__tests__/bodyWaterMask.geos.test.ts` | New suite                                     |
| W4   | `src/shared/geometry/__tests__/geometryBackend.selection.test.ts`       | New suite                                     |
| W6   | `src/shared/geometry/__tests__/bufferProjection.test.ts`                | New suite                                     |
| W7   | `package.json` / `pnpm check`                                           | Add cycle check (e.g. `madge --circular src`) |

## Verification gates per phase

| Phase     | Gate                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| W1        | `pnpm test:geos` compiles and runs without shim errors. `pnpm test` still passes.                             |
| W2        | `pnpm test:geos` runs green; deliberately swapping `difference`↔`intersection` in an adapter causes failure. |
| W3        | `pnpm test:geos` runs green.                                                                                  |
| W4        | `pnpm test` runs green with native mocked-absent.                                                             |
| W6        | `pnpm test` runs green.                                                                                       |
| W7        | `pnpm check` runs green; a synthetic require cycle fails the check.                                           |
| **Final** | `pnpm typecheck && pnpm test && pnpm test:geos && pnpm check` all green.                                      |

## Delegation strategy

- Dispatch one implementer subagent per phase, sequentially. W4 and W6 can be parallel once W1 is done.
- Each implementer should read the relevant plan doc, the master plan section, and the pattern files listed above before writing code.
- Review each phase before starting the next.

## Questions?

Ask the user if anything is unclear before starting implementation.

# Plan — Regression Guards (Projection Finiteness & Require-Cycle Detection)

_2026-06-09. Part of the G5 overlay-op parity test coverage. Covers W6 + W7 from the master plan._

## Scope

Two independent guardrails that close the gaps that let the all-NaN body-of-water incident ship:

1. **W6** — Unit tests and runtime guards ensuring the AEQD projection never produces non-finite coordinates silently.
2. **W7** — A structural require-cycle check in CI so init-order hazards cannot recur.

## Why

Geometry-parity tests (W2/W3) are necessary but not sufficient. The all-NaN bug was a **require cycle** that only misbehaved under Hermes' module init order; Jest/V8 resolved it benignly, so every geometry test passed while the device was broken.

## Work

### W6 — Projection-finiteness guard

New suite at `src/shared/geometry/__tests__/bufferProjection.test.ts` (default jest).

- Assert `projectionFor(feature)` yields a projection whose output is **finite** for a known feature.
- Assert `projectGeometry(...)` contains no non-finite coordinates.
- Assert `EARTH_RADIUS` / `EARTH_RADIUS_METERS` is a finite positive number at import time.
- Keep the existing `[geosSanity]` runtime check in `geosGeometryBackend.ts` — it localized the incident and is quiet on the happy path.
- Optional belt-and-suspenders: add a `bufferProjection`-level invariant (`if (!Number.isFinite(EARTH_RADIUS)) throw`).

See master PLAN §W6 for full details.

### W7 — Require-cycle detection in CI

- Add a `madge --circular` (or equivalent) check over `src/` to `pnpm check`, or a focused guard asserting `src/shared/geometry/*` has no cycle through `@/shared/geojson`.
- Fail CI on new cycles.
- Treat Metro's boot-time `Require cycle: …` warning as a signal, not noise.

See master PLAN §W7 for full details.

## Files

- `src/shared/geometry/__tests__/bufferProjection.test.ts` — new (W6)
- `package.json` / `pnpm check` — add cycle check (W7)

## Verification

- `pnpm test` includes W6 green.
- `pnpm check` includes W7 green; introducing a require cycle fails CI.

## Reference

- Master plan: [`PLAN-geos-overlay-parity-test.md`](./PLAN-geos-overlay-parity-test.md) §W6, §W7

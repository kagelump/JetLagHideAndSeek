# Handoff — P0 dissolve bug fixes (2026-06-08)

**STATUS: COMPLETE.** Both review bugs fixed, a third (O(n²) union hang) found
and fixed, bundle regenerated, all suites green. Remaining: commit (see bottom).

## Summary of the completed run

- **151 features / 1.84 MB raw / 0.53 MB gzip** (was 31,302 / 8.86 MB; old ring
  bundle was 45,566 / 11.5 MB). 0 degenerate rings.
- `node --test extract-measuring-bundles.test.mjs`: **84/84**.
- `pnpm test`: **871 passed, 2 skipped** (74 suites).
- `pnpm check`: **green** (lint, format, typecheck, perf-typecheck, poi-selector
  drift).

## What's done

### Bug A ✅ — polyclip-ts coordinate mismatch

`polygonDissolve` now passes `.coordinates` (raw arrays) to `union`/`intersection` instead of GeoJSON geometry objects. Results are re-wrapped as `{ type: "MultiPolygon", coordinates: ... }` for downstream helpers.

### Bug B ✅ — post-simplify degenerate ring filtering

`simplifyPolygonFeature` now filters rings with < 4 coords after RDP simplification, matching the runtime `simplifyPolygonCoords` contract. Returns `null` when all rings collapse. Call site in `polygonDissolve` skips `null` results.

### Test strengthening ✅

The "dissolve merges overlapping polygons" test now:

- Asserts `result.length === 1` (proves actual merging)
- Uses squares that fit entirely within one tile
- Verifies area ≈ union (not sum) via shoelace formula

### Bug C ✅ — O(n²) sequential union (the 30-min hang)

The dissolve still used `acc = union(acc, next)` sequential accumulation, which
re-processes the growing accumulator on every step. On the real ~26k-polygon
input this is the hang reported during regeneration (pegged 100% CPU, 30+ min,
no progress). Benchmarked on trivial 5-vertex squares: 2,000 polys took **123 s
sequential vs 0.1 s** for a single variadic `union(first, ...rest)` pass.

`polygonDissolve` now calls a new `unionAllCoords(coordsList)` helper:

- One variadic `union(first, ...rest)` pass per tile (polyclip-ts sweeps all
  inputs in one O(n log n) pass).
- Fail-safe: if a union throws (polyclip-ts occasionally fails on degenerate OSM
  rings), the input is split in half and each half dissolved independently, so
  one bad polygon isolates itself instead of poisoning the tile.

Real run: union over 26,707 polygons / 256 tiles finished in **14.8 s** total.

### Smoke-test bound — corrected, not tightened

Item 3 below was based on a wrong premise. The old bundle was fast because
degenerate features buffered to ~nothing. The **correct** dissolved bundle is
real dense coastline (Tokyo Bay window ≈ 67 MultiPolygons), so buffering it
genuinely takes ~2.4 s locally and more on CI — the P1 budget + polygon-coord
simplification keep it bounded but it is not 300 ms / 1.5 s work. So instead of
tightening:

- Added a deterministic **dissolve regression guard** (schemaVersion 2,
  `features.length < 2000`, geometry is Polygon/MultiPolygon) — catches a revert
  to the ring/un-dissolved bundle loudly, with no timing flake.
- Kept the timing check as a generous boundedness guard (`< 8000` ms) with a
  comment explaining why, so it won't flake on slower CI.

### Test results

- Extraction unit tests: **84/84**.
- `pnpm test`: **871 passed, 2 skipped**.
- `pnpm check`: **green**.

## What's left

1. ~~Regenerate the bundle~~ ✅ done (151 features, 1.84 MB).
2. ~~Verify extract-measuring-bundles.test.mjs green~~ ✅ 84/84.
3. ~~Tighten smoke-test bounds~~ ✅ corrected — see "Smoke-test bound" above.
4. ~~Run `pnpm test`~~ ✅ green.
5. **Commit.** Working tree also carries the four other regenerated measuring
   bundles (admin-1st/2nd, coastline, high-speed-rail) from earlier branch work
   and the untracked planning docs — confirm scope before `git add`.

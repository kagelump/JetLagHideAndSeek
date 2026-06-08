# Measuring performance work — design docs

These docs break the `body-of-water` softlock and the broader measuring-perf
findings from [`../measuring_perf_audit.md`](../measuring_perf_audit.md) into
independently shippable pieces. Each doc is self-contained and has a
**Testing** section written so a new contributor can implement and verify it
without prior context.

**Already shipped (not covered here):** the reference-line spill / Tōhoku fix
and the line-pipeline consolidation landed in commit
`feat(measuring): consolidate line geometry pipeline, fix reference-line spill`.
That work introduced `computeLineCategory` (the single `windowFeatures` source),
`computeLineBufferCached`, `clipLineFeaturesToPlayArea`, and `getDilatedPlayArea`.
The docs below build on those primitives. (That was audit item "P4"; it is done,
which is why there is no P4 doc here.)

| Doc                                     | What it does                                                                                                       | Touches                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| [P0](./P0-dissolved-polygon-bundle.md)  | Ship `body-of-water` as **pre-dissolved polygons** instead of 45k line rings. Kills the softlock at the source.    | bundle + extract script + runtime line path |
| [P1](./P1-runtime-input-budget.md)      | Hard **input budget** + lower buffer fidelity + higher min-length floor before `@turf/buffer`. Runtime safety net. | `lineMeasuringGeometry.ts`                  |
| [P2](./P2-windowed-spatial-index.md)    | Replace the fixed 50 km brute-force nearest-point scan with a **windowed spatial index**.                          | `lineMeasuringGeometry.ts` (+ index util)   |
| [P3](./P3-async-derivation.md)          | Move heavy measuring derivation **off the synchronous render `useMemo`** so it can't freeze the UI.                | `questionGeometry.ts`                       |
| [P5](./P5-unify-line-point-pipeline.md) | Unify the line and point paths behind one **bounded pipeline** so future categories inherit the discipline.        | measuring feature folder                    |

## Recommended order

1. **P1** first — it's the cheapest fix that makes the softlock impossible, and
   protects every category regardless of bundle shape. Ship it before anything
   else so the app is safe while the rest lands.
2. **P0** — the real fix for `body-of-water`; removes the work instead of
   capping it. Bigger (bundle + runtime), but highest quality ceiling.
3. **P2** — kills the remaining 1.4 s nearest-point scan.
4. **P3** — makes any future heavy derivation degrade gracefully instead of
   freezing.
5. **P5** — consolidation once the above are proven.

## Shared facts every doc assumes

- Unit tests: `pnpm test` (jest). Single suite:
  `pnpm test -- <pattern>` (e.g. `pnpm test -- lineMeasuringGeometry`).
- Data-script tests (node:test) run in `pnpm pretest` and standalone via
  `node --test data/geofabrik/scripts/extract-measuring-bundles.test.mjs`.
- `pnpm check` = lint + format + typecheck + perf-typecheck + POI-selector drift
  (does **not** run jest — run `pnpm test` too).
- Bundles in `assets/measuring/` are **committed**; CI cannot regenerate them
  (no Geofabrik PBF). Regenerate locally with `pnpm data:measuring` and
  `git add` the output.
- Test seams already exist: `__setLineBundleForTest`,
  `__clearLineBundlesForTest`, `clearLineDistanceCache`,
  `clearLineBufferCache`, `clearLineCategoryCache`, `clearDilatedBoundaryCache`.
- `kdbush` / `geokdbush` are already dependencies (used by matching's
  `spatialIndex.ts`); reuse them, don't add a new index library.
  </content>

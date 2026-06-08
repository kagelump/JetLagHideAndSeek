# P5 — Unify the line and point measuring pipelines

**Status:** ready (do last, after P0–P3) · **Priority:** maintainability ·
**Risk:** low-medium (refactor; behavior-preserving) · **Quality cost:** none if
done as a pure refactor

## Problem

The measuring feature has two parallel geometry paths that solve the same shape
of problem with divergent discipline:

- **Point path** (`pointMeasuringGeometry.ts`) is bounded and fast: columnar
  bbox filter → grid dedup (ε-net) → `@turf/buffer` of a `MultiPoint` with
  `steps: 8` → LRU cache.
- **Line path** (`lineMeasuringGeometry.ts`) historically ran turf/JSTS over raw
  bundle geometry with no budget and a linear nearest-point scan. P0/P1/P2 fix
  the symptoms, but the two paths still don't share the "bbox-filter → index →
  budget/dedup → low-step buffer → cache" skeleton.

The risk: a future measuring category (or a tweak to one path) re-introduces the
unbounded behavior because the bounded behavior isn't encoded in one shared
place. The audit's softlock was exactly this — the line path missing the point
path's guards.

## Goal

Extract one shared, bounded pipeline that both paths use, so:

- adding a category is "plug in a feature source + buffer primitive," and it
  inherits windowing, budgeting, low-step buffering, and caching for free;
- the invariants (input budget, cache keys, step count) live in **one** module
  with **one** set of tests.

This is a **behavior-preserving refactor** — outputs must be identical to
post-P0–P3 behavior.

## Design

Introduce `measuring/pipeline.ts` exposing a generic shape:

```ts
type MeasuringSource<TFeature> = {
    /** Candidate features near a window (bbox prefilter / index). */
    selectWindow(center, playAreaBbox, marginM): TFeature[];
    /** Nearest point + distance from center to the geometry. */
    nearest(center): NearestPointResult | null;
    /** Buffer the window features at a radius into a mask polygon. */
    buffer(features, radiusMeters): Feature<Polygon | MultiPolygon> | null;
};

function computeMeasuringMask<TFeature>(
    source: MeasuringSource<TFeature>,
    center,
    category,
    playAreaBbox,
    radiusMeters,
): { nearest; distanceMeters; mask; windowFeatures };
```

- The shared driver owns: the window-margin logic
  (`max(distance, MIN_WINDOW_MARGIN_M)`), the **input budget** (P1), the
  **low-step buffer fidelity**, and the **LRU caches** + cache-key/version
  scheme.
- The line source wraps `getLineBundle` + the P2 index + `computeLineBuffer`.
- The point source wraps the columnar bundle + grid dedup + `MultiPoint` buffer.
- `computeLineCategory` / `computePointUnionBuffer` become thin adapters over the
  driver (keep their names/exports for callers, or migrate callers — see steps).

Keep `measuringGeometry.ts`'s `buildMeasuringRenderState` as the orchestrator; it
just calls the unified driver per question instead of branching into two bespoke
modules.

## Implementation steps

1. Land P0–P3 first (the pipeline encodes their guards; unifying before they
   exist just moves unbounded code around).
2. Add `measuring/pipeline.ts` with the `MeasuringSource` interface + driver +
   shared budget/cache constants.
3. Implement `lineSource` and `pointSource` adapters over existing code.
4. Re-express `computeLineCategory` and `computePointUnionBuffer` as adapters
   (preserve exports so tests/imports don't churn in step 4), or update callers
   in `measuringGeometry.ts` directly.
5. Delete now-duplicated constants (window margin, step counts, budgets) from the
   two per-shape modules; they live only in `pipeline.ts`.
6. Bump all relevant cache versions once.

## Testing

> **Orientation.** This is a refactor, so the testing strategy is
> **"prove nothing changed."** The strongest tool is a characterization/golden
> test captured _before_ the refactor and asserted _after_. All existing
> measuring suites must stay green unchanged.

### Step 0 — capture goldens BEFORE refactoring

Before touching code, add a golden test that records current outputs, commit it,
and keep it passing through the refactor:

```ts
// measuringGoldens.test.ts — run against pre-refactor code first
const CASES = [
    { category: "body-of-water", center: [139.75, 35.68], answer: "positive" },
    { category: "coastline", center: [139.6, 35.3], answer: "negative" },
    { category: "rail-station", center: [139.7, 35.69], answer: "positive" }, // point
    // ...one per implemented category
];
it.each(CASES)("render state golden for %o", (c) => {
    const state = buildMeasuringRenderState(
        [makeQuestion(c)],
        TOKYO_BBOX,
        TOKYO_BOUNDARY,
    );
    expect(stableSummary(state)).toMatchSnapshot();
});
```

`stableSummary` should reduce the render state to size-stable, deterministic
facts (feature counts per collection, bbox of each mask rounded to ~5 decimals,
geometry types) — **not** raw coordinates (those are huge and noisy). Snapshot
those. The refactor passes iff the snapshots don't change.

### During/after the refactor

1. **All existing suites green, unchanged:** `lineMeasuringGeometry.test.ts`,
   `measuringGeometry.test.ts`, `measuringCategories.test.ts`,
   `measuringConfig.test.ts`, and the point-path tests. Do not edit assertions to
   make them pass — if one fails, the refactor changed behavior.
2. **Golden snapshots unchanged** (Step 0).
3. **Pipeline unit tests (new).** Test the generic driver directly with a fake
   `MeasuringSource` whose methods are jest mocks:
    - window margin = `max(distance, MIN_WINDOW_MARGIN_M)` is passed to
      `selectWindow`.
    - budget is enforced (the driver calls `buffer` with a capped feature set —
      assert via the mock's received arg length ≤ budget).
    - caching: two identical calls invoke `source.buffer` **once** (second is a
      cache hit); a cache clear makes it run again.
    - a `null` from `source.nearest` short-circuits to a null mask.
4. **Both adapters satisfy the interface:** a small contract test that runs
   `lineSource` and `pointSource` through the same driver with injected fixtures
   and asserts both return well-formed masks.

### Commands

```bash
# capture goldens on the pre-refactor commit:
pnpm test -- measuringGoldens -u        # write snapshots, commit them
# after refactor — snapshots must NOT change:
pnpm test -- measuring                  # all measuring suites
pnpm test -- pipeline                   # new driver tests
pnpm typecheck && pnpm check
```

> If `-u` would rewrite a golden snapshot after the refactor, **stop** — that is
> a behavior change, not a clean refactor. Investigate before updating.

### Native check

Pure-logic refactor with unchanged outputs → jest + `pnpm check` are sufficient.
Run the Maestro measuring flow once as a final smoke
(`pnpm test:e2e:stack` or the `Maestro E2E` workflow) since it touches the map
render path.

## Acceptance criteria

- [ ] Golden snapshots identical before/after (no `-u` needed post-refactor).
- [ ] All existing measuring suites pass without assertion edits.
- [ ] Budget/window/step/cache constants exist in exactly one module
      (`pipeline.ts`); duplicates removed from the per-shape modules.
- [ ] New driver tests cover window margin, budget, caching, and null
      short-circuit.
- [ ] `pnpm test` + `pnpm check` pass; Maestro measuring flow green.

## Rollback

Refactor-only; revert the commit. Because outputs are golden-verified identical,
rollback carries no data/behavior risk.
</content>

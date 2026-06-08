# P8 — Include coastline in the body-of-water calculation

**Status:** ready to implement · **Type:** _correctness_ (runtime, no bundle regen) ·
**Risk:** low · **Touches:** `lineBundleLoader.ts` + `lineMeasuringGeometry.ts` (two read sites) + tests

> Instructions doc for an implementing agent. Self-contained: rationale, the one
> design decision, exact code seams, tests, verification.

## Context — why this exists

The sea is a body of water, but the `measuring` **Body of Water** category only
queries inland water (`natural=water` / basin / riverbank, and — after
[P7](./P7-waterway-centerline-coverage.md) — waterway centerlines). A seeker
standing on the coast is near a body of water (the ocean), yet the question
reports the nearest _inland_ water instead, which can be far away. The
**Coastline** geometry — already extracted as its own bundle
(`assets/measuring/coastline.json`, `way/natural=coastline` LineStrings) — should
also count toward Body of Water.

`Coastline` stays its own standalone category (distance-to-coast is still a valid
question); P8 only makes Body of Water _additionally_ consider coastline.

## Goal & scope

When `category === "body-of-water"`, the nearest-point distance, the mask buffer,
and the rendered reference line all consider **body-of-water ∪ coastline**
geometry. No other category changes. No bundle regeneration (coastline is already
a committed bundle).

This composes cleanly with P7 (which enriches the _body-of-water bundle_ at
extraction): P8 unions the _coastline bundle_ at runtime. The two are orthogonal
and order-independent.

## Design

Both relevant runtime functions read a single bundle via `getLineBundle(category)`
and iterate its `features`. Because the mask buffer (`computeLineBufferCached`)
and the reference line (`buildMeasuringRenderState`) are both derived from
`computeLineCategory`'s `windowFeatures` (the P4 single-source consolidation),
**one change at the two bundle-read seams propagates to distance, mask, and line.**

**Chosen approach — runtime union (Option 1).** Introduce a category→extra-source
map and have the two read sites gather features from all source bundles. Coastline
features are `LineString`s, which `computeLineDistance` / `selectWindowFeatures`
already handle (the non-polygon branch), so no new geometry handling is needed.

> _Rejected — extraction merge (Option 2):_ copy coastline geometry into
> `body-of-water.json` at extract time. Duplicates coastline data across two
> bundles, grows the bundle, and needs a regen. Option 1 is strictly smaller and
> reuses the already-committed coastline bundle.

Caches stay valid: `computeLineDistance` (keyed `category,center`),
`computeLineCategory` (keyed `category,center,bbox`), and the buffer/clip caches
are all still correct because coastline is _always_ merged into body-of-water
deterministically.

### Why this is safe

- **`inside polygon → distance 0` early-return** (`computeLineDistance`, ~line
  944): only fires for Polygon/MultiPolygon, never for coastline LineStrings.
  Merging is order-independent — distance takes the min, the buffer unions.
- **Offshore semantics:** coastline is the shore _line_, not a sea polygon, so a
  seeker just off the coast measures a small distance to the shoreline — exactly
  the desired "near a body of water" behavior. Seekers are on land, so the
  far-out-at-sea case is irrelevant.
- **Redundancy** where a coastal water polygon and the coastline coincide is
  harmless (min / union).

## Implementation

### 1. `lineBundleLoader.ts` — source-bundle map + accessor

Add a map of categories that draw from extra bundles, and an accessor returning
the de-duplicated, non-null source bundles:

```ts
/** Categories whose measuring calc draws from additional source bundles. */
const MEASURING_EXTRA_BUNDLES: Partial<
    Record<MeasuringCategory, MeasuringCategory[]>
> = {
    // The ocean is a body of water — fold the coastline shoreline in.
    "body-of-water": ["coastline"],
};

/**
 * Returns every source bundle that feeds `category`'s measuring calculation —
 * the category's own bundle plus any extras (e.g. coastline for body-of-water).
 * Nulls (point categories / missing bundles) are filtered out.
 */
export function getLineBundleSources(
    category: MeasuringCategory,
): LineBundle[] {
    const keys = [category, ...(MEASURING_EXTRA_BUNDLES[category] ?? [])];
    const out: LineBundle[] = [];
    for (const k of keys) {
        const b = getLineBundle(k);
        if (b && b.features.length > 0) out.push(b);
    }
    return out;
}
```

Keep `getLineBundle` as-is (still used by tests and as the single-bundle loader).

### 2. `lineMeasuringGeometry.ts` — `selectWindowFeatures` (~line 62)

Replace the single `getLineBundle(category)` + single-`fc.features` loop with a
loop over `getLineBundleSources(category)`, accumulating into `result`. Sum the
feature counts for the existing `[selectWindow]` log. Early-return `[]` only when
_all_ sources are empty.

### 3. `lineMeasuringGeometry.ts` — `computeLineDistance` (~line 909)

Same pattern: iterate `getLineBundleSources(category)` and run the existing
bbox-filter / polygon-inside / ring-extraction body over **each** source's
features (one combined `lines[]`). Preserve the inside-polygon early return
(returns 0 from any source). Update the `[lineDistance] bundle load` /
`bbox filter` logs to reflect the combined feature count.

### 4. (Optional, cosmetic) `measuringCategories.ts`

The body-of-water `osmQueryTags` (~line 99) is the Overpass-fallback string; line
categories use bundles, not Overpass, so it's effectively display-only. Optionally
append `way["natural"="coastline"];` for consistency, and/or tweak the **Body of
Water** title/description to signal it includes the coast. Not required for
function.

## Tests

`src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts`
(inject both bundles via `__setLineBundleForTest`; clear caches in `beforeEach`):

1. **Coastline counts for body-of-water.** Set a `body-of-water` bundle with a
   _far_ water feature and a `coastline` bundle with a _near_ shoreline.
   `computeLineDistance(center, "body-of-water")` snaps to the coastline (small
   distance). Without P8 it snaps to the far water feature.
2. **Window includes coastline.** `computeLineCategory(...).windowFeatures`
   contains the coastline feature(s) → the derived mask + reference line include
   the coast (assert through `buildMeasuringRenderState` `lineFeatures`).
3. **Other categories unaffected.** `coastline` and (say) `admin-1st-border`
   distances are unchanged — `getLineBundleSources` returns only their own bundle.
4. **Real bundle.** A seeker on a Tokyo Bay shoreline point returns a small
   `body-of-water` distance (dominated by coastline, not an inland feature).

## Verification

```bash
pnpm exec jest --testPathPattern="(lineMeasuringGeometry|measuringGeometry)"
pnpm typecheck
pnpm check
```

Manual (device): Tokyo 23-Wards, Measuring → **Body of Water**, place the seeker
near Tokyo Bay → the reference line traces the **coastline** and the nearest-point
marker/connector point at the shore; the mask reflects nearness to the sea.

No bundle regeneration and no `git add assets/...` — this is runtime-only.

## Acceptance criteria

- [ ] For `body-of-water`, nearest-distance / mask / reference line consider
      `body-of-water ∪ coastline`; a near-coast seeker gets a small distance.
- [ ] `coastline` and all other categories are unchanged.
- [ ] Single seam (`getLineBundleSources`) feeds both read sites; caches untouched
      in behavior.
- [ ] No bundle regen; `pnpm test` / `pnpm typecheck` / `pnpm check` green.

## Rollback

Pure runtime change in two functions plus one map. Revert the commit; remove the
`body-of-water → coastline` entry from `MEASURING_EXTRA_BUNDLES` to disable.

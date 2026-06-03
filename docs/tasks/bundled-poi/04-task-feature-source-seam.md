# Task 04 — FeatureSource Seam (local + Overpass dispatch)

**Epic:** [Bundled Offline POIs](epic.md)
**Phase:** 1 (MVP)
**Status:** Not started
**Depends on:** 03 (`bundledPois.ts`)
**Blocks:** 05 (cache integration)

## Objective

Introduce the single dispatch point the cache will call instead of Overpass directly:
`resolveBboxFeatures(category, bbox, signal)` returns local bundled features when a bundled
region fully covers the bbox, otherwise falls back to
`fetchAndParseOverpassBboxFeatures`. This is the one seam the epic hinges on; keep it small
and pure so it is trivially testable.

## Context

- The active cache path is the **cell** cache, which fetches per-cell **bboxes** via
  `fetchAndParseOverpassBboxFeatures(category, south, west, north, east, signal)`
  ([`osmMatching.ts:192`](../../../src/features/questions/matching/osmMatching.ts),
  called from `osmMatchingCache.ts:595` and `:636`). The seam therefore operates on a
  **bbox**, matching the cell grid.
- Cell bboxes come from `cellBbox(cellId)` →
  `{ south, west, north, east }` (`osmMatchingGrid.ts:41`).
- `Bbox` tuple order in `src/shared/geojson.ts` is `[west, south, east, north]`. Be
  explicit converting between the cell's `{south,west,north,east}` object and the tuple.
- Local features come from `getBundledCategoryFeatures(regionId, category)` and must be
  filtered to the requested bbox so the cell cache stores only that cell's features
  (preserving dedup/merge semantics across cells).

## Files to create / modify

**Create:**

- `src/features/questions/matching/featureSource.ts`
- `src/features/questions/matching/__tests__/featureSource.test.ts`

**Modify:** none yet (task 05 rewires the cache to call this).

## Implementation

```ts
import type { Bbox } from "@/shared/geojson";
import { getBundledCategoryFeatures, regionCoveringBbox } from "./bundledPois";
import type { MatchingCategory, OsmFeature } from "./matchingTypes";
import { fetchAndParseOverpassBboxFeatures } from "./osmMatching";

export type BboxObj = {
    south: number;
    west: number;
    north: number;
    east: number;
};

export type FeatureSourceKind = "local" | "overpass";

export type ResolvedBboxFeatures = {
    features: OsmFeature[];
    source: FeatureSourceKind;
    /** ISO timestamp of the bundle the local features came from (for staleness). */
    generatedAt?: string;
};

const toBbox = (b: BboxObj): Bbox => [b.west, b.south, b.east, b.north];

/** Returns bundled features whose point falls inside the bbox, or null if not covered. */
export function localBboxFeatures(
    category: MatchingCategory,
    bbox: BboxObj,
): { features: OsmFeature[]; generatedAt: string } | null {
    const tuple = toBbox(bbox);
    const regionId = regionCoveringBbox(tuple);
    if (!regionId) return null;

    const all = getBundledCategoryFeatures(regionId, category);
    const features = all.filter(
        (f) =>
            f.lon >= bbox.west &&
            f.lon <= bbox.east &&
            f.lat >= bbox.south &&
            f.lat <= bbox.north,
    );
    // generatedAt for staleness stamping — import getRegionGeneratedAt from bundledPois.
    return { features, generatedAt: getRegionGeneratedAt(regionId) ?? "" };
}

/**
 * Resolve features for a cell bbox: bundled data if a region fully covers the cell,
 * else Overpass. The cell cache (task 05) calls this in place of
 * fetchAndParseOverpassBboxFeatures.
 */
export async function resolveBboxFeatures(
    category: MatchingCategory,
    bbox: BboxObj,
    signal?: AbortSignal,
): Promise<ResolvedBboxFeatures> {
    const local = localBboxFeatures(category, bbox);
    if (local) {
        return {
            features: local.features,
            source: "local",
            generatedAt: local.generatedAt || undefined,
        };
    }
    const features = await fetchAndParseOverpassBboxFeatures(
        category,
        bbox.south,
        bbox.west,
        bbox.north,
        bbox.east,
        signal,
    );
    return { features, source: "overpass" };
}
```

Add the missing import: `getRegionGeneratedAt` from `./bundledPois` (task 03 exports it).

### Why bbox-coverage, not point-coverage

A cell is `CELL_DEGREES` (0.1°) wide. Using `regionCoveringBbox(cellTuple)` guarantees the
**entire cell** is inside the bundled region before serving locally — so a cell on the
region edge that pokes outside the bundle falls back to Overpass rather than returning a
truncated local result. This keeps results correct at boundaries without a multi-region
merge (a documented future refinement).

## Edge cases

- **No bundled region / partial coverage** → `localBboxFeatures` returns `null` → Overpass.
- **Covered region, category absent in bundle** (e.g. an `admin-*` cell, or a category with
  zero features in that region): `getBundledCategoryFeatures` returns `[]`. Decide:
    - For `isBundleableCategory(category) === false` (admin, transit-line): **do not** treat
      as locally covered — return `null` so Overpass answers. Add an early
      `if (!isBundleableCategory(category)) return null;` in `localBboxFeatures` (import from
      `matchingSelectors`, task 01).
    - For a bundleable category that genuinely has zero features in the bbox: returning an
      empty local result is **correct** (there are none there). Distinguish these two cases
      via `isBundleableCategory`, not via array length.
- **`signal` already aborted** before an Overpass call: `fetch` will reject; that's the
  existing behavior — don't special-case.
- Local path ignores `signal` (synchronous, instant) — fine.

## Testing

`featureSource.test.ts` (mock `bundledPois` and `osmMatching`):

- `localBboxFeatures` returns `null` when `regionCoveringBbox` returns `null`.
- `localBboxFeatures` returns only features inside the bbox (filters out-of-bbox points).
- `localBboxFeatures` returns `null` for a non-bundleable category (`admin-1st`) even if a
  region covers it.
- `resolveBboxFeatures` returns `{source:"local"}` with bundled features + `generatedAt`
  when covered.
- `resolveBboxFeatures` calls `fetchAndParseOverpassBboxFeatures` with the correct
  `(south, west, north, east)` argument order and returns `{source:"overpass"}` when not
  covered.
- An aborted `signal` propagates to the Overpass call (assert it's forwarded).

Mock pattern: `jest.mock("./bundledPois", () => ({ ... }))` and
`jest.mock("./osmMatching", () => ({ fetchAndParseOverpassBboxFeatures: jest.fn() }))` —
follow the existing mock style in
[`osmMatchingCache.test.ts`](../../../src/features/questions/matching/__tests__/osmMatchingCache.test.ts).

## Acceptance criteria

- [ ] `resolveBboxFeatures` returns local features for a covered, bundleable category and
      Overpass features otherwise.
- [ ] Argument order to `fetchAndParseOverpassBboxFeatures` is verified by test.
- [ ] Non-bundleable categories always fall back to Overpass.
- [ ] `pnpm typecheck` + new tests pass. No changes to `osmMatchingCache.ts` yet.

## Out of scope

- Wiring this into the cache and the staleness stamp (task 05).
- A radius (circle) variant. The cell path is the only active consumer; the legacy
  `fetchAndStore`/`revalidateInBackground` circle path (`osmMatchingCache.ts:405`,`:366`)
  can be left on Overpass, or given a `resolveRadiusFeatures` sibling in task 05 if needed.

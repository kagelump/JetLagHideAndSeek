# Task 03 — Bundle Asset Loader + In-Memory Index

**Epic:** [Bundled Offline POIs](epic.md)
**Phase:** 1 (MVP)
**Status:** Not started
**Depends on:** 02 (output schema: `assets/poi/<regionId>.json`, `assets/poi/regions.json`)
**Blocks:** 04 (feature source)

## Objective

A runtime module that lazily loads a bundled region's columnar POI JSON, reconstructs
`OsmFeature` objects on demand per category, and answers "which bundled region covers this
point/bbox?" — without parsing the large JSON until a matching query actually needs it.

## Context — constraints

- Metro bundles `.json` natively; the precedent is `import osakaBoundaryJson from
"../../../assets/default-zones/osaka.json"` (`playAreaBoundary.ts:4`) and the larger
  `tokyo.json` (175 KB). The Kantō POI file is ~2.7 MB parsed, so it must be loaded
  **lazily**, not via a top-level `import` (which Metro evaluates eagerly at first module
  import and would tax startup).
- Metro requires **literal** `require()` paths; dynamic `require(variable)` does not work.
  Use a `switch` over `regionId` with one literal `require` per region (mirrors how RN
  apps register static assets).
- `OsmFeature` shape (do not change):
  `{ lat, lon, name, nameLength?, osmId, osmType: "node"|"way"|"relation", tags }`
  ([`matchingTypes.ts:45`](../../../src/features/questions/matching/matchingTypes.ts)).
  The bundle stores `osmType` as `0|1|2` and no `tags`; the loader maps back and sets
  `tags: {}`.
- `Bbox` is `[west, south, east, north]` (`src/shared/geojson.ts:11`).

## Files to create

- `src/features/questions/matching/bundledPois.ts` — loader, index, coverage.
- `src/features/questions/matching/__tests__/bundledPois.test.ts` — unit tests.
- `src/features/questions/matching/__tests__/fixtures/poi-mini.json` — a tiny hand-written
  region fixture (2–3 categories, a handful of features) for tests.

(Region registry `assets/poi/regions.json` is statically importable — it is small.)

## Implementation

### Types

```ts
import type { Bbox } from "@/shared/geojson";
import type { MatchingCategory, OsmFeature } from "./matchingTypes";

type RawCategory = {
    count: number;
    lon: number[];
    lat: number[];
    name: string[];
    osmId: number[];
    osmType: number[];
    nameLength?: number[]; // present only for station-name-length
};

type RawRegion = {
    schemaVersion: number;
    region: string;
    label: string;
    generatedAt: string;
    bbox: Bbox;
    totalCount: number;
    categories: Partial<Record<MatchingCategory, RawCategory>>;
};

type RegionMeta = { id: string; label: string; bbox: Bbox; file: string };
```

### Region registry + coverage (cheap, eager)

```ts
import regionsJson from "../../../../assets/poi/regions.json";

const REGIONS: RegionMeta[] = regionsJson.regions;

function bboxContainsPoint(b: Bbox, lat: number, lon: number): boolean {
    const [w, s, e, n] = b;
    return lon >= w && lon <= e && lat >= s && lat <= n;
}

function bboxContainsBbox(outer: Bbox, inner: Bbox): boolean {
    return (
        inner[0] >= outer[0] &&
        inner[1] >= outer[1] &&
        inner[2] <= outer[2] &&
        inner[3] <= outer[3]
    );
}

/** Region whose bbox fully contains the query bbox, or null. */
export function regionCoveringBbox(bbox: Bbox): string | null {
    return REGIONS.find((r) => bboxContainsBbox(r.bbox, bbox))?.id ?? null;
}

/** Region whose bbox contains the point, or null. */
export function regionCoveringPoint(lat: number, lon: number): string | null {
    return REGIONS.find((r) => bboxContainsPoint(r.bbox, lat, lon))?.id ?? null;
}
```

### Lazy region load (heavy, deferred + memoized)

```ts
const regionCache = new Map<string, RawRegion>();

function loadRegionRaw(regionId: string): RawRegion | null {
    const cached = regionCache.get(regionId);
    if (cached) return cached;

    let raw: RawRegion | null = null;
    switch (regionId) {
        case "japan-kanto":
            // Literal path so Metro can resolve + lazily evaluate on first call.
            raw =
                require("../../../../assets/poi/japan-kanto.json") as RawRegion;
            break;
        default:
            raw = null;
    }
    if (raw) regionCache.set(regionId, raw);
    return raw;
}
```

> Adding a region = one `case`. Keep the `switch` and `regions.json` in sync; consider a
> dev-only assertion that every `regions.json` id has a `case`.

### Category accessor → `OsmFeature[]`

```ts
const OSM_TYPES = ["node", "way", "relation"] as const;

/** Reconstructs OsmFeatures for a category in a region. Empty array if absent. */
export function getBundledCategoryFeatures(
    regionId: string,
    category: MatchingCategory,
): OsmFeature[] {
    const region = loadRegionRaw(regionId);
    const col = region?.categories[category];
    if (!col) return [];

    const out: OsmFeature[] = new Array(col.count);
    for (let i = 0; i < col.count; i++) {
        const f: OsmFeature = {
            lat: col.lat[i],
            lon: col.lon[i],
            name: col.name[i],
            osmId: col.osmId[i],
            osmType: OSM_TYPES[col.osmType[i]] ?? "node",
            tags: {},
        };
        if (col.nameLength) f.nameLength = col.nameLength[i];
        out[i] = f;
    }
    return out;
}

/** Returns the bundle's generatedAt for staleness stamping (task 05), or null. */
export function getRegionGeneratedAt(regionId: string): string | null {
    return loadRegionRaw(regionId)?.generatedAt ?? null;
}
```

> **Memoization tradeoff:** `getBundledCategoryFeatures` rebuilds the array each call.
> Callers (task 04) filter by bbox immediately, so the array is short-lived. If profiling
> shows churn, memoize per `(regionId, category)`. Do **not** prematurely cache all
> categories — that defeats lazy loading. Start without per-category memo; add it only if
> the perf harness flags it.

## Edge cases

- `regions.json` empty / region file missing from the `switch` → accessors return `[]`,
  coverage returns `null`; callers fall back to Overpass. No throw.
- `osmType` out of range → default `"node"`.
- A category present in `regions.json` totals but absent from the region's `categories`
  (zero features) → `[]`.
- Schema version mismatch (`region.schemaVersion !== 1`) → log a dev warning and treat as
  no coverage (return `[]`/`null`) so a stale committed asset can't crash the app.

## Testing

Use the `poi-mini.json` fixture and a matching `regions.json` fixture (or inject the
registry via a test-only setter). Mock the `require` by pointing the `switch` at the
fixture in tests, or refactor `loadRegionRaw` to accept an injectable loader for testability
(preferred — see below).

> **Testability note:** hard-coded `require` is hard to unit-test. Refactor so the
> region→raw mapping is a module-level `Map<string, () => RawRegion>` that production
> populates with the `require` thunks and tests populate with fixtures. Keep the lazy
> semantics (thunks aren't called until accessed).

Tests:

- `regionCoveringPoint` inside the fixture bbox returns the id; outside returns `null`.
- `regionCoveringBbox` true only when fully contained; a straddling bbox returns `null`.
- `getBundledCategoryFeatures("<region>", "park")` returns correctly reconstructed
  `OsmFeature`s with `tags: {}` and string `osmType`.
- Station category features carry `nameLength`.
- Unknown region / unknown category → `[]`.
- Lazy: the heavy loader thunk is **not** invoked by `regionCoveringPoint` (only by the
  category accessor). Assert via a spy that coverage checks don't trigger the load.
- Schema mismatch fixture → `[]` + no throw.

## Acceptance criteria

- [ ] `getBundledCategoryFeatures` reconstructs valid `OsmFeature[]` from the fixture.
- [ ] Coverage functions are correct and do **not** trigger the heavy region load.
- [ ] Region load is memoized (second access doesn't re-`require`/re-parse).
- [ ] `pnpm typecheck` + the new tests pass.

## Out of scope

- The local/Overpass dispatch (task 04).
- gzip/downloaded packs (task 07) — those will register additional region loaders through
  the same injectable map.

# Task 02 — POI Extraction Pipeline Stage

**Epic:** [Bundled Offline POIs](epic.md)
**Phase:** 1 (MVP)
**Status:** Not started
**Depends on:** 01 (selector registry → `data/geofabrik/poi-selectors.json`)
**Blocks:** 03 (asset loader), 06 (attribution)

## Objective

Add a curated POI extraction stage to the Geofabrik pipeline that produces the bundleable
artifact the app loads. It must fix the three gaps in the current `--poi` stage:

1. **Node-only extraction.** The current stage filters `n/<key>` only
   ([`fetch-geofabrik.mjs:72`](../../../data/geofabrik/scripts/fetch-geofabrik.mjs)).
   Parks, golf courses, hospitals, museums, and aerodromes are largely **ways/relations**.
   Extract node **+ way + relation** and reduce each to a centroid (Overpass's `out center`
   does this server-side; we replicate it offline). This is why the measured count is
   58,479, not the node-only framing in `SIZES.md`.
2. **Key-level filtering.** The current stage filters whole keys (`amenity`, `tourism`),
   pulling 10–40× more than needed. Filter by `key=value` from the registry.
3. **Missing categories.** `diplomatic` (consulate) is absent from `config.yaml`'s
   `poiNodeKeys`. The registry includes it.

Output is **per-region columnar JSON** (one file per region) plus a region **index** and
**stats**, consuming the named-only, centroid-reduced features.

## Context

- Existing script: [`data/geofabrik/scripts/fetch-geofabrik.mjs`](../../../data/geofabrik/scripts/fetch-geofabrik.mjs).
  Reuse its download/cache logic and `osmium` invocation style (`execFileSync`).
- `osmium` 1.19.1 is available; `osmium export -f geojsonseq` emits one feature per
  tagged object (RFC 8142: each line is prefixed with an `0x1e` record separator that must
  be stripped before `JSON.parse`).
- Coordinate reduction was validated in the epic appendix: filter → export geojsonseq →
  reduce to named centroids → 58,479 records → 0.93 MB gzip.
- The engine keeps **only named features** (`osmMatching.ts:246` drops unnamed). The
  reducer must do the same.
- For `station-name-length`, the engine uses the **English** name (`name:en` || `name`)
  and stores `nameLength` (`osmMatching.ts:262-266`). The reducer must precompute these
  for the station category.
- Downstream uses only `lat, lon, name, nameLength?, osmId, osmType`; **`tags` is not
  stored** (verified: only the parse stage reads tags).

## Files to create / modify

**Modify:**

- `data/geofabrik/scripts/fetch-geofabrik.mjs` — add a `--bundle` stage (keep the existing
  `--poi` stats stage, or replace it; see Implementation).
- `data/geofabrik/config.yaml` — remove the stale `poiNodeKeys` (now sourced from the
  registry) or leave it for the legacy `--poi` stats stage and add a comment pointing to
  `poi-selectors.json`.
- `package.json` — add `data:geofabrik:bundle` and `test:data:geofabrik` scripts.

**Create:**

- `data/geofabrik/scripts/poiReducer.mjs` — the pure reduction logic (extracted so it is
  unit-testable without osmium).
- `data/geofabrik/scripts/poiReducer.test.mjs` — `node --test` unit tests.

**Generated (committed):**

- `assets/poi/<regionId>.json` — the bundled columnar artifact (e.g.
  `assets/poi/japan-kanto.json`).
- `assets/poi/<regionId>.stats.json` — per-category counts + sizes.
- `assets/poi/regions.json` — registry of bundled regions (id, label, bbox, generatedAt,
  counts) for the runtime coverage check.

> Place the artifact under `assets/` (not `data/geofabrik/generated/`) because the app
> bundles from `assets/` (precedent: `assets/default-zones/`). The pipeline writes there.

## Output schema

### `assets/poi/<regionId>.json` (columnar, per region)

```json
{
    "schemaVersion": 1,
    "region": "japan-kanto",
    "label": "Kantō, Japan",
    "generatedAt": "2026-06-01T20:21:26Z",
    "sourceSequence": 3320,
    "source": "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf",
    "bbox": [134.045, 18.625, 155.606, 37.16],
    "attribution": {
        "text": "© OpenStreetMap contributors. ODbL. Geofabrik extract.",
        "license": "ODbL-1.0",
        "url": "https://www.openstreetmap.org/copyright"
    },
    "totalCount": 58479,
    "categories": {
        "park": {
            "count": 30000,
            "lon": [139.700001, 139.701234, "..."],
            "lat": [35.66, 35.69, "..."],
            "name": ["Yoyogi Park", "..."],
            "osmId": [123456, "..."],
            "osmType": [1, 1, 0, "..."]
        },
        "museum": {
            "count": 1945,
            "lon": [],
            "lat": [],
            "name": [],
            "osmId": [],
            "osmType": []
        }
    }
}
```

Rules:

- `osmType` integer encoding: `0 = node`, `1 = way`, `2 = relation`.
- `lon`/`lat`: numbers rounded to **6 decimals** (`Math.round(x * 1e6) / 1e6`).
- Parallel arrays per category are **index-aligned**: feature `i` is
  `(lon[i], lat[i], name[i], osmId[i], osmType[i])`.
- For `station-name-length` only, add a parallel `nameLength: number[]` array and set
  `name[i]` to the English display name (`name:en` || `name`).
- Only categories with ≥1 feature are emitted (omit empties).
- `bbox` is `[west, south, east, north]` — match `Bbox` in
  [`src/shared/geojson.ts`](../../../src/shared/geojson.ts) (`[minX, minY, maxX, maxY]`).
  Use the region's PBF header bbox (from `osmium fileinfo`) or compute from features.

### `assets/poi/regions.json`

```json
{
    "schemaVersion": 1,
    "generatedAt": "2026-06-03T00:00:00Z",
    "regions": [
        {
            "id": "japan-kanto",
            "label": "Kantō, Japan",
            "bbox": [134.045, 18.625, 155.606, 37.16],
            "totalCount": 58479,
            "file": "japan-kanto.json"
        }
    ]
}
```

## Implementation

### 1. `poiReducer.mjs` (pure, testable)

```js
const TYPE_CODE = { node: 0, way: 1, relation: 2 };

/** Centroid of any GeoJSON geometry (mean of all coordinates). */
export function centroid(geometry) {
    if (geometry.type === "Point") return geometry.coordinates;
    let sx = 0,
        sy = 0,
        n = 0;
    const walk = (c) => {
        if (typeof c[0] === "number") {
            sx += c[0];
            sy += c[1];
            n++;
        } else c.forEach(walk);
    };
    walk(geometry.coordinates);
    return [sx / n, sy / n];
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Reduces a GeoJSONSeq line (already 0x1e-stripped, JSON-parsed Feature) to a compact
 * record, or null if it has no name. `categoryOf(props)` maps a feature's tags to one of
 * the bundle categories (or null). For station features, computes English name + length.
 */
export function reduceFeature(feature, categoryOf) {
    const props = feature.properties ?? {};
    const category = categoryOf(props);
    if (!category) return null;

    const isStation = category === "station-name-length";
    const name = isStation
        ? props["name:en"]?.trim() || props.name?.trim() || ""
        : props.name?.trim() || "";
    if (!name) return null;

    const [lon, lat] = centroid(feature.geometry);
    const osmId = Number(props["@id"] ?? feature.id ?? 0);
    const osmType = TYPE_CODE[props["@type"] ?? "node"] ?? 0;

    const record = {
        category,
        lon: round6(lon),
        lat: round6(lat),
        name,
        osmId,
        osmType,
    };
    if (isStation) record.nameLength = name.length;
    return record;
}

/** Builds the columnar per-region object from an array of reduced records. */
export function buildColumnar(records) {
    /* group by category, push parallel arrays */
}
```

> `categoryOf(props)`: derive from `poi-selectors.json`. For each bundle category, check
> whether the feature's properties satisfy any selector's ANDed conditions. Because a
> feature can match multiple categories (rare here), assign it to the **first** matching
> category in a deterministic registry order, OR emit it under each — pick **first match**
> for Phase 1 and document it. (Overpass would return it once per category query; the
> bundle stores it once. Acceptable: ranking is per-category and the same feature rarely
> qualifies for two of these specific categories.)

### 2. `fetch-geofabrik.mjs` `--bundle` stage

Per region, after the PBF is present:

1. Read `data/geofabrik/poi-selectors.json` → `tagsFilterArgs` (e.g.
   `["aeroway=aerodrome", "amenity=cinema,hospital,library", ...]`).
2. `osmium tags-filter <pbf> <...tagsFilterArgs> -o <tmp>/curated.osm.pbf -O`.
3. `osmium export <tmp>/curated.osm.pbf -f geojsonseq -o <tmp>/curated.seq -O`.
4. Stream `curated.seq` line by line: strip leading `\x1e`, `JSON.parse`, `reduceFeature`,
   collect non-null records. (Stream — do not read the whole file into memory; the seq for
   a country can be large.)
5. `buildColumnar(records)` → write `assets/poi/<regionId>.json`.
6. Compute per-category counts + gzip size (`node:zlib gzipSync`), write
   `assets/poi/<regionId>.stats.json`.
7. After all regions, write/merge `assets/poi/regions.json`.

CLI flags (extend the existing parsing at `fetch-geofabrik.mjs:25`):

| Flag                                                                           | Behavior                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `--bundle`                                                                     | Run the curated bundle stage (this task).                            |
| `--cache-only`                                                                 | Existing: use cached PBFs only.                                      |
| `--check`                                                                      | Regenerate the bundle into a temp dir and diff against the committed |
| `assets/poi/*.json`; exit non-zero on difference (CI guard + reproducibility). |

Keep the existing `--poi` stats stage if useful, but it is now legacy (node-only,
key-level). Prefer routing CI through `--bundle --check`.

### 3. `package.json` scripts

```json
"data:geofabrik:bundle": "node data/geofabrik/scripts/fetch-geofabrik.mjs --cache-only --bundle",
"test:data:geofabrik": "node --test data/geofabrik/scripts/poiReducer.test.mjs"
```

(The pipeline also needs `data:poi-selectors` from task 01 to have run first; document the
order in the script comments / a `data:geofabrik:bundle` that runs `data:poi-selectors`
first.)

## Edge cases

- **GeoJSONSeq `0x1e` prefix** — strip with `line.replace(/^\x1e/, "")` before parsing.
  Empty lines must be skipped.
- **Degenerate geometry** (a way with one node, empty coordinates) — `centroid` would
  divide by zero (NaN). Skip records where `lon`/`lat` are not finite.
- **Missing `@id`/`@type`** — `osmium export` writes `@id` like `"node/123"` or numeric
  `@id` + `@type`; confirm the actual property names your osmium version emits (run on a
  10-line sample) and adapt `reduceFeature`. Do not assume; verify.
- **Antimeridian / very large regions** — centroid-by-mean is fine for the compact regions
  here; note as a limitation for future global packs.
- **Duplicate features across categories** — assign to first matching category (documented).
- **Determinism** — sort records within each category by `osmId` before building columnar
  arrays so output is stable across runs (required for `--check` to be meaningful).

## Testing

`poiReducer.test.mjs` (`node --test`, no osmium needed — feed Feature objects):

- `centroid` of a `Point` returns the point; of a `Polygon` returns the mean of its ring
  coords; of a `MultiPolygon` averages all coords.
- `reduceFeature` drops a feature with no `name`.
- `reduceFeature` for a park way returns `{category:"park", osmType:1, ...}` with 6-dp
  coords.
- `reduceFeature` for a station prefers `name:en`, sets `nameLength` to its length.
- `reduceFeature` returns null when `categoryOf` returns null.
- `reduceFeature` skips NaN centroids (degenerate geometry).
- `buildColumnar` produces index-aligned parallel arrays, sorted by `osmId`, omits empty
  categories, includes `nameLength` only for stations.

Optional integration smoke (guarded by `existsSync(pbf)` so it skips in CI without the
PBF): run `--bundle --cache-only` against the cached Kantō PBF and assert
`assets/poi/japan-kanto.json` has `totalCount` within ±5% of 58,479.

## Acceptance criteria

- [ ] `pnpm data:geofabrik:bundle` produces `assets/poi/japan-kanto.json`,
      `assets/poi/japan-kanto.stats.json`, and `assets/poi/regions.json`.
- [ ] The Kantō artifact has `totalCount` ≈ 58k and gzips to ≈ 0.9 MB (check the stats file).
- [ ] Every bundled category from the registry with ≥1 Kantō feature appears; `park`,
      `hospital`, `museum`, `golf-course`, `mountain`, `library` are non-empty.
- [ ] `station-name-length` entries carry `nameLength` and English names.
- [ ] `pnpm test:data:geofabrik` (reducer unit tests) passes.
- [ ] `--bundle --check` is reproducible (re-running yields a byte-identical artifact).

## Out of scope

- The runtime loader (task 03).
- Admin-division centroids derived from the boundary pipeline (Phase 1.5 follow-up): a
  future stage can read `data/geofabrik/generated/boundaries.json`, compute each admin
  relation's centroid, and emit `admin-1st`…`admin-4th` categories. Leave a TODO.
- gzip artifacts for download (task 07 emits `.json.gz`).

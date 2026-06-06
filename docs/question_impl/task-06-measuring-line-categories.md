# Task 06: Measuring — Line/Polygon-Distance Categories

**Depends on**: Task 05 (Measuring point categories — base type, `measuringCategories.ts`,
`measuringGeometry.ts`, detail screen). At time of writing, the repo has
`measuringTypes.ts` and `measuringConfig.ts` only; this task assumes Task 05 has
landed `measuringCategories.ts` (the per-category config array) and
`measuringGeometry.ts` (`buildMeasuringRenderState`). Confirm those exist before
starting.

**Audience**: senior (geometry correctness, data pipeline design, multi-category
dispatch). This is a design-and-build brief; read it fully before writing code.

## Revision decisions (baked into this version)

This brief was revised after review. The decisions below override any older draft:

1. **`nearestPoint` is derived on render, never stored.** It is cheap to
   recompute from `(center, category)`, so it is not a question field, not in the
   wire format, and not persisted. The render-state builder computes it (with an
   LRU cache); the detail screen computes it via `useMemo` for display. This
   removes the auto-compute hook, the wire/codec changes, and an entire class of
   staleness bugs.
2. **`computeLineDistance` takes `(center, category)` only** — no `playAreaBbox`.
   The query window is the seeker pin ± a fixed margin.
3. **The auto-picked target is drawn on the map**: a connector line from `center`
   to the nearest point plus a marker, so the user can see what was selected
   before answering. The render state gains two collections for this.
4. **Bundle CI strategy** is a wiring change, not a new subtask: a PBF-free
   structural validator runs in `pretest`/`pnpm check`; the regeneration `--check`
   (needs the PBF) is a documented local guard the implementer runs by hand.
5. **Final bundle sizes are measured and recorded** in `data/geofabrik/SIZES.md`
   (Phase 4).
6. **Source PBF is whole-Japan, clipped to a Kantō+margin window** (not the Kantō
   sub-region PBF), so prefecture/ward borders and coastline are not truncated
   near the play area.

## Overview

These five Measuring categories compute distance to a **line or polygon edge**
rather than a named POI centroid. They need new bundled geometry data, the
`@turf/nearest-point-on-line` dependency, and a geometry branch that differs from
Task 05's point-POI path at every stage (search, candidate display, circle
center).

The five categories:

| Category key       | Measures distance to…              | Geometry source                           | Data pipeline                |
| ------------------ | ---------------------------------- | ----------------------------------------- | ---------------------------- |
| `high-speed-rail`  | Nearest high-speed rail track      | OSM `railway=rail` ways (LineString)      | japan-latest → clip → osmium |
| `coastline`        | Nearest coastline                  | OSM `natural=coastline` ways (LineString) | japan-latest → clip → osmium |
| `body-of-water`    | Nearest water-body edge            | OSM water polygons → outer-ring lines     | japan-latest → clip → osmium |
| `admin-1st-border` | Nearest prefecture boundary        | OSM `admin_level=4` relations             | japan-latest → clip → osmium |
| `admin-2nd-border` | Nearest ward/municipality boundary | OSM `admin_level=7` relations             | japan-latest → clip → osmium |

## Shared geometry pattern (different from point POIs)

For all five line/polygon categories, the "target" is the **nearest point on a
line or polygon edge**, not a named POI. The flow:

1. User selects a line category (e.g., "Coastline").
2. The render pipeline loads the bundled geometry for that category.
3. The app **derives** the nearest point on the line/edge from the seeker's
   `center` — there is no candidate list to choose from. This is recomputed each
   render from `(center, category)` (LRU-cached); nothing is stored on the
   question.
4. `seekerDistanceMeters` = haversine distance from `center` to that nearest
   point (also derived, not stored).
5. The app draws a connector line from `center` to the nearest point plus a
   marker (so the auto-pick is visible before answering).
6. When answered, the Measuring circle is **centered on the nearest point**
   (matching the point-category behavior of "circle centers on the target").

### Key behavioral difference from point categories

| Aspect                              | Point categories (Task 05)                           | Line categories (Task 06)                                        |
| ----------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Search                              | `useMeasuringSearch` → OSM/Overpass → candidate list | Load bundle → bbox-filter → `nearestPointOnLine` → single result |
| Candidate UI                        | Sectioned list of named POIs, user picks one         | No list; distance + nearest-point marker, all auto-derived       |
| Answer enabled                      | Only after user selects a POI                        | Immediately (result is auto-derived)                             |
| `selectedOsmId` / `selectedOsmType` | Set to the chosen POI                                | `null` (untouched)                                               |
| `seekerDistanceMeters` (stored)     | Stored when a POI is picked                          | `null` — derived per render, never stored                        |
| Nearest point                       | n/a                                                  | Derived per render from `(center, category)`                     |
| Circle center                       | Selected POI's `[lon, lat]`                          | Derived nearest point                                            |

---

## 1. Type design

### `MeasuringCategory` — already includes the 5 keys

`measuringTypes.ts` (Task 05) already lists all 18 keys, with the 5 line/polygon
keys stubbed (`implemented: false` in the config). This task flips them to
`implemented: true` and adds the geometry behavior. **No union change is needed.**

### `MeasuringQuestion` — do NOT add a `nearestPoint` field

Because the nearest point is derived on render (decision 1), **no new field is
added to `MeasuringQuestion`.** Line-category questions reuse the existing shape
exactly: they keep `selectedOsmId: null`, `selectedOsmType: null`,
`candidates: []`, and `seekerDistanceMeters: null`. Only `center`, `category`,
`answer`, and `seekerDistanceUnit` (a `DistanceUnit` display preference) carry
meaning for them.

> Note: `seekerDistanceUnit` is the `DistanceUnit` type from
> `@/shared/distanceUnits`, not an inline `"m" | "km" | "mi"` union.

### `MeasuringRenderState` — gains two collections

The earlier draft said "no render-state change needed." That is now **false**
because of decision 3 (draw the connector + marker). Extend the render state in
`measuringTypes.ts`:

```typescript
import type {
    FeatureCollection,
    LineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";

export type MeasuringRenderState = {
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>; // closer
    missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>; // farther
    // ── Task 06: line/polygon target visualization ───────────────────────
    /** Hairline from each line-category question's `center` to its nearest point. */
    nearestPointConnectors: FeatureCollection<LineString>;
    /** A marker at each line-category question's nearest point. */
    nearestPointMarkers: FeatureCollection<Point>;
};

export const EMPTY_MEASURING_RENDER_STATE: MeasuringRenderState = {
    hitMaskFeatures: { features: [], type: "FeatureCollection" },
    missMaskFeatures: { features: [], type: "FeatureCollection" },
    nearestPointConnectors: { features: [], type: "FeatureCollection" },
    nearestPointMarkers: { features: [], type: "FeatureCollection" },
};
```

`NativeMap` gains a `MeasuringLayers.tsx` that renders these two collections
(see §6). `questionGeometry.ts` already aggregates `measuring` into
`QuestionMapRenderState`; Task 05 swaps `EMPTY_MEASURING_RENDER_STATE` for
`buildMeasuringRenderState(questions)` there.

### `isLineMeasuringCategory` guard

Export a type guard from `measuringCategories.ts` so geometry and UI can branch
cleanly:

```typescript
export const LINE_MEASURING_CATEGORIES: MeasuringCategory[] = [
    "high-speed-rail",
    "coastline",
    "body-of-water",
    "admin-1st-border",
    "admin-2nd-border",
];

export function isLineMeasuringCategory(category: MeasuringCategory): boolean {
    return (LINE_MEASURING_CATEGORIES as string[]).includes(category);
}
```

---

## 2. Category config & UI sections

Task 05 created `MeasuringCategorySection` with a `"Border"` section. This task
**renames `"Border"` → `"Borders & Lines"`** and **moves three categories into
it**: `high-speed-rail` (Task 05 tentatively filed under `"Transit"`),
`coastline`, and `body-of-water` (tentatively under `"Natural"`). Update the
enum and the affected `measuringCategories` entries together — this is a
migration, not an addition:

```typescript
export type MeasuringCategorySection =
    | "Transit"
    | "Borders & Lines"
    | "Natural"
    | "Places of Interest"
    | "Public Utilities";
```

The five line categories become `implemented: true`:

| Category           | Section         | Title                        | `osmQueryTags` (reference only)                                                                               |
| ------------------ | --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `high-speed-rail`  | Borders & Lines | "High-Speed Rail"            | `(way["railway"="rail"]["highspeed"="yes"]; way["railway"="rail"]["maxspeed"~"^2[0-9]{2}"];)`                 |
| `coastline`        | Borders & Lines | "Coastline"                  | `(way["natural"="coastline"];)`                                                                               |
| `body-of-water`    | Borders & Lines | "Body of Water"              | `(way["natural"="water"]; relation["natural"="water"]; way["landuse"="basin"]; way["waterway"="riverbank"];)` |
| `admin-1st-border` | Borders & Lines | "Prefecture Border"          | `(relation["boundary"="administrative"]["admin_level"="4"];)`                                                 |
| `admin-2nd-border` | Borders & Lines | "Ward / Municipality Border" | `(relation["boundary"="administrative"]["admin_level"="7"];)`                                                 |

The `osmQueryTags` are **Overpass-syntax documentation strings** — the bundle
loader uses the committed artifacts, not live Overpass. They are _not_ the
extraction filters: Overpass can AND two tags in one clause, but `osmium
tags-filter` cannot, so the build pipeline uses coarse osmium filters plus a
script post-filter (see §3.2). Keep these strings as the reference for a possible
future Overpass fallback.

---

## 3. Bundled geometry data pipeline

### 3.0 Source PBF: whole-Japan, clipped to Kantō+margin (decision 6)

To avoid truncating borders/coastline at a sub-region edge, the source is the
whole-Japan PBF clipped once to a generous window around the play area. Add a
`measuring` block to `data/geofabrik/config.yaml`:

```yaml
# Measuring line/polygon bundles (task-06).
# Whole-Japan source clipped to a Kantō+margin window so prefecture/ward borders
# and coastline are complete anywhere a seeker near the play area could query.
measuring:
    sourcePbfUrl: "https://download.geofabrik.de/asia/japan-latest.osm.pbf"
    # Kantō extent expanded by ~1° (~110 km) per side. [W, S, E, N].
    extractBbox: [137.9, 33.9, 141.9, 37.9]
    outputDir: ../../assets/measuring
```

The extract step (run once per regeneration, before the per-category filters):

```bash
osmium extract -b 137.9,33.9,141.9,37.9 <cache>/japan-latest.osm.pbf \
  -o <cache>/measuring-kanto-wide.osm.pbf --overwrite
```

Because the 110 km extract margin exceeds the 50 km runtime query margin (§4.3),
any seeker within ~50 km of the play area sees complete geometry. (When
multi-region play areas arrive, widen `extractBbox` or add more windows.)

### 3.1 Bundle artifact format

Each category produces one file at `assets/measuring/<category>.json`:

```json
{
    "schemaVersion": 1,
    "category": "high-speed-rail",
    "generatedAt": "2026-06-05T12:00:00.000Z",
    "source": "japan-latest",
    "extractBbox": [137.9, 33.9, 141.9, 37.9],
    "attribution": {
        "text": "© OpenStreetMap contributors. Data available under the Open Database License (ODbL). Geofabrik extract from download.geofabrik.de.",
        "license": "ODbL-1.0",
        "url": "https://www.openstreetmap.org/copyright"
    },
    "features": [
        {
            "type": "Feature",
            "bbox": [139.7, 35.6, 139.8, 35.7],
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [139.71, 35.62],
                    [139.72, 35.63]
                ]
            },
            "properties": {}
        }
    ]
}
```

Key design choices:

- **One file per category**, parsed lazily at runtime (see §5).
- **Each feature carries its own `bbox`**, pre-computed at build time, so the
  runtime pre-filter is an O(1) numeric comparison per feature instead of an
  O(coordinates) scan.
- **Polygon features are converted to outer-ring `LineString`s** at build time.
  The runtime only ever handles `LineString`/`MultiLineString`.
- **Geometry is simplified** at build time with `@turf/simplify` (a dependency,
  `^7.3.5`) at per-category tolerances (§3.5).
- **Attribution block** mirrors `assets/poi/*.json`.

### 3.2 Extraction script: `data/geofabrik/scripts/extract-measuring-bundles.mjs`

A new pure-ESM Node script that lives alongside the existing pipeline scripts
(`fetch-geofabrik.mjs`, `poiReducer.mjs`) — **not** under `data/scripts/`.

1. Read `data/geofabrik/config.yaml` `measuring` block.
2. Ensure `japan-latest.osm.pbf` is cached (download unless `--cache-only`).
3. `osmium extract -b <extractBbox>` → `measuring-kanto-wide.osm.pbf`.
4. For each category:
    - `osmium tags-filter` with the **coarse** filter (table below) on the wide
      extract → a per-category PBF.
    - `osmium export -f geojsonseq` → stream the features.
    - For each feature: apply the script **post-filter** (admin level / maxspeed),
      convert polygons to outer-ring LineStrings (§3.3), simplify (§3.5), compute
      the per-feature bbox (§3.4).
    - Write the merged `FeatureCollection` to `assets/measuring/<category>.json`.
5. Flags: `--cache-only` (error if the PBF is missing) and `--check` (regenerate
   to a temp dir and diff against committed; **requires the PBF**, so this is a
   local guard, not part of `pnpm check` — see §9.6).

`osmium` and Node built-ins (`fs`, `path`, `stream`, `readline`, `zlib`) are the
only dependencies, same as the POI pipeline.

Add the npm script:

```json
"data:measuring": "node data/geofabrik/scripts/extract-measuring-bundles.mjs",
```

**Coarse osmium filters + script post-filters** (osmium cannot AND two tags, so
the AND lives in the script — same pattern for both high-speed-rail and the admin
levels):

| Category           | `osmium tags-filter` (coarse)                                          | Script post-filter                                   | Geometry          |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| `high-speed-rail`  | `w/railway=rail`                                                       | `highspeed === "yes" \|\| parseInt(maxspeed) >= 200` | LineString (pass) |
| `coastline`        | `w/natural=coastline`                                                  | none                                                 | LineString (pass) |
| `body-of-water`    | `w/natural=water r/natural=water w/landuse=basin w/waterway=riverbank` | none                                                 | Polygon → ring    |
| `admin-1st-border` | `r/boundary=administrative`                                            | `admin_level === "4"`                                | Polygon → ring    |
| `admin-2nd-border` | `r/boundary=administrative`                                            | `admin_level === "7"`                                | Polygon → ring    |

Optimization: `admin-1st-border` and `admin-2nd-border` share the coarse filter
`r/boundary=administrative` — run osmium once and split by `admin_level` into the
two bundles to save a pass.

**Coastline note:** OSM `natural=coastline` is mapped as **open, directional
LineStrings** (land on the left of travel direction), so `osmium export` emits
LineStrings — there is no ring-closure and no polygon conversion. That is exactly
why coastline is the best Phase-1 category: full pipeline, zero post-filter, no
polygon handling.

### 3.3 Polygon-to-boundary conversion (build-time)

For polygon/multipolygon features (water, admin boundaries), extract the **outer
ring only** as a `LineString`. The previous draft's snippet iterated every ring
(outer + holes), contradicting its own "skip holes" intent — this version skips
holes:

```javascript
function featureToLineStrings(feature) {
    const { type, coordinates } = feature.geometry;
    if (type === "LineString" || type === "MultiLineString") return [feature];

    const lines = [];
    const pushRing = (ring) => {
        if (ring.length < 4) return; // skip degenerate rings
        lines.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: ring },
            properties: {},
        });
    };

    // Outer ring is coordinates[0]; holes (coordinates[1..]) are skipped.
    if (type === "Polygon") {
        pushRing(coordinates[0]);
    } else if (type === "MultiPolygon") {
        for (const poly of coordinates) pushRing(poly[0]);
    }
    return lines;
}
```

Holes represent lakes/exclaves; for "distance to the boundary" the outer ring is
sufficient, and including a hole would give a misleadingly small distance for a
seeker standing inside it.

### 3.4 Bbox computation (build-time)

```javascript
function computeBbox(coords) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walk = (c) => {
        if (typeof c[0] === "number") {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
        } else c.forEach(walk);
    };
    walk(coords);
    return [minX, minY, maxX, maxY]; // [W, S, E, N] — matches @/shared/geojson Bbox
}
```

Compute **after** simplification so the bbox reflects the shipped geometry.

### 3.5 Simplification (build-time)

`@turf/simplify` at per-category tolerance:

| Category           | Tolerance       | Rationale                                                        |
| ------------------ | --------------- | ---------------------------------------------------------------- |
| `high-speed-rail`  | 0.0001° (~10 m) | Track geometry is already sparse; keep precision                 |
| `coastline`        | 0.0005° (~50 m) | Coastline detail beyond 50 m is noise for a distance measurement |
| `body-of-water`    | 0.0005° (~50 m) | Water edges don't need sub-meter precision                       |
| `admin-1st-border` | 0.0003° (~30 m) | Prefecture boundaries often follow detailed coastlines           |
| `admin-2nd-border` | 0.0003° (~30 m) | Ward boundaries are similar to admin-1st                         |

Simplify **after** polygon-to-boundary conversion and **before** bbox
computation.

---

## 4. Runtime geometry: `lineMeasuringGeometry.ts` (new)

Computes the nearest point on bundled geometry. Called by `measuringGeometry.ts`
(§6) for the map and by the detail screen (§7) for display.

### 4.1 Dependency addition

```bash
pnpm add @turf/nearest-point-on-line
```

It is already present transitively at **7.2.0** (pulled in by other `@turf`
packages). Pin it to `^7.2.0` to match `@turf/circle` / `@turf/helpers` and to
dedupe against the installed copy (avoid a second turf version in the bundle).
It exports both default and named (`export { nearestPointOnLine as default,
nearestPointOnLine }`), so the default import matches how `radarGeometry.ts`
imports `@turf/circle`. No native rebuild. `@turf/distance` (which
`nearest-point-on-line` uses internally) is present transitively — **do not
import it directly**; use `haversineDistanceMeters` (see §4.3).

### 4.2 Module API

```typescript
// src/features/questions/measuring/lineMeasuringGeometry.ts

import nearestPointOnLine from "@turf/nearest-point-on-line";
import { multiLineString, point } from "@turf/helpers";

import {
    bboxIntersects,
    haversineDistanceMeters,
    type Bbox,
    type Position,
} from "@/shared/geojson";
import type { MeasuringCategory } from "./measuringCategories";
import { getLineBundle } from "./lineBundleLoader";

export type NearestPointResult = {
    /** Nearest point on the line/edge (GeoJSON [lon, lat]). */
    nearestPoint: Position;
    /** Haversine distance in meters from `center` to `nearestPoint`. */
    distanceMeters: number;
};

/**
 * Nearest point on bundled line/polygon geometry for a center + category.
 * Bbox-pre-filters features around the center, then runs
 * @turf/nearest-point-on-line on the merged MultiLineString. LRU-cached on
 * (category, center). Returns null for empty bundles or no surviving features.
 */
export function computeLineDistance(
    center: Position,
    category: MeasuringCategory,
): NearestPointResult | null;
```

### 4.3 Algorithm

```text
const MARGIN_METERS = 50_000; // 50 km query window; covers any plausible seeker distance

function computeLineDistance(center, category):
    key = cacheKey(category, center)
    if cache.has(key) → promote + return cache.get(key)

    fc = getLineBundle(category)
    if !fc or fc.features.length === 0 → cache.set(key, null); return null

    marginDeg = MARGIN_METERS / 111_320            // ~deg at mid-latitudes
    queryBbox = [center[0]-marginDeg, center[1]-marginDeg,
                 center[0]+marginDeg, center[1]+marginDeg]

    lines = []                                     // array of LineString coord arrays
    for f of fc.features:
        if !bboxIntersects(featureBbox(f), queryBbox) → continue
        if f.geometry.type === "LineString"
            lines.push(f.geometry.coordinates)
        else                                       // MultiLineString
            for seg of f.geometry.coordinates: lines.push(seg)

    if lines.length === 0 → cache.set(key, null); return null

    snapped = nearestPointOnLine(multiLineString(lines), point(center))
    nearestPoint = snapped.geometry.coordinates as Position
    distanceMeters = haversineDistanceMeters(
        center[1], center[0], nearestPoint[1], nearestPoint[0])

    result = { nearestPoint, distanceMeters }
    cache.set(key, result) + evict-if-over-max
    return result
```

**Why merge before `nearestPointOnLine`?** It iterates every segment of its
input, so one call on a merged `MultiLineString` is O(total segments) — the same
as N calls plus a min, with less overhead and an identical result.

**Why recompute distance instead of using `snapped.properties.dist`?**
`@turf/nearest-point-on-line` already returns a great-circle distance (it calls
`@turf/distance`), but **in kilometers and dependent on turf's default unit**.
Recomputing with `haversineDistanceMeters` keeps meters as the single source of
truth and matches every other distance in the app. (The earlier draft claimed
`dist` was "planar degrees" — that is incorrect; the reason to recompute is
unit/consistency, not correctness of turf's value.)

**Bbox margin:** a slightly-too-large window just lets a few extra features
through the filter; a too-small one could miss the true nearest point, so the
fixed 50 km window errs large. `marginDeg` uses 1° ≈ 111,320 m, which is fine for
a pre-filter.

### 4.4 LRU cache

Keyed on `(version, category, center)` only — **not** question id (the result
depends solely on center + category, so two questions with the same center share
a hit). Same `Map`-insertion-order LRU as `radarGeometry.ts`:

```typescript
const LINE_DISTANCE_CACHE_VERSION = 1; // bump to invalidate when the algorithm changes
const LINE_DISTANCE_CACHE_MAX = 100;

const distanceCache = new Map<string, NearestPointResult | null>();

function cacheKey(category: MeasuringCategory, center: Position): string {
    return [
        LINE_DISTANCE_CACHE_VERSION,
        category,
        center[0].toFixed(7),
        center[1].toFixed(7),
    ].join(":");
}

/** Clears the cache. Call in tests. Exported from THIS module (no re-export). */
export function clearLineDistanceCache(): void {
    distanceCache.clear();
}
```

The cache now earns its keep: `buildMeasuringRenderState` runs on every
questions change, so a stable `(center, category)` is recomputed-free.

### 4.5 Feature bbox helper

```typescript
import type { Feature } from "geojson";

function featureBbox(f: Feature): Bbox {
    if (f.bbox) return f.bbox as Bbox;
    return computeBboxFromCoords(f.geometry); // fallback; build pipeline always sets bbox
}
```

### 4.6 Edge cases & known limitations

- **Seeker inside a water body / admin area**: `nearestPointOnLine` finds the
  nearest segment regardless of side, so a seeker inside a lake correctly snaps
  to the nearest shoreline. ✅
- **Seeker exactly on the line**: distance ≈ 0. `buildMeasuringRenderState`
  guards `distanceMeters > 0`, skipping the degenerate radius-0 circle (the
  connector/marker are likewise skipped at 0).
- **Boundary truncation**: largely resolved by decision 6 — the whole-Japan
  source is clipped to Kantō + 110 km, so features are complete within the 50 km
  query window of any seeker near the play area. Truncation only reappears for a
  seeker > ~60 km outside the play area, which is out of scope.
- **`Position` typing**: `snapped.geometry.coordinates` is the geojson
  `Position` (`number[]`); cast to `@/shared/geojson` `Position`
  (`[number, number]`) when assigning.
- **Performance**: bundles parse lazily on first use of a category (§5). Per
  query: O(features) bbox filter + `nearestPointOnLine` over the survivors'
  segments — a few ms for typical Kantō queries; the LRU makes re-renders free.

---

## 5. Bundle loader: `lineBundleLoader.ts` (new)

Follow the **proven lazy `require()`-in-a-switch pattern** from
`bundledPois.ts` (which deliberately avoids eager top-level JSON imports so
Metro bundles but only parses on first use). Metro statically resolves the
literal `require()` paths; the parse is synchronous, so there is no loading
state — lazy and synchronous are not mutually exclusive.

```typescript
// src/features/questions/measuring/lineBundleLoader.ts

import type { Feature, LineString, MultiLineString } from "geojson";
import type { Bbox } from "@/shared/geojson";
import type { MeasuringCategory } from "./measuringCategories";

type LineFeature = Feature<LineString | MultiLineString>;

export type LineBundle = {
    schemaVersion: number;
    category: string;
    generatedAt: string;
    source: string;
    extractBbox: Bbox;
    features: LineFeature[];
};

const cache = new Map<string, LineBundle | null>();

/** Test seam: inject a synthetic bundle (or null) for a category. */
export function __setLineBundleForTest(
    category: MeasuringCategory,
    bundle: LineBundle | null,
): void {
    cache.set(category, bundle);
}

/** Test seam: drop all injected/loaded bundles. */
export function __clearLineBundlesForTest(): void {
    cache.clear();
}

/**
 * Returns the bundle for a line/polygon category, lazily `require()`-ing and
 * caching it on first use. Returns null for point categories.
 */
export function getLineBundle(category: MeasuringCategory): LineBundle | null {
    if (cache.has(category)) return cache.get(category) ?? null;

    let bundle: LineBundle | null = null;
    switch (category) {
        case "coastline":
            bundle = require("../../../../assets/measuring/coastline.json");
            break;
        case "high-speed-rail":
            bundle = require("../../../../assets/measuring/high-speed-rail.json");
            break;
        case "body-of-water":
            bundle = require("../../../../assets/measuring/body-of-water.json");
            break;
        case "admin-1st-border":
            bundle = require("../../../../assets/measuring/admin-1st-border.json");
            break;
        case "admin-2nd-border":
            bundle = require("../../../../assets/measuring/admin-2nd-border.json");
            break;
        default:
            bundle = null; // point category
    }
    cache.set(category, bundle);
    return bundle;
}
```

> This loader does **not** re-export `clearLineDistanceCache` (the earlier draft
> did, creating a loader↔geometry import cycle). The distance cache lives in and
> is exported from `lineMeasuringGeometry.ts`.

**Jest:** there is **no existing POI JSON mock to mirror** (`jest.setup.ts`
mocks native modules, not `assets/poi/*.json`; POI tests use the committed
files). Use the test seam above (`__setLineBundleForTest`) to supply synthetic
`LineString` fixtures, rather than `jest.mock` on brittle `../../../../` paths.

---

## 6. Integration with `measuringGeometry.ts` (modify)

Task 05's `buildMeasuringRenderState` pre-filters the question array on
`selectedOsmId !== null && seekerDistanceMeters > 0`. **Line categories have
`selectedOsmId === null` and `seekerDistanceMeters === null`, so that pre-filter
would silently drop every one of them.** Restructure: filter only on
`type === "measuring"`, then branch inside the loop.

```typescript
import circle from "@turf/circle";
import { lineString, point } from "@turf/helpers";
import { computeLineDistance } from "./lineMeasuringGeometry";
import { isLineMeasuringCategory } from "./measuringCategories";

export function buildMeasuringRenderState(
    questions: QuestionState[],
): MeasuringRenderState {
    const measuring = questions.filter(
        (q): q is Extract<QuestionState, { type: "measuring" }> =>
            q.type === "measuring",
    );

    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const missFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const connectors: Feature<LineString>[] = [];
    const markers: Feature<Point>[] = [];

    for (const q of measuring) {
        let circleCenter: Position | null = null;
        let radiusMeters: number | null = null;

        if (isLineMeasuringCategory(q.category)) {
            // Derive on render — nothing is read from the question except center.
            const result = computeLineDistance(q.center, q.category);
            if (!result || result.distanceMeters <= 0) continue;
            circleCenter = result.nearestPoint;
            radiusMeters = result.distanceMeters;

            // Always show the auto-picked target (decision 3), answered or not.
            connectors.push(lineString([q.center, result.nearestPoint]));
            markers.push(point(result.nearestPoint));
        } else {
            // Point category (Task 05 path): selected POI + stored distance.
            if (
                q.selectedOsmId === null ||
                !q.seekerDistanceMeters ||
                q.seekerDistanceMeters <= 0
            )
                continue;
            const target = q.candidates.find(
                (c) =>
                    c.osmId === q.selectedOsmId &&
                    c.osmType === q.selectedOsmType,
            );
            if (!target) continue;
            circleCenter = [target.lon, target.lat];
            radiusMeters = q.seekerDistanceMeters;
        }

        if (q.answer === "positive" || q.answer === "negative") {
            const circ = circle(circleCenter, radiusMeters / 1000, {
                units: "kilometers",
            });
            (q.answer === "positive" ? hitFeatures : missFeatures).push(circ);
        }
    }

    return {
        hitMaskFeatures: { features: hitFeatures, type: "FeatureCollection" },
        missMaskFeatures: { features: missFeatures, type: "FeatureCollection" },
        nearestPointConnectors: {
            features: connectors,
            type: "FeatureCollection",
        },
        nearestPointMarkers: { features: markers, type: "FeatureCollection" },
    };
}
```

`MeasuringLayers.tsx` (new, mirroring `RadarQuestionLayers.tsx` /
`OsmMatchingLayers.tsx`): an always-mounted `MLShapeSource` for
`nearestPointConnectors` with an `MLLineLayer` (use a measuring color token in
`src/theme/colors.ts`; add one if absent), plus an `MLShapeSource` +
`MLCircleLayer` for `nearestPointMarkers`. Keep these line/marker layers ordered
**before** the movable-pin overlays, and keep `ShapeSource`s mounted even when
empty (the `VoronoiOutlineLayers.tsx` convention). Add the new collections to
`NativeMap`'s `questionMapRenderState.measuring.*` dependency list.

> Optional point-category circle cache: keep Task 05's `(osmId, osmType,
distance)` LRU. The line path's circle is recomputed from the (already cached)
> `computeLineDistance` result, so it needs no separate cache.

---

## 7. Detail screen: line-category UX

### 7.1 Dispatch in `MeasuringQuestionDetailScreen.tsx` (modify)

When `isLineMeasuringCategory(question.category)`, render `LineMeasuringResult`
and **skip the search hook** entirely (no candidate list, no Overpass).

```typescript
if (isLineMeasuringCategory(question.category)) {
    return <LineMeasuringResult question={question} onRecenter={...} />;
}
// else: existing Task 05 point-category UI
```

### 7.2 `LineMeasuringResult` component (new)

```text
┌──────────────────────────────────────┐
│  Category: Coastline                  │
│                                       │
│  My Position   [Set to My Location]   │
│  35.67620, 139.65030    (drag pin)    │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │  Nearest coastline              │  │
│  │  2.3 km                         │  │  ← distance leads; marker shown on map
│  └─────────────────────────────────┘  │
│                                       │
│  "I'm 2.3 km from the nearest         │
│   coastline. Are you closer or        │
│   farther from yours?"                │
│  [m]  [km]  [mi]                      │
│                                       │
│  Answer  [ Closer ] [ Farther ] [Reset]│
└──────────────────────────────────────┘
```

Key UX details:

- **Lead with the distance**, not coordinates. The previous draft surfaced the
  nearest point's raw lat/long as the primary readout — that string is
  meaningless to a player. Show "Nearest coastline · 2.3 km"; the _location_ is
  communicated by the on-map marker + connector line (from the render state).
  Raw coordinates, if shown at all, are secondary.
- **Phrasing line** adapts per category from the `measuringCategories` title:
  "nearest coastline", "nearest body of water", "nearest high-speed rail track",
  "nearest prefecture border", "nearest ward/municipality border".
- **Distance unit toggle** (`m`/`km`/`mi`) updates `seekerDistanceUnit` and the
  displayed value only.
- **Answer selector** is enabled immediately (no POI selection needed).
- **Display value is derived, not stored**: compute it inline.
- **Accessibility/E2E**: give the result block and answer buttons stable
  `testID`s / a11y labels (per `AGENTS.md`'s native-a11y guidance); a Jest
  `getByTestId` pass does not guarantee Maestro can target the same node.

### 7.3 Deriving the display distance (no hook, no stored state)

The earlier draft used a `useEffect` that wrote `nearestPoint`/`seekerDistanceMeters`
back into the question (and contradicted itself on debouncing). With decision 1
that hook is **deleted**. The detail screen derives the distance for display with
a memo:

```typescript
const result = useMemo(
    () => computeLineDistance(question.center, question.category),
    [question.center, question.category],
);
// result?.distanceMeters → formatted via seekerDistanceUnit for display.
```

`computeLineDistance` is LRU-cached, so dragging the pin recomputes cheaply and
the map (driven by `buildMeasuringRenderState`) stays in sync automatically. If
profiling ever shows pin-drag jank on the densest categories, throttle the
`center` commits (~200 ms) at the drag source — but do not reintroduce a
write-back hook.

---

## 8. Wire format & persistence

**Task 06 adds no new wire or persisted fields.** Because the nearest point and
distance are derived on render (decision 1), a line-category Measuring question
serializes exactly like a point-category one: `center`, `category`, `answer`,
`seekerDistanceUnit`, with `selectedOsmId: null`, `selectedOsmType: null`,
`candidates: []`, `seekerDistanceMeters: null`. On import/restore, the circle,
connector, and marker are recomputed from `(center, category)`.

The only requirement on Task 03 is that the existing Measuring wire/minified
schema round-trips a question whose `category` is one of the five line keys with
a null selection — no `nearestPoint` field exists to encode. (Remove the
`nearestPoint`/`np` field map, `compactCoord` handling, and the
`normalizeQuestionState` default from any earlier draft of Task 03.)

---

## 9. Test plan (write first)

### 9.1 `__tests__/lineMeasuringGeometry.test.ts` (new)

Use `__setLineBundleForTest` to inject fixtures; `clearLineDistanceCache` +
`__clearLineBundlesForTest` between cases.

- **Single-segment projection**: point offset from a horizontal line →
  `nearestPoint` is the perpendicular foot; `distanceMeters` matches a
  hand-computed haversine within 1 m.
- **Two disjoint segments**: point closer to segment B → result lands on B.
- **bbox pre-filter**: near + 200 km-away features → the far one is excluded
  (assert via the near result, or spy on `nearestPointOnLine`'s input size).
- **Empty bundle → null**; **all features filtered out → null**.
- **Caching**: two calls with the same `(category, center)` return the
  referentially-equal cached object; clearing the cache breaks identity.
- **Polygon → boundary**: a water-body `Polygon` fixture → nearest point on the
  outer ring, not inside; a hole is ignored.
- **Coastline multi-segment**: nearest point lands on the closest segment.

### 9.2 `__tests__/measuringCategories.test.ts` (extend)

- `LINE_MEASURING_CATEGORIES` has exactly 5 entries.
- `isLineMeasuringCategory` is `true` for the 5, `false` for the 13.
- All 18 `measuringCategories` entries are `implemented: true`.
- The 5 line categories are in section `"Borders & Lines"`; no entry still uses
  `"Border"`.

### 9.3 `__tests__/measuringGeometry.test.ts` (extend)

- **Regression guard for the filter fix**: a line-category question (with an
  injected bundle, `selectedOsmId: null`) is **not** dropped — it produces a
  circle. (This is the bug the §6 restructure fixes.)
- Line-category answered → circle centered on the derived nearest point, **not**
  on `center`.
- Line-category (any answer) → one connector `LineString` from `center` to the
  nearest point and one marker `Point` at the nearest point.
- Line-category whose bundle yields no survivor / distance 0 → skipped (no
  circle, no connector, no marker).
- Mixed: one point-category (positive) + one line-category (negative) → each in
  the correct mask collection.

### 9.4 `__tests__/MeasuringQuestionDetailScreen.test.tsx` (extend)

- Selecting a line category shows the single result block (no candidate list, no
  search).
- The phrasing line reads "nearest coastline" (or the category's title).
- The answer selector is enabled immediately.
- Moving the pin changes the **displayed** distance (recomputed via
  `computeLineDistance`); assert no write-back to `seekerDistanceMeters`/no
  `nearestPoint` field is set on the question.

### 9.5 `src/sharing/wire/__tests__/codec.test.ts` (Task 03 scope)

- A `category: "coastline"` question with null selection round-trips unchanged.
- Assert there is **no** `nearestPoint`/`np` key in the encoded payload.

### 9.6 `data/geofabrik/scripts/extract-measuring-bundles.test.mjs` (new, `node --test`)

Structural validator — **no PBF required**, so it is CI-safe. Wire it into the
`pretest` hook next to `poiReducer.test.mjs`, and it then rides along in
`pnpm check`:

- Each committed bundle exists and parses as JSON; `schemaVersion === 1`.
- Every feature is `LineString` or `MultiLineString` (never Polygon/Point) with a
  non-empty `coordinates` array.
- Every feature has a `bbox` of four finite numbers, contained in `extractBbox`.

The regeneration `--check` (re-run osmium, diff against committed) **needs the
PBF**, so it stays a **local** guard the implementer runs by hand before
committing — it is _not_ added to `pnpm check`.

---

## 10. Implementation order

### Phase 0: data infra

1. Add the `measuring` block to `config.yaml`; download `japan-latest.osm.pbf`;
   `osmium extract` the Kantō+margin window.

### Phase 1: coastline first (de-risk the line-distance path)

Coastline needs no post-filter and no polygon conversion — the cleanest first
category.

1. Write `extract-measuring-bundles.mjs` (coastline only); run it; **commit**
   `assets/measuring/coastline.json`.
2. `pnpm add @turf/nearest-point-on-line` (pin `^7.2.0`).
3. `lineBundleLoader.ts` (coastline case + test seams).
4. `lineMeasuringGeometry.ts` + red tests → green.
5. Extend `MeasuringRenderState`; restructure `buildMeasuringRenderState` (§6);
   add `MeasuringLayers.tsx`; wire into `NativeMap`.
6. `LineMeasuringResult` + detail-screen dispatch (§7).
7. Add the structural validator to `pretest`.
8. Measure `coastline.json` size; note it (Phase 4).
9. E2E: create a coastline Measuring question, see the marker + distance, draw
   the circle.

### Phase 2: remaining four categories

1. Extend the script: water (polygon→ring), admin 1st/2nd (shared coarse filter,
   split by `admin_level`), high-speed-rail (maxspeed post-filter).
2. **Commit** the four bundles; add their `getLineBundle` cases.
3. Flip all five `measuringCategories` entries to `implemented: true`; rename
   `"Border"` → `"Borders & Lines"` and move coastline/water/high-speed-rail in.
4. All tests green.

### Phase 3: wire format (coordinate with Task 03)

1. No new fields. Confirm round-trip of a line-category question with null
   selection; ensure no `nearestPoint` codec remnants exist.

### Phase 4: measure & document sizes (decision 5)

1. Record raw + gzip size of each `assets/measuring/*.json` and the combined
   total in `data/geofabrik/SIZES.md` (add a "Measuring line/polygon bundles"
   section alongside the POI analysis).
2. Confirm lazy loading keeps parse cost off app start (only the selected
   category parses, on first use).

---

## 11. Enabling a category (checklist)

1. [ ] Run `pnpm data:measuring`; **commit** `assets/measuring/<category>.json`
       (CI cannot regenerate Geofabrik extracts).
2. [ ] Add the `require()` case in `lineBundleLoader.ts`.
3. [ ] Set the `measuringCategories` entry to `implemented: true`, section
       `"Borders & Lines"`.
4. [ ] (Geometry/UI need no per-category code — `isLineMeasuringCategory` and the
       loader switch cover it.)
5. [ ] Record the bundle size in `data/geofabrik/SIZES.md`.
6. [ ] `pnpm check` (includes the structural bundle validator) + `pnpm test`;
       run the local `--check` regeneration once before committing.
7. [ ] Manual smoke: create the question, confirm the marker + connector +
       distance, answer Closer/Farther, verify the circle.

---

## 12. Acceptance Criteria

- `pnpm typecheck`, `pnpm test`, `pnpm check` pass (the bundle validator runs in
  `pnpm check`; the PBF-based `--check` passes locally).
- All 5 line-category bundles committed to `assets/measuring/`, generated from the
  whole-Japan source clipped to the Kantō+margin window.
- `@turf/nearest-point-on-line` installed and pinned to 7.x (`^7.2.0`).
- `isLineMeasuringCategory` discriminates the 5 line categories from the 13 point
  categories; all 18 are `implemented: true`.
- For each line category:
    - `computeLineDistance` returns the correct nearest point within 1 m of a
      hand-computed haversine on synthetic fixtures.
    - The Measuring circle centers on the **derived nearest point**, not on
      `center`.
    - The map shows a connector line + marker for the auto-picked target.
    - The detail screen leads with the distance; the answer selector is enabled
      immediately.
    - Moving the pin recomputes the nearest point/distance with **no** write-back
      to question state.
- No `nearestPoint` field is added to the question, wire format, or persistence.
- No regression to point categories (candidate list + POI selection still work).
- `data/geofabrik/SIZES.md` records the measuring bundle sizes.

# Task 06: Measuring — Line/Polygon-Distance Categories

**Depends on**: Task 05
**Audience**: **needs a dedicated design pass before coding.** This is a
design-and-build brief, not a tracking stub. Hand it to whoever owns the
line/polygon distance work; the previous agent ran out of bandwidth here.

These five Measuring categories are wanted for **v1** but were split out because
they need distance-to-a-line / distance-to-a-polygon-edge geometry and new
bundled data — qualitatively different from the point-POI path in Task 05:

1. `high-speed-rail` — distance to nearest high-speed rail **track**
2. `coastline` — distance to nearest **coastline**
3. `body-of-water` — distance to nearest **water-body edge**
4. `admin-1st-border` — distance to nearest **prefecture boundary line**
5. `admin-2nd-border` — distance to nearest **ward/municipality boundary line**

## Shared shape

All five share one pattern that differs from point POIs:

- The "target" is the **nearest point on a line/edge**, not a named POI centroid.
- `seekerDistanceMeters` = distance from `center` to that nearest point.
- The Measuring circle is centered on that nearest point.
- The detail-screen "candidate list" can't show named POIs; show the nearest
  point's coordinates + a short label (e.g. "Nearest coastline point"). The
  selected "POI" is synthetic.

### Algorithm & library hints

- **Nearest point on a line/edge**: use `@turf/nearest-point-on-line` against a
  `LineString` / `MultiLineString`. ⚠️ **It is not currently a dependency** —
  installing it is a deliberate `pnpm add @turf/nearest-point-on-line` step (pure
  JS, no native rebuild needed, but update `metro.config.js` only if a duplicate
  singleton appears). Confirm the version matches the other `@turf/*` 7.x pins.
- **Polygons → edge lines**: water bodies and admin areas are polygons. Convert
  each polygon's rings to `LineString`s before measuring (so "distance to the
  area" means distance to its boundary, not its centroid). `@turf/polygon-to-line`
  does this, or iterate `polygon.coordinates` rings manually into `lineString`s
  (manual avoids another dependency).
- **Performance**: there can be hundreds of candidate lines/polygons. Pre-filter
  by bbox (reuse `bboxIntersects` from `@/shared/geojson`) to the play-area bbox
  plus a margin before running `nearestPointOnLine`, then take the global
  minimum. Cache the per-question result with the same LRU pattern as
  `radarGeometry`.
- **Spatial pre-indexing (optional)**: if bbox pre-filtering is not enough,
  build a kdbush index over densified vertices (reuse the `spatialIndex.ts`
  approach) to find candidate segments near `center` quickly, then refine with
  `nearestPointOnLine` on just those.
- **Distance unit**: results in meters via `haversineDistanceMeters`; do not use
  `@turf/distance`.

## Per-category data sourcing

### 1. `high-speed-rail`

OSM models high-speed rail as `LineString` ways. Extract via a Geofabrik
pipeline step (see `data/geofabrik/`), bundling `MultiLineString` GeoJSON to
`assets/measuring/high-speed-rail.json`.

```
(
  way["railway"="rail"]["highspeed"="yes"];
  way["railway"="rail"]["maxspeed"~"^(200|210|220|240|250|260|270|275|280|285|300|305|310|315|320|330|340|360|380)"];
)
```

### 2. `coastline` — cheapest to land first

A pre-processed global coastline already exists in the reference web app:
`https://github.com/taibeled/JetLagHideAndSeek/blob/master/public/coastline50.geojson`
(~7 MB, 50 m resolution). Recommended: commit a **Japan/Asia-region clip** to
`assets/measuring/coastline.json` to keep bundle size down, then
`nearestPointOnLine` against it. Because the source is already simplified line
geometry, this category needs **no Geofabrik PBF run** — making it the lowest-
effort of the five. Consider doing it first to de-risk the line-distance path.

### 3. `body-of-water`

Extract water polygons from Geofabrik; bundle to `assets/measuring/water.json`
(region-limited). Convert rings to lines and measure to the nearest edge.

```
(
  way["natural"="water"]; relation["natural"="water"];
  way["landuse"="basin"]; way["waterway"="riverbank"];
)
```

For small water bodies, centroid distance is an acceptable approximation **only
if** flagged as approximate in the UI; prefer true edge distance.

### 4 & 5. `admin-1st-border` / `admin-2nd-border`

Extract `boundary=administrative` relations at `admin_level=4` (1st / prefecture)
and `admin_level=7` (2nd / ward) from Geofabrik. Bundle boundary ring
`LineString`s to `assets/measuring/admin-1st-border.json` /
`admin-2nd-border.json`. Measure to the nearest boundary segment with
`nearestPointOnLine`.

## Test plan (write first)

For each enabled category:

- A synthetic line/polygon fixture + a seeker point with a known nearest point;
  assert the computed nearest point and `seekerDistanceMeters` (within an epsilon).
- Circle is centered on the nearest point, not on `center`.
- bbox pre-filter excludes far-away geometry without changing the min result.
- Empty/zero-feature bundle → category yields no overlay (graceful).
- Reducer/extraction tests for any new Geofabrik pipeline step, mirroring
  `data/geofabrik/scripts/poiReducer.test.mjs`.

## Enabling a category (checklist)

1. Add the bundle pipeline step (or commit the coastline clip) and **commit the
   artifact** — CI cannot regenerate Geofabrik extracts.
2. `pnpm add @turf/nearest-point-on-line` (first category only).
3. Flip the `measuringCategories` entry to `implemented: true`.
4. Add the line/polygon distance branch in `measuringGeometry.ts` (route by
   category: point categories use Task 05's path; these use nearest-point).
5. Update `MeasuringQuestionDetailScreen` to show the synthetic nearest-point
   "candidate" for line/polygon categories.
6. Add the wire/persistence handling if the stored shape diverges (coordinate-
   only target) — coordinate with Task 03's schema.
7. `pnpm check` (registry drift) + `pnpm test`.

## Acceptance Criteria (per enabled category)

- `pnpm typecheck`, `pnpm test`, `pnpm check` pass
- Bundled artifact committed; geometry tests assert nearest-point correctness
- The Measuring circle for the category centers on the nearest line/edge point
- Detail screen shows a sensible non-POI "nearest point" entry
- No regression to the 13 point categories

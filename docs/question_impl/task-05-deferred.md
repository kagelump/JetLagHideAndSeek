# Task 05: Deferred Measuring Categories

This is a tracking document, not a code task. Five Measuring categories require polygon/line distance geometry that is not implemented in Tasks 01–02. They are tracked here to avoid losing the design context.

## Deferred Items

### 1. High-Speed Rail (`high-speed-rail`)

**Game interpretation:** Distance to the nearest high-speed rail *track* (not station). Example: Shinkansen lines.

**Why deferred:** OSM models rail lines as `LineString` ways tagged `railway=rail` with various speed/service attributes (e.g., `maxspeed`, `service=high_speed`). Distance to the nearest point on a rail line requires:
1. Bundling the rail line geometries as GeoJSON (new bundle artifact, not covered by the existing POI pipeline).
2. Computing distance using `@turf/nearestPointOnLine` against a `MultiLineString`.

This is qualitatively different from the point-POI path used by all other Measuring categories.

**Recommended approach:**
- Add a Geofabrik pipeline step to extract high-speed rail ways (`railway=rail`, `highspeed=yes` or `maxspeed >= 200`) as GeoJSON LineStrings.
- Bundle as `assets/measuring/high-speed-rail.json` (similar to the POI bundles).
- In `measuringGeometry.ts`, use `nearestPointOnLine` to compute seeker distance to the rail network, then build the circle overlay at that nearest point.

**OSM tags to extract:**
```
(
  way["railway"="rail"]["highspeed"="yes"];
  way["railway"="rail"]["maxspeed"~"^(200|210|220|240|250|260|270|275|280|285|300|305|310|315|320|330|340|360|380)"];
)
```

---

### 2. Coastline (`coastline`)

**Game interpretation:** Distance to the nearest coastline.

**Why deferred:** Coastlines in OSM are `natural=coastline` ways assembled into a global MultiLineString. Point-distance doesn't apply — the correct measurement is distance to the nearest edge of the coastline geometry.

**Source data:**
A pre-processed coastline GeoJSON already exists in the reference web app at:
`https://github.com/taibeled/JetLagHideAndSeek/blob/master/public/coastline50.geojson`

This is a simplified global coastline (50m resolution). This file should be bundled in the app as `assets/measuring/coastline.json` (or compressed / region-clipped to reduce size).

**Recommended approach:**
- Download and commit `coastline50.geojson` (or a Japan-region clip of it) to `assets/measuring/`.
- In `measuringGeometry.ts`, use `@turf/nearestPointOnLine` against the coastline `MultiLineString` to compute seeker distance to the coast, then build the circle at that nearest point.
- The `coast` feature is a line, not a point, so the circle center is the nearest coastline point rather than a fixed POI centroid. This also means the candidate list in the detail screen would show the nearest coastline point's coordinates rather than a named POI.

**File size note:** The full coastline50.geojson is ~7 MB. Consider clipping to the play area's region on-the-fly or shipping a pre-clipped Japan/Asia subset.

---

### 3. Body of Water (`body-of-water`)

**Game interpretation:** Distance to the nearest body of water (lake, river, reservoir).

**Why deferred:** Water bodies in OSM are polygons (`natural=water`, `landuse=basin`, `waterway=river` areas). Distance to a water body means distance to the nearest *edge* of the polygon, not the centroid. Computing edge-distance for hundreds of polygons is more expensive than point distance.

**Recommended approach:**
- Add a Geofabrik pipeline step to extract water polygons as GeoJSON.
- Bundle as `assets/measuring/water.json` (region-limited, e.g., Japan).
- In `measuringGeometry.ts`, iterate polygon rings and use `@turf/nearestPointOnLine` against each ring to find the nearest edge point, then build the circle at that point.
- Alternatively, use polygon centroids as an approximation for small water bodies, with a note in the UI that accuracy is approximate.

**OSM tags to extract:**
```
(
  way["natural"="water"];
  relation["natural"="water"];
  way["landuse"="basin"];
  way["waterway"="riverbank"];
)
```

---

### 4. 1st Admin. Division Border (`admin-1st-border`)

**Game interpretation:** Distance to the nearest prefectural (or equivalent) boundary line (OSM admin_level=4 in Japan, e.g., Tokyo-Kanagawa border).

**Why deferred:** Requires extracting administrative boundary polygons and computing distance to the boundary *line* (polygon edges), not the polygon centroid. This is the same polygon-edge-distance problem as body-of-water.

**Recommended approach:**
- Extract `boundary=administrative` + `admin_level=4` relations from Geofabrik.
- Bundle boundary ring LineStrings as `assets/measuring/admin-1st-border.json`.
- Use `@turf/nearestPointOnLine` to compute seeker distance to the nearest boundary segment.

---

### 5. 2nd Admin. Division Border (`admin-2nd-border`)

**Game interpretation:** Distance to the nearest ward/municipality boundary (OSM admin_level=7 in Japan, e.g., Shinjuku-ku / Shibuya-ku border).

**Same approach as admin-1st-border**, but using `admin_level=7`.

---

## Shared Implementation Pattern (when undeferred)

All five categories follow the same pattern:

1. **Bundle generation**: add a pipeline step to Geofabrik scripts that extracts the geometry into `assets/measuring/<category>.json`.
2. **Distance function**: `@turf/nearestPointOnLine` against the bundled `LineString` or `MultiLineString`.
3. **Circle construction**: build the circle at `nearestPoint` (not at a named POI centroid) with `seekerDistanceMeters` radius.
4. **UI**: the candidate list changes for line-based categories — instead of showing named POIs, it shows the nearest point on the line (coordinates + approximate description). The seeker's distance is still auto-computed.

## Enabling a Deferred Category

When implementing any of these:

1. Update `measuringCategoryConfig` entry: `implemented: false → true`.
2. Add bundle pipeline step + commit the artifact.
3. Add the distance-computation branch to `measuringGeometry.ts`.
4. Update the detail screen to handle the non-POI candidate display for that category.
5. Run `pnpm check` to verify no registry drift.
6. Add geometry unit tests.

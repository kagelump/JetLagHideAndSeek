# Kantō POI Size Analysis

Generated 2026-06-02 from `kanto-latest.osm.pbf` (Geofabrik daily extract,
sequence 3320, timestamp 2026-06-01T20:21:26Z).

## Bottom Line

**All 977,768 POIs in Kantō**: 191 MB GeoJSON, 25 MB gzipped, 20 MB PBF.

Bundling all POIs for offline use is **feasible** if compressed (25 MB gzip for
entire Kantō), but you almost certainly don't want all of them. 60% are unnamed
crossings, signals, trees, benches, and bollards. A curated "useful" POI set
(named + traditional categories) is **70 MB GeoJSON / 12 MB gzipped** for
281,778 features.

## Source Data

| Metric        | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| Region        | Kantō, Japan                                                    |
| Source        | `https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf` |
| Full PBF size | 468.6 MB (446.9 MiB)                                            |
| Bounding box  | `[134.045, 18.625, 155.606, 37.160]`                            |
| PBF header    | `pbf_dense_nodes=true`, `Sort.Type_then_ID`                     |

## All POIs — Sizes by Format

POIs extracted with `osmium tags-filter` matching 15 tag keys on nodes only:
`amenity`, `shop`, `tourism`, `leisure`, `historic`, `craft`, `office`,
`healthcare`, `public_transport`, `railway`, `highway`, `aeroway`, `man_made`,
`natural`, `barrier`.

| Format              | Size             | vs. Full PBF |
| ------------------- | ---------------- | ------------ |
| **Full Kanto PBF**  | **468.6 MB**     | 100%         |
| POI-only PBF        | 20.5 MB          | 4.4%         |
| POI GeoJSON         | 191.3 MB         | 40.8%        |
| POI GeoJSON gzip -9 | 25.0 MB          | 5.3%         |
| POI count           | 977,768 features | —            |

**Key takeaway**: POIs are ~4% of the raw PBF data in PBF format, but GeoJSON
inflates them to 191 MB because each point becomes a full verbose JSON object.
Gzip compresses GeoJSON 7.7:1.

## POI Count by Tag Key

A node can match multiple keys (e.g., `amenity=restaurant` + `shop=food`), so
the sum exceeds the total feature count.

### Traditional POIs

| Tag Key      | Count   | Top Values                                                                                  |
| ------------ | ------- | ------------------------------------------------------------------------------------------- |
| `amenity`    | 230,974 | restaurant (32k), vending_machine (17k), bench (16k), bicycle_rental (13k), fast_food (10k) |
| `shop`       | 81,329  | convenience (14k), hairdresser (8k), supermarket (5k), clothes (5k), massage (3k)           |
| `tourism`    | 27,418  | information (17k), artwork (3k), hotel (2k), viewpoint (1.4k), attraction (1k)              |
| `healthcare` | 16,968  | pharmacy (6k), dentist (4k), doctor (4k), clinic (1k), hospital (0.9k)                      |
| `office`     | 14,130  | company (7k), estate_agent (3k), government (0.8k), yes (0.6k)                              |
| `historic`   | 13,077  | memorial (7k), wayside_shrine (4k), monument (0.5k)                                         |
| `leisure`    | 8,462   | playground (1.4k), picnic_table (1.3k), park (1.2k), fitness_centre (1.2k)                  |
| `craft`      | 2,732   | carpenter (0.6k), confectionery (0.6k), photographer (0.2k)                                 |

### Transit

| Tag Key            | Count   | Top Values                                                                            |
| ------------------ | ------- | ------------------------------------------------------------------------------------- |
| `highway`          | 409,742 | crossing (182k), traffic_signals (76k), bus_stop (74k), stop (59k), street_lamp (11k) |
| `public_transport` | 77,350  | platform (68k), stop_position (7k), station (2.5k)                                    |
| `railway`          | 40,251  | switch (13k), level_crossing (9k), stop (5k), buffer_stop (4k)                        |
| `aeroway`          | 1,218   | parking_position (0.4k), holding_position (0.3k), gate (0.2k)                         |

### Infrastructure & Natural

| Tag Key    | Count  | Top Values                                              |
| ---------- | ------ | ------------------------------------------------------- |
| `natural`  | 89,112 | tree (86k), peak (1.6k), shrub (0.6k)                   |
| `barrier`  | 47,695 | bollard (22k), kerb (9k), gate (8k), cycle_barrier (4k) |
| `man_made` | 12,384 | tower (1.2k), surveillance (1.2k), utility_pole (1.1k)  |

### Named vs. Unnamed

| Subset         | Features        | GeoJSON  | gzip -9 |
| -------------- | --------------- | -------- | ------- |
| **All POIs**   | 977,768         | 191.3 MB | 25.0 MB |
| Has `name` tag | 399,882 (40.9%) | 95.9 MB  | 16.6 MB |
| No `name` tag  | 577,886 (59.1%) | 95.3 MB  | 8.4 MB  |

Only 41% of POI nodes have a `name` tag. The largest unnamed categories are
crossings (182k), traffic signals (76k), platforms (68k), stops (59k), and
trees (86k).

## Subset Sizes

Practical subsets you might actually bundle:

| Subset              | Features | GeoJSON  | gzip -9 | Notes                                                         |
| ------------------- | -------- | -------- | ------- | ------------------------------------------------------------- |
| **All POIs**        | 977,768  | 191.3 MB | 25.0 MB | Everything                                                    |
| **Named only**      | 399,882  | 95.9 MB  | 16.6 MB | Every POI with a name                                         |
| **Traditional**¹    | 376,363  | 84.1 MB  | 14.4 MB | amenity/shop/tourism/leisure/historic/craft/office/healthcare |
| **Useful**²         | 281,778  | 70.3 MB  | 12.5 MB | Traditional ∩ named                                           |
| **Transit**³        | 453,781  | 75.0 MB  | 7.3 MB  | public_transport/railway/highway/aeroway                      |
| **Infrastructure**⁴ | 149,034  | 19.8 MB  | 1.8 MB  | man_made/natural/barrier                                      |

¹ Traditional: `amenity`, `shop`, `tourism`, `leisure`, `historic`, `craft`, `office`, `healthcare`
² Useful: Traditional ∩ has `name` tag — restaurants, hotels, museums, etc.
³ Transit: `public_transport`, `railway`, `highway`, `aeroway`
⁴ Infrastructure: `man_made`, `natural`, `barrier`

## Per-Tag-Key GeoJSON Sizes

Estimated from feature counts and average object size per category.

| Tag Key            | Est. GeoJSON | Est. gzip |
| ------------------ | ------------ | --------- |
| `amenity`          | ~48 MB       | ~8 MB     |
| `highway`          | ~63 MB       | ~4 MB     |
| `shop`             | ~18 MB       | ~3 MB     |
| `natural`          | ~13 MB       | ~1 MB     |
| `public_transport` | ~13 MB       | ~2 MB     |
| `barrier`          | ~7 MB        | ~0.5 MB   |
| `railway`          | ~7 MB        | ~1 MB     |
| `tourism`          | ~6 MB        | ~1 MB     |
| `healthcare`       | ~4 MB        | ~0.7 MB   |
| `office`           | ~3 MB        | ~0.5 MB   |
| `historic`         | ~3 MB        | ~0.5 MB   |
| `leisure`          | ~2 MB        | ~0.3 MB   |
| `man_made`         | ~2 MB        | ~0.3 MB   |
| `craft`            | ~0.5 MB      | ~0.1 MB   |
| `aeroway`          | ~0.2 MB      | ~0.03 MB  |

## Mobile App Guidance

### What fits in a mobile bundle?

- **~12 MB gzipped**: Useful POIs (named restaurants, hotels, shops, museums, hospitals).
  Fits easily in an app bundle or as an on-demand download.
- **~25 MB gzipped**: All POIs. Feasible as an on-demand download, but 60% is unnamed
  crossings, trees, and bollards — unlikely to be user-visible.
- **191 MB uncompressed GeoJSON**: Do not bundle this. It's a reference artifact;
  convert to PBF (20 MB) or a spatial index before shipping.

### Recommended strategy

1. **Bundle**: Useful POIs (traditional + named) as gzipped GeoJSON → **12–14 MB**.
   This covers restaurants, hotels, shops, museums, hospitals, stations — every
   POI a player would reasonably search for or navigate to.

2. **On-demand**: Transit stops (bus_stop, station, platform) → **~7 MB gzipped**.
   Validates against hiding-zone transit presets. Can be fetched when a
   transit-heavy play area is loaded.

3. **Skip**: Unnamed crossings, traffic signals, trees, bollards, vending machines,
   benches. These add ~60% of the feature count with minimal gameplay value.

4. **Format**: Prefer PBF (20 MB for all POIs) over GeoJSON if you control the
   deserialization layer. GeoJSON is convenient for `ShapeSource` but the 7.7×
   size penalty hurts on mobile. Consider storing as PBF and converting to
   GeoJSON on load in JS (already have `osmtogeojson`).

## Technical Notes

- Extraction command: `osmium tags-filter kanto-latest.osm.pbf n/amenity n/shop ...
-o kanto-pois.osm.pbf`
- GeoJSON conversion: `osmium export kanto-pois.osm.pbf -f geojson -o kanto-pois.geojson`
- Gzip level: -9 (best compression)
- osmium-tool version: 1.19.1, libosmium 2.23.1
- The full PBF uses dense nodes (`pbf_dense_nodes=true`), which is why it's only
  468 MB — a non-dense encoding would be significantly larger.
- The POI PBF retains all parent metadata (generator, replication URL/timestamp)
  from the source extract, so it can be updated incrementally if needed.

---

# Measuring Line/Polygon Bundle Sizes

Generated 2026-06-06 from `japan-latest.osm.pbf` (whole-Japan Geofabrik extract),
clipped to Kantō+margin window [137.9, 33.9, 141.9, 37.9].

## Bottom Line

**All 5 measuring bundles**: 22.89 MB raw, 4.02 MB gzipped.
Lazy-loaded per category on first use; only the selected category's JSON is
parsed at runtime.

## Per-Category Sizes

| Category           | Features   | Raw          | Gzip        |
| ------------------ | ---------- | ------------ | ----------- |
| `coastline`        | 7,045      | 1.41 MB      | 0.21 MB     |
| `high-speed-rail`  | 4,228      | 0.79 MB      | 0.10 MB     |
| `body-of-water`    | 74,539     | 16.14 MB     | 2.44 MB     |
| `admin-1st-border` | 666        | 0.50 MB      | 0.15 MB     |
| `admin-2nd-border` | 3,438      | 4.04 MB      | 1.13 MB     |
| **TOTAL**          | **89,916** | **22.89 MB** | **4.02 MB** |

## Notes

- Source: whole-Japan PBF (2.3 GB) clipped to Kantō + ~1° margin with `osmium extract`.
- Geometry types: `LineString` and `MultiLineString` only; polygon features are
  converted to outer-ring LineStrings at build time.
- Simplification: `@turf/simplify` (Ramer-Douglas-Peucker) at per-category
  tolerances (10–50 m).
- Lazy loading: each category's JSON is `require()`-d only on first use via
  `lineBundleLoader.ts`, matching the `bundledPois.ts` pattern.

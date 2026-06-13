# Geofabrik Data Pipeline — Plan

## Overview

[Geofabrik](https://download.geofabrik.de/) provides daily OSM data extracts by
region — continents, countries, and sub-regions — in PBF and GeoPackage formats.
This pipeline downloads those extracts, extracts OSM administrative boundary
relations from them, converts the results to GeoJSON, and outputs checked-in
boundary fixtures that can be bundled as default play-area zones (the same shape
as `assets/default-zones/tokyo.json`).

**Why Geofabrik instead of Overpass:**

- A single PBF download covers every boundary relation in a region.
- No rate-limiting or timeout risk from live Overpass queries.
- Reproducible offline pipeline — the same PBF always produces the same output.
- Makes it practical to bundle many play-area boundaries instead of just Tokyo
  and Osaka.

## Directory Layout

```
data/geofabrik/
    PLAN.md          ← this file
    NOTICE.md         ← attribution, license, usage-rule notes
    sources.md        ← Geofabrik source URLs and OSM attribution
    config.yaml       ← regions to download, relations to extract
    scripts/
        fetch-geofabrik.mjs   ← download + extract + generate
        fetch-geofabrik.test.mjs  ← tests
    cache/            ← git-ignored, raw PBF downloads
    generated/        ← checked-in GeoJSON boundary files
```

## Toolchain

The minimum toolchain is **one** native tool that can read a PBF file and emit
OSM JSON for a specific set of relations:

### Primary: `osmium-tool`

Install:

```bash
brew install osmium-tool           # macOS
apt-get install osmium-tool        # Debian/Ubuntu
```

`osmium-tool` is a fast, well-maintained C++ tool. It can:

- Extract relations by ID from a multi-GB PBF in seconds.
- Filter by tags (e.g., `boundary=administrative`).
- Export to OSM JSON, OSM XML, or GeoJSON directly.

Example — extract Tokyo 23 Wards (relation 19631009) from a Japan PBF:

```bash
osmium getid -r data/geofabrik/cache/kanto-latest.osm.pbf r19631009 \
    -f geojson -o data/geofabrik/generated/tokyo-23-wards.geojson
```

### Fallback: `osmconvert` + `osmfilter`

If osmium can't be bootstrapped, `osmconvert` (also in brew/apt) can filter PBF
to OSM XML, and `osmfilter` can extract specific relations. The Node.js script
can then parse OSM XML and convert to GeoJSON. This is slower and more fragile
than osmium, but avoids a C++ build chain.

### Node.js packages (already available)

| Package               | Purpose            | Status                         |
| --------------------- | ------------------ | ------------------------------ |
| `osmtogeojson`        | OSM JSON → GeoJSON | Already in `package.json`      |
| `@types/osmtogeojson` | TypeScript types   | May need adding for TS scripts |

The pipeline script wraps the native tool call, passes the output through
`osmtogeojson` if needed, and writes the final GeoJSON. No new npm dependencies
are required beyond what the project already has (`yaml`, `fflate`, etc.).

## config.yaml Shape

Follows the `data/odpt/config.yaml` pattern:

```yaml
output: generated/boundaries.json
cacheDir: cache
notice: NOTICE.md

# Each region entry maps a Geofabrik sub-region URL to a list of relation IDs
# to extract from that PBF.
regions:
    - id: japan-kanto
      label: Kantō, Japan
      url: "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf"
      relations:
          - id: 19631009
            name: Tokyo 23 Wards
            name_ja: "東京23区"
          - id: 1543125
            name: Tokyo Prefecture
            name_ja: "東京都"
          # … more Kantō administrative boundaries

    - id: japan-kansai
      label: Kansai, Japan
      url: "https://download.geofabrik.de/asia/japan/kansai-latest.osm.pbf"
      relations:
          - id: 358674
            name: Osaka Prefecture
            name_ja: "大阪府"
          # … more Kansai administrative boundaries
```

## Pipeline Script Design

**`scripts/fetch-geofabrik.mjs`** — entry point:

1. **Load config** from `config.yaml`.
2. **Download** each region's PBF to `cache/` (skip if `--cache-only` and cached).
3. **Extract** the configured relations from the PBF using `osmium getid`.
    - Accept relation IDs only (type `r` filter in osmium); discard ways and nodes.
    - Emit GeoJSON or OSM JSON.
4. **Convert** OSM JSON → GeoJSON via `osmtogeojson` (if osmium didn't emit GeoJSON
   directly).
5. **Validate** each boundary:
    - Must be a polygonal geometry (Polygon or MultiPolygon).
    - Must contain at least one coordinate ring.
    - Reject empty or point-only features.
6. **Assemble** the output bundle (same shape as the current
   `assets/default-zones/tokyo.json`):
    ```json
    {
        "attribution": { … },
        "generatedAt": "<ISO timestamp>",
        "boundaries": [
            {
                "regionId": "japan-kanto",
                "osmId": 19631009,
                "label": "Tokyo 23 Wards",
                "feature": { /* GeoJSON Feature */ }
            }
        ]
    }
    ```
7. **Write** the bundle to `generated/boundaries.json`.

### CLI flags

| Flag           | Behavior                                                    |
| -------------- | ----------------------------------------------------------- |
| (none)         | Download, extract, generate                                 |
| `--cache-only` | Use cached PBFs only; error if missing                      |
| `--check`      | Run validation against checked-in generated output (for CI) |

### npm scripts to add to `package.json`

```json
"data:geofabrik": "node data/geofabrik/scripts/fetch-geofabrik.mjs",
"test:data:geofabrik": "node --test data/geofabrik/scripts/fetch-geofabrik.test.mjs",
```

## Integration with the App

Generated boundaries follow the same GeoJSON Feature shape that
`loadPlayAreaByRelationId` (`src/features/map/playAreaBoundary.ts`) already
expects. Existing bundled boundaries for Tokyo (`19631009`) and Osaka
(`358674`) live in `assets/default-zones/`; the Geofabrik pipeline generates
additional candidates.

The app's `BUNDLED_BOUNDARIES` map can import from
`data/geofabrik/generated/` once boundaries are validated:

```ts
// Hypothetical: import generated boundaries alongside existing fixtures
import boundaries from "../../../data/geofabrik/generated/boundaries.json";
// Map relationId → GeoJSON FeatureCollection for each boundary
```

Note: `osmtogeojson` is already used in
`src/features/map/playAreaBoundaryConversion.ts` to convert Overpass responses.
The Geofabrik pipeline produces the same output shape; no conversion code
changes are needed on the app side.

## Priority Boundaries

Starting with Japanese administrative divisions (all OSM relations):

| Priority | Boundary          | OSM ID   | Region PBF         |
| -------- | ----------------- | -------- | ------------------ |
| ✓ done   | Tokyo 23 Wards    | 19631009 | kantō              |
| ✓ done   | Osaka Prefecture  | 358674   | kansai             |
| P0       | Tokyo Prefecture  | 1543125  | kantō              |
| P1       | Kyoto Prefecture  | 2138096  | kansai             |
| P1       | Hokkaidō          | 37973    | hokkaidō           |
| P2       | Other prefectures | —        | respective regions |

## Attribution and License

OSM data is © OpenStreetMap contributors and licensed under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).

Geofabrik extracts carry the same license. The pipeline must:

- Include OSM attribution in generated JSON (matching the existing
  `assets/default-zones/tokyo.json` pattern).
- Document sources in `data/geofabrik/sources.md`.
- Include a `data/geofabrik/NOTICE.md` with OSM/Geofabrik attribution text.

## Bootstrap Checklist

- [x] Verify `osmium` (or fallback) is available: `brew install osmium-tool` (1.19.1)
- [x] Create `config.yaml` with at least one region + relation
- [x] Create `NOTICE.md` with OSM/Geofabrik attribution
- [x] Create `sources.md` with Geofabrik download URLs
- [x] Write `scripts/fetch-geofabrik.mjs`
- [ ] Write `scripts/fetch-geofabrik.test.mjs`
- [x] Add `.gitignore` entries for `cache/`
- [x] Add `data:geofabrik` and `test:data:geofabrik` npm scripts
- [x] Run first fetch → validate generated output (2026-06-02, Kantō)
- [x] Produce `SIZES.md` with POI size analysis
- [ ] Wire generated boundaries into app (optional, can be done incrementally)

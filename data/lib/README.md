# Shared Data Pipeline Modules

This directory holds modules shared across the three data-extraction
pipelines (`data/geofabrik/`, `data/transit/`, `data/packs/`).

## `geo/` — Geometry primitives

`data/lib/geo/index.mjs` exports canonical implementations of common
OSM-extraction geometry functions. Pipeline-specific modules should
import from here rather than defining their own copies.

### Exports

| Function          | Signature                  | Returns     | Description                                           |
| ----------------- | -------------------------- | ----------- | ----------------------------------------------------- |
| `haversineKm`     | `(a, b) => number`         | kilometers  | Great-circle distance between two `[lon, lat]` points |
| `computeBbox`     | `(coords) => [w,s,e,n]`    | bbox array  | Bounding box from flat or nested coordinate arrays    |
| `bboxesIntersect` | `(a, b) => boolean`        | boolean     | True when two `[w,s,e,n]` bboxes overlap (inclusive)  |
| `padBbox`         | `(bbox, deg) => [w,s,e,n]` | padded bbox | Expand a bbox by `deg` degrees on each side           |

### Conversion convention

The shared `haversineKm` returns kilometers. Pipelines that need meters
(e.g., `lineStitching.mjs`'s `haversineMeters`, `grid.mjs`'s `haversineM`)
multiply by 1000 in their delegating wrapper. This avoids unit confusion
and keeps the canonical function in a consistent unit.

## Future structure

As more duplication is identified across the pipelines, extract shared
modules here. Likely candidates:

- `osm/` — OSM-tag extraction primitives (e.g., `@id`→numeric id parsing,
  operator name normalization shared between transit and packs)

Pipeline-specific logic (e.g., geometry simplification with RDP,
station deduplication rules, measuring-category post-filters) stays in
each pipeline's own `lib/` directory.

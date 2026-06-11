# Admin Boundaries — Integer Delta Encoding

## Problem

`assets/measuring/admin-boundaries.json` is **13.8 MB raw / 3.4 MB gzip** for
9,310 admin boundary polygons across levels 2–11 in Kantō. Every coordinate is
stored as a JSON float array (`[139.758492, 35.682913, 139.758521, …]`) with
6–7 significant digits each.

## Solution

Replace float coordinate arrays with **integer delta encoding** at 1-meter
resolution. Instead of absolute floats, store the first point as an integer
relative to the extract bbox origin, then each subsequent point as the signed
difference from the previous point.

### Example

```
Float:     [139.75849, 35.68291,  139.75852, 35.68293,  139.75854, 35.68295]
             ↓ ×100,000 and round
Integer:   [13975849, 3568291,    13975852, 3568293,    13975854, 3568295]
             ↓ delta-encode
Delta:     [13975849, 3568291,    +3,       +2,        +2,       +2]
```

Adjacent vertices in a simplified polygon ring are a few meters apart, so deltas
are tiny integers (typically −10 to +10). gzip compresses these much better than
6-digit absolute floats.

### Measured results

| Format                  | Raw     | Gzip       | vs original |
| ----------------------- | ------- | ---------- | ----------- |
| Float GeoJSON (current) | 13.8 MB | 3.4 MB     | —           |
| Integer delta GeoJSON   | 5.7 MB  | **1.6 MB** | −53%        |

## Accuracy

Two sources of coordinate error, in order of magnitude:

1. **Douglas-Peucker simplification** (already applied in pipeline): 0.0001°
   tolerance ≈ **11 meters** — drops vertices that deviate less than this from
   the simplified line.
2. **Integer quantization** (new): ×100,000 and round → each unit ≈ 0.9–1.1 m
   at 35°N. Maximum error per coordinate ≈ **0.5 meters**.

The integer step adds ~0.5 m of error on top of the existing ~11 m
simplification. For point-in-polygon at prefecture/city scale this is invisible;
GPS error is an order of magnitude larger.

Delta encoding itself is **lossless** — `[a, b−a, c−b]` → accumulate → `[a, b, c]`
reproduces the exact same integers.

## Bundle format

The encoded bundle keeps the same GeoJSON FeatureCollection structure but
replaces each coordinate array with a flat integer array and adds an `encoding`
field so the client can dispatch decoders.

```json
{
    "schemaVersion": 2,
    "encoding": "int-delta-rel-100000",
    "category": "admin-boundaries",
    "extractBbox": [13790000, 3390000, 14190000, 3790000],
    "features": [
        {
            "type": "Feature",
            "bbox": [13900000, 3500000, 13950000, 3550000],
            "geometry": {
                "type": "Polygon",
                "coordinates": [[13900000, 3500000, 3, 0, 0, 5, -3, 0, 0, -5]]
            },
            "properties": {
                "osmId": 1001,
                "admin_level": "4",
                "name": "Tokyo",
                "name:en": "Tokyo"
            }
        }
    ]
}
```

**Encoding rules:**

- `coordinates` is a flat `number[]`, not `Position[][]`.
- Ring boundaries: **RESOLVED (2026-06-12): length-prefixed rings, not null
  sentinels** — `[ringLen, x0, y0, dx1, dy1, …]` per ring, rings
  concatenated; a MultiPolygon is prefixed per polygon by its ring count.
  This adopts Review 1's suggestion 1 (pure `number[]`, no mixed-array
  JSON, no sentinel scanning). The offline-packs epic (T6 encoder, T7
  decoder) is built on this resolution; do not implement the null-sentinel
  variant described in earlier drafts of this doc.
- The first two ints of a ring are the _absolute_ integer coords of the first
  vertex (already quantized, relative to extractBbox min). All subsequent
  pairs are signed deltas from the previous vertex.
- All bbox values and `extractBbox` are also quantized identically.
- Last point of a ring is stored explicitly (the delta back to close the ring,
  typically near zero). Decoder must close explicitly.

## Implementation plan

### Step 1: Pipeline — encode step

**File:** `data/geofabrik/scripts/extract-measuring-bundles.mjs`

After polygon simplification, pass coordinates through an encoder before
writing the bundle:

```js
function encodeDeltaRing(ring, scale, baseX, baseY) {
    const out = [];
    let px = Math.round(ring[0][0] * scale) - baseX;
    let py = Math.round(ring[0][1] * scale) - baseY;
    out.push(px, py);
    for (let i = 1; i < ring.length; i++) {
        const x = Math.round(ring[i][0] * scale) - baseX;
        const y = Math.round(ring[i][1] * scale) - baseY;
        out.push(x - px, y - py);
        px = x;
        py = y;
    }
    return out;
}
```

Gate on a config flag (e.g. `encoding: "int-delta"` in the category definition)
so the existing border bundles are unaffected.

### Step 2: Client — decoder

**File:** `src/features/questions/matching/adminBoundaryLoader.ts`

Add a decoder that reconstructs `Position[][]` from the delta-encoded array
before building the grid index:

```ts
function decodeDeltaRing(
    encoded: number[],
    scale: number,
    baseX: number,
    baseY: number,
): Position[][] {
    // Walk the flat array, splitting on ring separators (null),
    // accumulating deltas back to absolute float coords.
}
```

Dispatch on `bundle.encoding` — if `"int-delta-rel-100000"`, run the decoder;
otherwise treat coordinates as raw float arrays (backward compat).

### Step 3: Tests

- Pipeline: verify encoding round-trips correctly (encode → decode → same
  coords within 1/scale tolerance)
- Client: verify `queryAdminBoundary` works identically with delta-encoded
  bundles vs float bundles

### Step 4: Config

```yaml
# data/geofabrik/config.yaml
- key: admin-boundaries
  geometry: polygon
  encoding: int-delta      # NEW
  encodingScale: 100000    # NEW — units per degree
  ...
```

## Optional follow-ups

- **Drop level 10–11**: cuts another 0.4 MB (1.6 → 1.2 MB). Level 10 (cho-me)
  has 6,300+ polygons — only useful if a game uses neighborhood-block questions.
- **Levels 4+7 only**: 0.7 MB gzip. Covers the two most common admin matching
  questions (same prefecture, same city).

# Review 1

**Two implementation suggestions** beyond what the doc has:

1. Prefer **length-prefixed rings** over `null` sentinels in the flat array — `[ringLen, x0, y0, dx1, dy1, …]` keeps `coordinates` a pure `number[]` (cleaner types, no mixed-array JSON), and the decoder doesn't need to scan for sentinels.
2. Make sure body-of-water decoding happens **before** the geometry hits the native GEOS / WKB fast path — decode to plain float `Position[][]` once at bundle load, so nothing downstream (dissolve, clipping) has to know about the encoding. Decode cost is one linear pass, negligible next to `JSON.parse` on a 14 MB file.

One thing to verify when you implement: `extract-measuring-bundles.test.mjs` and the cross-tile dissolve dedup you fixed recently both compare coordinates — quantization will change exact equality at tile seams, so the dedup should run _after_ quantization (identical seam vertices then quantize identically, which actually makes dedup more robust, but only if ordering is right).

Net: do all five measuring bundles, skip (or only quantize) POIs.

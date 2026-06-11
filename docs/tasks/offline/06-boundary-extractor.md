# T6 — Boundaries artifact: delta-encoded polygons + name index

## Context

The "fully offline play-area setup" decision means each pack carries the
region's admin boundary polygons and a name-search index (design.md →
"Boundaries artifact"). This task builds the pipeline side only; T7 makes
the app consume it.

The encoding is already designed and measured:
[../admin-boundaries-delta-encoding.md](../admin-boundaries-delta-encoding.md)
(Kantō levels 2–11: 13.8 MB float JSON → 1.6 MB gz delta). Implement that
format — don't invent a new one — **with one amendment, which is binding**:
use **length-prefixed rings** (`[ringLen, x0, y0, dx1, dy1, …]`, a pure
`number[]`), not the `null` sentinels the doc's body shows. The doc's
Review 1 recommends this and the doc now records it as the resolution. If
T6 and T7 disagree on this, the artifact format breaks — both implement
length-prefixed.

Levels come from `regions.yaml` (T1): `adminLevels.extract` (what goes in
the artifact, superset) and `adminLevels.matching` (the 4 levels mapped to
`admin-1st`…`admin-4th`, default 4/7/9/10 — matching the app's existing
default in `adminDivisionConfig.ts`).

Depends on **T2b**, which factored the osmium-based relation assembly out
of `extract-measuring-bundles.mjs` into `lib/osmiumPipeline.mjs` — this
task consumes that function and must not duplicate it.

## What to build

### 1. Extraction

Replace the T1 `boundaries` stub. From the region PBF, extract every
`boundary=administrative` relation whose `admin_level` ∈
`adminLevels.extract`, assembling complete (multi)polygons.

Assembly is **not** hand-written code you need to find or port — it's an
**osmium** pipeline, and T2b already factored it into a callable function:

```js
import { assembleAdminBoundaries } from "data/geofabrik/scripts/lib/osmiumPipeline.mjs";
const { features, summary } = await assembleAdminBoundaries({
    pbfPath,
    levels: region.adminLevels.extract,
    tmpDir,
});
```

Under the hood that runs osmium three times (tags-filter → `getid -r` to
pull complete relations with members → `export`, which does the
multipolygon ring assembly). You consume its GeoJSON output; do not write
ring-assembly logic yourself. If `assembleAdminBoundaries` is missing
something you need (e.g. per-level filtering happens post-export), extend
it in `lib/osmiumPipeline.mjs` with a test, don't fork it.

Per relation keep: OSM relation id, `name`, `name:en` (and `name:ja`/local
variants if present), `admin_level`, assembled polygon(s).

Drop relations with no name or broken geometry — but **count** them and
print a summary (`assembled / dropped-noname / dropped-broken per level`);
silent data loss is how offline search grows mystery holes.

### 2. Artifact format — `dist/<region-id>/boundaries.json.gz`

```jsonc
{
    "schemaVersion": 1,
    "regionId": "europe-netherlands",
    "generatedAt": "…",
    "levels": [4, 7, 8, 9, 10], // = adminLevels.extract
    "index": [
        {
            "relationId": 47796,
            "name": "Utrecht",
            "nameEn": "Utrecht", // omit when identical/absent
            "normalized": ["utrecht"], // lowercase, diacritics stripped, all variants, deduped
            "adminLevel": 4,
            "centroid": [5.12, 52.09],
            "bbox": [4.79, 51.93, 5.63, 52.3],
            "areaKm2": 1560,
        },
    ],
    "polygons": {
        "47796": {
            /* delta-encoded MultiPolygon per the encoding doc */
        },
    },
}
```

- Implement encode in the pipeline (`lib/deltaEncode.mjs`) **and** a
  reference decoder next to it, with a round-trip test — T7 ports the
  decoder to TypeScript and must match it. Format: 1e-5° integer grid,
  per-ring first-point absolute then signed deltas, **length-prefixed
  rings** (see Context — not null sentinels).
- Simplify polygons before encoding with the tolerance the encoding doc
  assumes; record the tolerance in the artifact for transparency.
- `normalized` variants: lowercase + Unicode NFKD + strip combining marks;
  include `name`, `name:en`, and local-language names. CJK names won't
  latinize — they stay as-is (offline search in local script is fine; see
  the open question in design.md).

### 3. Lint + sizing

pack-lint additions: decode round-trip on 3 random relations matches the
reference decoder; every index row has a polygon and vice versa; centroid
falls inside the polygon bbox; levels in the artifact ⊆ `extract` config.
Print artifact gz size per level so over-budget regions are visible (warn
above 10 MB gz, same convention as T3).

## How to test

`node --test`:

- Delta encode/decode round-trip: synthetic rings (incl. a multipolygon
  with a hole) survive encode→decode within the grid resolution.
- Normalization: `"São Paulo"` → `"sao paulo"`; `"Kreis Düren"` →
  `"kreis duren"`; CJK passthrough.
- Fixture PBF with two small admin relations (one with `name:en`): index
  rows + polygon presence + level filter all asserted.
- Dropped-relation accounting: a relation with broken geometry increments
  the counter and is absent from output.

Manual: build NL boundaries, then view them in `tools/data-viewer`. The
viewer work here is concrete and in scope: T2 already added the
`--pack <dir>` flag and the `/api/pack/*` route pattern to `server.mjs`
(read its orientation paragraph if you haven't); you add an
`/api/pack/boundaries/<level>` route that gunzips the artifact, decodes
polygons with the pipeline's **reference decoder** (import it from
`data/geofabrik/scripts/lib/deltaEncode.mjs` — server.mjs already uses
`createRequire` for `lib/transitGeojson.js`, follow that), and returns a
FeatureCollection, plus a per-level layer toggle in `index.html`. Eyeball:
provinces (level 4) and municipalities (level 8) look like the
Netherlands; check the printed gz size against the design sizing table
(~1–2 MB expected).

Also build `asia-taiwan` (add it to `regions.yaml`) — the CJK name-index
stress case the epic's M2 exit criterion needs.

## Out of scope

- App-side decoding/search (T7), admin-division matching integration (T8),
  any change to the committed `assets/measuring/admin-*` bundles.

## Done when

- NL + Taiwan boundaries artifacts build and lint clean, sizes in the
  expected range, viewer eyeball passes.
- Encode/decode reference round-trip is tested and documented in the
  artifact (`schemaVersion: 1`).
- `pnpm test` + `pnpm check` green.

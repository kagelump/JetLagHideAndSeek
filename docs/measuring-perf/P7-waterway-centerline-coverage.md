# P7 — Body-of-water river coverage (waterway centerlines + thin-polygon retention)

**Status:** ready to implement · **Type:** _correctness_ (data/extraction), not perf ·
**Risk:** medium (bundle size) · **Touches:** `data/geofabrik/scripts/extract-measuring-bundles.mjs` + its test + a runtime regression test; regenerates `assets/measuring/body-of-water.json`

> This is an instructions doc for an implementing agent. It is self-contained:
> background, exact code locations, the size decision you must make, and the
> end-to-end verification (which is runnable locally — the PBF cache is present).

## Context — why this exists

A `measuring` "body of water" question renders a red reference line to the
nearest shoreline and computes nearest-water distance. In Tokyo 23-Wards the
**Meguro River reference line stops mid-course at Naka-Meguro** and the upstream
(NW) half is missing — a correctness bug: a seeker near the upper Meguro is told
the nearest water is far away.

Investigation (this is settled — don't re-derive):

1. **It is not the runtime clip (P6) and not simplification of the rendered
   line.** The geometry is genuinely absent from the bundle. In the whole Meguro
   corridor there are only ~216 vertices, and the nearest bundle vertex to two
   upstream sample points is the _same_ point — nothing exists NW of
   ~139.702,35.642.
2. **The Meguro is a `waterway=river` centerline way
   ([way/49683811](https://www.openstreetmap.org/way/49683811)) with no riverbank
   polygon.** The body-of-water osmium filter is polygon-only
   (`w/natural=water r/natural=water w/landuse=basin w/waterway=riverbank` —
   `extract-measuring-bundles.mjs` ~line 41). `waterway=river` matches none of
   those clauses, so the river is dropped at the osmium stage. **Primary cause.**
3. **Separately, thin polygon water collapses during simplification.** The
   body-of-water RDP tolerance is `0.0005°` (~55 m) and
   `simplifyPolygonFeature` drops any ring left with `< 4` points. A water polygon
   narrower than ~2×tolerance collapses to a sliver and is discarded. Verified
   with the script's own `simplifyPolygonFeature`:

    | river width | ~56m (current) | ~22m | ~11m | ~6m  |
    | ----------- | -------------- | ---- | ---- | ---- |
    | 20m         | DROP           | DROP | KEPT | KEPT |
    | 30m         | DROP           | KEPT | KEPT | KEPT |
    | 60m         | KEPT           | KEPT | KEPT | KEPT |

    So riverbank polygons narrower than ~60 m are silently lost too. **Secondary
    cause.**

**Scope chosen by the user:** fix all three — (A) add waterway centerlines, (B)
collapse-fallback so thin polygons are never dropped, (C) lower the polygon
tolerance. (A) is what actually restores the Meguro.

## Data you'll be working with (measured from the cached extract)

`data/geofabrik/cache/measuring-kanto-wide.osm.pbf` (the exact window the script
reuses) contains, for the new line tags:

| tag               | ways       | nodes         |
| ----------------- | ---------- | ------------- |
| `waterway=river`  | 34,896     | 1,380,172     |
| `waterway=canal`  | 3,758      | 21,641        |
| `waterway=stream` | **94,511** | **1,952,340** |

Current committed bundle: **151 features, 1.84 MB raw / 0.53 MB gzip**, all
MultiPolygon. The Meguro way **is present** in the cached extract (`osmium getid
… w49683811` → found), so the fix is verifiable end-to-end without a network
fetch.

> ⚠️ **`stream` is the dominant size risk** — ~94 k ways / ~2 M nodes, roughly
> doubling the raw line-vertex load. Treat the bundle-size checkpoint below as a
> real decision gate, not a formality.

## What to change

All three changes are in **`data/geofabrik/scripts/extract-measuring-bundles.mjs`**.
The runtime needs **no change** — `LineBundle.features` is already
`Feature<LineString | MultiLineString | Polygon | MultiPolygon>`, and
`computeLineDistance` / `computeLineBuffer` / `polygonFeaturesToLineFeatures`
(`src/features/questions/measuring/lineMeasuringGeometry.ts`) all already handle a
mixed line+polygon bundle. `body-of-water` stays `schemaVersion: 2`.

### A. Capture waterway centerlines

1.  **Filter** (`CATEGORIES`, body-of-water, ~line 41): append the line tags:

    ```js
    "w/natural=water r/natural=water w/landuse=basin w/waterway=riverbank " +
        "w/waterway=river w/waterway=canal w/waterway=stream";
    ```

2.  **Mixed ingestion** in the streaming loop (the `category.geometry ===
"polygon-dissolve"` branch, ~lines 1513–1588). Today it accepts only
    Polygon/MultiPolygon and `continue`s on lines. Change it to **also accept
    LineString/MultiLineString**, splitting MultiLineStrings into LineStrings and
    pushing them **raw (un-simplified)** — exactly like high-speed-rail defers
    simplification so the shared-node stitcher sees full-resolution endpoints.
    Tag each pushed line feature with its waterway type, e.g.
    `properties: { waterway: feature.properties?.waterway }`, so the size
    checkpoint can filter per-type if needed.

                            Distinguish the two subsets downstream purely by `geometry.type`.

### B + C. Polygon path: collapse-fallback + lower tolerance

3. **Collapse-fallback** in `simplifyPolygonFeature` (~line 331). Today each ring
   is `simplifyCoords(ring, tol)` then filtered by `ring.length >= 4`, which
   _drops_ collapsed thin rings. Replace the per-ring step with a fallback: if the
   simplified ring has `< 4` points, retry at a finer tolerance (e.g. `tol / 4`),
   and if it still collapses keep the **cleaned, un-simplified ring** rather than
   dropping it. Only return `null`/drop when the _source_ ring genuinely has `< 4`
   coords. This guarantees no thin water polygon is silently lost. (The dissolve
   already guards fully-degenerate features at the `if (!simplified) continue`
   site, ~line 531 — keep that.)

4. **Lower the polygon tolerance** (`SIMPLIFY_TOLERANCES["body-of-water"]`, ~line
   65): `0.0005` → `0.0002` (~22 m). With (B) covering the collapse case, this is
   a modest fidelity bump for thin-but-surviving polygons; don't go lower than
   needed (it bloats the wide bodies — Tokyo Bay, lakes — which are fine coarse).

### Line subset post-processing (new)

In the `isPolygonDissolve` post-processing block (~lines 1596–1683), **partition
`features` into polygons and lines up front**, run the existing polygon steps
(clean → min-length-by-perimeter → recompute bbox → `polygonDissolve`) on the
polygon subset only, and run a new pipeline on the line subset, then concatenate.

> Do **not** let line features reach the existing step-2 min-length filter as-is:
> it uses `polygonPerimeterMeters` under `isPolygonDissolve`, which returns 0 for
> lines and would drop every river. Partitioning first avoids this.

Line subset pipeline (mirror the HSR pattern, reusing existing helpers):

1. `cleanCoordsInline` each line (removes exact dup coords; preserves shared
   nodes).
2. **Stitch** with `stitchSegments` (already defined, ~line 727) — assembles the
   fragmented OSM ways into continuous rivers via the exact shared-node graph, so
   per-segment min-length can't punch gaps mid-river. Drop degenerate loops
   (`nodeKey(first) === nodeKey(last)`) like HSR does (~line 1693).
3. **Min-length filter on assembled lines** — see the size checkpoint for the
   floor. River/canal want a low floor (~100 m); stream wants a high floor to cull
   the ~94 k minor streams.
4. `simplifyFeature(line, WATERWAY_LINE_SIMPLIFY)` with a new constant
   `WATERWAY_LINE_SIMPLIFY = 0.0001` (~11 m) — rivers are thin, lines are cheap,
   so keep them crisp. Recompute bbox with `computeBbox`.

Skip `dedupeParallelTracks` / `bridgeCollinearGaps` (rail-specific) and
`validateLineContinuity` (its hole/component thresholds are tuned for HSR).

## The bundle-size checkpoint (decision gate)

After a first regeneration, check `assets/measuring/body-of-water.json` size.
**Budget reference: keep gzip ≲ ~1.5 MB** (offline download; currently 0.53 MB).
If stream pushes it over:

1. **Raise the stream min-length** (e.g. assembled stream floor 500 m → 1 km).
   Per-type filtering needs the `waterway` property tagged in step A; after
   `stitchSegments`, a merged line carries its seed's props, which is good enough
   to bucket streams.
2. If still over budget, **drop `waterway=stream` from the filter** entirely and
   ship river+canal only. Rivers+canals are what players mean by "body of water";
   streams are marginal. The Meguro is `river`, so dropping stream does **not**
   regress the reported bug.

Record the final decision and the measured size in the commit message.

## Tests

- **`extract-measuring-bundles.test.mjs`** — the structural "every feature is a
  LineString/MultiLineString/Polygon/MultiPolygon" test (~line 103) already passes
  for mixed geometry; no fix needed there. **Add** a positive guard for the real
  body-of-water bundle: at least one `LineString`/`MultiLineString` feature exists,
  and the Meguro corridor is covered (port the gap test below — assert nearest
  bundle vertex to an upstream sample like `[139.6855, 35.6510]` is within, say,
  300 m). This is the regression guard for the actual bug.
- **`simplifyPolygonFeature` unit test** (same file, polygon-dissolve section
  ~line 456+) — add: a ~20 m-wide thin rectangle polygon is **retained** (not
  `null`) after `simplifyPolygonFeature(feat, 0.0002)`. Pre-fix this returns null.
- **Runtime jest** `lineMeasuringGeometry.test.ts` — extend the existing real-bundle
  test (~line 507, "handles body-of-water bundle without throwing") or add a
  Meguro-specific one: a seeker just off the upstream Meguro returns a _small_
  `distanceMeters` (e.g. `< 500`), proving the centerline is now in the bundle.

## Verification (runnable locally — cache is present)

```bash
# 1. Regenerate ONLY body-of-water; reuses the cached wide PBF (no download).
pnpm data:measuring --only=body-of-water
#   → watch the [dissolve] / line-subset logs and the final size line.

# 2. Confirm the upstream Meguro is now covered (gap test).
node -e '
const b=require("./assets/measuring/body-of-water.json");
const hv=(a,c)=>{const R=6371000,r=x=>x*Math.PI/180,dy=r(c[1]-a[1]),dx=r(c[0]-a[0]);
const s=Math.sin(dy/2)**2+Math.cos(r(a[1]))*Math.cos(r(c[1]))*Math.sin(dx/2)**2;return 2*R*Math.asin(Math.sqrt(s));};
const V=[];const w=c=>{if(typeof c[0]==="number"){if(c[0]>139.64&&c[0]<139.76&&c[1]>35.59&&c[1]<35.66)V.push(c);}else c.forEach(w);};
for(const f of b.features)w(f.geometry.coordinates);
for(const[n,lo,la]of[["Ikejiri/Ohashi",139.6855,35.6510],["Naka-Meguro",139.6985,35.6440]]){
let best=1e9;for(const v of V)best=Math.min(best,hv([lo,la],v));
console.log(n.padEnd(16),best.toFixed(0)+"m");}'
#   PASS: both upstream points now < ~300m (pre-fix: Ikejiri was 1768m).

# 3. Size check (the decision gate).
ls -lh assets/measuring/body-of-water.json
node -e 'const z=require("zlib"),fs=require("fs");
console.log((z.gzipSync(fs.readFileSync("assets/measuring/body-of-water.json")).length/1048576).toFixed(2)+" MB gzip");'

# 4. Suites.
node --test data/geofabrik/scripts/extract-measuring-bundles.test.mjs
pnpm exec jest --testPathPattern="(lineMeasuringGeometry|measuringGeometry|clipLineFeatures)"
pnpm typecheck
```

Then **`git add assets/measuring/body-of-water.json`** plus the script/test
changes and commit. CI cannot regenerate this bundle (no Geofabrik PBF), so the
committed artifact is the source of truth.

### Manual device check (recommended)

Tokyo 23-Wards play area → add a Measuring question, category **Body of Water** →
the red reference line should now trace the **full Meguro River** (and other
centerline rivers) through the wards, not stop at Naka-Meguro.

## Acceptance criteria

- [ ] Upstream Meguro sample points are < ~300 m from a bundle vertex (was 1768 m).
- [ ] body-of-water bundle contains both polygon and line features;
      `schemaVersion` still `2`.
- [ ] Thin (~20 m) polygon water is retained by `simplifyPolygonFeature` (B).
- [ ] `SIMPLIFY_TOLERANCES["body-of-water"] = 0.0002`; `WATERWAY_LINE_SIMPLIFY`
      added (C).
- [ ] Bundle gzip within budget (or stream dropped/raised per the checkpoint,
      decision recorded in the commit).
- [ ] `extract-measuring-bundles.test.mjs`, the measuring jest suites, and
      `pnpm typecheck` pass.
- [ ] Regenerated `assets/measuring/body-of-water.json` committed.

## Rollback

Revert the script + test changes and restore the previous
`assets/measuring/body-of-water.json` from git. No runtime code changed, so there
is nothing else to undo.

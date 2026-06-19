# Body-of-water mask artifacts at line/polygon river junctions — handoff

## Symptom

The body-of-water eligibility mask still shows artifacts at water boundaries where a
`waterway` centerline (line river) meets a water-area polygon (polygon river). The user
pointed to the Meguro river around Nakameguro station (`way 49683811`).

## Reproduction

Use the built Kanto pack and the real measuring geometry code with the GEOS wasm oracle:

```bash
cd /Users/ryantseng/projects/JetLagHideAndSeek

# Inspect the artifact
gunzip -c data/packs/dist/asia-japan-kanto/measuring-body-of-water.json.gz \
  | node --input-type=module -e "
      import { gunzipSync } from 'node:zlib';
      import { readFileSync } from 'node:fs';
      const b = JSON.parse(gunzipSync(0));
      const t = {};
      for (const f of b.features) t[f.geometry.type] = (t[f.geometry.type] || 0) + 1;
      console.log('schemaVersion', b.schemaVersion, 'types', t, 'total', b.features.length);
    "
# → schemaVersion 2 types { MultiPolygon: 2, LineString: 15738 } total 15740
```

The repro window used was Nakameguro:

```text
center: [139.6985, 35.6440]
bbox:   [139.68, 35.63, 139.72, 35.66]
radius: ~155 m (typical body-of-water measuring distance)
```

## What the data looks like

- The body-of-water bundle contains **two enormous dissolved `MultiPolygon` features**
  (eastern and western Kanto water areas) plus **15 738 line rivers/canals**.
- Around Nakameguro the line feature that matches the Meguro river ends at
  `139.701981988, 35.642371095`.
- That endpoint lies **inside** a small water polygon ring (ring 1334 of the eastern
  `MultiPolygon`) rather than exactly on its boundary. The pipeline clips lines at
  polygon boundaries, but the clip intersection is numerically indistinguishable from
  the original endpoint, so the line is still present and terminates well inside the
  polygon.

## Evidence of the artifact

With the GEOS wasm backend, buffering the scoped water features logs:

```text
Self-intersection at or near point 131750.45580893656 432652.94886509597
```

Projected back to WGS84 this is approximately:

```text
139.700214315, 35.642210381
```

The resulting buffer is a `MultiPolygon`. A grid comparison around that point shows
real gaps in the mask:

```text
gridSize: 961
bothOk:   159
extra:    8
gap:      794
```

Example gap points (within 155 m of the water but missing from the buffer):

```text
[139.699540582, 35.641536648] → 70.3 m from water
[139.699540582, 35.641581563] → 71.2 m from water
[139.699540582, 35.641626479] → 72.4 m from water
```

## Root cause

The artifact is **not caused by the line buffer**. It originates from buffering the
single giant dissolved water `MultiPolygon`.

| Buffer input    | Output polygons | Self-intersection? | Gaps in mask? |
| --------------- | --------------- | ------------------ | ------------- |
| Polygon only    | 1555            | yes                | yes           |
| Lines only      | 2               | no                 | no            |
| Polygon + lines | 1557            | yes                | yes           |

So the line river is a red herring in the sense that removing it does not fix the
notch. However, the notch appears exactly where the line river meets the polygon
boundary, because that junction is on a small, narrow water polygon ring that the
50 m runtime simplification + 155 m GEOS buffer cannot offset cleanly.

Key factors:

1. **Giant dissolved geometry.** The pack stores water as two continent-scale
   `MultiPolygon`s with thousands of rings (9447 in the eastern one around Nakameguro).
   Buffering that as one object creates complex interactions between nearby rings.
2. **Runtime simplification.** Because the polygon has >20k coordinates, the runtime
   simplifies it at 50 m before buffering. Per-ring RDP does not preserve topology and
   can sharpen narrow inlets.
3. **Buffer wider than the feature.** Typical measuring radii (~155 m) are larger than
   the width of the small inlet/river mouth where the Meguro line meets ring 1334. GEOS
   `Buffer` produces a self-intersecting offset there; `MakeValid`/`unaryUnion` recovery
   leaves a concave notch on the land side.

## Why previous fixes did not catch this

- `P7-waterway-centerline-coverage.md` added waterway centerlines so that riverbanks
  collapsed by simplification would still be covered. That works for **line-only**
  rivers.
- It did not address the case where a **polygon riverbank exists but is narrower or
  spikier than the measuring radius**, so buffering the polygon itself still breaks.

## Candidate fixes

1. **Split the dissolved water polygons.** Instead of two continent-scale
   `MultiPolygon`s, keep water areas in smaller spatial cells (e.g. the pack tile grid
   or a coarse grid). Buffering smaller pieces limits the interaction that causes the
   self-intersection.
2. **Filter/generalize narrow water polygons in the pack pipeline.** Drop or merge
   water-area polygons whose minimum width is below the smallest expected measuring
   radius, relying on centerlines for those features.
3. **Topology-preserving simplification + MakeValid before buffer.** Replace the
   per-ring RDP in `simplifyPolygonCoords` with a topology-aware simplifier and/or call
   `MakeValid`/`unaryUnion` after simplification so the input to `Buffer` is cleaner.
4. **Post-process the buffer.** After GEOS `unaryUnion`, fill small holes/notches
   (area or width below a threshold) that are clearly buffer artifacts rather than
   real islands. This is the smallest runtime change but risks over-filling legitimate
   land gaps.
5. **Distance-field approach.** Replace polygon buffering for body-of-water with a
   raster distance field and contour extraction. This is the most robust but largest
   architectural change.

## Files and outputs produced during investigation

Local `/tmp` outputs (not committed) that can be inspected with the data viewer or
QGIS:

- `/tmp/scoped_nakameguro.json` — features in the Nakameguro window.
- `/tmp/ring1334.json` — the small water polygon ring where the Meguro line terminates.
- `/tmp/buf_poly_only.json` — buffer of the water polygon only; shows the notch.
- `/tmp/buf_line_only.json` — buffer of the line rivers only; clean.
- `/tmp/buf_nakameguro_geos.json` — combined polygon + line buffer.

## Recommended next step

Try candidate **#1** (split the dissolved water polygon into smaller cells in the pack
pipeline) first. It attacks the root cause (giant interacting geometry) without
changing runtime semantics, and it aligns with the existing pack-tile mental model.
If splitting alone is insufficient, combine it with **#2** (filter narrow polygons)
and/or **#4** (post-buffer hole filling).

## Validation + refined root cause (handoff 2)

Validated the handoff above and pinned the exact mechanism. The handoff's root
cause ("buffering the giant dissolved MultiPolygon", line river a red herring) is
**correct**. The new findings make the _why_ precise and explain the regression.

### What the artifact actually is

`measuring-body-of-water.json.gz` = **2 continent-scale `MultiPolygon`s** + 15 738
lines. The two polygons split at **exactly `x = 139.545154`** — a clean vertical
line, i.e. the band seam. So the bundle optimization (commit `7746ee7`,
band-partition clip + _concatenate, not union_) is what produced these two giant
blobs (effJobs = 2 bands, kept as separate features). MP0 = west (4198 polys, 51 636
coords), MP1 = east (9447 polys, 105 181 coords). Nakameguro (139.70) is interior to
MP1, ~0.15° east of the seam — so the seam itself is _not_ the notch; the giant
feature is.

### Why a giant feature breaks the mask (the precise chain)

1. **Feature-level windowing can't subset a giant `MultiPolygon`.** The runtime
   window filter (`lineMeasuringGeometry.ts:86`, `selectWindowFeatures`) keeps a
   feature if its **bbox** intersects the query window. A continent-scale MP's bbox
   intersects _every_ Kantō play area, so the **entire 105 k-coord MP1 is always
   selected** and handed to the buffer whole.
2. **The runtime is built for ~dozens of small pieces, not 2 giant ones.**
   `computeLineBuffer` (`lineBufferComputation.ts:217`) buffers **each polygon
   feature separately**, then unions all pieces (`:429`). Its own comment (`:405`)
   states the design expectation verbatim: _"body-of-water yields ~40
   heavily-overlapping buffer pieces (dissolved water polygons + river lines)."_
   Overlapping polygon features are **explicitly fine** — they're unioned. The
   dissolve collapsing ~40 features into 2 is exactly what defeats this design.
3. **The giant feature trips the coord budget → aggressive simplification.**
   MP1 (105 k coords) ≫ `maxBufferCoords` (20 000), so the polygon path uses
   `polySimplifyTolerance` = **50 m** instead of the gentle `simplifyTolerance` =
   **10 m** (`lineBufferComputation.ts:207-215`, `appConfig.ts:266-281`). Per-ring
   Douglas–Peucker (`simplifyPolygonCoords`, **not topology-preserving**) at 50 m
   sharpens narrow inlets like the Meguro river mouth; the ~155 m buffer is wider
   than the inlet, so the offset curve self-intersects → MakeValid leaves a concave
   **notch** on the land side → the 794 gap points the handoff measured.

### Evidence gathered this pass

- **Small + gentle scope buffers perfectly clean.** Scoping MP1 to a tight
  Nakameguro window (10 polys) and buffering at 10 m → single clean `Polygon`, **no
  self-intersection, 0 gaps**. The notch only appears at large scope under 50 m.
- **Clipping MP1 to the Tokyo-23 bbox drops 105 181 → 11 492 coords** — i.e. _below_
  the 20 k budget, which would restore the gentle 10 m simplification.
- GEOS-wasm-in-Node OOMs (`std::bad_alloc` / "invalid table size") when buffering
  the giant geometry. That is a **test-harness ceiling** (wasm memory growth), not
  device behaviour — native GEOS 3.14 on-device completes (the handoff got a
  1555-poly buffer). Don't chase the wasm OOM; reproduce gap geometry at clipped /
  small scope only.

### Two viable fixes (refined)

- **A — Pipeline (proper revert of the regression).** Emit dissolved water as many
  smaller, overlap-tolerant `MultiPolygon` features (per dissolve tile) instead of 2
  giant blobs. `dissolveTile` _already_ yields one feature per tile; the
  band-worker pre-merge + the `buildMeasuring` "cross-tile merge → 1 polygon" /
  band-concat steps are what fuse them. Keep building the waterway-clip grid
  (`mergedPolyCoords`) from the union, but **emit the tiles**. Restores
  feature-level windowing → only nearby tiles selected → each small → gentle 10 m
  simplify → clean per-piece buffers → union. Requires rebuild + republish
  (`pnpm data:pack -- --region asia-japan-kanto --jobs auto` then
  `pnpm data:pack:publish`). Watch artifact size (overlapping seams duplicate
  coords).
- **B — Runtime defense (no republish).** In `computeLineBuffer`'s polygon path,
  clip each polygon feature to `(window/playArea bbox + radius margin)` before
  simplify+buffer. Drops coords below the 20 k budget → gentle 10 m simplify (no
  inlet notch) and shrinks the op. Needs the window bbox threaded into
  `computeLineBuffer` (it currently only gets `windowFeatures` + radius;
  `computeLineCategory` has `playAreaBbox`). Defends against _any_ future giant
  polygon input.

Recommend shipping **B** (immediate, no republish, defends generally) and doing
**A** as the clean source-level revert when the region is next rebuilt. The line
river / ring-1334 junction is a symptom, not the cause — neither #2 (filter narrow
polygons) nor #3 (topology-preserving simplify) is needed if the buffer op is kept
small (which both A and B accomplish).

## Implemented (handoff 2)

Both fixes landed; A's effect is **pending the next rebuild** (no republish was run).

**B — runtime (live now, no rebuild):**

- `filterPolygonMembersByBbox` (`lineMeasuringGeometry.ts`) — drops MultiPolygon
  **members** whose bbox is outside `(playArea bbox + radius margin)`. Members are
  whole water bodies, so no cut edges. Wired into `measuringGeometry.ts` after the
  existing `filterFeaturesByBboxMargin`. This is the member-granularity windowing a
  giant feature defeats (instead of a geometric clip — avoids artificial edges and
  the JS-backend cost). Scopes Kantō MP1 from 105k coords to the ~dozens of water
  bodies near the play area.
- `simplifyPolygonBufferFeatures` (`lineBufferComputation.ts`) — replaces the global
  coord-budget cliff with **per-member** tolerance: a member is simplified gently
  (`simplifyTolerance`, ~10 m) unless it alone exceeds
  `measuring.line.polyMemberSimplifyCoordLimit` (2000), in which case it gets the
  aggressive `polySimplifyTolerance` (~50 m). This is the actual notch fix: small
  narrow members (river mouths) no longer get 50 m'd just because Tokyo Bay is in the
  same feature. The on-device parity harness (`parityHarness.ts`) now calls the same
  helper. Buffer cache version bumped 5 → 6.
- Tests: `filterPolygonMembersByBbox` + `simplifyPolygonBufferFeatures` in
  `__tests__/lineMeasuringGeometry.test.ts` (incl. "narrow member simplified
  identically whether or not a huge sibling is present").

**A — pipeline (in code; takes effect on next `pnpm data:pack` + publish):**

- `bucketPolygonsToGridFeatures` (`polygonDissolve.mjs`) — buckets dissolved member
  polygons into a coarse grid (`measuring.dissolve.emitCellDeg`, default 0.1°) by
  bbox center, emitting one small `MultiPolygon` Feature per non-empty cell. Whole
  members, no cuts. `buildMeasuring.mjs` calls it right after `mergedPolyCoords` is
  built and **replaces** the 1–2 giant blobs in `features` with the bucketed set;
  the waterway-clip grid still uses the un-bucketed `mergedPolyCoords`. Tests in
  `bucketPolygons.test.mjs`.
- To make A live: `pnpm data:pack -- --region asia-japan-kanto --jobs auto` then
  `pnpm data:pack:publish -- --region asia-japan-kanto`. Eyeball the re-tiled water
  in `tools/data-viewer` before publishing; watch artifact size.

Not done (deliberately): the heavy Kantō rebuild/republish, and the unrelated
pre-existing `site/packs/index.html` Prettier failure (already unformatted at HEAD).

## The "circle" report — diagnosis + fix (handoff 3)

After A+B (A rebuilt into the artifact: 369 features, not 2 giants; B live), the user
still saw **a circle "exactly at the intersection of the river line and polygon"**
near Nakameguro. Investigated with a device-faithful geos-wasm reproduction (project
→ buffer → unproject → unaryUnion, the real `computeLineBuffer` path) since the
features are now small enough that wasm no longer OOMs.

**The circles are buffers of tiny water-area polygons — not a geometry bug.** Each
small isolated water polygon buffers to one ~circle. Measured every water member in
the visible window (6 of them): areas **0, 393, 499, 516, 755, 2298 m²** — i.e. 5 of
6 are sub-2000 m² garden ponds/slivers, one literally **0 m²** (degenerate). Cross-
checked OSM (Overpass): the 755 m² one is **real** (`way 328677258`, `water=pond`),
sitting ~250 m from the junction — its circle is geometrically _correct_. The
junction itself is **continuous**: the river-centerline buffer and the river water-
area (`poly1`) buffer overlap by **43,657 m²** (endpoints 6 m apart), so there is no
gap/notch there. A+B also removed the earlier sliver fragmentation (0 tiny-sliver
mask components vs several before).

So the noise comes from (a) real-but-trivial ponds and (b) **degenerate ≈0 m²
slivers** the dissolve+simplification collapse out of thin water strips, which
MakeValid-recover into spurious circular blobs. User chose: **drop only degenerate
(<100 m²)** — keep real ponds.

**Fix (two layers, both default 100 m²):**

- Pipeline: `polygonAreaM2` + `filterTinyPolygons` (`polygonDissolve.mjs`);
  `buildMeasuring.mjs` drops members below
  `measuring.dissolve.minWaterPolygonAreaM2` (default 100) right after
  `mergedPolyCoords` is built (before bucketing + the waterway grid). Permanent fix,
  takes effect on next rebuild. Tests in `bucketPolygons.test.mjs`.
- Runtime: `simplifyPolygonBufferFeatures` now drops a member whose post-simplify
  area `< measuring.line.degenerateWaterPolygonAreaM2` (default 100, via
  `parityMetrics.polygonAreaM2`). **Defends the already-shipped artifact with no
  rebuild** — verified it drops the 0 m² member and keeps the 393–755 m² ponds.
  Buffer cache bumped 6 → 7. Test: "drops a degenerate near-zero-area member but
  keeps a real pond".

To remove the _real_ small-pond circles too (if ever wanted), raise
`minWaterPolygonAreaM2` / `degenerateWaterPolygonAreaM2` (2000 m² drops garden ponds;
5000 m² is more aggressive). Rivers stay covered by waterway centerlines regardless.

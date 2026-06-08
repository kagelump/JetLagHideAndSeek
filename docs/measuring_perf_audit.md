# Measuring System — Reference-Line & Performance Audit

_2026-06-08. Scope: the `measuring` question family
(`src/features/questions/measuring/`) plus its render-state consumer
(`questionGeometry.ts`) and map layer (`MeasuringLayers.tsx`). Driven by two
reported symptoms: (1) the visible Shinkansen reference line "looks wrong" even
though the mask is correct, and (2) `body-of-water` softlocks the app after
tapping closer/farther._

## TL;DR

| #   | Problem                                       | Root cause                                                                                              | Fix class                                                      |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | HSR red line spills far outside the play area | `lineFeatures` render **whole** bundle features; never clipped to the play area                         | clip + restyle                                                 |
| 2   | `body-of-water` softlocks / phone heats up    | `@turf/buffer` (JSTS) on a **MultiLineString of ~1,533 line rings**, run synchronously on the JS thread | **bundle dissolved polygons** (P0) + runtime input budget (P1) |
| 3   | Every closer/farther tap re-derives           | buffer cache key includes the radius; line-distance scans 45k coords brute-force                        | windowed spatial index (P2)                                    |
| 4   | Any heavy category blocks the whole UI        | all question geometry is built in one synchronous `useMemo`                                             | yield / off-thread                                             |

The line and point measuring paths have diverged: the point path is bounded and
fast (columnar bbox filter → grid dedup → `steps: 8` MultiPoint buffer), while
the line path is unbounded and runs JSTS over raw bundle geometry. Most of the
fix is making the line path adopt the point path's discipline.

---

## Issue 1 — The Shinkansen reference line looks wrong

### What's drawn

`MeasuringLayers.tsx` renders `measuring.lineFeatures` as the `measuring-line-ref`
layer: `lineColor: "#ff0000"`, `lineWidth: 10`, `lineOpacity: 0.7`. (The comments
in both files still call this the "orange reference line" — the color was changed
to thick red and the comments never caught up. Minor, but worth fixing so intent
is legible.)

### Why it spills outside the play area

In `buildMeasuringRenderState` (`measuringGeometry.ts:270-317`), `lineFeatures`
is assembled by walking the whole bundle and keeping features that (a) have a
bbox intersecting `playAreaBbox` and (b) match the nearest border by
`relationId`, or — when relationIds are absent — pass `featureNearPoint` (any
vertex within ~100 m of the nearest point).

Two facts from the bundles make this wrong for rail:

- **HSR features carry no `relationId`** (`grep` of
  `assets/measuring/high-speed-rail.json`: 0/15 features). So the relationId
  branch never fires; everything falls to the `featureNearPoint` spatial
  fallback.
- **HSR features are long stitched corridors.** The nearest feature is a
  ~170–180-coord LineString spanning the Tōkaidō corridor. `featureNearPoint`
  returns `true` if _one_ vertex is within 100 m of the nearest point — so the
  **entire** corridor feature is emitted, including the leg that continues out
  past Yokohama and off-screen.

Then nothing clips it: `bboxIntersects(featureBbox, playAreaBbox)` is a
**bbox** test, and the per-feature filters above are all-or-nothing. A feature
that dips into the play area is rendered in full. That is exactly the long red
line in the screenshot.

For `admin-1st/2nd-border` the same code looks fine only because those features
_are_ the border you measured to and stay near the play area; for a transport
corridor "the whole feature" is the wrong unit.

### Same flaw, second symptom: in-area corridors are dropped (e.g. Tōhoku)

The reference line and the mask use **different, inconsistent selection rules**,
and that asymmetry is the deeper bug:

- **Mask** (`lineMeasuringGeometry.ts:273-279`) buffers **every** feature whose
  bbox intersects the _play-area ± radius_ window — so both the Tōkaidō (south)
  and Tōhoku (north) Shinkansen corridors contribute, and the mask is correct on
  both sides.
- **Reference line** (`measuringGeometry.ts:294-313`), because HSR has no
  `relationId`, falls to `featureNearPoint(f, nearby.nearestPoint)`: it keeps
  only features with a vertex within **100 m of the single nearest point**. That
  point sits on whichever corridor is closest to the seeker (Tōkaidō, by the
  pin). The Tōhoku corridor is a separate feature nowhere near that one point, so
  it is **dropped entirely** — even though it's inside the play area and _is_ in
  the mask.

So there are two faces of one flaw — **the reference-line selection is not
derived from the same feature set the mask covers**:

1. The kept feature renders unclipped → the red line spills off past Yokohama.
2. Other in-area corridors (Tōhoku) are never kept → they show in the mask but
   have no reference line.

Note this means the P3 "clip to the play area" fix is **necessary but not
sufficient**: clipping fixes the spill, but Tōhoku stays missing until selection
itself changes. The correct fix is to build the reference line from the **same
windowed feature set the buffer uses** (all features intersecting the play-area
window), then clip that set to the play-area boundary — one source of truth for
both the highlight and the mask. The `featureNearPoint`/`relationId`
single-nearest-point filter should be removed for line categories.

### Is the red line even the right UX?

The dashed connector (`nearestPointConnectors`) + the white-ringed marker
(`nearestPointMarkers`) already answer "what are you measuring to, and where is
the nearest point." The thick red full-corridor overlay adds little beyond that
and actively fights the mask for visual attention. Recommended, in order of
preference:

1. **Clip `lineFeatures` to the play-area boundary** before returning them, and
   restyle to a thin (~3 px), distinct, semi-transparent stroke. This keeps the
   "here's the rail/border you're near" affordance without the off-screen spill
   or the heavy red. Clipping is a `lineSplit`/`bboxClip` per kept feature, or
   reuse the play-area polygon via `@turf/bbox-clip` (cheap; the kept set is
   tiny after filtering).
2. **Or** render only a short highlighted stub around the nearest point (e.g.
   the ±N vertices of the nearest feature) rather than the whole feature.
3. **Or** drop the reference line for line categories entirely and rely on the
   connector + marker.

Clipping (option 1) is the smallest change that fixes the reported bug and
generalizes to every line category.

---

## Issue 2 — `body-of-water` softlock

### Bundle scale

`assets/measuring/body-of-water.json` is **11.5 MB**: 45,566 features /
207,366 coords. It's generated `polygon-to-ring` — every water polygon (every
pond, basin, river bank) becomes an outer-ring LineString. Contrast the other
bundles: HSR 15 feats / 742 coords, admin-1st 8 / 9,045, coastline 2,620 /
12,978. `body-of-water` is two orders of magnitude denser than anything else and
is the only category that reliably tips the line path over.

### Where the time goes (from the attached logs)

```
[lineDistance] 45052 coords → simplify(10m): 45051 coords, turf in 1440ms
[lineBuffer] 1533 features in query window, 1533 segments, 8189 total coords
[lineBuffer] after dedup: 1533 segs, 8189 coords → simplify(23m): 8189 coords
(softlock; phone hot)
```

Three compounding problems:

1. **`computeLineDistance` is a brute-force scan.** It collects every feature
   whose bbox is within a fixed **50 km** window of the center
   (`MARGIN_METERS = 50_000`), concatenates them into one MultiLineString
   (45,051 coords), and runs `@turf/nearest-point-on-line` over all of it →
   **1,440 ms**. There is no spatial index; the 50 km window is far larger than
   any plausible answer and pulls in the entire Kantō water layer.

2. **`simplify(10m)` does essentially nothing here** (45,052 → 45,051). The
   bundle is already simplified at ~55 m during extraction
   (`SIMPLIFY_TOLERANCES["body-of-water"] = 0.0005`), and per-segment RDP can't
   drop a vertex from a 3–5-point pond ring. The same is true downstream:
   `simplify(23m): 8189 → 8189`. Per-feature simplification is the wrong lever
   when the cost is the **number of features**, not vertices-per-feature.

3. **The actual softlock is `@turf/buffer` on 1,533 line segments.** JSTS
   buffers each segment into a polygon and unions them. Line-buffer + union of
   ~1.5k pieces at a multi-km radius is the cliff — this is where the logs stop
   and the phone heats. The point path never hits this because it buffers a
   single `MultiPoint` with `steps: 8` and lets one offset operation produce the
   union; the line path passes a raw `multiLineString(simplifiedLines)` straight
   into `buffer()` with default fidelity and no segment budget.

### Secondary: it re-derives on every tap

`computeLineDistance` is cached on `(category, center)`, so closer/farther
shouldn't re-run it — but `computeLineBuffer`'s cache key includes
`Math.round(radiusMeters/10)*10`, and closer/farther changes the derived
distance → new radius → cache miss → full re-buffer. So each tap pays the full
1,533-segment buffer again. For `body-of-water` that's a guaranteed softlock per
interaction, not a one-time cost.

### Semantic note

Buffering the _outer ring_ of a water polygon yields a band straddling the
shoreline, not "within d of the water body." For small ponds that's
indistinguishable; for Tokyo Bay the open-water interior isn't covered. Because
the mask is intersected with the (land) play area this rarely matters in
practice, but if `body-of-water` is ever measured against an area that includes
water, the ring-buffer is subtly wrong. Keeping polygons (not rings) for this
category would fix both the semantics and enable a cheaper polygon-union path.

---

## Common threads across the measuring system

1. **Line path is unbounded; point path is bounded.** Point geometry caps work
   via columnar bbox filter + grid dedup + low-step buffer. Line geometry runs
   JSTS over raw bundle features with no segment/coord budget and no spatial
   index. Every systemic fix below is really "make the line path behave like the
   point path."

2. **No spatial index for line bundles.** The repo already ships
   kdbush/geokdbush (used by matching). Line nearest-point and the buffer
   pre-filter are both linear scans over the full bundle. A per-(region,
   category) index over feature bboxes (rbush) or vertices (kdbush) turns the
   45k-feature scan into a windowed query.

3. **Per-feature simplification can't reduce feature count.** The dominant cost
   for dense categories is the number of segments handed to JSTS, which
   simplification leaves untouched. There is no "drop tiny features / merge /
   cap to budget" stage on the line path comparable to the point path's grid
   dedup.

4. **Everything is synchronous in one `useMemo`.** `useQuestionMapRenderState`
   builds radar + matching + tentacles + thermometer + measuring together, on
   the JS thread, whenever _any_ dependency changes. A single heavy measuring
   category blocks all rendering and gesture handling — that's why it presents
   as a softlock with the phone heating rather than a slow-but-responsive frame.
   There's no `InteractionManager`, no incremental yield, no per-question
   memoization, and no "skip while gesturing" guard.

5. **Whole-feature, unclipped overlays.** Issue 1 is a specific case of a general
   habit: derived line geometry is filtered but never clipped to the play area
   before it reaches MapLibre.

---

## Recommendations (prioritized; quality cost noted)

### P0 — Bundle `body-of-water` as dissolved polygons (kills the softlock at the source)

The softlock is `@turf/buffer` + union over ~1,533 independent line rings. The
single highest-ROI fix is to **stop shipping 1,533 rings** and instead bundle a
**pre-dissolved polygon geometry**, computed once at extraction time.

- Change the extraction for `body-of-water` (and, by the same logic, the admin
  borders) from `polygon-to-ring` to **keep polygons and dissolve them** into a
  small number of merged MultiPolygons per region (e.g. tile or cluster so no
  single multipolygon is enormous). `data/geofabrik/scripts/extract-measuring-bundles.mjs`
  already has the polygon geometry in hand before it rings them.
- At runtime the buffer becomes **one offset over a handful of dissolved
  polygons** instead of 1,533 line buffers + union. That is the operation that
  collapses from "freeze" to milliseconds.
- Bonus: it also fixes the shoreline-band **semantics** — buffering the polygon
  (interior included) gives a true "within d of the water body" region, not a
  band straddling the outline.
- Quality cost: dissolving merges adjacent water bodies that were distinct
  features; for a distance/eligibility mask this is what you want. Tile/cluster
  boundaries must overlap slightly so the dissolve doesn't leave seams.

**Why bundle-time and not a runtime dissolve:** the win is _amortization_ —
compute the merge once, offline, ship the result. Dissolving 1,533 rings at
runtime is the same cost as the union we're trying to avoid (see the
union-vs-dissolve note below). Precomputing removes it entirely.

This supersedes the old P4 "store as polygons" item, which is now the top
priority.

### P1 — Runtime safety net + bounded inputs (ship regardless of P0)

Even with dissolved bundles, the line path should be bounded so no future dense
category can softlock. These also protect builds that predate a regenerated
bundle.

- **Hard segment/coord budget before `buffer()`.** After bbox-filtering, if the
  surviving segment count or total coords exceed a budget (e.g. >400 segments or
    > 4,000 coords), escalate simplification _and_ raise the min-feature-length
    > floor until under budget, dropping the smallest features first. At the buffer
    > radius these are sub-pixel; dropping them is invisible.
- **Lower line-buffer fidelity to match the point path** (`steps: 4`–`6`). The
  mask is intersected and difference-d afterward; circle resolution is
  imperceptible.
- **Raise `MIN_FEATURE_LENGTH_M["body-of-water"]`** (and the runtime
  `minFeatureLenM` floor) so thousands of tiny ponds/basins never enter the
  buffer. Quality cost: very small ponds stop contributing — almost always
  desirable for a "nearest body of water" mask.

### P2 — Don't re-pay the distance scan every tap

- **Window `computeLineDistance` like the buffer** (use the play-area bbox ±
  margin instead of a fixed 50 km box around the center) and **index it**. A
  kdbush over bundle vertices, or rbush over feature bboxes, replaces the 45k
  brute-force `nearestPointOnLine` (1,440 ms → single-digit ms). A **bundled**
  index makes this free at startup (no lazy build). Note: an index fixes the
  _scan_, not the softlock — the dissolved bundle (P0) is what removes the
  freeze. Quality cost: none.
- **Memoize render-state per question**, so toggling one question's answer
  doesn't rebuild the others. Quality cost: none.

### P3 — Don't block the UI thread (medium effort)

- **Yield heavy measuring derivation off the synchronous `useMemo`** — compute
  on `InteractionManager.runAfterInteractions`, or chunk the work and publish
  incrementally, or move it to a worker. The goal is that a heavy category
  degrades to "the band appears a beat late" rather than "the app freezes and
  heats." Quality cost: brief visual latency on first derivation.

### P4 — Fix the reference line (Issue 1)

- **Derive `lineFeatures` from the same windowed feature set the buffer uses**
  (all features intersecting the play-area ± radius window), not from the
  single-nearest-point `featureNearPoint`/`relationId` filter. This brings back
  in-area corridors like Tōhoku that the mask already covers. Quality cost: none.
- **Then clip that set to the play-area boundary** and restyle to a thin,
  distinct, semi-transparent stroke (drop the `lineWidth: 10` red). Fixes the
  off-screen spill. Fix the stale "orange" comments. Quality cost: none.
- Clipping alone is **not** sufficient — without the selection change, Tōhoku
  stays missing. Both changes are needed.
- Optionally drop the line overlay for line categories entirely and rely on the
  connector + marker.

### P5 — Structural (larger, optional)

- **Unify the line and point paths** behind a shared "bbox-filter → spatial
  index → budget/dedup → low-step buffer → cache" pipeline so future categories
  inherit the bounded behavior automatically.

---

## Note: should we replace `union` with `dissolve` at runtime?

No — and it's worth being precise about why, because "dissolve" sounds like a
faster operator than "union" and it isn't.

- **They are the same operation.** Dissolving N polygons _is_ unioning them into
  merged geometry. `@turf/dissolve` is implemented _on top of_ union (iteratively)
  and is historically slower and less robust than calling the clipper directly.
  Swapping the operator buys nothing and can regress.
- **The bundle win is amortization, not the operator.** `body-of-water` gets
  fast because the merge is precomputed once, offline — not because dissolve is a
  faster verb. There is no static input to amortize at most runtime union sites.
- **The codebase already uses the best primitive.** `unionPolygons`
  (`shared/geojson.ts:32`) and `maskBuilder` both call `polyclip-ts`
  `union(a, ...rest)` — a single-pass N-ary planar overlay, not pairwise turf
  unions. That is already "dissolve-grade"; there is nothing better to switch to.
- **The softlock's union isn't even a union _call_.** It lives inside
  `@turf/buffer` (JSTS dissolving the buffered pieces), so an operator swap never
  reaches it. The fix is _fewer / pre-dissolved inputs to buffer_ (P0), not a
  different merge function.

The transferable principle from "dissolve" is **precompute-where-inputs-are-
static** (→ bundle, or memoize) and **shrink-inputs-before-merging** (→ budget /
dedup) — neither of which is an operator change. A scan of the active runtime
union sites (`maskBuilder` excluded areas, `matchingVoronoi` hit/miss cells,
hiding-zone circle merge) shows they are already memoized or have per-render
inputs, so there is no free precompute win there. The measuring buffer is the
one site with a static, precomputable input — and that is exactly the P0 bundle
change.

---

## Quick reference — where each thing lives

- Reference-line assembly & clipping target: `measuringGeometry.ts:270-317`
- Line nearest-point (50 km scan, 1,440 ms): `lineMeasuringGeometry.ts:465-587`
- Line buffer (JSTS softlock): `lineMeasuringGeometry.ts:229-425`
- Point path to mirror: `pointMeasuringGeometry.ts:237-416`
- Synchronous build site: `questionGeometry.ts:80-108`
- Layer styling / "orange" comment: `MeasuringLayers.tsx:28-79`
- Bundle generation (simplify tol, min length, polygon-to-ring):
  `data/geofabrik/scripts/extract-measuring-bundles.mjs:25-90`
  </content>
  </invoke>

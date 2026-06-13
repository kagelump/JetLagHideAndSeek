# Through-Service Filter — Way-Overlap Classifier (Design + Tasks)

**Date:** 2026-06-14
**Status:** Design — supersedes the `passenger`+multi-operator heuristic in
[[through-service-filter]] as the global v2.
**Parent:** [[post-removal-regressions]] · [[project_japan_pack_transit_regression]]

## Why replace the `passenger` heuristic

The shipped v1 flags a line as a through-service when its `operator` is
multi-value (`;`) **and** it carries a `passenger` tag, then gap-fills its
`routeIds` in a second attach pass. It works for Tokyo but uses **tags to infer
a structural property**, which breaks globally:

- **False positives (Europe).** A genuinely multi-operator regional/cross-border
  line (`operator=SNCF;SBB`, `passenger=regional`) is wrongly demoted →
  undercounts shared-interchange stations. `passenger` is standard on first-class
  European regional/long-distance routes.
- **False negatives.** Through-services with no `passenger` tag still inflate
  counts.
- **Partial fix.** v1 only de-dupes per-station `routeIds`; the fallback line is
  still pushed into `preset.routes` (so `routes.length`/the "N lines" UI still
  counts it) and its geometry is still drawn, overlapping the physical line.

## The structural signal

A through-service is a _journey stitched across other lines' physical track_; a
physical line _owns_ a unique contiguous stretch of rail. Since `wayGeometry:
true` already resolves each line's OSM **way members**, the discriminator is
locale-free and tag-free:

> A line is a through-service when (near) all of its way members are also members
> of **other** route relations that resolve to a **different** canonical line —
> i.e. it contributes ≈ zero unique track.

Because such a line owns no unique track, every station on it already sits on a
physical line that owns that track. So a confidently-classified through-service
can be **dropped entirely** — no gap-fill needed — which removes the inflated
station count, the redundant `preset.routes` entry, **and** the duplicated map
geometry in one move.

## Design

### Where it runs

In [osmRoutes.mjs](../../../data/transit/scripts/lib/osmRoutes.mjs)
`processOsmRoutes`, **after** `buildLine` has produced `keptLines` with stitched
way geometry and after operator cleaning/collapse, **before** colors are
resolved and lines returned. It needs the per-line way-member sets, so capture
them during `buildLine` (the `wayMembers` array is already gathered there for
`stitchWays`) onto the line as `line.wayIds: number[]` (deduped).

### Algorithm

1. **Build a way→owners index.** For every kept line, for each way id in
   `line.wayIds`, record the line's _canonical key_ `op|lineNameKey(name)`
   (reuse the collapse key already defined in this module). Map: `wayId →
Set<canonicalKey>`.
2. **Score each line.** For line `L` with `n = L.wayIds.length`:
    - `sharedForeign` = count of `w ∈ L.wayIds` where the way→owners set contains
      **any key ≠ L's own key**.
    - `overlapRatio = sharedForeign / n` (guard `n > 0`).
3. **Classify.** `L` is a through-service when:
    - `overlapRatio ≥ OVERLAP_THRESHOLD` (default **0.9**, per-region overridable
      via `transitOverrides.throughServiceOverlap`), **and**
    - `n ≥ MIN_WAYS` (default **3** — don't classify near-stub lines on overlap
      noise), **and**
    - at least one foreign owner key exists (it shares with a _real other_ line,
      not just its own collapsed variants — variants already merged in collapse,
      so this mostly falls out, but assert it).
4. **Action: drop.** Remove classified lines from `keptLines` before color
   resolution and return. Log `dropped N through-service line(s) (overlap ≥ X)`.
    - **Safety net — never strand a station.** Before dropping, verify every
      `memberStationId` of the dropped line also appears in at least one _kept_
      non-through-service line. If a station would be left with zero routes,
      **keep** that line in gap-fill mode (mark `_fallback = true`) instead of
      dropping — i.e. fall back to v1 behavior for that line only. This makes the
      classifier strictly safe: worst case it degrades to the current behavior.

### Interaction with v1

- Keep the `_fallback` two-pass attach in
  [attachRoutes.mjs](../../../data/transit/scripts/lib/attachRoutes.mjs) — it
  becomes the **safety-net path** (step 4 above), not the primary mechanism.
- **Remove** the `passenger`+multi-operator `_fallback` tagging in `buildLine`
  (lines ~151, ~190) once the classifier lands; the overlap signal subsumes it.
  Keep the `;`-operator **cleaning** block (that's correct normalization,
  independent of through-service detection).

### Config

Add to the packs config schema ([config.mjs](../../../data/packs/scripts/lib/config.mjs)):

- `transitOverrides.throughServiceOverlap` (number, default 0.9)
- `transitOverrides.minThroughServiceWays` (number, default 3)
  Document defaults in `regions.yaml` comments; Japan needs no override.

### Edge cases / caveats

- **Branch/loop lines** sharing a trunk (e.g. JR lines over a shared corridor)
  could show moderate overlap but still own unique branch track → the 0.9
  threshold + the station-stranding safety net protect them. Tune threshold per
  the data-viewer eyeball, not blindly.
- **Stop-position fallback lines** (no way members, `n = 0`) are never
  classified — they can't be scored. Correct: they're already minimal.
- **Direction variants** are merged in collapse before scoring, so a line isn't
  flagged as overlapping "itself."
- Planar way-id set comparison — no geometry math needed; it's set membership,
  cheap (`O(total ways)`).

## Tasks

1. **Capture way ids per line.** In `buildLine`, dedupe `wayMembers` into
   `line.wayIds`. Ensure it survives `collapse` (union way ids across collapsed
   variants, like `memberStationIds`).
2. **Implement the classifier** as a pure helper
   `classifyThroughServices(lines, { overlap, minWays })` →
   `{ throughServiceIds: Set, strandedFallbackIds: Set }`, called from
   `processOsmRoutes`. Pure + exported for unit testing.
3. **Wire drop + safety-net** into `processOsmRoutes`; drop classified lines,
   demote stranded ones to `_fallback`.
4. **Remove** the `passenger`+`;` `_fallback` tagging; keep `;` cleaning.
5. **Config schema + defaults** (`throughServiceOverlap`, `minThroughServiceWays`).
6. **Rebuild + republish** all 8 `asia-japan-*` packs; eyeball in the
   data-viewer; commit the regenerated `site/packs/catalog.json`.
7. **Dedupe `routeColors`** in `regions.yaml` via a YAML anchor
   (`&japan_route_colors` / `*japan_route_colors`) while touching the file.

## Tests to add

### Unit — `osmRoutes.test.mjs` (classifier)

- **Drops a pure through-service:** line B whose way ids ⊆ lines A+C (different
  canonical keys), `overlapRatio = 1.0` → classified; A/C kept.
- **Keeps a physical line with unique track:** line owning ways not in any other
  line (`overlapRatio = 0`) → not classified — _this is the European
  multi-operator regression guard._
- **Threshold boundary:** line at 0.89 overlap kept, 0.91 dropped (with default
  0.9); honor per-region override.
- **`minWays` guard:** a 2-way line with 100% overlap is **not** dropped.
- **Station-stranding safety net:** a station served _only_ by a high-overlap
  line → that line is demoted to `_fallback`, not dropped; station ends with 1
  route.
- **Collapse union:** way ids and member stations union across collapsed
  direction variants; a line isn't flagged as overlapping its own variant.
- **No way members:** stop-position-fallback lines (`wayIds = []`) are skipped,
  never classified.

### Unit — `attachRoutes.test.mjs` (new file — none exists today)

- **Two-pass gap-fill:** non-fallback line attaches unconditionally; a
  `_fallback` line attaches a routeId only to stations with 0 existing routes.
- **Fallback never inflates:** station already covered by a non-fallback line is
  untouched by a later fallback line.
- **Route still placed:** a `_fallback` line still appears in its preset's
  `routes` (geometry/color preserved) even when it gap-fills nothing — document
  this as intended, or change it (see open question).

### Integration — `pack-lint.mjs` quality gate (extend `checkTransitQuality`)

The hardcoded Kantō invariants already added are the right shape. Extend:

- Keep: 中目黒=2, 広尾=1, 原宿=1, 駒場東大前=1, 代官山=1; 目黒↔白金台 shared edge.
- Add a **no-duplicate-route-per-station** assertion: no station's `routeIds`
  contains two routes whose canonical line key is identical (catches through-
  service leakage structurally, not just for the named stations).
- Add a generic Japan check (already present): ≥1 hub station with ≥2 routes.
- Note: this gate only runs on **local** builds (CI can't build packs) — call
  that out so a green CI isn't mistaken for transit-quality coverage.

### Regression fixtures

- Add a small synthetic OSM fixture (2 physical lines + 1 through-service over
  their combined track) under the transit test fixtures so the classifier has a
  deterministic, network-free case that mirrors the Tokyo Tōyoko/Hibiya/直通運転
  topology.

## Lightweight pack smoke tests (per-region invariants)

**Yes, this is lightweight.** It's the natural extension of the
`checkTransitQuality` gate already in [pack-lint.mjs](../../../data/packs/scripts/pack-lint.mjs):
read the built `transit.json` once, run cheap set/count/coordinate assertions
over `presets[].stations[].routeIds` and `presets[].routes[].geometry`. No
network, no extra build, runs inside `pnpm data:pack:lint`. Cost is microseconds
per region. **Caveat:** it's a **local build-time** gate (CI can't build packs),
so a green CI does not imply transit quality — keep that explicit in the output.

### Shape: a per-region invariants table

Move the inline Kantō checks into a data-driven `REGION_INVARIANTS` map keyed by
region id, so adding a region is adding a table entry, not code:

```js
const REGION_INVARIANTS = {
    "asia-japan-kanto": {
        stationRouteCounts: {
            中目黒: 2,
            広尾: 1,
            原宿: 1,
            駒場東大前: 1,
            代官山: 1,
        },
        sharedEdges: [["目黒", "白金台"]], // must share ≥1 route
        ringRoutes: ["JR山手線"], // closed-loop geometry
        minHubStations: 1, // ≥1 station with ≥2 routes
        expectColoredRoutes: ["JR山手線", "東急東横線"], // non-fallback color set
    },
    // other asia-japan-* regions: minHubStations only, until curated
};
```

### Check kinds (all cheap, all structural)

1. **Exact station route count** — `routeIds(name).size === expected`
   (already present; surface "STATION MISSING" when 0). Catches through-service
   leakage and dropped lines.
2. **No duplicate canonical line per station** — no station has two routeIds
   resolving to the same `op|lineNameKey`. The structural version of #1 that
   doesn't need a curated name list — run it on **every** station, every region.
3. **Shared-edge presence** — named station pairs share ≥1 routeId (already
   present). Guards the 目黒↔白金台 through-running edge.
4. **Ring-route topology** — for each `ringRoutes` name, find the route and
   assert its geometry is a closed loop: first coord ≈ last coord of the
   stitched line within ~150 m (great-circle), OR the line's ordered member
   stations form a cycle (first station adjacent to last). Yamanote (山手線),
   Osaka Loop (大阪環状線) are the obvious cases. Cheap coordinate compare on the
   already-built geometry.
5. **Colored-route presence** — each `expectColoredRoutes` name exists with a
   `color` that is **not** the preset `defaultColor` (`#1f6f78`) — catches the
   "Tōyoko fell back to HSL/default" regression.
6. **Generic Japan floor** — `minHubStations` ≥ 1 station with ≥2 routes
   (already present) confirms the PTv2 service layer attached at all.

### Implementation notes

- Build the `name → Set<routeId>` and `routeId → {name, color, geometry}` maps
  once, reuse across all checks.
- Ring check helper: `isClosedLoop(geometry, toleranceMeters = 150)` over a
  MultiLineString — concat segments, compare global first/last endpoints (and/or
  detect any segment whose own ends coincide). Keep it planar+haversine, no turf.
- Regions absent from `REGION_INVARIANTS` run only the generic floor (#2, #6) —
  zero curation cost, still catches gross breakage everywhere.

### Tests for the smoke tests

- A `pack-lint.test.mjs` (node --test) feeding a **synthetic** `transit.json`:
    - a station with two routeIds of the same canonical key → #2 fails;
    - a non-closed line listed in `ringRoutes` → #4 fails; a closed one → passes;
    - a route at `defaultColor` listed in `expectColoredRoutes` → #5 fails.
- These make the gate itself regression-safe and run in **CI** (they don't build
  a pack — they assert the linter logic against fixtures), unlike the gate's
  real-artifact pass.

## Open questions

- **Drop vs demote for confident through-services.** Design says drop (cleaner:
  removes count + route-list + geometry dup). Confirm we're OK losing the
  through-service's _name_ from the preset route list entirely (it's redundant
  with the physical lines). If we want to keep names visible, demote instead.
- **Threshold default.** 0.9 is a guess; calibrate against Kantō + one European
  pack (e.g. `europe-ile-de-france`) in the data-viewer before locking.
- **GTFS path unaffected** — this is OSM-only; Japan GTFS (if re-enabled) uses
  single-operator `agency_name`.

# Train Route Data Spec

## Background

The transit pipeline extracts train route geometry and station data from two
sources: **GTFS feeds** (for operators that publish them, e.g. Tokyo Metro) and
**OSM route relations** (for everything else). The output is a JSON bundle per
region (`assets/transit/*.json`) consumed by the app's hiding-zone system and
the bundle viewer.

During development we hit several classes of data bugs — most traced back to
OSM relation quality, but some exposed pipeline assumptions that didn't hold for
real-world data.

### Problem 1 — Invalid color values

OSM route relations frequently use CSS color names (`colour=red`,
`colour=DeepSkyBlue`) instead of hex codes. The pipeline prepended `#` but
never validated, producing strings like `#red` that MapLibre silently rejects.
The renderer fell back to gray `#888`, making major lines (e.g. 湘南新宿ライン,
京浜急行) indistinguishable from unlabeled segments.

**Fix applied**: validate against `/^#[0-9a-fA-F]{3,8}$/`; drop invalid values
so the preset's `defaultColor` takes over.

### Problem 2 — Branch interleaving on route_masters

A `route_master` groups multiple directional variants (e.g. northbound,
southbound, branch A, branch B). The pipeline originally merged stops from
**all** variants into one `Set`, then built a single polyline. For routes with
multiple branches — like 湘南新宿ライン (Utsunomiya, Takasaki, Yokosuka,
Narita Express variants) — this interleaved stops from unrelated branches,
producing straight-line jumps of 60–470 km between non-sequential stations.

**Fix applied**: process each variant independently, building one ordered
LineString per variant. The output MultiLineString contains separate segments
per branch.

### Problem 3 — Misordered stop members in OSM relations

Some standalone route relations have stop members in the wrong order. The
Hanzomon–Den-en-toshi–Tobu through-service (`relation:12185878`) has 57 stops:
the first 56 run correctly south from 南栗橋 to 中央林間, but the 57th is 春日部
(62.6 km back north) — added at the end of the member list instead of its
correct position (~18th). The pipeline faithfully reproduces this as a 62.6 km
straight-line jump.

The root cause is that while OSM route relations often store station nodes
in order, they don't **always** do so. OSM is an approximation of reality, and
when the data doesn't reflect the actual physical order of stations on the
line, reality should take precedence. When member order produces an
implausible jump, the pipeline should repair the order so that each stop's
previous/next neighbors in the sequence are its physical neighbors on the
line — by minimally reinserting the outlier stop(s), not by re-sorting the
whole route.

### Problem 4 — Stop positions vs. station nodes

OSM route relations reference `stop_position` nodes (on the tracks), not
`railway=station` nodes (the tagged station record). The pipeline uses a
spatial fallback to match stop positions to nearby station records. This works
well when the station cache has a nearby record, but can silently produce wrong
matches when:

- Multiple station records exist for the same physical complex
- The stop_position is far from any cached station (e.g. rural halts)
- The station cache is incomplete

### Problem 5 — Geometry is a rough polyline, not the actual track

The pipeline builds route geometry from stop-to-stop straight lines, not from
the actual OSM way members that trace the physical track. For routes that follow
curved or non-straight paths (riverside lines, mountain passes, subway curves),
the rendered line cuts across blocks and waterways instead of following the
real alignment. The way members are present in the OSM relation but not used.

---

## Spec

### What a route represents

A **route** is a named, colored train/subway line that a passenger can ride
from one end to the other. It may have branches (e.g. express vs. local
variants that share a trunk but diverge at the ends). Each branch is a
**segment**.

### Geometry rules

1. **One segment per branch.** A route with N branches produces N LineStrings
   in a MultiLineString. A route with no branches (simple A→B line) produces
   one LineString. The renderer draws each segment independently — no
   straight-line jumps between unrelated branches.

2. **Edges connect adjacent stops on the same line.** Each LineString vertex
   should represent a stop that is a direct, sequential neighbor on the same
   branch. A stop at index _i_ and stop at index _i+1_ must be **physically
   adjacent** on the same track — no skipping intermediate stations, no jumping
   between branches.

3. **Vertices follow the track, not straight lines.** Where possible, geometry
   should follow the actual rail alignment (from OSM way members) rather than
   drawing straight lines between stations. This matters for curved sections,
   riverbank alignments, and underground segments that don't follow streets.
   A straight-line approximation is acceptable as a fallback when way geometry
   is unavailable, but the vertex density should be high enough that the
   approximation is visually close to the real path.

4. **No degenerate segments.** A segment with fewer than 2 distinct
   coordinates is dropped. Consecutive duplicate coordinates (from multiple
   station records at the same location) are collapsed.

### Station rules

1. **Stations belong to a route by membership**, not by spatial proximity. A
   station is part of a route if and only if it appears as a stop member in the
   route's OSM relation (or GTFS stop_times). Spatial fallback is only used
   when the referenced node ID doesn't match a cached station record.

2. **Station order follows reality, not OSM member order.** The sequence of
   stations on a branch must match the actual physical order along the line.
   OSM relation member order is used as a starting hint, but reality takes
   precedence: if the OSM data has misordered members (e.g. a stop appended at
   the end of the list instead of its correct position mid-route), the pipeline
   should correct the order rather than reproducing the error. For GTFS sources,
   `stop_times` sequence is authoritative. For OSM sources, the correctness
   criterion is **adjacency**: each stop's previous/next neighbors in the
   sequence must be its physical neighbors on the line. A jump is implausible
   when the gap is large both absolutely and relative to the variant's own
   spacing (e.g. `gap > max(20 km, 4 × median inter-stop gap)` — the relative
   test avoids false positives on limited-express variants that legitimately
   skip stations). The repair is minimal reinsertion of the outlier stop(s),
   accepted only when it eliminates the flagged gap and reduces total path
   length. The pipeline must not re-derive a whole route's order geometrically
   (e.g. by sorting along a projection axis) — that breaks on loop and
   horseshoe routes (山手線, 大江戸線, 武蔵野線).

3. **Internal consistency matters most.** A route and its branches must use a
   consistent, coherent set of stations. If a station appears on one branch it
   should resolve to the same record throughout that route's data — no mixing
   resolved and unresolved records for the same stop.

4. **Cross-source merging.** When the same station appears in both GTFS and OSM
   data for the same line and operator, records are merged into a single
   station. This is the primary use case for merging — combining two data
   sources that describe the same physical stop.

5. **Cross-operator merging is optional.** Stations shared by different
   operators (e.g. JR東京 and Tokyo Metro東京) may be merged or kept separate,
   depending on what produces cleaner or more accurate data for the use case.
   The app merges by `mergeKey` for rendering concentric rings; the pipeline
   doesn't enforce one approach.

### Color rules

1. **Hex only.** Route colors must be valid 3–8 digit hex (`#RGB` through
   `#RRGGBBAA`). CSS color names, named colors, and non-hex strings are
   dropped.

2. **Fallback chain**: route `colour` tag → preset `defaultColor` → gray
   (`#888888`). Invalid intermediate values are skipped, not passed through.

### Data quality expectations

The pipeline should **not** silently fix OSM data errors (missing stations,
wrong positions). It should:

- Preserve the data as-is so errors are visible in the bundle viewer
- Log warnings during bundle build for suspicious patterns (e.g. an inter-stop
  gap that is both > 20 km and far above the variant's median gap). Warnings
  surface at
  build time so they can lead to one of two outcomes:
    1. A **systematic fix** in the pipeline (e.g. the color validation and
       branch separation we already shipped, or the outlier-reinsertion repair
       specced here)
    2. An **explicit exception** recorded in a config file (e.g. "this relation
       has a known misordered stop, skip the warning") — a controlled override
       when the data can't be fixed upstream
- Rely on upstream OSM edits for corrections where possible

The pipeline **should** correct:

- **Misordered stops**: when the implausible-jump check flags a variant,
  minimally reinsert the outlier stop(s) so that consecutive stops are
  physically adjacent, accepting the repair only when it eliminates the flagged
  gap and reduces total path length. Repairs are capped at ~3 outliers per
  variant; beyond that the variant is treated as un-repairable. Orders this
  repair cannot fix (reversed blocks, wholesale shuffles) are left as-is with
  a warning. Detection runs on both sources, but only OSM-sourced sequences
  are ever reordered — a flagged GTFS variant signals a feed or parsing bug,
  not data to fix. OSM is an approximation of reality; reality takes
  precedence.
- **CSS color name → hex normalization**: purely a format issue, not a data
  error.
- **Branch separation**: correct interpretation of route_master semantics.
- **Duplicate coordinate collapsing**: artifact of stop_position + station node
  pairs.

---

## Implementation Plan

Status of the problem classes:

| Problem                      | Status                                    |
| ---------------------------- | ----------------------------------------- |
| 1 — Invalid color values     | ✅ Fixed (`osmRoutes.mjs` hex validation) |
| 2 — Branch interleaving      | ✅ Fixed (per-variant LineStrings)        |
| 3 — Misordered stop members  | ✅ Shipped (Task 1 — detection + repair)  |
| 4 — Stop position resolution | ✅ Shipped (Task 3 — audit logging)       |
| 5 — Rough polyline geometry  | 📋 Task 4 below (future)                  |

### Task 1 — Stop-order detection + repair (Problem 3)

Design decisions (settled):

- **Trigger-gated**: repair runs only when the implausible-jump check flags a
  variant; OSM member order is trusted otherwise.
- **Detection**: per-variant, a gap is implausible when
  `gap > max(20 km, 4 × median inter-stop gap)`.
- **Repair**: cheapest reinsertion of outlier stops only — candidates are the
  stops adjacent to a flagged gap; try removing each and reinserting at the
  position that minimizes total path length. Never re-sort the whole variant.
- **Acceptance**: keep a repair only if it eliminates the flagged gap and
  strictly reduces total path length; otherwise keep the original order.
- **Cap**: at most ~3 repairs per variant, then treat as un-repairable.
- **Scope**: detection runs on OSM and GTFS variants; repair applies to OSM
  only (a flagged GTFS sequence signals a feed/parsing bug).
- **Visibility**: warn-only — build-time log per detection and per
  repair/rejection; no bundle-format change.

Steps:

1. New module `data/transit/scripts/lib/stopOrderRepair.mjs`:
   `detectImplausibleJumps(coordsOrStops)` and
   `repairStopOrder(stops, { maxRepairs })` returning
   `{ stops, repaired, warnings }`.
2. Node --test suite `stopOrderRepair.test.mjs`. Fixtures:
    - relation `12185878` (春日部 appended at end of 57 stops) → repaired to
      position ~18, flagged gap eliminated;
    - a loop-route sequence (山手線-like) → no detection, untouched;
    - a limited-express variant with uniformly long gaps → no detection;
    - a reversed mid-route block → detected, repair rejected by the acceptance
      gate, original order preserved, warning emitted;
    - an already-correct route force-fed to the repairer → reinsertion finds no
      improvement, order unchanged.
3. Wire into `osmRoutes.mjs` after per-variant stop resolution
   (`variantStationIds`, before the LineString coords are built). Run the same
   detection over GTFS-derived sequences in `gtfs.mjs` as warn-only.
4. Surface counts in the build stats/report (`detectedJumps`, `repairedStops`,
   `unrepairableVariants`).
5. Regenerate bundles (`pnpm data:transit -- --cache-only`), review the build
   warnings and the diff in the bundle viewer (`tools/data-viewer`), commit
   regenerated bundles. The first regeneration doubles as the wild-data audit:
   the warning log shows how many flagged variants are single-stop-fixable vs
   reversed-block/shuffled.

### Task 2 — Per-relation exception config (escape hatch)

For relations the repair can't fix and upstream OSM edits haven't propagated:

1. Add an `overrides` section to `data/transit/config.yaml`: relation ID →
   `suppressJumpWarning: true` and/or an explicit stop-order list.
2. Apply overrides before detection in `osmRoutes.mjs`; warn if an override no
   longer matches the data (stale override).
3. Document the workflow in `PLAYBOOK.md` (when to override vs fix upstream).

Do this after Task 1's first regeneration — the warning audit tells us whether
any relation actually needs it.

### Task 3 — Stop-position resolution audit (Problem 4)

Observe before fixing; the failure mode is _silent_ wrong matches.

1. Log ambiguous spatial fallbacks in `osmRoutes.mjs`: more than one station
   within range with near-equal effective distance, or a best match near
   `maxDist`.
2. Count per-bundle `unresolvedStops` and ambiguous matches in the report.
3. Decide per pattern: tighten the penalty model, extend the station cache, or
   record an override (Task 2 machinery).

### Task 4 — Track-way geometry (Problem 5, future)

Use OSM way members so segments follow the real alignment:

1. Assemble each variant's way members into a continuous track polyline
   (handle unordered ways, gaps, per-direction duplicates).
2. Project stops onto the polyline; order by arc-length. This **replaces**
   Task 1's reinsertion repair (adjacency holds by construction, loops and
   horseshoes included) — Task 1's detection survives as a validation pass.
   A stop projecting far off-track is also a Problem 4 wrong-match signal.
3. Keep stop-to-stop straight lines as the fallback when way assembly fails;
   emit which geometry source each segment used in the build report.
4. Watch bundle size — way geometry is much denser than stop-to-stop lines;
   may need simplification (e.g. Douglas-Peucker) to stay within budget.

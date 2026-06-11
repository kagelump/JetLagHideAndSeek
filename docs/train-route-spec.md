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
line, reality should take precedence. The pipeline should sort stations
geographically along the route axis when member order produces implausible
jumps.

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
   `stop_times` sequence is authoritative. For OSM sources, geographic sorting
   along the route axis is the fallback when member order produces implausible
   jumps (e.g. > 20 km between consecutive stops on a non-Shinkansen route).

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
- Log warnings during bundle build for suspicious patterns (e.g. jumps > 20 km
  between consecutive stops on a non-Shinkansen route). Warnings surface at
  build time so they can lead to one of two outcomes:
    1. A **systematic fix** in the pipeline (e.g. the color validation, branch
       separation, and geographic reordering we already shipped)
    2. An **explicit exception** recorded in a config file (e.g. "this relation
       has a known misordered stop, skip the warning") — a controlled override
       when the data can't be fixed upstream
- Rely on upstream OSM edits for corrections where possible

The pipeline **should** correct:

- **Misordered stops**: sort stations geographically along the route axis when
  OSM member order produces implausible jumps. OSM is an approximation of
  reality; reality takes precedence.
- **CSS color name → hex normalization**: purely a format issue, not a data
  error.
- **Branch separation**: correct interpretation of route_master semantics.
- **Duplicate coordinate collapsing**: artifact of stop_position + station node
  pairs.

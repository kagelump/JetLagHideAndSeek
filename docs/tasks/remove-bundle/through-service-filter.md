# Through-Service Route Filter — Handoff

**Date:** 2026-06-14
**Status:** Complete — v2 way-overlap + passenger tiebreaker classifier shipped

## Problem

After the Japan bundle removal (`useRailwayInfrastructure: false`, `wayGeometry: true`),
the transit pipeline processes OSM `route=train`/`route=subway` relations. Japanese OSM
contains **through-service relations** (直通運転) — separate `route_master` entities that
model inter-operator service patterns (trains from one company running through onto
another's tracks). These inflate station route counts.

**Example — 中目黒 (Naka-Meguro):**

| Route                                     | Type                    | Expected?         |
| ----------------------------------------- | ----------------------- | ----------------- |
| 東京メトロ日比谷線 (Hibiya)               | Physical subway line    | ✅                |
| 列車 東急東横線 (Tōyoko)                  | Physical train line     | ✅                |
| 東京地下鉄の直通運転 - 東横線             | Through-service pattern | ❌ inflates count |
| 東京地下鉄の直通運転 - スカイツリーライン | Through-service pattern | ❌ inflates count |

中目黒 shows 4 routes when it should show 2.

## Root cause — OSM tagging conventions

Japanese OSM mappers do two things that interact badly:

**1. Through-service relations exist as separate `route_master` entities.**
These describe where trains go AFTER leaving the line's own tracks. Tags:

```
type=route_master
route_master=train
name=東京地下鉄の直通運転 - 東横線
operator=東急電鉄;東京地下鉄    ← multi-operator (semicolon)
network:metro=東京メトロ直通運転  ← explicit through-service tag
passenger=suburban               ← service pattern, not infrastructure
```

**2. Physical lines have through-running operators appended with `;`.**
The Tōyoko Line's OSM `operator` tag reads `東急電鉄;東京地下鉄` — Tokyu OWNS the
line, but OSM mappers append `;東京地下鉄` because Tokyo Metro trains run through on
Tokyu tracks. This is an annotation convention, not a true multi-operator situation.

## Data analysis — distinguishing signals

For Kanto, inspecting 62 multi-operator route_masters found in the cached OSM data:

| Signal          | Physical line (e.g. Tōyoko)     | Through-service (e.g. 直通運転 Toyoko) |
| --------------- | ------------------------------- | -------------------------------------- |
| `operator`      | `東急電鉄;東京地下鉄`           | `東急電鉄;東京地下鉄`                  |
| `passenger`     | **absent**                      | `suburban`                             |
| `network:metro` | `みなとみらい線` (physical ref) | `東京メトロ直通運転` (through-service) |
| `name`          | `列車 東急東横線`               | `東京地下鉄の直通運転 - 東横線`        |
| `description`   | absent                          | "through service", "bypass line"       |

**`passenger`** is the most general OSM signal — it's a global convention (not
Japan-specific). Values like `suburban`, `regional`, `long_distance`, `local`
indicate a service pattern. Physical infrastructure lines don't use this tag.

## Approach

### What we rejected

- **Filter on name** (直通運転): User requirement — app must work globally, not
  rely on locale-specific name patterns.
- **Drop all `;` operator lines**: Too aggressive. 62 lines had `;` in Kanto, but
  only ~20 are true through-services. The other ~42 are physical lines with
  through-running annotation (e.g. Tōyoko, Tōbu lines, Seibu lines).

### What we're implementing

**Two-signal structural filter using general OSM conventions:**

1. **Clean operator**: When `operator` contains `;`, split and take the first part
   as canonical. This handles the annotation convention (東急電鉄;東京地下鉄 →
   東急電鉄). Does NOT drop the line — just normalizes.

2. **Mark fallback lines**: Lines that were multi-operator AND have a `passenger`
   tag are marked `_fallback = true`. The `passenger` tag signals "service pattern"
   rather than physical infrastructure. This is a global OSM convention.

3. **Two-pass station attachment** (in `attachRoutes.mjs`): Non-fallback lines
   attach routeIds to stations first. Fallback lines only attach to stations that
   still have zero routeIds after pass 1. This means:
    - 中目黒: Hibiya (non-fallback) attaches first → Toyoko through-service
      (fallback) sees existing routeIds → skips → count = 1 ✅
    - 代官山: Only Toyoko physical line serves it → Toyoko (non-fallback) attaches
      → count = 1 ✅
    - A station only covered by through-service relations: fallback kicks in →
      count ≥ 1 ✅

## Files changed

### `data/transit/scripts/lib/osmRoutes.mjs`

1. **`buildLine` call site (line ~152)**: After building a line from a route_master,
   check `tags.passenger` on the master. If operator is multi-value AND passenger
   is set → `line._fallback = true`.

2. **Masterless route build (line ~192)**: Same check for routes without a master.

3. **Multi-operator cleaning block (line ~317)**: After operator gating and inference,
   clean `;`-joined operators to first part. Reports cleaned count and fallback count.

### `data/transit/scripts/lib/attachRoutes.mjs`

1. **`_fallback` typedef**: Added to TransitLine JSDoc.

2. **Two-pass `placeAndAttach`**: Extracted route/preset placement + station
   attachment into a helper with `onlyIfEmpty` parameter. Pass 1: non-fallback
   lines attach unconditionally. Pass 2: fallback lines attach only to stations
   with 0 routeIds.

## Current state

The code compiles and all 191 transit tests pass. Kanto rebuilds with:

- 62 multi-operator lines cleaned
- `passenger`-tagged lines marked `_fallback`
- Fallback lines appear in presets (routes, colors) but their routeIds don't
  inflate station counts

**Pending verification**: Need to rebuild Kanto and actually check station route
counts to confirm the `passenger`-based fallback correctly distinguishes physical
lines from through-services. The key test cases:

| Station        | Expected routes     | Rationale                        |
| -------------- | ------------------- | -------------------------------- |
| 中目黒         | 2 (Hibiya + Tōyoko) | Both are physical, non-fallback  |
| 代官山         | 1 (Tōyoko)          | Tōyoko is physical, non-fallback |
| 広尾           | 1 (Hibiya)          | Hibiya is physical, non-fallback |
| 駒場東大前     | 1 (Inokashira)      | Single-operator line             |
| 目黒 ↔ 白金台 | Edge present        | Shared Mita + Namboku            |

## Open questions

1. **Are there false positives from `passenger`?** Some physical lines might have
   `passenger` tags legitimately (e.g., `passenger=local` on a branch line). Need
   to audit the Kanto data for cases where a physical line has `passenger` set
   but should NOT be fallback.

2. **Are there false negatives?** Some through-services might lack `passenger`
   tags. The `network:metro=東京メトロ直通運転` tag is a more specific signal
   (but Japan-only). Consider a layered approach: `passenger` first, then locale-
   specific signals as fallback.

3. **Does the `passenger` tag appear on non-through-service lines elsewhere?**
   The OSM wiki says `passenger` is used on `route=train` relations for service
   type (local, regional, etc.). In Europe, a regional train line might have
   `passenger=regional` but be a legitimate first-class line. Need to verify
   that `passenger` + multi-operator is globally sufficient.

4. **The GTFS data path is unaffected.** This filter only applies to OSM-sourced
   transit. Japan GTFS data (when/if re-enabled) uses `agency_name` which is
   always single-operator.

## Final implementation (v2, shipped 2026-06-14)

Replaced the v1 `passenger`+`;` heuristic with a **way-overlap classifier +
passenger tiebreaker** in `osmRoutes.mjs` `classifyThroughServices()`:

1. **Capture wayIds** per line during `buildLine` (union across collapsed variants).
2. **Build way→owners index** mapping each OSM way to the set of canonical line
   keys (`op|lineNameKey`) that use it.
3. **Two-signal gate**: a line is a through-service when:

    - Its way overlap ratio ≥ 0.9 (≥90% of its ways shared with other lines), AND
    - It carries the OSM `passenger` tag (suburban, regional, long_distance, local).

    The overlap gate eliminates v1's European false-positive (multi-operator
    regional lines with `passenger` that own unique track → overlap < 0.9).
    The passenger tiebreaker breaks the symmetry between physical lines and
    their through-services (both see each other's ways, but only the through-
    service has `passenger`).

4. **Safety net**: lines whose stations would be stranded by dropping are demoted
   to `_fallback` (gap-fill attachment) instead.
5. **Config**: `throughServiceOverlap` (default 0.9) and `minThroughServiceWays`
   (default 3) in `transitOverrides`, validated in `config.mjs`.
6. **YAML dedup**: Japan `routeColors` extracted to a `&japan_route_colors` anchor
   shared across all 8 `asia-japan-*` regions.

### Kanto rebuild results (2026-06-14)

| Station      | Before       | After                    | Expected | Status |
| ------------ | ------------ | ------------------------ | -------- | ------ |
| 中目黒       | 4 (inflated) | 2 (Hibiya + Tōyoko)      | 2        | ✅     |
| 代官山       | 2 (inflated) | 1 (Tōyoko)               | 1        | ✅     |
| 広尾         | ?            | 1 (Hibiya)               | 1        | ✅     |
| 駒場東大前   | ?            | 1 (Inokashira)           | 1        | ✅     |
| 白金台       | ?            | 2 (Mita + Namboku)       | 2        | ✅     |
| 目黒↔白金台 | ?            | 2 shared (Mita, Namboku) | ≥1       | ✅     |

- 20 through-services dropped (直通運転 lines with passenger tags + way overlap)
- 0 lines demoted to fallback (no station stranding)
- 1 through-service survives (東京地下鉄の直通運転 - 西武有楽町線) — lacks way
  overlap with foreign canonical keys, attaches 4 stations. Non-inflating.

### Known remaining gap

JR shared-track through-services (湘南新宿ライン, JR埼京線, JR成田エクスプレス,
Sotetsu through-service) lack `passenger` tags in OSM and are not classified.
This causes route-count inflation at stations like 原宿 (7 routes vs ~1-2
expected) and 目黒 (9 routes). These are same-operator service patterns over
shared JR track — a different class from the cross-operator 直通運転 relations.
See [[through-service-filter-solution-tasks]] for the way-overlap-only v2
design that would catch these.

## Related

- [[through-service-filter-solution-tasks]] — v2 design doc (way-overlap classifier)
- [[post-removal-regressions]] — parent epic
- [[project_japan_pack_transit_regression]] — memory: Japan transit regressions
- `data/transit/scripts/lib/normalizeOperator.mjs` — `splitOperators` already splits on `;`
- `docs/tasks/offline/18-way-geometry-everywhere.md` — T18 way geometry task

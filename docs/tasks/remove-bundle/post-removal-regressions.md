# Post-Removal Regressions — Findings & Next Steps

**Date:** 2026-06-13
**Context:** After [removing the bundled Japan data](remove-bundled-japan-audit.md)
and serving Tokyo from the `asia-japan-kanto` offline pack, the hiding-zone
transit data regressed badly (missing/wrong edges, wrong colors, wrong route
counts). Separately, the removal series shipped with a **red test suite** (16
tests / 4 suites). This doc root-causes both and lays out the fix.

> **Headline:** the transit regressions are **not** random breakage. They trace
> to a single misconfiguration: all eight `asia-japan-*` packs are built with
> `wayGeometry: false` + `useRailwayInfrastructure: true` — the **exact
> opposite** of what [T18](../offline/18-way-geometry-everywhere.md) prescribes.
> The bundle removal swapped Tokyo from **GTFS** (accurate geometry, official
> colors, correct membership) to **OSM** processed under those two flags. Fix
> the flags, rebuild, republish → the user's hypothesis is right: real route
> geometry resolves the majority of the issues.

---

## Part 1 — Transit / edge regressions

### How the data is built

`asia-japan-kanto` transit comes from [buildTransit.mjs](../../../data/packs/scripts/lib/buildTransit.mjs)
→ `processOsmRoutes` ([osmRoutes.mjs](../../../data/transit/scripts/lib/osmRoutes.mjs))
→ `attachRoutesToPresets` ([attachRoutes.mjs](../../../data/transit/scripts/lib/attachRoutes.mjs)).
The two `transitOverrides` flags in [regions.yaml](../../../data/packs/regions.yaml)
drive the damage:

**`useRailwayInfrastructure: true`** ([osmRoutes.mjs:83-104](../../../data/transit/scripts/lib/osmRoutes.mjs)):

1. **Drops the `route=train` service layer entirely** ("Keeps railway/tracks/
   subway/light_rail/monorail + their masters").
2. **Adds `route=railway` / `route_master=railway` infrastructure relations**
   ([extractOsmRoutes.mjs:96-98](../../../data/transit/scripts/lib/extractOsmRoutes.mjs)).

This is **Taiwan-tuned** — T18 explicitly warns: _"Do not turn that on for other
regions blindly — its train-drop + collapse policy is Taiwan-tuned."_ Japan has
excellent PTv2 `route=train`/`route=subway` coverage; this flag throws the
`route=train` half away and double-counts the rest.

**`wayGeometry: false`** ([osmRoutes.mjs:700](../../../data/transit/scripts/lib/osmRoutes.mjs)):
forces the **stop-position polyline fallback** ([osmRoutes.mjs:736](../../../data/transit/scripts/lib/osmRoutes.mjs))
instead of `stitchWays(...)`. Edges become straight lines between member-station
stop positions, and any station the relation doesn't list as a member gets **no
edge at all**. The track-following machinery + RDP simplification (T18) is fully
implemented and idle.

### Symptom → root cause

| Observed                                                                                                                             | Root cause                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edges don't follow tracks** (everywhere)                                                                                           | `wayGeometry: false` → straight stop-position polylines, not stitched track ways.                                                                                                                                                                                                                                                      |
| **Missing JR/Keio edges** — 原宿 (Yamanote, JR East), 駒場東大前 (Inokashira, Keio) each show 1 route but no/broken edge             | These are `route=train` lines → **dropped** by `useRailwayInfrastructure`. They survive only via `route=railway` infrastructure relations, which carry **way members, not station-node members** → the stop-polyline fallback has no member stations to connect → missing edges.                                                       |
| **Missing 都営三田線 / 南北線 shared edge** — 目黒 shows 1 route (Tokyo Metro), 白金台 shows 都営三田線 (Toei), no edge between them | Meguro↔Shirokanedai is shared Mita (Toei) + Namboku (Tokyo Metro) track with through-service. With train-drop + no way geometry, station→line membership is incomplete: 目黒 never attaches to the Mita line, so the shared edge is absent. Spatial attach along real track (`attachStationsAlongLine`, way geometry) would catch it. |
| **Wrong route counts** — 広尾 shows 2 (should be 1, Hibiya only); 中目黒 shows 3 (should be 2, Tōyoko + Hibiya)                      | `route=subway` service line **plus** an added `route=railway` infrastructure relation for the same physical line → the station's `routeIds` ([attachRoutes.mjs:103-110](../../../data/transit/scripts/lib/attachRoutes.mjs)) gets both → inflated wedge/ring count.                                                                    |
| **Wrong Tōyoko color** (should be red) — 代官山, Tokyu                                                                               | `routeColors: {}` for Japan → color comes from the OSM `colour` tag ([osmRoutes.mjs:424](../../../data/transit/scripts/lib/osmRoutes.mjs)); when absent/invalid it falls to a **deterministic HSL hue** ([resolveLineColor](../../../data/transit/scripts/lib/osmRoutes.mjs)), not the official line color.                            |
| **No major missing stations**                                                                                                        | Station extraction/dedupe is healthy — confirms the problem is purely route/edge/color, all downstream of the two flags.                                                                                                                                                                                                               |

Note: the app-side cross-preset color fix (**T18 "Fix A"**) **is** in place —
`getSelectedStations(selectedPresets, presets)` passes the full bundle for color
resolution ([hidingZone.ts:65-90](../../../src/features/hidingZone/hidingZone.ts),
[hidingZoneStore.tsx:199](../../../src/state/hidingZoneStore.tsx)). So colors are
a **data** problem (empty `routeColors` + missing OSM tags), not an app bug.

### The fix (Part 1)

Reconfigure every `asia-japan-*` block in [regions.yaml](../../../data/packs/regions.yaml):

```yaml
transitOverrides:
    nameSuffixes: ["駅"]
    maxClusterMeters: 150
    # useRailwayInfrastructure: REMOVE (default false) — keep PTv2 route=train/subway
    wayGeometry: true # follow tracks via stitchWays
    simplifyMeters: 11 # RDP — keeps the blob small (T18: Taiwan 330KB→78KB)
    routeColors: # official colors for major lines (see below)
        東急東横線: "#DA0442"
        # … Tokyo Metro / Toei / JR major lines
```

Then per region:

```bash
NODE_OPTIONS=--max-old-space-size=16384 pnpm data:pack -- --region asia-japan-kanto
pnpm data:pack:lint
node tools/data-viewer/server.mjs   # eyeball: edges follow track; counts/colors right
pnpm data:pack:publish -- --region asia-japan-kanto   # uploads blobs, recommits catalog
```

**Validate during rebuild** (the assumption this all rests on): Japan PTv2
`route=train`/`route=subway` relations carry **way members** so `stitchWays`
produces real geometry. The build log prints geometry-point counts and
`transit.json.gz` size — confirm geometry is non-trivial and size is acceptable
(~hundreds of KB for dense Kantō after 11 m RDP; if too big, raise
`simplifyMeters`).

**Color strategy:** prefer OSM `colour` tags (many JP relations have them); add
`routeColors` overrides only for lines that render wrong. A shared
`japanRouteColors` map reused across all eight packs avoids per-region drift.

**Apply to all eight** `asia-japan-*` packs, not just Kantō — same
misconfiguration, same fix, and §coverage below depends on all of them.

---

## Part 2 — Known test failures (16 tests, 4 suites)

`pnpm test` is currently **red on `master`** — pre-existing in the removal
series (the `334e157 test: update tests…` commit missed these). Two causes:

### 2a. Stale expectations after the admin-default flip

- [matchingCategories.test.ts:52](../../../src/features/questions/matching/__tests__/matchingCategories.test.ts) — expects `"2nd Admin Division (OSM level 7)"`, gets level 6.
- [persistence.test.ts:100](../../../src/state/__tests__/persistence.test.ts) — `questionSettings` deep-equality on admin defaults.

The default admin preset correctly flipped `japan → generic` (`[4,6,8,10]`) when
Japan stopped being bundled; the tests weren't updated. **Fix:** update the
expected values to the `generic` preset. Low-risk (behavior is intended per
[AGENTS.md](../../../AGENTS.md) "Admin Division Defaults").

### 2b. Overpass `406` — offline fallback now hits the network

- [playAreaStore.test.tsx](../../../src/state/__tests__/playAreaStore.test.tsx) — "restores a persisted full play-area snapshot on mount."
- [persistence.test.ts](../../../src/state/__tests__/persistence.test.ts) — play-area restore case.
- [poiSearch.perf.test.ts](../../../src/features/questions/matching/__tests__/poiSearch.perf.test.ts) — `park r=10000m` cold.

With bundled Osaka boundary + Kantō POI gone, these resolve through live
Overpass instead of offline, with **no fetch mock** — a violation of the
AGENTS.md rule "keep happy-path unit tests off [Overpass/Photon]." **Fix:** mock
`fetch`/the Overpass module in these suites (extend `jest.setup.ts` so it's done
once), or point fixtures at data resolvable offline. The perf test should either
seed a synthetic registered region or be gated to skip when no bundled POI is
present.

---

## Part 3 — Other coverage regressions to verify

The user's instinct ("big diff, many fundamental things broken") is partly
right — beyond transit, these need an explicit pass:

1. **body-of-water measuring question — REGRESSED in Japan.** All Japan packs
   set `measuringOverrides.body-of-water.enabled: false` (GEOS dissolve
   hard-lock, [15-geos-dissolve-memory.md](../offline/15-geos-dissolve-memory.md)).
   Bundled Japan _had_ it. The measuring "body of water" question now silently
   has no data in Japan. **Action:** confirm the question degrades gracefully
   (no crash, clear empty state) and decide fix-vs-accept.
2. **Admin-division defaults.** Japan play areas now use the `generic` preset
   unless the installed pack's `meta.adminLevels.matching` overrides it. The
   `asia-japan-kanto` pack sets `matching: [4,7,8,9]` — verify that propagates
   via `registerPackAdminLevels` and that Tokyo admin-division questions resolve
   correctly offline (this is also why the Part 2a tests changed).
3. **POI completeness.** Confirm the pack POI extract covers the same categories
   as the deleted `japan-kanto.json` (33,754 features). A thinner extract would
   silently weaken `matching` questions. Cross-check against
   [coverage-baseline.json](../offline/coverage-baseline.json) via the
   [japanParity.test.mjs](../../../data/packs/scripts/lib/japanParity.test.mjs) gate.
4. **First-run placeholder.** Tokyo boundary renders, but with no pack installed
   the map has a play area and **no game data** — confirm questions/hiding-zones
   show a sane "download a pack" state rather than empty/broken UI.

---

## Next steps (prioritized)

1. **[P0] Fix the red suite** (Part 2) — `master` should be green. Quick:
   admin-default expectations + Overpass mocks. ~half a day.
2. **[P0] Reconfigure + rebuild + republish Japan transit packs** (Part 1) —
   `wayGeometry: true`, drop `useRailwayInfrastructure`, add `routeColors`.
   Start with `asia-japan-kanto`, verify in the data-viewer against the user's
   six example stations, then roll to the other seven.
3. **[P1] Add a transit-quality assertion** to the parity gate: for a known
   station set (e.g. 中目黒 → 2 lines, 広尾 → 1, 目黒 ↔ 白金台 edge exists),
   assert route counts + edge presence so this can't silently regress again.
4. **[P1] body-of-water decision** (Part 3.1) — fix the dissolve or formally
   accept the Japan gap + ensure graceful degradation.
5. **[P2] Verify coverage parity** (Part 3.2–3.4) — POI categories, admin
   levels, first-run empty states.

## Verification checklist

```bash
pnpm typecheck && pnpm test          # green after Part 2
pnpm test:data:transit               # geometry/route unit tests
NODE_OPTIONS=--max-old-space-size=16384 pnpm data:pack -- --region asia-japan-kanto
pnpm data:pack:lint
node tools/data-viewer/server.mjs    # the six example stations look right:
#   中目黒 = 2 lines (Tōyoko red + Hibiya), 広尾 = 1 (Hibiya),
#   目黒↔白金台 shared edge present, 原宿/駒場東大前 edges follow track,
#   Tōyoko = red
pnpm data:pack:publish -- --region asia-japan-kanto
```

## Open questions

- Way geometry on for **dense Kantō**: acceptable `transit.json.gz` size after
  11 m RDP? (Measure on first rebuild; raise `simplifyMeters` if needed.)
- Maintain a curated `routeColors` map for major JP lines, or rely on OSM
  `colour` tags + only override the visibly-wrong ones?
- Is the **body-of-water** Japan gap a launch blocker, or accept-with-graceful-
  degradation until the GEOS dissolve fix?

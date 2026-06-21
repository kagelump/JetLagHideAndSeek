# Buglist

# Unprocessed Buglist

- Move search box for play area to very top so that it doesn't get covered.
- Continue should also be on the top right corner
- Hiding zone: If clicking into an operator, the selection should be reflected back as if the operator is selected. In fact the default should be no line is selected, and selecting one line selects the operator.
- Hiding zone: Add Done button on top right inline with back to go back to home
- Home screen: swap out "Seeker" with "add question" and remove the big "add question"
- Matching question - Have tap on POI to see POI name, using same mechnism as tenticle questions

##

- Admin ux needs an overhaul

## Local rulesets

- In SF Bay area, a common game mode is: Allowed transit lines/stations - Everything on rails (BART, MUNI, Caltrain, cablecars, historic streetcars) plus the 38r and 14r bus lines. This requires adding in bus line options.
- Dallas https://docs.google.com/document/d/1ahmznZhiLT6PncF8tASiT7ISJqIrZS4u28yWIiSrB1M/edit?tab=t.0#heading=h.ns0pgnihiy1a

## UI

- Main sheet hero box - # Stations should update to # of stations remaining.

# Processed Buglist

Difficulty: **[E]** easy (≤half day), **[M]** medium (1–2 days), **[H]** hard
(multi-day / needs design). Notes give a starting direction, not a spec.

## Questions - Overall

- **[E]** Set to my location button should be smaller or placed in a better location.
    - Direction: `QuestionLocationSelector` — compact icon button next to the
      coordinate row.
- **[M]** Delta encode bundles docs/tasks/admin-boundaries-delta-encoding.md

## Thermometer

- **[M]** Nice to have: Label on top of the line. Eg <1 km, 1km, 5km, 15km, 75km.
    - Direction: SymbolLayer with `symbolPlacement: line` on the preview
      rings/travel line. Test on iOS — style expressions there are fragile.

## Tentacles

- **[E/M]** Aquarium / Amusement Park overflows weirdly. We should use carousels for category items
    - Direction: `TentaclesQuestionDetailScreen` category grid → horizontal
      `FlatList` carousel.

## Measuring

- Nice logos
- **[E]** Add casting costs to question details
    - Direction: `questionRegistry.ts` already has `cost` strings per type;
      render in `QuestionDetailScreen` header.

---

## Audit findings (2026-06-11)

Correctness issues found in a code audit, ordered by gameplay impact.

### P0 — wrong eliminations

- **[M] Tentacles: no "not within radius" answer.** `derivePoiAnswer` only
  yields `positive`/`unanswered`, and the detail screen only offers POI
  selection or reset. In the game, a hider outside the radius eliminates the
  entire circle. Fix: add a negative answer affordance; in
  `tentaclesGeometry.ts`, when negative, emit the radius circle as the miss
  mask (and skip Voronoi).

### P1 — accuracy of masks

- **[M] Voronoi computed in raw lon/lat is geometrically wrong at 35°N.**
  `@turf/voronoi` bisectors are planar; at Japan latitudes longitude degrees
  are ~0.82× latitude degrees, so cell edges between diagonal neighbors are
  skewed — boundaries can be off by hundreds of meters. Affects matching,
  station-name-length, and tentacles masks. Fix: equirectangular
  pre-projection (scale lon by cos(midLat)) around the candidate centroid
  before `computeVoronoiCells`, unproject the cells after — same trick
  `thermometerGeometry.buildHalfPlane` already uses.

- **[M] Matching Voronoi over a truncated candidate set.** Progressive search
  stops at >10 in-radius candidates (`progressiveSearch.ts`), but Voronoi
  cells are clipped to the whole play-area bbox — fringe cells are massively
  oversized for dense categories. Mostly benign for plain matching (only the
  selected cell is used and its true neighbors are loaded), but
  station-name-length unions _all_ cells, so its masks are unreliable beyond
  the loaded neighborhood. Fix: for name-length, keep expanding until the
  search disk covers the play area (the bundled spatial index makes this
  cheap), or clip the mask to the candidate coverage disk.

- **[E] Radar circles are inscribed 32-gons — up to ~0.5% small.**
  `RADAR.circleSteps = 32`: at 80 km the polygon edge midpoints sit ~385 m
  inside the true circle; ~720 m at 150 km. A hider just inside the real
  circle edge can be wrongly eliminated on a Hit. Fix: scale steps with
  radius (e.g. 64–128 above 10 km) in `radarGeometry.getRadarCircle`; bump
  `RADAR_FRAGMENT_VERSION`.

- **[E] Hiding-zone circles use 12 steps (~3.4% inward error).**
  `HIDING_ZONE.circleSteps = 12` → ~20 m error on a 600 m zone, and these
  polygons feed the eligibility mask and transit-line question masks, not
  just rendering. Fix: bump to 32+ (cost is mitigated by the circle/component
  caches); bump `CIRCLE_ALGORITHM_VERSION`.

- **[E] `clipStationsToPlayArea` under-pads longitude.**
  `hidingZone.ts`: `degPad = radiusMeters / 111320` is applied to both axes;
  at 35°N the east/west pad is ~18% short, so a station just outside the
  bbox edge whose circle still reaches the play area gets dropped. Fix:
  divide the lon pad by `cos(midLat)`.

### P2 — robustness / consistency

- **[E] Tentacles `isSelected` compares `osmId` only.**
  `tentaclesGeometry.ts` poiFeatures: `c.osmId === q.selectedOsmId` ignores
  `osmType`; node/way id collisions mis-highlight. Compare the full
  `osmType/osmId` key (mask logic already does).
- **[M] Tentacles transit-line candidates get synthetic index-based osmIds.**
  `useTentaclesSearch.ts` assigns `osmId: index + 1`; if the station set
  changes (preset toggle, re-search) a persisted/shared `selectedOsmId` can
  silently point at a different station. Use a stable hash of the station id
  instead.
- **[M] Transit-line question masks depend on _current_ hiding-zone
  selection.** `questionGeometry.ts` builds them from `selectedStations`;
  deselecting a preset after answering silently empties/changes an answered
  question's mask (fail-open). Also only the first positive and first
  negative transit-line question render (`.find()`); additional ones are
  ignored. Snapshot the line's stations on the question, and loop over all.
- **[E] Contradictory answers darken the whole play area with no
  explanation.** `buildCombinedEligibilityMask` returns the full play-area
  mask when the intersection of required constraints is empty — correct, but
  silent; usually means a data-entry error. Surface a "no eligible area —
  check answers" banner.

### Pre-existing test failures on master (2026-06-11) — ✅ resolved

Both suites now pass (verified 2026-06-13: `matchingSelectors` +
`lineMeasuringGeometry`, 130 tests green). The commercial-airport selector
expectation was reconciled (military-airfield exclusion, 79b2ae1) and the
body-of-water perf guard was de-flaked (da43936 / 9f03cec).

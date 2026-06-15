# Buglist

# Unprocessed Buglist

## Local rulesets

- In SF Bay area, a common game mode is: Allowed transit lines/stations - Everything on rails (BART, MUNI, Caltrain, cablecars, historic streetcars) plus the 38r and 14r bus lines. This requires adding in bus line options.
- Dallas https://docs.google.com/document/d/1ahmznZhiLT6PncF8tASiT7ISJqIrZS4u28yWIiSrB1M/edit?tab=t.0#heading=h.ns0pgnihiy1a

## UI

- Main sheet hero box - # Stations should update to # of stations remaining.

# Processed Buglist

Difficulty: **[E]** easy (≤half day), **[M]** medium (1–2 days), **[H]** hard
(multi-day / needs design). Notes give a starting direction, not a spec.

## Settings

### Play Area

- ✅ **Done.** Admin level defaults to country of play area.
  `PlayAreaScreen` auto-selects on play-area change: pack-derived levels
  (`findPackForPlayArea` → `buildPackAdminDivisionPack` →
  `setAdminDivisionPack`) first, else geographic preset via `isBboxInJapan`
  (`japan` / `generic`). `AdminDivisionScreen` exposes a Generic/Japan preset
  picker; per-field edits clear the preset name. Shipped in 8a6f46b.
- **[M]** Should automatic find and download offline data pack for the play area (or loudly error if it doesn't exist)
    - 🚧 **Mostly done (T10).** `getCoverageStatus()` computes per-play-area
      coverage (catalog + installed index, persisted bbox for offline
      resilience) and `PlayAreaScreen` now surfaces the download prompt via
      `OfflinePackModal` with dismissed-prompt persistence
      (`dismissedOsmId`). Remaining: Settings/MainDrawer red (!) badge and the
      update-flow UI for stale installed packs. See
      `src/features/offline/coverage.ts` + `PlayAreaScreen.tsx`.

### Hiding zones

## Train lines

- 🚧 **Mostly done.** OSM-based train line (e.g. JR East) geometry.
    - The way-stitching fix landed: `buildLine` in
      `data/transit/scripts/lib/osmRoutes.mjs` now calls `stitchWays`
      (`wayStitch.mjs`) to stitch route-relation member **ways** into ordered
      linestrings (per-variant, deduped, RDP-simplified via
      `simplifyGeometry.mjs`), falling back to stop polylines only when ways
      are missing. Shipped across 97102d8 / d6e02d5 / 872c378.
    - Remaining is conflation quality (see next item): operator
      normalization, duplicate station complexes. Validate per region in the
      data viewer.
- **[M]** Add all of the other Tokyo transit lines, see if we can cover all Japan with some generic way (WIP, has bugs)
    - Status: national expansion landed (8 regional bundles + per-operator
      presets in `assets/transit/`). Remaining bugs are conflation quality:
      operator normalization, duplicate station complexes, and the OSM route
      geometry issue above. Validate per region in the data viewer
      (`tools/data-viewer/`).

### Offline data

- ✅ **Done (gameplay data).** Offline data packs ship. The pipeline
  (`data/packs/`) builds per-Geofabrik-region poi/measuring/boundaries/transit
  artifacts, publishes blobs to GitHub Releases, and the app discovers/installs
  them via the Pages catalog (`site/packs/catalog.json`). 20+ regions live
  (incl. Taiwan, NL, NorCal/SoCal). `loadPlayAreaByRelationId` and admin-level
  defaults resolve from installed packs. Map tiles remain **permanently out of
  scope** (basemap stays live raster + on-device cache).

### Other

## Questions - Overall

- **[E]** Set to my location button should be smaller or placed in a better location.
    - Direction: `QuestionLocationSelector` — compact icon button next to the
      coordinate row.
- **[M]** ~~Tap to set pin should be reversed, tap + hold to set pin instead~~ **(resolved: removed)** — The long-press-on-empty-area-to-place-pin affordance (`onPlace`/`onPlacePin`) was removed entirely (2026-06-15). Pins are now set only via the "Set to My Location" button (or background GPS on creation) and repositioned by long-press dragging. This eliminates gesture conflicts with map scrolling, zooming, and POI taps.
- **[M]** Add some sort of loading / calculating animation when work (masking, etc) is being done.
    - Direction: mask/clip work runs synchronously inside the
      `useQuestionMapRenderState` memo on the JS thread, so a spinner can't
      even paint. Needs the heavy ops (maskBuilder, clipCells, buffers)
      deferred off the render pass (InteractionManager / chunked async) with
      a `isComputing` flag the sheet/map can render.
- **[M]** Delta encode bundles docs/tasks/admin-boundaries-delta-encoding.md

## Thermometer

- **[E]** The two pins should have two different colors
    - Direction: `getQuestionPins.ts` already knows start/end; add a `role`
      property and split filtered layers in `QuestionPinLayer` (literal
      colors — see iOS expression caution in AGENTS.md).
- **[E]** Start/End position sections taking too much verticle space.
    - Direction: `ThermometerQuestionDetailScreen` styles; collapse into one
      row per pin.
- **[M]** Nice to have: Label on top of the line. Eg <1 km, 1km, 5km, 15km, 75km.
    - Direction: SymbolLayer with `symbolPlacement: line` on the preview
      rings/travel line. Test on iOS — style expressions there are fragile.
- **[M]** Even for N/A, it would be nice to have a dotted preview line (chopped at play area)
    - Direction: `thermometerGeometry.ts` already emits the preview line for
      unanswered questions; "chopped at play area" needs a line∩polygon clip
      (reuse `clipLineFeaturesToPlayArea` from measuring).
- **[M]** I think now that we moves to GEOS this render should be cheap, maybe we can render the mask while moving the pin?
    - Direction: recompute on drag-update behind a ~100ms debounce
      (`debounceConfig.ts`); confirm GEOS backend active on device (stale dev
      client silently degrades to JS — see AGENTS.md).

## Tentacles

- **[M]** Must load all POIs in play area
    - Note from audit: the progressive search already returns up to 999
      candidates within 2× the question radius (`unbounded: true`), so the
      in-radius set is effectively complete for sparse categories. If the
      goal is _preloading_ the whole play area for offline/instant use,
      that's a different change: query `bundledPois` columns by play-area
      bbox instead of radius-around-pin (`useTentaclesSearch.ts`).
- **[E/M]** Aquarium / Amusement Park overflows weirdly. We should use carousels for category items
    - Direction: `TentaclesQuestionDetailScreen` category grid → horizontal
      `FlatList` carousel.

## Measuring

## Android Issues

- **[M]** UI flicker when clicking into a menu item
    - Direction: profile `AppBottomSheet` route transitions; suspect full
      drawer re-render on route change. Compare with iOS to rule out
      `react-native-screens`/sheet interaction.
- **[M]** Back button doesn't always seem to work from question deatils sheet (swipe to go back works)
    - Direction: hardware back needs a `BackHandler` hook tied to
      `sheetNav.ts` route stack; check it's registered while a detail route
      is active and returns `true` to swallow the event.
- **[M/H]** Questions -> [Radar|Measuring|Tenticles] Very long delay or just doesn't work
    - Direction from audit: first suspect is the geometry backend — a dev
      client without current `native-geometry` silently falls back to JS
      (one `console.warn` per op) and body-of-water dissolve takes ~25s.
      Check `[geometry]`/`[maskBuilder]` logs on Android; rebuild dev client.
      Second suspect: synchronous mask building blocking the JS thread (same
      fix as the loading-animation item).

## Viewer

- ✅ **Done.** Transit line rendering in the data viewer
  (`tools/data-viewer/lib/transitGeojson.js`, committed; pack POI hover/click
  added in 27b0a02).
- **[E]** Add toggles for bundles (kanto, hokkaido, etc)
- **[M]** Add toggles for turn on layers (also will need to cluster layers, eg POI, etc)

## Extra Polish

- Nice logos
- **[E]** Add casting costs to question details
    - Direction: `questionRegistry.ts` already has `cost` strings per type;
      render in `QuestionDetailScreen` header.

---

## Audit findings (2026-06-11)

Correctness issues found in a code audit, ordered by gameplay impact.

### P0 — wrong eliminations

- ✅ **Fixed. Station-name-length negative answer.**
  `osmMatchingGeometry.ts` now pushes the name-length `hitMask` (matching
  cells) into `missFeatures` on a negative answer, correctly excluding the
  cells that match the seeker's name length.

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

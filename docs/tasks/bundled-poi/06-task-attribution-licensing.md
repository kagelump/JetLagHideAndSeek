# Task 06 — Attribution & Licensing Surface

**Epic:** [Bundled Offline POIs](epic.md)
**Phase:** 1 (MVP)
**Status:** Not started
**Depends on:** 02 (bundle carries an `attribution` block)
**Blocks:** Phase 1 ship (must land before bundled data ships to users)

## Objective

Ship the bundled OSM POI data in compliance with the ODbL: carry attribution metadata in
the data, surface OpenStreetMap / Geofabrik attribution and the ODbL notice in the app UI,
and document provenance + update cadence. Bundling **derived** OSM data triggers ODbL
attribution and share-alike obligations beyond the existing map-tile attribution.

## Context

- OSM data is © OpenStreetMap contributors under
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/). Geofabrik extracts inherit it.
- The map already shows `"© OpenStreetMap contributors"` for **tiles** via
  [`src/features/map/mapStyle.ts:13`](../../../src/features/map/mapStyle.ts). Bundling POI
  _data_ is a separate, stronger obligation (share-alike on the data itself).
- Attribution text already exists in two places to reuse/align:
    - [`data/geofabrik/scripts/fetch-geofabrik.mjs:15`](../../../data/geofabrik/scripts/fetch-geofabrik.mjs)
      (`attribution` object).
    - [`data/geofabrik/NOTICE.md`](../../../data/geofabrik/NOTICE.md).
- The app has a [`SettingsScreen.tsx`](../../../src/features/sheet/SettingsScreen.tsx)
  reachable from `MainDrawer.tsx` — the natural home for an "About / Data & Licenses"
  section.

## Files to create / modify

**Modify:**

- `src/features/sheet/SettingsScreen.tsx` — add a "Data & Attribution" section (or a linked
  sub-screen) listing OSM/ODbL/Geofabrik attribution and the bundled-data build date.
- `data/geofabrik/NOTICE.md` — add a section explicitly covering the bundled POI artifact
  (`assets/poi/*.json`), not just boundaries.

**Create (if a dedicated screen is preferred over an inline section):**

- `src/features/sheet/DataAttributionScreen.tsx` + route registration.

**Verify:**

- Task 02 writes an `attribution` block into each `assets/poi/<regionId>.json` and the
  app reads `generatedAt` for display.

## Implementation

### 1. Attribution constant

Centralize the strings so data and UI cannot drift:

```ts
// src/features/questions/matching/poiAttribution.ts (or a shared location)
export const POI_DATA_ATTRIBUTION = {
    text: "Place data © OpenStreetMap contributors, available under the Open Database License (ODbL). Extracted via Geofabrik.",
    osmCopyrightUrl: "https://www.openstreetmap.org/copyright",
    odblUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    geofabrikUrl: "https://download.geofabrik.de/",
} as const;
```

### 2. Settings UI

Add a section to `SettingsScreen.tsx` following its existing row/section styling:

- Heading: "Data & Attribution".
- Body: `POI_DATA_ATTRIBUTION.text`.
- Tappable links (use the app's existing link/`Linking.openURL` pattern — check how other
  external links are opened in the codebase) to the OSM copyright page, ODbL, and Geofabrik.
- A line showing the bundled data build date: read `getRegionGeneratedAt("japan-kanto")`
  (task 03) or the `regions.json` `generatedAt`, formatted (e.g. "Offline place data:
  Kantō, built 2026-06-01").
- A short share-alike note: derived/redistributed OSM data remains under ODbL.

### 3. NOTICE.md

Add a subsection documenting:

- The bundled artifact path(s) (`assets/poi/*.json`) and that they are **derived** from the
  Geofabrik PBF extracts.
- The exact transformation (tag filter → centroid reduction → named-only) so downstream
  redistributors understand what the data is.
- ODbL share-alike statement and the build/update cadence (bundle refreshes per app
  release; runtime SWR refresh after 90 days online).

## Edge cases

- Keep the **tile** attribution (`mapStyle.ts`) as-is — it covers the basemap. This task
  adds **data** attribution; both must be present.
- If the bundle is absent (e.g. a build that excludes it), the Settings section should
  still render the general OSM attribution and simply omit the build-date line.

## Testing

- A render test for `SettingsScreen` (or `DataAttributionScreen`) asserting the OSM/ODbL
  attribution text and links are present. Follow existing screen test patterns (e.g.
  `OsmMatchingQuestionDetailScreen.test.tsx`).
- A test asserting the bundle artifact (or its fixture) contains a non-empty `attribution`
  block (guards task 02 output).
- Lint/format pass.

## Acceptance criteria

- [ ] Settings shows OSM + ODbL + Geofabrik attribution and the bundled data build date.
- [ ] External links open the OSM copyright, ODbL, and Geofabrik pages.
- [ ] `NOTICE.md` documents the bundled POI artifact and ODbL share-alike.
- [ ] Tests + `pnpm check` pass.

## Out of scope

- Per-feature attribution (not required by ODbL for this use).
- Legal review of share-alike for any future commercial redistribution (flag to the owner
  if relevant; not an engineering task).

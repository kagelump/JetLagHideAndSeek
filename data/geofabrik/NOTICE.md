# Geofabrik Data Notice

This directory contains processed OpenStreetMap data derived from Geofabrik
regional extracts.

## Attribution

OpenStreetMap data is © OpenStreetMap contributors and licensed under the
Open Database License (ODbL) 1.0.

Geofabrik extracts are provided by Geofabrik GmbH. When using, displaying, or
redistributing the processed data in this directory, include attribution to
both OpenStreetMap contributors and Geofabrik.

Suggested attribution text:

> Map data © OpenStreetMap contributors. Data available under the Open Database
> License (ODbL) from https://www.openstreetmap.org/copyright. Geofabrik extract
> from https://download.geofabrik.de/.

## License

OpenStreetMap data is made available under the Open Database License
(https://opendatacommons.org/licenses/odbl/1.0/). Any rights in individual
contents of the database are licensed under the Database Contents License
(https://opendatacommons.org/licenses/dbcl/1.0/).

## Bundled POI Data

The `assets/poi/*.json` files shipped in the app binary are **derived** from
Geofabrik regional PBF extracts. They are produced by the `--bundle` stage of
the Geofabrik pipeline (`data/geofabrik/scripts/fetch-geofabrik.mjs`).

**Transformation applied:**

1. Tag-filter the PBF to the exact `key=value` selectors from the POI selector
   registry (`data/geofabrik/poi-selectors.json`, generated from
   `src/features/questions/matching/matchingSelectors.ts`).
2. Collapse ways and relations to a single centroid per feature (analogous to
   Overpass's `out center`).
3. Keep only named features (unnamed features are dropped).
4. Store as per-category columnar JSON (parallel `lon[]`, `lat[]`, `name[]`,
   `osmId[]`, `osmType[]` arrays) with 6-decimal coordinate precision.
5. For `station-name-length` features, precompute the English display name
   (`name:en` || `name`) and character length.

**License:** These derived artifacts remain under the **ODbL 1.0**
(share-alike). Any redistribution of the app binary that includes them must
comply with ODbL terms.

**Update cadence:** The bundle is refreshed per app release via
`pnpm data:geofabrik:bundle`. At runtime, locally-served cells are stamped with
the bundle's `generatedAt` timestamp. If the bundle is older than 90 days (the
matching cache TTL), a stale-while-revalidate background refresh fetches fresh
data from Overpass when the device is online.

## Sources

See [sources.md](./sources.md) for the specific Geofabrik download URLs used.

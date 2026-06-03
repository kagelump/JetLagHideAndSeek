/**
 * Centralized attribution strings for bundled OSM POI data.
 *
 * OpenStreetMap data is © OpenStreetMap contributors under ODbL 1.0.
 * Geofabrik extracts inherit the same license.
 *
 * These strings are used both in the data artifacts (task 02) and in
 * the in-app attribution UI (task 06).
 */
export const POI_DATA_ATTRIBUTION = {
    text: "Place data © OpenStreetMap contributors, available under the Open Database License (ODbL). Extracted via Geofabrik.",
    osmCopyrightUrl: "https://www.openstreetmap.org/copyright",
    odblUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    geofabrikUrl: "https://download.geofabrik.de/",
} as const;

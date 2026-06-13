/**
 * Builds the bundle-viewer static site into site/bundle-viewer/.
 *
 * Reads measuring bundles, default zones, and POI data from the repo,
 * converts them to standard GeoJSON FeatureCollections, and writes
 * everything into the Pages output directory.
 */
import { mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, "site/bundle-viewer");
const DATA_OUT = join(OUT, "data");

function readJson(relPath) {
    return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

function writeJson(name, data) {
    writeFileSync(join(DATA_OUT, name), JSON.stringify(data));
}

// --- Measuring bundles ---
const MEASURING = [
    "coastline",
    "high-speed-rail",
    "body-of-water",
    "admin-1st-border",
    "admin-2nd-border",
];

mkdirSync(join(DATA_OUT, "measuring"), { recursive: true });

for (const category of MEASURING) {
    const data = readJson(`assets/measuring/${category}.json`);
    writeJson(`measuring/${category}.json`, {
        type: "FeatureCollection",
        features: data.features ?? [],
    });
    console.log(
        `  measuring/${category}.json — ${(data.features ?? []).length} features`,
    );
}

// --- Default zones ---
mkdirSync(join(DATA_OUT, "zones"), { recursive: true });

const tokyo = readJson("assets/default-zones/tokyo.json");
const osaka = readJson("assets/default-zones/osaka.json");
writeJson("zones/default.json", {
    type: "FeatureCollection",
    features: [...(tokyo.features ?? []), ...(osaka.features ?? [])],
});
console.log(
    `  zones/default.json — ${tokyo.features.length + osaka.features.length} features`,
);

// --- POIs (columnar → GeoJSON) ---
const columnarToGeojson = require("./lib/columnarToGeojson.js");

mkdirSync(join(DATA_OUT, "poi"), { recursive: true });

const poiData = readJson("assets/poi/japan-kanto.json");
const poiFeatures = columnarToGeojson.allCategoriesToFeatures(poiData);
writeJson("poi/japan-kanto.json", poiFeatures);
console.log(`  poi/japan-kanto.json — ${poiFeatures.features.length} features`);

// --- Transit routes & stations ---
const transitGeojson = require("./lib/transitGeojson.js");

mkdirSync(join(DATA_OUT, "transit"), { recursive: true });

const transitBundle = readJson("assets/transit/japan-kanto.json");
const presets = transitBundle.presets ?? [];

const routeFeatures = transitGeojson.buildRouteFeatureCollection(presets);
writeJson("transit/routes.json", routeFeatures);
console.log(
    `  transit/routes.json — ${routeFeatures.features.length} features`,
);

const mergedStations = transitGeojson.getSelectedStations(presets);
const allWedges =
    transitGeojson.buildAllWedgeFeatureCollections(mergedStations);
writeJson("transit/stations.json", allWedges);
console.log(
    `  transit/stations.json — large: ${allWedges.large.features.length}, medium: ${allWedges.medium.features.length}, small: ${allWedges.small.features.length} features (${mergedStations.length} stations)`,
);

// --- HTML ---
cpSync(join(import.meta.dirname, "index-static.html"), join(OUT, "index.html"));
console.log(`  index.html`);

// --- Shared lib scripts ---
cpSync(join(import.meta.dirname, "lib"), join(OUT, "lib"), { recursive: true });
console.log(`  lib/`);

console.log(`\nBuilt to ${OUT}`);

/**
 * Builds the bundle-viewer static site into site/bundle-viewer/.
 *
 * Reads measuring bundles, default zones, and POI data from the repo,
 * converts them to standard GeoJSON FeatureCollections, and writes
 * everything into the Pages output directory.
 */
import { mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";

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
  console.log(`  measuring/${category}.json — ${(data.features ?? []).length} features`);
}

// --- Default zones ---
mkdirSync(join(DATA_OUT, "zones"), { recursive: true });

const tokyo = readJson("assets/default-zones/tokyo.json");
const osaka = readJson("assets/default-zones/osaka.json");
writeJson("zones/default.json", {
  type: "FeatureCollection",
  features: [...(tokyo.features ?? []), ...(osaka.features ?? [])],
});
console.log(`  zones/default.json — ${tokyo.features.length + osaka.features.length} features`);

// --- POIs (columnar → GeoJSON) ---
mkdirSync(join(DATA_OUT, "poi"), { recursive: true });

const poiData = readJson("assets/poi/japan-kanto.json");
const poiFeatures = [];
for (const [category, cat] of Object.entries(poiData.categories)) {
  for (let i = 0; i < cat.count; i++) {
    poiFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cat.lon[i], cat.lat[i]] },
      properties: {
        category,
        name: cat.name[i] ?? null,
        osmId: cat.osmId[i] ?? null,
        osmType: cat.osmType[i] ?? null,
        ...(cat.iata ? { iata: cat.iata[i] ?? null } : {}),
        ...(cat.nameLength ? { nameLength: cat.nameLength[i] ?? null } : {}),
      },
    });
  }
}
writeJson("poi/japan-kanto.json", { type: "FeatureCollection", features: poiFeatures });
console.log(`  poi/japan-kanto.json — ${poiFeatures.length} features`);

// --- HTML ---
cpSync(join(import.meta.dirname, "index-static.html"), join(OUT, "index.html"));
console.log(`  index.html`);

console.log(`\nBuilt to ${OUT}`);

/**
 * Builds the bundle-viewer static site into site/bundle-viewer/.
 *
 * Reads the default zone placeholder from the repo, copies the viewer
 * HTML and shared libraries, and writes everything into the Pages output
 * directory. All gameplay data (POI, measuring, transit) now lives in
 * downloadable offline packs and is inspected via drag-drop or the local
 * server with --pack <dir>.
 */
import {
    mkdirSync,
    readFileSync,
    writeFileSync,
    cpSync,
    rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, "site/bundle-viewer");
const DATA_OUT = join(OUT, "data");

// Clean stale bundled-data artifacts from previous builds.
rmSync(OUT, { recursive: true, force: true });

function readJson(relPath) {
    return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

function writeJson(name, data) {
    writeFileSync(join(DATA_OUT, name), JSON.stringify(data));
}

// --- Default zones ---
mkdirSync(join(DATA_OUT, "zones"), { recursive: true });

const tokyo = readJson("assets/default-zones/tokyo.json");
writeJson("zones/default.json", {
    type: "FeatureCollection",
    features: [...(tokyo.features ?? [])],
});
console.log(`  zones/default.json — ${tokyo.features.length} features`);

// --- HTML ---
cpSync(join(import.meta.dirname, "index-static.html"), join(OUT, "index.html"));
console.log(`  index.html`);

// --- Shared lib scripts ---
cpSync(join(import.meta.dirname, "lib"), join(OUT, "lib"), { recursive: true });
console.log(`  lib/`);

console.log(`\nBuilt to ${OUT}`);

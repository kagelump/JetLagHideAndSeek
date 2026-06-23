/**
 * Regenerates the committed darkCircleRepro fixtures.
 *
 * `darkCircleRepro.geos.test.ts` reproduces the body-of-water "dark circle"
 * notch near the Meguro-river junction (Nakameguro). It originally read the
 * full Kantō pack measuring artifacts straight out of `data/packs/dist/` —
 * but those blobs are git-ignored and never committed (AGENTS.md → "Offline
 * Pack Rules"), so they're absent in CI and the suite ENOENT'd.
 *
 * Every assertion in that test is LOCAL to the notch (notch coverage, distance
 * to the notch, gap cells within ±150 m). The buffer radius is ~172.5 m, so a
 * generous geographic clip around the seeker + notch preserves all of them
 * while shrinking the body-of-water artifact from ~3.25 MB to ~36 KB — small
 * enough to commit as a deterministic fixture.
 *
 * Source blobs live on a dev machine that has built the pack:
 *   pnpm data:pack -- --region asia-japan-kanto
 *
 * Then regenerate the committed fixtures:
 *   node src/features/questions/measuring/__tests__/__fixtures__/darkCircleRepro/generate.mjs
 */

import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = resolve(
    HERE,
    "../../../../../../../data/packs/dist/asia-japan-kanto",
);

// Seeker [139.6948, 35.64628] and notch [139.701994, 35.642352] sit inside
// this box with a ~5 km margin on every side — ~29× the 172.5 m buffer radius,
// so every feature whose buffer can reach the notch (or the seeker's nearest
// water) is retained.
const CLIP = [139.64, 35.6, 139.76, 35.69];

const inBox = (c) =>
    c[0] >= CLIP[0] && c[0] <= CLIP[2] && c[1] >= CLIP[1] && c[1] <= CLIP[3];

const geometryTouchesBox = (g) => {
    const ringHit = (r) => r.some(inBox);
    switch (g.type) {
        case "Point":
            return inBox(g.coordinates);
        case "LineString":
            return ringHit(g.coordinates);
        case "MultiLineString":
        case "Polygon":
            return g.coordinates.some(ringHit);
        case "MultiPolygon":
            return g.coordinates.some((poly) => poly.some(ringHit));
        default:
            return false;
    }
};

for (const name of ["measuring-body-of-water", "measuring-coastline"]) {
    const src = resolve(PACK_DIR, `${name}.json.gz`);
    const bundle = JSON.parse(gunzipSync(readFileSync(src)).toString());
    const clipped = {
        ...bundle,
        features: bundle.features.filter((f) => geometryTouchesBox(f.geometry)),
    };
    const out = resolve(HERE, `${name.replace("measuring-", "")}.json.gz`);
    const gz = gzipSync(Buffer.from(JSON.stringify(clipped)));
    writeFileSync(out, gz);
    console.log(
        `${name}: kept ${clipped.features.length}/${bundle.features.length} ` +
            `features → ${out} (${(gz.length / 1024).toFixed(1)} KB)`,
    );
}

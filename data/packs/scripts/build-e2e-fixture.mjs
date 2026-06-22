#!/usr/bin/env node
/**
 * Build the committed E2E fixture pack.
 *
 * Intentionally separate from `regions.yaml` / `build-packs.mjs` so the fixture
 * never enters the published catalog or dist directory. It reuses the same
 * artifact builders, producing byte-identical schemas.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildTransitArtifact } from "./lib/buildTransit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const FIXTURE_ID = "e2e-fixture";
const FIXTURE_BBOX = [139.76, 35.68, 139.78, 35.7]; // W,S,E,N — Tokyo Station / Marunouchi
const DEFAULT_SOURCE_PBF = join(
    REPO_ROOT,
    "data",
    "packs",
    "cache",
    "e2e-fixture",
    "e2e-tokyo.osm.pbf",
);
const OUT_DIR = join(REPO_ROOT, "assets", "e2e-fixture", FIXTURE_ID);
const CACHE_DIR = join(REPO_ROOT, "data", "packs", "cache", FIXTURE_ID);

/** Inline fixture config — not part of `regions.yaml`. */
export const fixtureConfig = {
    id: FIXTURE_ID,
    label: "E2E fixture (Tokyo core)",
    bbox: FIXTURE_BBOX,
    transitOverrides: {},
};

/**
 * Convert an absolute path to a repo-relative path for the manifest.
 * Falls back to the original path if it is not inside the repo.
 *
 * @param {string} pbfPath
 * @returns {string}
 */
function repoRelativePbfPath(pbfPath) {
    const rel = relative(REPO_ROOT, pbfPath);
    return rel && !rel.startsWith("..") && !rel.startsWith("/") ? rel : pbfPath;
}

export async function buildE2eFixture({
    pbfPath = DEFAULT_SOURCE_PBF,
    outDir = OUT_DIR,
    cacheDir = CACHE_DIR,
    buildTransit = buildTransitArtifact,
} = {}) {
    await mkdir(cacheDir, { recursive: true });
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    const transitResult = await buildTransit({
        region: fixtureConfig,
        pbfPath,
        distDir: outDir,
        cacheDir,
    });

    if (!transitResult) {
        throw new Error(
            `No transit data found in ${pbfPath}. Check the bbox / clip.`,
        );
    }

    const transitJson = transitResult.uncompressed;
    await writeFile(
        join(outDir, "transit.json"),
        Buffer.concat([transitJson, Buffer.from("\n")]),
    );

    await rm(join(outDir, "transit.json.gz"), { force: true });

    const meta = {
        schemaVersion: 1,
        regionId: FIXTURE_ID,
        label: fixtureConfig.label,
        bbox: FIXTURE_BBOX,
        osmSnapshot: new Date().toISOString().slice(0, 10),
        adminLevels: { matching: [4, 7, 9, 10] }, // Japan preset
        artifacts: ["transit.json"],
        attribution: {
            text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL).",
            license: "ODbL-1.0",
            url: "https://www.openstreetmap.org/copyright",
        },
    };
    const metaJson = JSON.stringify(meta, null, 2);
    await writeFile(join(outDir, "meta.json"), `${metaJson}\n`);

    const manifest = {
        id: FIXTURE_ID,
        sourcePbf: repoRelativePbfPath(pbfPath),
        sourcePbfDate: meta.osmSnapshot,
        bbox: FIXTURE_BBOX,
        version: 1,
        artifacts: {
            "transit.json": {
                sha256: createHash("sha256")
                    .update(transitJson)
                    .update("\n")
                    .digest("hex"),
                bytes: transitJson.length + 1,
                presets: transitResult.presets.length,
                stations: transitResult.presets.reduce(
                    (sum, p) => sum + p.stations.length,
                    0,
                ),
            },
        },
        meta: {
            sha256: createHash("sha256")
                .update(metaJson)
                .update("\n")
                .digest("hex"),
            bytes: Buffer.byteLength(metaJson, "utf8") + 1,
        },
    };
    await writeFile(
        join(outDir, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
    );

    console.log(`Wrote fixture to ${outDir}`);
    console.log(JSON.stringify(manifest, null, 2));
}

function main() {
    const args = process.argv.slice(2);
    const pbfFlag = args.find((a) => a.startsWith("--pbf="));
    const pbfPath = pbfFlag ? pbfFlag.slice("--pbf=".length) : undefined;

    buildE2eFixture({ pbfPath }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main();
}

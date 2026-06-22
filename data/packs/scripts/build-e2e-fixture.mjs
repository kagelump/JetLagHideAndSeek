#!/usr/bin/env node
/**
 * Build the committed E2E fixture pack.
 *
 * Intentionally separate from `regions.yaml` / `build-packs.mjs` so the fixture
 * never enters the published catalog or dist directory. It reuses the same
 * artifact builders, producing byte-identical schemas.
 *
 * Phased artifact enablement:
 *   F1 — transit only
 *   F2 — + measuring (high-speed-rail, body-of-water)
 *   F3 — + boundaries + POI
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
 */
function repoRelativePbfPath(pbfPath) {
    const rel = relative(REPO_ROOT, pbfPath);
    return rel && !rel.startsWith("..") && !rel.startsWith("/") ? rel : pbfPath;
}

/**
 * Build the fixture artifacts.
 *
 * @param {object} [deps]
 * @param {string} [deps.pbfPath] - clipped source PBF
 * @param {string} [deps.outDir] - committed asset output directory
 * @param {string} [deps.cacheDir] - temp cache directory
 * @param {Function} [deps.buildTransit]
 * @param {Function} [deps.buildMeasuring]
 * @param {Function} [deps.buildBoundaries]
 * @param {Function} [deps.buildPoi]
 * @returns {Promise<void>}
 */
export async function buildE2eFixture({
    pbfPath = DEFAULT_SOURCE_PBF,
    outDir = OUT_DIR,
    cacheDir = CACHE_DIR,
    buildTransit = buildTransitArtifact,
    buildMeasuring = null,
    buildBoundaries = null,
    buildPoi = null,
} = {}) {
    await mkdir(cacheDir, { recursive: true });
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    // ── Transit (always built) ────────────────────────────────────────────

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

    const metaArtifacts = ["transit.json"];
    const manifestArtifacts = {
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
    };

    // ── Measuring (F2) ────────────────────────────────────────────────────

    if (buildMeasuring) {
        const measResult = await buildMeasuring({
            region: fixtureConfig,
            pbfPath,
            distDir: outDir,
            bbox: FIXTURE_BBOX,
        });

        for (const [artifactKey, { uncompressed }] of measResult.artifacts) {
            const filename = `${artifactKey}.json`;
            await writeFile(
                join(outDir, filename),
                Buffer.concat([uncompressed, Buffer.from("\n")]),
            );
            // Clean up any .gz intermediate the builder left behind.
            await rm(join(outDir, `${artifactKey}.json.gz`), { force: true });

            metaArtifacts.push(filename);
            const measParsed = JSON.parse(uncompressed.toString("utf8"));
            manifestArtifacts[filename] = {
                sha256: createHash("sha256")
                    .update(uncompressed)
                    .update("\n")
                    .digest("hex"),
                bytes: uncompressed.length + 1,
                features: measParsed.features?.length ?? 0,
            };
        }

        if (measResult.categories.length === 0) {
            console.warn("  [measuring] No categories produced artifacts.");
        }
    }

    // ── Boundaries (F3) ───────────────────────────────────────────────────

    if (buildBoundaries) {
        const boundariesResult = await buildBoundaries({
            region: fixtureConfig,
            pbfPath,
            distDir: outDir,
            tmpDir: cacheDir,
            regionBbox: FIXTURE_BBOX,
        });

        const boundariesJson = boundariesResult.uncompressed;
        await writeFile(
            join(outDir, "boundaries.json"),
            Buffer.concat([boundariesJson, Buffer.from("\n")]),
        );
        await rm(join(outDir, "boundaries.json.gz"), { force: true });

        metaArtifacts.push("boundaries.json");
        manifestArtifacts["boundaries.json"] = {
            sha256: createHash("sha256")
                .update(boundariesJson)
                .update("\n")
                .digest("hex"),
            bytes: boundariesJson.length + 1,
        };
    }

    // ── POI (F3) ──────────────────────────────────────────────────────────

    if (buildPoi) {
        const poiResult = await buildPoi({
            region: fixtureConfig,
            pbfPath,
            distDir: outDir,
        });

        if (poiResult) {
            const poiJson = poiResult.uncompressed;
            await writeFile(
                join(outDir, "poi.json"),
                Buffer.concat([poiJson, Buffer.from("\n")]),
            );
            await rm(join(outDir, "poi.json.gz"), { force: true });

            metaArtifacts.push("poi.json");
            const poiParsed = JSON.parse(poiJson.toString("utf8"));
            const poiCategories =
                typeof poiParsed.categories === "object" &&
                poiParsed.categories !== null
                    ? Object.keys(poiParsed.categories).length
                    : 0;
            manifestArtifacts["poi.json"] = {
                sha256: createHash("sha256")
                    .update(poiJson)
                    .update("\n")
                    .digest("hex"),
                bytes: poiJson.length + 1,
                categories: poiCategories,
                features: poiParsed.totalCount ?? 0,
            };
        } else {
            console.warn("  [poi] No POI data — skipping artifact.");
        }
    }

    // ── Meta ──────────────────────────────────────────────────────────────

    const meta = {
        schemaVersion: 1,
        regionId: FIXTURE_ID,
        label: fixtureConfig.label,
        bbox: FIXTURE_BBOX,
        osmSnapshot: new Date().toISOString().slice(0, 10),
        adminLevels: { matching: [4, 7, 9, 10] }, // Japan preset
        artifacts: metaArtifacts,
        attribution: {
            text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL).",
            license: "ODbL-1.0",
            url: "https://www.openstreetmap.org/copyright",
        },
    };
    const metaJson = JSON.stringify(meta, null, 2);
    await writeFile(join(outDir, "meta.json"), `${metaJson}\n`);

    // ── Manifest ──────────────────────────────────────────────────────────

    const manifest = {
        id: FIXTURE_ID,
        sourcePbf: repoRelativePbfPath(pbfPath),
        sourcePbfDate: meta.osmSnapshot,
        bbox: FIXTURE_BBOX,
        version: 1,
        artifacts: manifestArtifacts,
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

async function main() {
    const args = process.argv.slice(2);
    const pbfFlag = args.find((a) => a.startsWith("--pbf="));
    const pbfPath = pbfFlag ? pbfFlag.slice("--pbf=".length) : undefined;

    // Phase flags: opt-in to heavier artifacts.
    const withMeasuring = args.includes("--measuring");
    const withBoundaries = args.includes("--boundaries");
    const withPoi = args.includes("--poi");
    const withAll = args.includes("--all");

    let buildMeasuring = null;
    let buildBoundaries = null;
    let buildPoi = null;

    if (withMeasuring || withAll) {
        const mod = await import("./lib/buildMeasuring.mjs");
        buildMeasuring = mod.buildMeasuringArtifact;
    }
    if (withBoundaries || withAll) {
        const mod = await import("./lib/buildBoundaries.mjs");
        buildBoundaries = mod.buildBoundaries;
    }
    if (withPoi || withAll) {
        // POI builder is inlined (matches build-packs.mjs pattern).
        buildPoi = async ({ region, pbfPath, distDir }) => {
            const { existsSync, readFileSync } = await import("node:fs");
            const { gzipSync } = await import("node:zlib");
            const { resolve } = await import("node:path");
            const { fileURLToPath } = await import("node:url");

            const geofabrikDir = resolve(
                dirname(fileURLToPath(import.meta.url)),
                "..",
                "..",
                "geofabrik",
            );
            const selectorsPath = resolve(geofabrikDir, "poi-selectors.json");

            if (!existsSync(selectorsPath)) {
                console.warn(
                    `  [poi] ${selectorsPath} not found — skipping. ` +
                        `Run pnpm data:poi first.`,
                );
                return null;
            }
            const selectorsJson = JSON.parse(
                readFileSync(selectorsPath, "utf8"),
            );
            const tagsFilterArgs = selectorsJson.tagsFilterArgs;
            if (!tagsFilterArgs || tagsFilterArgs.length === 0) {
                console.warn(
                    `  [poi] poi-selectors.json has no tagsFilterArgs — skipping.`,
                );
                return null;
            }

            const { execFileSync } = await import("node:child_process");
            let bbox = region.bbox ?? null;
            try {
                const fileinfo = execFileSync("osmium", [
                    "fileinfo",
                    pbfPath,
                    "--no-progress",
                ]);
                const text = fileinfo.toString("utf8");
                const m = text.match(
                    /Bounding box(?:es)?:\s*\(([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\)/,
                );
                if (m) {
                    const [west, south, east, north] = [
                        parseFloat(m[1]),
                        parseFloat(m[2]),
                        parseFloat(m[3]),
                        parseFloat(m[4]),
                    ];
                    if (
                        [west, south, east, north].every(Number.isFinite)
                    ) {
                        bbox = [west, south, east, north];
                    }
                }
            } catch {
                // osmium fileinfo may fail.
            }

            const { extractPoisFromPbf } = await import(
                "../../../data/geofabrik/scripts/lib/extractPois.mjs"
            );

            const { serialized, columnar } = await extractPoisFromPbf({
                pbfPath,
                selectorsJson,
                tagsFilterArgs,
                regionMeta: {
                    id: region.id,
                    label: region.label,
                    bbox,
                    source: region.pbfUrl ?? pbfPath,
                },
            });

            const gzipped = gzipSync(serialized, { level: 9 });
            const gzPath = resolve(distDir, "poi.json.gz");
            const { writeFile } = await import("node:fs/promises");
            await writeFile(gzPath, gzipped);

            console.log(
                `    poi.json.gz: ${(gzipped.length / 1024).toFixed(1)} KB gz`,
            );

            return {
                gzPath,
                uncompressed: Buffer.from(serialized, "utf8"),
                columnar,
            };
        };
    }

    buildE2eFixture({
        pbfPath,
        buildMeasuring,
        buildBoundaries,
        buildPoi,
    }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main();
}

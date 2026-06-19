/**
 * Dissolve shard worker (level 1 of the two-level dissolve).
 *
 * One child process of {@link polygonDissolveParallel}. Reads a spec file
 * (one contiguous band of tiles + the band's feature subset + simplify
 * tolerance), dissolves each tile with the shared {@link dissolveTile}, then
 * **pre-merges** the band's tile features into a few compact blobs so the
 * parent's final cross-tile merge only has ~N blobs to union. Spawned with
 * `--import tsx` so the GEOS-wasm fast path in `polygonDissolve.mjs` is
 * available — identical engine to the sequential path.
 *
 * @module dissolveWorker
 */

/* global console, process */

import { readFile, writeFile } from "node:fs/promises";

import { bboxesIntersect, computePolygonBbox } from "./geometryCleanup.mjs";
import { dissolveTile, geosUnaryUnionCoords } from "./polygonDissolve.mjs";

async function main() {
    const specPath = process.argv[2];
    if (!specPath) {
        console.error("dissolveWorker: missing spec path argument");
        process.exit(2);
    }

    const {
        shardId,
        totalShards,
        inputPath,
        outputPath,
        tiles,
        simplifyTolerance,
    } = JSON.parse(await readFile(specPath, "utf8"));
    const features = JSON.parse(await readFile(inputPath, "utf8"));

    const tag = `[dissolve][shard ${shardId + 1}/${totalShards}]`;
    const t0 = Date.now();

    // ── Dissolve each tile in this band ──────────────────────────────────────
    const tileFeatures = [];
    let tileUnionMs = 0;
    let nTiles = 0;
    for (let i = 0; i < tiles.length; i++) {
        const tileBbox = tiles[i];
        const tilePolys = features.filter((f) =>
            bboxesIntersect(f.bbox, tileBbox),
        );
        if (tilePolys.length === 0) continue;

        const r = dissolveTile(tileBbox, tilePolys, simplifyTolerance);
        tileUnionMs += r.unionMs;
        nTiles++;
        for (const f of r.features) tileFeatures.push(f);

        if (i % 25 === 0 || r.unionMs > 1000) {
            console.log(
                `  ${tag} tile ${i + 1}/${tiles.length} ` +
                    `${tilePolys.length.toLocaleString()} polys → ` +
                    `${r.groupCount} grp (${r.unionMs}ms)`,
            );
        }
    }

    // ── Pre-merge this contiguous band into compact blobs ────────────────────
    const results = [];
    let mergeMs = 0;
    if (tileFeatures.length > 0) {
        const tMerge = Date.now();
        const groups = geosUnaryUnionCoords(
            tileFeatures.map((f) => f.geometry.coordinates),
        );
        mergeMs = Date.now() - tMerge;
        for (const g of groups) {
            if (!g || g.length === 0) continue;
            const geometry = { type: "MultiPolygon", coordinates: g };
            results.push({
                type: "Feature",
                bbox: computePolygonBbox(geometry),
                geometry,
                properties: {},
            });
        }
    }

    await writeFile(outputPath, JSON.stringify(results));
    console.log(
        `  ${tag} ${nTiles} tiles → ${results.length} blob(s); ` +
            `tile-union ${(tileUnionMs / 1000).toFixed(1)}s, ` +
            `band-merge ${(mergeMs / 1000).toFixed(1)}s, ` +
            `total ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
}

main().catch((err) => {
    console.error(`dissolveWorker error: ${err.stack || err.message}`);
    process.exit(1);
});

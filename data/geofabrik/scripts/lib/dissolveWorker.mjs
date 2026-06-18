/**
 * Dissolve shard worker.
 *
 * One child process of {@link polygonDissolveParallel}. Reads a spec file
 * (tile list + feature subset paths + simplify tolerance), dissolves each of
 * its tiles with the shared {@link dissolveTile}, and writes the resulting
 * features to its output file. Spawned with `--import tsx` so the GEOS-wasm
 * fast path in `polygonDissolve.mjs` is available — identical engine to the
 * sequential path.
 *
 * @module dissolveWorker
 */

/* global console, process */

import { readFile, writeFile } from "node:fs/promises";

import { bboxesIntersect } from "./geometryCleanup.mjs";
import { dissolveTile } from "./polygonDissolve.mjs";

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
    const results = [];
    let unionMs = 0;

    for (let i = 0; i < tiles.length; i++) {
        const tileBbox = tiles[i];
        const tilePolys = features.filter((f) =>
            bboxesIntersect(f.bbox, tileBbox),
        );
        if (tilePolys.length === 0) continue;

        const r = dissolveTile(tileBbox, tilePolys, simplifyTolerance);
        unionMs += r.unionMs;
        for (const f of r.features) results.push(f);

        if (i % 25 === 0 || r.unionMs > 1000) {
            console.log(
                `  ${tag} tile ${i + 1}/${tiles.length} ` +
                    `${tilePolys.length.toLocaleString()} polys → ` +
                    `${r.groupCount} grp (${r.unionMs}ms)`,
            );
        }
    }

    await writeFile(outputPath, JSON.stringify(results));
    console.log(
        `  ${tag} ${results.length} features, union ${(unionMs / 1000).toFixed(1)}s, ` +
            `total ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
}

main().catch((err) => {
    console.error(`dissolveWorker error: ${err.stack || err.message}`);
    process.exit(1);
});

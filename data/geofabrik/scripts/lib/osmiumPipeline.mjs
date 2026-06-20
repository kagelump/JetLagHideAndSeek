/**
 * Osmium CLI wrappers for measuring bundle extraction.
 *
 * The admin-boundary assembly is a three-step osmium pipeline:
 * tags-filter → getid -r → export.  This module factors that
 * orchestration so it can be reused by both the measuring pipeline
 * (T2b) and the pack boundaries artifact (T6).
 *
 * @module osmiumPipeline
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";

/**
 * Assemble complete admin-boundary (multi)polygons from a PBF.
 *
 * Wraps the three-step osmium pipeline:
 * 1. `osmium tags-filter` — extract r/boundary=administrative relations
 * 2. `osmium getid -r -i` — pull complete relations with member ways
 * 3. `osmium export -f geojson` — assemble multipolygon rings
 *
 * Returns GeoJSON features with properties { @id, @type, admin_level, name, … }
 * and a summary { assembled, droppedNoName, droppedBroken } the caller logs.
 *
 * @param {object} opts
 * @param {string} opts.pbfPath - path to the source PBF (should be pre-filtered to the region bbox)
 * @param {number[]} [opts.levels] - admin_level values to include (empty = all levels)
 * @param {string} [opts.tmpDir] - temporary directory (default: os.tmpdir()/<random>)
 * @returns {Promise<{ features: object[], summary: { assembled: number, droppedNoName: number, droppedBroken: number } }>}
 */
export async function assembleAdminBoundaries({
    pbfPath,
    levels,
    tmpDir: tmpDirOverride,
}) {
    const workDir =
        tmpDirOverride ?? join(tmpdir(), `admin-boundary-${Date.now()}`);
    await mkdir(workDir, { recursive: true });

    // Step 1: tags-filter — only r/boundary=administrative relations.
    const adminRelsPbf = join(workDir, "admin-rels-only.osm.pbf");
    console.log(`  [osmium] Filtering r/boundary=administrative...`);
    execFileSync(
        "osmium",
        [
            "tags-filter",
            pbfPath,
            "r/boundary=administrative",
            "-o",
            adminRelsPbf,
            "-O",
        ],
        { stdio: "inherit" },
    );

    // Step 2: extract relation IDs, then pull complete relations + member ways.
    console.log(`  [osmium] Extracting relation IDs...`);
    const idsPath = join(workDir, "admin-rel-ids.txt");
    const oplPath = join(workDir, "admin-rels.opl");
    execFileSync(
        "osmium",
        ["cat", adminRelsPbf, "-f", "opl", "-o", oplPath, "-O"],
        { stdio: "inherit" },
    );
    // Stream the OPL file line-by-line rather than reading it into a single
    // string — the north-america parent PBF produces ~1 GB of OPL output,
    // which exceeds Node's ~512 MB string limit.
    const ids = [];
    const rl = createInterface({
        input: createReadStream(oplPath, { encoding: "utf8" }),
        crlfDelay: Infinity,
    });
    for await (const line of rl) {
        if (!line.startsWith("r")) continue;
        ids.push(line.split(" ")[0]);
    }
    writeFileSync(idsPath, ids.join("\n") + "\n");
    console.log(`  [osmium] Found ${ids.length} relation IDs`);

    console.log(`  [osmium] Pulling in member ways with getid -r...`);
    const adminCompletePbf = join(workDir, "admin-complete.osm.pbf");
    // osmium getid exits 1 when some referenced objects are outside the
    // extract (missing ways/nodes). The output file is still valid — just
    // with those objects omitted.
    try {
        execFileSync(
            "osmium",
            [
                "getid",
                pbfPath,
                "-r",
                "-i",
                idsPath,
                "-o",
                adminCompletePbf,
                "-O",
            ],
            { stdio: "inherit" },
        );
    } catch (err) {
        if (!existsSync(adminCompletePbf)) throw err;
        console.log(
            `  [osmium] getid reported missing objects ` +
                `(some member ways outside extract) — continuing`,
        );
    }

    // Step 3: export to GeoJSONSeq (one feature per line) so we can stream-
    // parse without hitting Node's ~512 MB string limit.  The assembled
    // admin-boundary set for the north-america parent PBF runs ~1 GB.
    const geojsonseqPath = join(workDir, "admin-boundaries.geojsonseq");
    console.log(`  [osmium] Exporting to GeoJSONSeq...`);
    execFileSync(
        "osmium",
        [
            "export",
            adminCompletePbf,
            "-f",
            "geojsonseq",
            "-a",
            "type,id",
            "-o",
            geojsonseqPath,
            "-O",
        ],
        { stdio: "inherit" },
    );

    // Stream-parse the GeoJSONSeq.
    const features = [];
    let droppedNoName = 0;
    let droppedBroken = 0;

    const RS = String.fromCharCode(0x1e);
    const rl2 = createInterface({
        input: createReadStream(geojsonseqPath, { encoding: "utf8" }),
        crlfDelay: Infinity,
    });
    for await (const line of rl2) {
        const clean = line.startsWith(RS)
            ? line.slice(1).trim()
            : line.trim();
        if (!clean) continue;

        let feature;
        try {
            feature = JSON.parse(clean);
        } catch {
            continue;
        }

        // Only interested in assembled relation polygons.
        if (feature.properties?.["@type"] !== "relation") continue;

        // Level filter (if requested).
        if (levels && levels.length > 0) {
            const adminLevel = parseInt(feature.properties.admin_level, 10);
            if (!Number.isFinite(adminLevel) || !levels.includes(adminLevel)) {
                continue;
            }
        }

        // Must have polygon geometry.
        const geom = feature.geometry;
        if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") {
            droppedBroken++;
            continue;
        }

        // Must have a name.
        if (!feature.properties.name && !feature.properties["name:en"]) {
            droppedNoName++;
            // Keep unnamed features for measuring; T6 drops them.
        }

        features.push(feature);
    }

    return {
        features,
        summary: {
            assembled: features.length,
            droppedNoName,
            droppedBroken,
        },
    };
}

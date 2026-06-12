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

import { execFileSync, execSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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
    const opl = execSync(`osmium cat "${adminRelsPbf}" -f opl`, {
        maxBuffer: 512 * 1024 * 1024,
    }).toString();
    const ids = [];
    for (const line of opl.split("\n")) {
        if (!line.startsWith("r")) continue;
        // Keep the 'r' prefix so osmium getid knows the type.
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

    // Step 3: export to GeoJSON with assembled polygon geometries.
    const geojsonPath = join(workDir, "admin-boundaries.geojson");
    console.log(`  [osmium] Exporting to GeoJSON...`);
    execFileSync(
        "osmium",
        [
            "export",
            adminCompletePbf,
            "-f",
            "geojson",
            "-a",
            "type,id",
            "-o",
            geojsonPath,
            "-O",
        ],
        { stdio: "inherit" },
    );

    // Parse the result.
    const raw = readFileSync(geojsonPath, "utf8");
    const fc = JSON.parse(raw);

    const features = [];
    let droppedNoName = 0;
    let droppedBroken = 0;

    for (const feature of fc.features ?? []) {
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

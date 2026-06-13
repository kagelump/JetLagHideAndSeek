/* global console */

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

import { mapOsmNode, dedupeOsmStations } from "./osmStations.mjs";
import { processOsmRoutes } from "./osmRoutes.mjs";
import { extractRouteRelationsFromPbf } from "./extractOsmRoutes.mjs";

/**
 * Run the OSM extraction stage.
 *
 * For each configured region:
 * 1. Download/cache the Geofabrik PBF (reuse existing japan-latest.osm.pbf
 *    when available, extracting a window).
 * 2. osmium tags-filter → station nodes.
 * 3. osmium export → GeoJSONSeq.
 * 4. Stream, map records, dedupe.
 * 5. Write intermediate JSON to data/transit/cache/osm-stations-<region>.json.
 *
 * @param {object} ctx - pipeline context
 */
export async function osmStage(ctx) {
    const regions = ctx.locale.osm?.regions;
    if (!regions || regions.length === 0) {
        console.log("[osm] No OSM regions configured — skipping.");
        return;
    }

    const suffixes = ctx.locale.nameSuffixes ?? [];
    const stationTags = ctx.locale.osm?.stationTags ?? [
        "n/railway=station",
        "n/railway=halt",
        "n/public_transport=station",
    ];

    const cacheDir = resolve(ctx.transitDir, ctx.config.cacheDir ?? "cache");
    const geofabrikCache = resolve(ctx.transitDir, "..", "geofabrik", "cache");
    const japanPbf = join(geofabrikCache, "japan-latest.osm.pbf");
    const hasJapanPbf = existsSync(japanPbf);

    await mkdir(cacheDir, { recursive: true });

    const regionFilter = ctx.region; // --region filter
    const targetRegions = regionFilter
        ? regions.filter((r) => r.id === regionFilter)
        : regions;

    if (regionFilter && targetRegions.length === 0) {
        throw new Error(
            `Unknown region "${regionFilter}". Available: ${regions.map((r) => r.id).join(", ")}`,
        );
    }

    ctx.osmStationFiles = [];

    for (const region of targetRegions) {
        console.log(`[osm] Extracting ${region.id}...`);

        // Determine PBF source.
        let pbfPath;
        if (hasJapanPbf) {
            // Extract a window from the Japan PBF using the region bbox.
            const [w, s, e, n] = region.bbox;
            const bboxStr = `${w},${s},${e},${n}`;
            pbfPath = join(cacheDir, `${region.id}-window.osm.pbf`);

            if (!existsSync(pbfPath)) {
                console.log(`  Extracting bbox window: ${bboxStr}`);
                execFileSync(
                    "osmium",
                    [
                        "extract",
                        "-b",
                        bboxStr,
                        japanPbf,
                        "-o",
                        pbfPath,
                        "--overwrite",
                    ],
                    { stdio: "inherit" },
                );
            } else {
                console.log(`  Using cached window: ${pbfPath}`);
            }
        } else if (region.pbf) {
            // Download from Geofabrik.
            const dlPath = join(cacheDir, `${region.id}-latest.osm.pbf`);
            if (!existsSync(dlPath)) {
                console.log(`  Downloading ${region.pbf}...`);
                const { fetchToCache } = await import("./cache.mjs");
                await fetchToCache(region.pbf, dlPath, {});
            }
            pbfPath = dlPath;
        } else {
            console.warn(`  No PBF source for ${region.id} — skipping.`);
            continue;
        }

        // Tags-filter: extract station nodes.
        const filteredPbf = join(cacheDir, `${region.id}-stations.osm.pbf`);
        if (!existsSync(filteredPbf)) {
            console.log(`  Filtering station tags...`);
            execFileSync(
                "osmium",
                [
                    "tags-filter",
                    pbfPath,
                    ...stationTags,
                    "-o",
                    filteredPbf,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        } else {
            console.log(`  Using cached filtered: ${filteredPbf}`);
        }

        // Export to GeoJSONSeq.
        const tmpDir = join(tmpdir(), `transit-osm-${region.id}-${Date.now()}`);
        await mkdir(tmpDir, { recursive: true });
        const seqPath = join(tmpDir, "stations.seq");
        execFileSync(
            "osmium",
            [
                "export",
                filteredPbf,
                "-f",
                "geojsonseq",
                "-a",
                "type,id",
                "-o",
                seqPath,
                "-O",
            ],
            { stdio: "inherit" },
        );

        // Stream and map records.
        console.log(`  Mapping records...`);
        const stats = {
            total: 0,
            skippedNoName: 0,
            skippedNoId: 0,
            skippedNonRailway: 0,
            mapped: 0,
        };
        const records = [];

        const rl = createInterface({
            input: createReadStream(seqPath, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            const RS = String.fromCharCode(0x1e);
            const clean = line.startsWith(RS)
                ? line.slice(1).trim()
                : line.trim();
            if (!clean) continue;

            stats.total++;
            let feature;
            try {
                feature = JSON.parse(clean);
            } catch {
                continue;
            }

            // Only nodes — skip ways/relations that osmium may have included.
            if (feature.properties?.["@type"] !== "node") continue;

            const rec = mapOsmNode(feature, region.id, suffixes, stats);
            if (rec) {
                records.push(rec);
                stats.mapped++;
            }
        }

        console.log(
            `  ${stats.total.toLocaleString()} features, ${stats.mapped.toLocaleString()} ` +
                `mapped (${stats.skippedNoName} unnamed, ${stats.skippedNoId} no-id, ${stats.skippedNonRailway} non-railway)`,
        );

        // Intra-source dedup.
        const { kept, stats: dedupStats } = dedupeOsmStations(records);
        console.log(
            `  Dedup: ${records.length.toLocaleString()} → ${kept.length.toLocaleString()} ` +
                `(id:${dedupStats.droppedById}, wiki:${dedupStats.droppedByWikidata}, ` +
                `name:${dedupStats.droppedByNameDist})`,
        );

        // Write intermediate.
        const outputPath = join(cacheDir, `osm-stations-${region.id}.json`);
        await writeFile(
            outputPath,
            JSON.stringify({
                region: region.id,
                generatedAt: new Date().toISOString(),
                stationCount: kept.length,
                stats: { ...stats, ...dedupStats },
                records: kept,
            }) + "\n",
        );
        console.log(
            `  Wrote ${outputPath} (${kept.length.toLocaleString()} stations)`,
        );

        ctx.osmStationFiles.push(outputPath);
    }

    // ─── Route relation extraction ────────────────────────────────────────
    //
    // For each region, extract route relations from the same window PBF and
    // convert them to OSM XML for parsing.  Routes are optional — failures here
    // are warnings, not fatal.

    console.log("[osm] Extracting route relations...");
    const allRelations = [];
    /** @type {Map<number, {lat: number, lon: number}>} */
    const allNodeCoords = new Map();
    /** @type {Map<number, number[]>} way id → ordered node refs */
    const allWays = new Map();

    for (const region of targetRegions) {
        // Determine PBF path (same logic as station extraction above).
        let pbfPath;
        if (hasJapanPbf) {
            pbfPath = join(cacheDir, `${region.id}-window.osm.pbf`);
        } else if (region.pbf) {
            pbfPath = join(cacheDir, `${region.id}-latest.osm.pbf`);
        } else {
            console.warn(
                `  [osm/routes] No PBF source for ${region.id} — skipping routes.`,
            );
            continue;
        }

        if (!existsSync(pbfPath)) {
            console.warn(
                `  [osm/routes] PBF not found: ${pbfPath} — skipping routes for ${region.id}.`,
            );
            continue;
        }

        const { relations, nodeCoords, ways } =
            await extractRouteRelationsFromPbf({
                pbfPath,
                cacheDir,
                regionId: region.id,
            });

        allRelations.push(...relations);
        for (const [id, coords] of nodeCoords) {
            if (!allNodeCoords.has(id)) allNodeCoords.set(id, coords);
        }
        for (const [id, refs] of ways) {
            if (!allWays.has(id)) allWays.set(id, refs);
        }
    }

    // Load station records from cached OSM station files.
    console.log(
        `[osm/routes] Loading station records from ${ctx.osmStationFiles.length} file(s)...`,
    );
    const allStationRecords = [];
    for (const filePath of ctx.osmStationFiles) {
        try {
            let data = "";
            for await (const chunk of createReadStream(filePath, {
                encoding: "utf8",
            })) {
                data += chunk;
            }
            const parsed = JSON.parse(data);
            if (parsed.records && Array.isArray(parsed.records)) {
                allStationRecords.push(...parsed.records);
            }
        } catch (err) {
            console.warn(
                `  [osm/routes] Could not read station file ${filePath}: ${err.message}`,
            );
        }
    }

    // Process routes.
    if (allRelations.length > 0 && allStationRecords.length > 0) {
        console.log(
            `[osm/routes] Processing ${allRelations.length} relations with ${allStationRecords.length} station records...`,
        );
        const result = processOsmRoutes(
            allRelations,
            allStationRecords,
            ctx.locale,
            allNodeCoords,
            allWays,
        );
        ctx.osmRouteLines = result.lines;
        ctx.osmRouteStats = result.stats;
        console.log(
            `[osm/routes] ${result.stats.totalRelations} relations → ${result.stats.linesKept} lines ` +
                `(${result.stats.linesDroppedGtfs} dropped via operator gating, ` +
                `${result.stats.linesTooFewStations} too few stations)` +
                (result.stats.detectedJumps > 0
                    ? `, ${result.stats.detectedJumps} jump(s) detected, ${result.stats.repairedStops} repaired, ${result.stats.unrepairableVariants} unrepairable`
                    : ""),
        );
    } else {
        console.log(
            `[osm/routes] No route relations (${allRelations.length}) or station records (${allStationRecords.length}) — skipping route processing.`,
        );
        ctx.osmRouteLines = [];
    }
}

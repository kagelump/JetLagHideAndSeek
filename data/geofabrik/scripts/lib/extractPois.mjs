/**
 * Extract POI features from a PBF using osmium + the poiReducer.
 *
 * The reusable core: osmium tags-filter → export GeoJSONSeq → stream,
 * reduce, deduplicate, and build columnar output.  Called by both the
 * legacy Japan pipeline (fetch-geofabrik.mjs) and the packs pipeline (T2).
 *
 * Callers are responsible for loading poi-selectors.json and passing both
 * the full parsed JSON (for categoryOf) and its precomputed tagsFilterArgs.
 *
 * @module extractPois
 */

import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
    buildColumnar,
    deduplicateRecords,
    reduceFeature,
    buildCategoryOf,
} from "../poiReducer.mjs";

/**
 * Extract POIs from a PBF file and return a RawRegion-compatible columnar
 * object. Does NOT write files — the caller handles that.
 *
 * @param {object} opts
 * @param {string} opts.pbfPath - path to the region PBF
 * @param {object} opts.selectorsJson - parsed poi-selectors.json
 *   ({ schemaVersion, selectors[], tagsFilterArgs })
 * @param {string[]} opts.tagsFilterArgs - precomputed osmium filter args
 *   from poi-selectors.json (must be the exact array for byte-identical output)
 * @param {object} opts.regionMeta - { id, label, bbox, source? } for output
 * @returns {Promise<{ columnar: object, serialized: string }>}
 */
export async function extractPoisFromPbf({
    pbfPath,
    selectorsJson,
    tagsFilterArgs,
    regionMeta,
}) {
    if (!tagsFilterArgs || tagsFilterArgs.length === 0) {
        throw new Error(
            "tagsFilterArgs is empty — poi-selectors.json may be missing or invalid. " +
                "Run pnpm data:poi-selectors first.",
        );
    }

    const categoryOf = buildCategoryOf(selectorsJson);

    const tmpDir = join(tmpdir(), `poi-extract-${regionMeta.id}-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    try {
        const curatedPath = join(tmpDir, "curated.osm.pbf");
        const geoSeqPath = join(tmpDir, "curated.seq");

        // 1. osmium tags-filter with exact key=value from registry.
        console.log(`  Filtering ${tagsFilterArgs.length} tag selectors...`);
        execFileSync(
            "osmium",
            [
                "tags-filter",
                pbfPath,
                ...tagsFilterArgs,
                "-o",
                curatedPath,
                "-O",
            ],
            { stdio: "inherit" },
        );

        // 2. osmium export to GeoJSONSeq for streaming.
        console.log(`  Exporting to GeoJSONSeq...`);
        execFileSync(
            "osmium",
            [
                "export",
                curatedPath,
                "-f",
                "geojsonseq",
                "-u",
                "type_id",
                "-a",
                "id,type",
                "-o",
                geoSeqPath,
                "-O",
            ],
            { stdio: "inherit" },
        );

        // 3. Stream, reduce, collect.
        console.log(`  Reducing features...`);
        const records = [];
        const rl = createInterface({
            input: createReadStream(geoSeqPath, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            // Strip GeoJSONSeq RS (0x1e) record separator.
            const RS = String.fromCharCode(0x1e);
            const clean = line.startsWith(RS)
                ? line.slice(1).trim()
                : line.trim();
            if (!clean) continue;
            let feature;
            try {
                feature = JSON.parse(clean);
            } catch {
                continue; // skip unparseable lines
            }
            const record = reduceFeature(feature, categoryOf);
            if (record) records.push(record);
        }

        console.log(
            `  Reduced ${records.length.toLocaleString()} named features`,
        );

        // 4. Deduplicate: OSM may have both a node and a way for the same POI.
        const deduped = deduplicateRecords(records);
        if (deduped.length < records.length) {
            console.log(
                `  Deduped: ${deduped.length.toLocaleString()} (removed ${(records.length - deduped.length).toLocaleString()} duplicates)`,
            );
        }

        // 5. Build columnar JSON.
        const generatedAt = new Date().toISOString();
        const bbox = regionMeta.bbox ?? [0, 0, 0, 0];

        const columnar = buildColumnar(deduped, {
            id: regionMeta.id,
            label: regionMeta.label,
            bbox,
            generatedAt,
            source: regionMeta.source ?? regionMeta.id,
            attribution: {
                text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL). Geofabrik extract from download.geofabrik.de.",
                license: "ODbL-1.0",
                url: "https://www.openstreetmap.org/copyright",
            },
        });

        const serialized = JSON.stringify(columnar);

        // Print per-category counts.
        console.log(`  POI Summary for ${regionMeta.label}:`);
        console.log(
            `     Total: ${columnar.totalCount.toLocaleString()} features across ${Object.keys(columnar.categories).length} categories`,
        );
        for (const [cat, data] of Object.entries(columnar.categories)) {
            console.log(`     ${cat}: ${data.count.toLocaleString()}`);
        }

        return { columnar, serialized };
    } finally {
        // Clean up temp files.
        const { rm } = await import("node:fs/promises");
        try {
            await rm(tmpDir, { recursive: true, force: true });
        } catch {
            // best-effort cleanup
        }
    }
}

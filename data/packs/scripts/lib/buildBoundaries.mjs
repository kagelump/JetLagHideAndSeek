/**
 * Boundaries artifact builder.
 *
 * For a region PBF: assemble admin boundary relations at configured levels,
 * drop bad relations, simplify polygons, delta-encode, build a name-search
 * index, and write boundaries.json.gz.
 *
 * @module buildBoundaries
 */

import { gzipSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * Compute approximate planar area of a polygon ring in square meters.
 * Uses the Shoelace formula on lon/lat, correcting for latitude.
 * @param {[number, number][]} ring - closed ring of [lon, lat] pairs
 * @returns {number} area in square meters
 */
function ringAreaSqm(ring) {
    if (ring.length < 4) return 0;
    let area = 0;
    // Average latitude for cos correction (rough)
    let sumLat = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        sumLat += ring[i][1];
    }
    const avgLat = (sumLat / (ring.length - 1)) * (Math.PI / 180);
    const cosLat = Math.cos(avgLat) || 0.0001;

    for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        // Planar shoelace; each unit ≈ 111320 m at equator
        area += x1 * y2 - x2 * y1;
    }

    // Convert planar deg² to m²: 1 deg lat ≈ 111320 m, 1 deg lon ≈ 111320 * cos(lat) m
    const scale = 111320 * 111320 * cosLat;
    return Math.abs(area * 0.5 * scale);
}

/**
 * Compute area of a Polygon or MultiPolygon geometry in km².
 * @param {object} geometry - GeoJSON Polygon or MultiPolygon
 * @returns {number} area in square kilometers
 */
function geometryAreaKm2(geometry) {
    let total = 0;
    if (geometry.type === "Polygon") {
        const outer = ringAreaSqm(geometry.coordinates[0]);
        const holes = geometry.coordinates
            .slice(1)
            .reduce((sum, ring) => sum + ringAreaSqm(ring), 0);
        total = outer - holes;
    } else if (geometry.type === "MultiPolygon") {
        for (const poly of geometry.coordinates) {
            const outer = ringAreaSqm(poly[0]);
            const holes = poly
                .slice(1)
                .reduce((sum, ring) => sum + ringAreaSqm(ring), 0);
            total += outer - holes;
        }
    }
    return total / 1_000_000; // convert m² to km²
}

/**
 * Build the region boundary artifact into a dist directory.
 *
 * @param {object} opts
 * @param {object} opts.region - region config entry (from regions.yaml)
 * @param {string} opts.pbfPath - path to cached PBF
 * @param {string} opts.distDir - output directory (dist/<region-id>/)
 * @param {string} [opts.tmpDir] - temp directory for osmium intermediates
 * @returns {Promise<{gzPath: string, uncompressed: Buffer}>}
 */
export async function buildBoundaries({ region, pbfPath, distDir, tmpDir }) {
    const { assembleAdminBoundaries } = await import(
        "../../../geofabrik/scripts/lib/osmiumPipeline.mjs"
    );
    const { encodeDeltaPolygon, getSimplifyToleranceDegrees } = await import(
        "./deltaEncode.mjs"
    );
    const { simplifyPolygonFeature, cleanPolygonFeature, computePolygonBbox } =
        await import(
            resolve(
                scriptDir,
                "../../../geofabrik/scripts/lib/geometryCleanup.mjs",
            )
        );
    const { collectNormalizedVariants } = await import("./normalizeNames.mjs");

    const levels = region.adminLevels?.extract ?? [4, 7, 9, 10];
    const simplifyTolerance = getSimplifyToleranceDegrees();

    console.log(
        `  [boundaries] Assembling admin boundaries (levels ${levels.join(",")})...`,
    );

    const { features, summary } = await assembleAdminBoundaries({
        pbfPath,
        levels,
        tmpDir,
    });

    console.log(
        `  [boundaries] Assembled ${summary.assembled} features (${summary.droppedNoName} dropped no-name, ${summary.droppedBroken} dropped broken)`,
    );

    // Filter and simplify.
    const index = [];
    const polygons = {};
    const levelCounts = {};
    let droppedNoName = 0;
    let droppedBroken = 0;

    for (const feature of features) {
        const props = feature.properties ?? {};
        const geom = feature.geometry;
        const relationId = props["@id"] ? Number(props["@id"]) : null;
        const adminLevel = parseInt(props.admin_level, 10);

        if (!Number.isFinite(adminLevel)) continue;

        // Drop no-name.
        if (!props.name && !props["name:en"]) {
            droppedNoName++;
            continue;
        }

        // Drop broken geometry (already filtered by assembleAdminBoundaries,
        // but double-check for null/invalid after simplification).
        if (
            !geom ||
            (geom.type !== "Polygon" && geom.type !== "MultiPolygon")
        ) {
            droppedBroken++;
            continue;
        }

        // Clean and simplify.
        let cleaned = cleanPolygonFeature(feature);
        if (!cleaned) {
            droppedBroken++;
            continue;
        }

        let simplified = simplifyPolygonFeature(cleaned, simplifyTolerance);
        if (!simplified) {
            droppedBroken++;
            continue;
        }

        // Delta-encode.
        const encoded = encodeDeltaPolygon(simplified.geometry);

        // Build index entry.
        const name = props.name ?? props["name:en"] ?? "";
        const nameEn =
            props["name:en"] && props["name:en"] !== props.name
                ? props["name:en"]
                : undefined;
        const normalized = collectNormalizedVariants(props);
        const bbox = computePolygonBbox(simplified.geometry);

        // Centroid: simple bbox center (no need for Turf center)
        const centroid = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

        const areaKm2 =
            Math.round(geometryAreaKm2(simplified.geometry) * 100) / 100;

        const idxEntry = {
            relationId,
            name,
            adminLevel,
            centroid,
            bbox,
            areaKm2,
        };
        if (nameEn) idxEntry.nameEn = nameEn;
        if (normalized.length > 0) idxEntry.normalized = normalized;

        index.push(idxEntry);
        polygons[String(relationId)] = encoded;

        levelCounts[adminLevel] = (levelCounts[adminLevel] ?? 0) + 1;
    }

    // Print per-level counts.
    for (const lv of levels.sort((a, b) => a - b)) {
        const count = levelCounts[lv] ?? 0;
        console.log(`  [boundaries]   Level ${lv}: ${count} features`);
    }
    console.log(
        `  [boundaries] Dropped: ${droppedNoName} no-name, ${droppedBroken} broken`,
    );

    // Build the artifact.
    const artifact = {
        schemaVersion: 1,
        regionId: region.id,
        generatedAt: new Date().toISOString(),
        levels,
        simplifyTolerance,
        index,
        polygons,
    };

    const serialized = JSON.stringify(artifact);
    const gzipped = gzipSync(serialized, { level: 9 });
    const gzPath = resolve(distDir, "boundaries.json.gz");

    await writeFile(gzPath, gzipped);

    const mb = (gzipped.length / 1024 / 1024).toFixed(2);
    const rawMb = (serialized.length / 1024 / 1024).toFixed(2);
    console.log(
        `  [boundaries] boundaries.json.gz: ${(gzipped.length / 1024).toFixed(1)} KB gz (${rawMb} MB raw)`,
    );

    // Warn if over 10 MB gz.
    if (gzipped.length > 10 * 1024 * 1024) {
        console.warn(
            `  [boundaries] WARNING: boundaries artifact is ${mb} MB gz (>10 MB threshold)`,
        );
    }

    return {
        gzPath,
        uncompressed: Buffer.from(serialized, "utf8"),
    };
}

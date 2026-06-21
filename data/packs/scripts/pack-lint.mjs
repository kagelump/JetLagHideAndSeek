/**
 * Pack lint — validate a built pack's dist directory.
 *
 * Usage:
 *   pnpm data:pack:lint -- --region <id>
 *
 * Checks: meta validates, every artifact in hashes.json exists with matching
 * bytes/hashes, gz files gunzip, bbox is sane.
 *
 * @module pack-lint
 */

/* global console, process */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { validateMeta } from "./lib/metaSchema.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packsDir = resolve(scriptDir, "..");
const distBase = resolve(packsDir, "dist");

/**
 * Lint a single region's dist directory. Returns error messages.
 *
 * @param {string} regionId
 * @returns {Promise<string[]>} error messages (empty = valid)
 */
export async function lintRegion(regionId) {
    const errors = [];
    const distDir = resolve(distBase, regionId);

    if (!existsSync(distDir)) {
        return [`dist/${regionId}/ does not exist`];
    }

    // 1. Validate meta.json.
    const metaPath = resolve(distDir, "meta.json");
    if (!existsSync(metaPath)) {
        errors.push(`dist/${regionId}/meta.json: missing`);
    } else {
        try {
            const meta = JSON.parse(await readFile(metaPath, "utf8"));
            const metaErrors = validateMeta(meta, `dist/${regionId}/meta.json`);
            errors.push(...metaErrors);
        } catch (err) {
            errors.push(`dist/${regionId}/meta.json: ${err.message}`);
        }
    }

    // 2. Validate hashes.json.
    const hashesPath = resolve(distDir, "hashes.json");
    if (!existsSync(hashesPath)) {
        errors.push(`dist/${regionId}/hashes.json: missing`);
    } else {
        let hashes;
        try {
            hashes = JSON.parse(await readFile(hashesPath, "utf8"));
        } catch (err) {
            errors.push(`dist/${regionId}/hashes.json: ${err.message}`);
            return errors;
        }

        // For each entry in hashes, verify the gz file exists and hashes match.
        for (const [artifactName, entry] of Object.entries(hashes)) {
            const gzPath = resolve(distDir, `${artifactName}.json.gz`);
            if (!existsSync(gzPath)) {
                // measuring artifacts use category-suffixed names.
                // Stub builders won't produce real files, so check both patterns.
                const byKind = resolve(
                    distDir,
                    `measuring-${artifactName}.json.gz`,
                );
                if (!existsSync(byKind)) {
                    errors.push(
                        `dist/${regionId}/${artifactName}.json.gz: missing from disk but listed in hashes.json`,
                    );
                    continue;
                }
            }

            // If the file exists, verify hashes.
            const gzFile = existsSync(gzPath)
                ? gzPath
                : resolve(distDir, `measuring-${artifactName}.json.gz`);

            try {
                const gzBytes = await readFile(gzFile);
                if (gzBytes.length !== entry.bytes) {
                    errors.push(
                        `dist/${regionId}/${basename(gzFile)}: bytes mismatch (expected ${entry.bytes}, got ${gzBytes.length})`,
                    );
                }

                // Verify it gunzips.
                let uncompressed;
                try {
                    uncompressed = gunzipSync(gzBytes);
                } catch (err) {
                    errors.push(
                        `dist/${regionId}/${basename(gzFile)}: not valid gzip: ${err.message}`,
                    );
                    continue;
                }

                // Check sha256 of uncompressed.
                const { createHash } = await import("node:crypto");
                const actualSha256 = createHash("sha256")
                    .update(uncompressed)
                    .digest("hex");
                if (actualSha256 !== entry.sha256) {
                    errors.push(
                        `dist/${regionId}/${basename(gzFile)}: sha256 mismatch`,
                    );
                }

                // Check md5 of gz.
                const actualMd5 = createHash("md5")
                    .update(gzBytes)
                    .digest("hex");
                if (actualMd5 !== entry.md5) {
                    errors.push(
                        `dist/${regionId}/${basename(gzFile)}: md5 mismatch`,
                    );
                }
            } catch (err) {
                errors.push(
                    `dist/${regionId}/${basename(gzFile)}: ${err.message}`,
                );
            }
        }
    }

    // 3. Boundary-specific checks if boundaries.json.gz exists.
    const boundariesPath = resolve(distDir, "boundaries.json.gz");
    if (existsSync(boundariesPath)) {
        const boundaryErrors = await lintBoundaries(distDir);
        errors.push(...boundaryErrors);
    }

    // 4. Transit-specific checks if transit.json.gz exists.
    const transitPath = resolve(distDir, "transit.json.gz");
    let meta = null;
    if (existsSync(metaPath)) {
        try {
            meta = JSON.parse(await readFile(metaPath, "utf8"));
        } catch {
            /* ignore — meta validation already reported */
        }
    }
    const declaresTransit =
        meta?.artifacts?.includes("transit") || existsSync(transitPath);
    if (declaresTransit) {
        const transitErrors = await lintTransit({
            distDir,
            bbox: meta?.bbox ?? null,
        });
        errors.push(...transitErrors);
    }

    return errors;
}

/**
 * Lint the boundaries artifact for a region.
 *
 * @param {string} distDir - path to dist/<regionId>/
 * @param {string} distBase - path to dist/
 * @param {string} regionId - region id for error messages
 * @returns {Promise<string[]>} error messages
 */
async function lintBoundaries(distDir) {
    const errors = [];
    const boundariesPath = resolve(distDir, "boundaries.json.gz");

    try {
        const { decodeDeltaPolygon } = await import("./lib/deltaEncode.mjs");
        const gzBytes = await readFile(boundariesPath);
        const uncompressed = gunzipSync(gzBytes);
        const artifact = JSON.parse(uncompressed.toString("utf8"));

        // Read meta to get expected levels.
        const metaPath = resolve(distDir, "meta.json");
        let metaLevels = null;
        let metaMatchingLevels = null;
        if (existsSync(metaPath)) {
            try {
                const meta = JSON.parse(await readFile(metaPath, "utf8"));
                metaLevels = meta.adminLevels?.extract ?? null;
                metaMatchingLevels = meta.adminLevels?.matching ?? null;
            } catch {
                /* ignore */
            }
        }

        // Check levels in artifact ⊆ extract config.
        if (metaLevels && Array.isArray(artifact.levels)) {
            const extractSet = new Set(metaLevels);
            for (const lv of artifact.levels) {
                if (!extractSet.has(lv)) {
                    errors.push(
                        `boundaries.json.gz: level ${lv} not in adminLevels.extract (${JSON.stringify(metaLevels)})`,
                    );
                }
            }
        }

        // Print per-level counts and guard: border tiers (matching[0],
        // matching[1]) must have relations in the boundaries artifact.
        if (
            metaMatchingLevels &&
            Array.isArray(metaMatchingLevels) &&
            Array.isArray(artifact.index)
        ) {
            const levelCounts = {};
            for (const entry of artifact.index) {
                const lv = entry.adminLevel;
                if (lv != null) levelCounts[lv] = (levelCounts[lv] ?? 0) + 1;
            }
            console.log(
                `  [boundaries] Per-level counts (matching levels: ${JSON.stringify(metaMatchingLevels)}):`,
            );

            // Pre-compute extract set for border-tier guard.
            const extractSet = metaLevels
                ? new Set(metaLevels)
                : new Set(metaMatchingLevels);

            for (const lv of metaMatchingLevels.sort((a, b) => a - b)) {
                const count = levelCounts[lv] ?? 0;
                const flag =
                    count === 0
                        ? "  ⚠ ZERO — remove from matching"
                        : count < 10
                          ? `  ⚠ only ${count} — consider curating`
                          : "";
                console.log(`    Level ${lv}: ${count}${flag}`);
            }

            // Hard error: border tiers (first two matching levels) must have
            // ≥1 relation in the built boundaries index, and must be present
            // in adminLevels.extract.
            if (metaMatchingLevels.length >= 2) {
                const borderLevels = [
                    metaMatchingLevels[0],
                    metaMatchingLevels[1],
                ];
                for (const blv of borderLevels) {
                    if (!extractSet.has(blv)) {
                        errors.push(
                            `boundaries.json.gz: border tier level ${blv} not in adminLevels.extract ` +
                                `(${JSON.stringify(metaLevels ?? metaMatchingLevels)})`,
                        );
                    }
                    const bc = levelCounts[blv] ?? 0;
                    if (bc === 0) {
                        errors.push(
                            `boundaries.json.gz: border tier level ${blv} has 0 relations — ` +
                                `admin border questions will return no data`,
                        );
                    }
                }
            }
        }

        // Every index row has a polygon and vice versa.
        const idxRelIds = new Set(
            artifact.index.map((e) => String(e.relationId)),
        );
        const polyRelIds = new Set(Object.keys(artifact.polygons));

        for (const id of idxRelIds) {
            if (!polyRelIds.has(id)) {
                errors.push(
                    `boundaries.json.gz: index row ${id} has no polygon entry`,
                );
            }
        }
        for (const id of polyRelIds) {
            if (!idxRelIds.has(id)) {
                errors.push(
                    `boundaries.json.gz: polygon ${id} has no index entry`,
                );
            }
        }

        // Decode round-trip on up to 3 random relations.
        const relIds = [...polyRelIds];
        const sampleCount = Math.min(3, relIds.length);
        for (let si = 0; si < sampleCount; si++) {
            const rid = relIds[si];
            const encoded = artifact.polygons[rid];
            try {
                const decoded = decodeDeltaPolygon(encoded);
                const { encodeDeltaPolygon } = await import(
                    "./lib/deltaEncode.mjs"
                );
                // decodeDeltaPolygon always returns MultiPolygon coords
                // ([polygon[ring[point]]]). Unpack the outer wrapper for
                // single-polygon geometries so encodeDeltaPolygon gets the
                // right shape.
                const reencoded = encodeDeltaPolygon({
                    type: decoded.length > 1 ? "MultiPolygon" : "Polygon",
                    coordinates: decoded.length > 1 ? decoded : decoded[0],
                });
                if (JSON.stringify(reencoded) !== JSON.stringify(encoded)) {
                    errors.push(
                        `boundaries.json.gz: relation ${rid} failed decode/re-encode round-trip`,
                    );
                }
            } catch (err) {
                errors.push(
                    `boundaries.json.gz: relation ${rid} decode failed: ${err.message}`,
                );
            }
        }

        // Centroid falls inside polygon bbox for each index entry.
        for (const entry of artifact.index) {
            const bbox = entry.bbox;
            const centroid = entry.centroid;
            if (bbox && centroid) {
                if (
                    centroid[0] < bbox[0] ||
                    centroid[0] > bbox[2] ||
                    centroid[1] < bbox[1] ||
                    centroid[1] > bbox[3]
                ) {
                    errors.push(
                        `boundaries.json.gz: centroid ${JSON.stringify(centroid)} outside bbox ${JSON.stringify(bbox)} for relation ${entry.relationId}`,
                    );
                }
            }
        }

        // Warn above 10 MB gz.
        if (gzBytes.length > 10 * 1024 * 1024) {
            const mb = (gzBytes.length / 1024 / 1024).toFixed(2);
            console.warn(
                `  WARNING: boundaries.json.gz is ${mb} MB (>10 MB threshold)`,
            );
        }
    } catch (err) {
        errors.push(`boundaries.json.gz: lint error: ${err.message}`);
    }

    return errors;
}

/**
 * Lint the transit artifact for a region.
 *
 * @param {object} opts
 * @param {string} opts.distDir - path to dist/<regionId>/
 * @param {[number,number,number,number]|null} opts.bbox - region bbox [w,s,e,n]
 * @returns {Promise<string[]>} error messages
 */
async function lintTransit({ distDir, bbox }) {
    const errors = [];
    const transitPath = resolve(distDir, "transit.json.gz");

    if (!existsSync(transitPath)) {
        errors.push(`transit.json.gz: missing`);
        return errors;
    }

    let artifact;
    try {
        const gzBytes = await readFile(transitPath);
        const uncompressed = gunzipSync(gzBytes);
        artifact = JSON.parse(uncompressed.toString("utf8"));
    } catch (err) {
        errors.push(`transit.json.gz: ${err.message}`);
        return errors;
    }

    if (!artifact || typeof artifact !== "object") {
        errors.push(`transit.json.gz: must be a JSON object`);
        return errors;
    }

    if (!Array.isArray(artifact.presets)) {
        errors.push(`transit.json.gz: "presets" must be an array`);
        return errors;
    }

    // Read region ID from meta.json for region-specific checks.
    let regionId = null;
    const metaPath = resolve(distDir, "meta.json");
    if (existsSync(metaPath)) {
        try {
            const meta = JSON.parse(await readFile(metaPath, "utf8"));
            regionId = meta.id ?? null;
        } catch {
            /* ignore */
        }
    }

    const regionBbox = Array.isArray(bbox) ? bbox : null;
    const [west, south, east, north] = regionBbox ?? [-180, -90, 180, 90];
    // Small slop to account for floating-point extraction boundaries.
    const SLOP = 0.001;

    const hexColorRe = /^#[0-9a-fA-F]{3,8}$/;

    let anyRoute = false;
    let anyRouteStation = false;

    for (const preset of artifact.presets) {
        if (!preset || typeof preset !== "object") {
            errors.push(`transit.json.gz: preset must be an object`);
            continue;
        }

        // Preset ids must not contain ':' (T9 invariant).
        if (typeof preset.id === "string" && preset.id.includes(":")) {
            errors.push(
                `transit.json.gz: preset id "${preset.id}" contains ':'`,
            );
        }

        if (Array.isArray(preset.routes)) {
            for (const route of preset.routes) {
                if (!route || typeof route !== "object") {
                    errors.push(
                        `transit.json.gz: route in preset "${preset.id}" must be an object`,
                    );
                    continue;
                }

                if (!route.id || typeof route.id !== "string") {
                    errors.push(
                        `transit.json.gz: route in preset "${preset.id}" has no id`,
                    );
                }

                if (
                    route.color != null &&
                    (typeof route.color !== "string" ||
                        !hexColorRe.test(route.color))
                ) {
                    errors.push(
                        `transit.json.gz: route "${route.id}" color is not a valid hex color`,
                    );
                }

                const geom = route.geometry;
                if (!geom || typeof geom !== "object") {
                    errors.push(
                        `transit.json.gz: route "${route.id}" has no geometry`,
                    );
                    continue;
                }

                let parts = [];
                if (geom.type === "LineString") {
                    parts = [geom.coordinates];
                } else if (geom.type === "MultiLineString") {
                    parts = geom.coordinates;
                } else {
                    errors.push(
                        `transit.json.gz: route "${route.id}" geometry type must be LineString or MultiLineString`,
                    );
                    continue;
                }

                if (!Array.isArray(parts) || parts.length === 0) {
                    errors.push(
                        `transit.json.gz: route "${route.id}" geometry has no parts`,
                    );
                    continue;
                }

                for (let pi = 0; pi < parts.length; pi++) {
                    const part = parts[pi];
                    if (!Array.isArray(part) || part.length < 2) {
                        errors.push(
                            `transit.json.gz: route "${route.id}" part ${pi} has < 2 coordinates`,
                        );
                        continue;
                    }

                    for (let ci = 0; ci < part.length; ci++) {
                        const coord = part[ci];
                        if (
                            !Array.isArray(coord) ||
                            coord.length < 2 ||
                            !Number.isFinite(coord[0]) ||
                            !Number.isFinite(coord[1])
                        ) {
                            errors.push(
                                `transit.json.gz: route "${route.id}" part ${pi} coord ${ci} is not a finite [lon,lat]`,
                            );
                            continue;
                        }

                        if (regionBbox) {
                            const [lon, lat] = coord;
                            if (
                                lon < west - SLOP ||
                                lon > east + SLOP ||
                                lat < south - SLOP ||
                                lat > north + SLOP
                            ) {
                                errors.push(
                                    `transit.json.gz: route "${route.id}" part ${pi} coord ${ci} ${JSON.stringify(coord)} outside region bbox`,
                                );
                            }
                        }
                    }
                }

                anyRoute = true;
            }
        }

        if (Array.isArray(preset.stations)) {
            for (const station of preset.stations) {
                if (!station || typeof station !== "object") {
                    errors.push(
                        `transit.json.gz: station in preset "${preset.id}" must be an object`,
                    );
                    continue;
                }

                if (!station.id || typeof station.id !== "string") {
                    errors.push(
                        `transit.json.gz: station in preset "${preset.id}" has no id`,
                    );
                }

                if (regionBbox) {
                    const { lon, lat } = station;
                    if (
                        typeof lon !== "number" ||
                        typeof lat !== "number" ||
                        !Number.isFinite(lon) ||
                        !Number.isFinite(lat) ||
                        lon < west - SLOP ||
                        lon > east + SLOP ||
                        lat < south - SLOP ||
                        lat > north + SLOP
                    ) {
                        errors.push(
                            `transit.json.gz: station "${station.id}" (${lon},${lat}) outside region bbox`,
                        );
                    }
                }

                if (
                    Array.isArray(station.routeIds) &&
                    station.routeIds.length > 0
                ) {
                    anyRouteStation = true;
                }
            }
        }
    }

    // Per-operator route-count sanity bound (guards per-train proliferation).
    // Railway-infrastructure mode collapses per-train routes into per-line,
    // so the bound is tighter for those regions.
    const maxRoutesPerOperator = 250;
    for (const preset of artifact.presets) {
        if (
            preset.kind === "operator" &&
            preset.routes.length > maxRoutesPerOperator
        ) {
            errors.push(
                `transit.json.gz: operator preset "${preset.id}" has ${preset.routes.length} routes (> ${maxRoutesPerOperator}) — possible per-train proliferation`,
            );
        }
    }

    // Additional tight bound for railway-infrastructure regions: per-line
    // routes should be well under 50 per operator.
    // Only applies to regions using useRailwayInfrastructure mode (Taiwan).
    // Japan uses the PTv2 service layer (route=train/subway) where 85+
    // routes per operator (e.g. JR East) is normal and correct.
    const maxRoutesInfra = 50;
    let isRailwayInfraRegion = false;
    if (regionId) {
        // Taiwan is the canonical railway-infrastructure region.
        // Japan regions use the PTv2 service layer — skip this check.
        isRailwayInfraRegion = !regionId.startsWith("asia-japan-");
    }
    if (isRailwayInfraRegion) {
        const hasRailwayRoutes = artifact.presets.some((p) =>
            (p.routes || []).some(
                (r) => r.name && /線/.test(r.name) && !/支線/.test(r.name),
            ),
        );
        if (hasRailwayRoutes) {
            for (const preset of artifact.presets) {
                if (
                    preset.kind === "operator" &&
                    preset.routes.length > maxRoutesInfra
                ) {
                    errors.push(
                        `transit.json.gz: operator preset "${preset.id}" has ${preset.routes.length} routes (> ${maxRoutesInfra} railway-infrastructure bound) — possible per-train leakage`,
                    );
                }
            }
        }
    }

    // Linkage sanity: a transit-declaring region must have at least one route
    // and at least one station linked to a route.
    if (!anyRoute) {
        errors.push(
            `transit.json.gz: no preset has routes — expected at least one route`,
        );
    }
    if (!anyRouteStation) {
        errors.push(
            `transit.json.gz: no station has routeIds — expected at least one station linked to a route`,
        );
    }

    // Transit-quality assertions (region-specific).
    const qualityErrors = await checkTransitQuality(artifact, distDir);
    errors.push(...qualityErrors);

    return errors;
}

/**
 * Deep quality assertions on transit artifact content.
 *
 * These checks run against the built artifact (local dist/) and guard against
 * silent regressions in station→route membership, edge presence, and route
 * geometry quality. Each region can define a set of known-good station/edge
 * invariants; regions without a config skip the check.
 *
 * @param {object} artifact - parsed transit.json
 * @param {string} distDir - path to dist/<regionId>/
 * @returns {Promise<string[]>} error messages
 */
async function checkTransitQuality(artifact, distDir) {
    const errors = [];

    // Read meta.json for region id so we can look up region-specific invariants.
    const metaPath = resolve(distDir, "meta.json");
    let regionId = null;
    if (existsSync(metaPath)) {
        try {
            const meta = JSON.parse(await readFile(metaPath, "utf8"));
            regionId = meta.regionId ?? meta.id ?? null;
        } catch {
            /* ignore */
        }
    }
    if (!regionId) return errors;

    // Build lookup: station name → set of routeIds.
    /** @type {Map<string, Set<string>>} */
    const stationRoutes = new Map();
    for (const preset of artifact.presets) {
        if (!Array.isArray(preset.stations)) continue;
        for (const s of preset.stations) {
            if (!s.name || !Array.isArray(s.routeIds)) continue;
            const entry = stationRoutes.get(s.name) ?? new Set();
            for (const rid of s.routeIds) entry.add(rid);
            stationRoutes.set(s.name, entry);
        }
    }

    // ── Kanto invariants ──────────────────────────────────────────────────
    if (regionId === "asia-japan-kanto") {
        // Station route-count assertions.
        const expectedCounts = {
            中目黒: 2, // Tōyoko + Hibiya (verified 2026-06-14)
            広尾: 1, // Hibiya only (verified 2026-06-14)
            駒場東大前: 1, // Inokashira (Keio) (verified 2026-06-14)
            代官山: 1, // Tōyoko (Tokyu) (verified 2026-06-14)
            原宿: 1, // Yamanote only — express services excluded by spatial-attach gate
            目黒: 4, // Yamanote + Mita + Namboku + Tōkyū-Meguro (verified 2026-06-14)
        };
        for (const [name, expected] of Object.entries(expectedCounts)) {
            const routes = stationRoutes.get(name);
            const count = routes?.size ?? 0;
            if (count !== expected) {
                const suffix =
                    count === 0 ? " (STATION MISSING — check OSM extract)" : "";
                errors.push(
                    `transit-quality: station "${name}" has ${count} route(s), expected ${expected}${suffix}`,
                );
            }
        }

        // Shared-edge assertions: both stations must share ≥1 route.
        const sharedEdgePairs = [
            ["目黒", "白金台"], // Meguro ↔ Shirokanedai (shared Mita/Namboku track)
        ];
        for (const [a, b] of sharedEdgePairs) {
            const routesA = stationRoutes.get(a);
            const routesB = stationRoutes.get(b);
            const shared = new Set();
            if (routesA && routesB) {
                for (const rid of routesA) {
                    if (routesB.has(rid)) shared.add(rid);
                }
            }
            if (shared.size === 0) {
                const missingA = !routesA ? `"${a}" not found` : "";
                const missingB = !routesB ? `"${b}" not found` : "";
                const detail = [missingA, missingB].filter(Boolean).join("; ");
                errors.push(
                    `transit-quality: edge "${a}"↔"${b}" has no shared route${detail ? ` (${detail})` : ""}`,
                );
            }
        }
    }

    // ── Other Japan region invariants ─────────────────────────────────────
    // Each Japan region should have at least 1 station with ≥2 routes
    // (a transit hub), which confirms route=train/subway service-layer
    // relations are present and correctly attached.
    if (regionId.startsWith("asia-japan-")) {
        const hubCount = [...stationRoutes.values()].filter(
            (s) => s.size >= 2,
        ).length;
        if (hubCount === 0) {
            errors.push(
                `transit-quality: no station has ≥2 routes — possible service-layer drop or attachment failure`,
            );
        }
    }

    return errors;
}

async function main() {
    const args = process.argv.slice(2);
    let regionId = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--region" && i + 1 < args.length) {
            regionId = args[++i];
        }
    }

    if (!regionId) {
        console.error("Usage: pnpm data:pack:lint -- --region <id>");
        process.exitCode = 2;
        return;
    }

    const errors = await lintRegion(regionId);

    if (errors.length > 0) {
        console.error(`\nLint FAILED for ${regionId}:`);
        for (const err of errors) {
            console.error(`  ${err}`);
        }
        process.exitCode = 1;
    } else {
        console.log(`Lint PASSED for ${regionId}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

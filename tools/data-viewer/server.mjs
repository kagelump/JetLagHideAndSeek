import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const transitGeojson = require("./lib/transitGeojson.js");
const columnarToGeojson = require("./lib/columnarToGeojson.js");

const ROOT = resolve(import.meta.dirname, "../..");
const PORT = 3210;

const MEASURING_FILES = [
    "coastline",
    "high-speed-rail",
    "body-of-water",
    "admin-1st-border",
    "admin-2nd-border",
];

// Parse --pack <dir> flag from arguments.
let packDistDir = null;
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--pack" && i + 1 < process.argv.length) {
        packDistDir = resolve(process.argv[i + 1]);
        break;
    }
}

function readJson(relPath) {
    return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

function measuringGeojson(category) {
    const data = readJson(`assets/measuring/${category}.json`);
    return { type: "FeatureCollection", features: data.features ?? [] };
}

function zonesGeojson() {
    const tokyo = readJson("assets/default-zones/tokyo.json");
    const osaka = readJson("assets/default-zones/osaka.json");
    return {
        type: "FeatureCollection",
        features: [...(tokyo.features ?? []), ...(osaka.features ?? [])],
    };
}

function poisGeojson() {
    const data = readJson("assets/poi/japan-kanto.json");
    const features = [];
    for (const [category, cat] of Object.entries(data.categories)) {
        for (let i = 0; i < cat.count; i++) {
            features.push({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [cat.lon[i], cat.lat[i]],
                },
                properties: {
                    category,
                    name: cat.name[i] ?? null,
                    osmId: cat.osmId[i] ?? null,
                    osmType: cat.osmType[i] ?? null,
                    ...(cat.iata ? { iata: cat.iata[i] ?? null } : {}),
                    ...(cat.nameLength
                        ? { nameLength: cat.nameLength[i] ?? null }
                        : {}),
                },
            });
        }
    }
    return { type: "FeatureCollection", features };
}

/**
 * Load a pack's boundaries artifact and return decoded features as a
 * GeoJSON FeatureCollection for a given admin level.
 *
 * @param {string} regionId - region id (directory name under packDistDir)
 * @param {number} level - admin_level to filter by
 * @returns {object} GeoJSON FeatureCollection
 */
function packBoundariesGeojson(regionId, level) {
    const gzPath = join(packDistDir, regionId, "boundaries.json.gz");
    if (!existsSync(gzPath)) {
        return { type: "FeatureCollection", features: [] };
    }

    const gzBytes = readFileSync(gzPath);
    const uncompressed = gunzipSync(gzBytes);
    const artifact = JSON.parse(uncompressed.toString("utf8"));

    // Use the same delta-encoding import approach as the pack pipeline.
    const { decodeDeltaPolygon } = require("./lib/deltaEncode.js");

    const features = [];
    for (const entry of artifact.index) {
        if (entry.adminLevel !== Number(level)) continue;
        const rid = String(entry.relationId);
        const encoded = artifact.polygons[rid];
        if (!encoded) continue;

        const decoded = decodeDeltaPolygon(encoded);
        const geomType = decoded.length > 1 ? "MultiPolygon" : "Polygon";
        const coordinates = decoded.length === 1 ? decoded[0] : decoded;

        features.push({
            type: "Feature",
            geometry: {
                type: geomType,
                coordinates,
            },
            properties: {
                relationId: entry.relationId,
                name: entry.name,
                nameEn: entry.nameEn ?? null,
                adminLevel: entry.adminLevel,
            },
        });
    }

    return { type: "FeatureCollection", features };
}

const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    if (pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(join(import.meta.dirname, "index.html"), "utf8"));
        return;
    }

    const measuringMatch = pathname.match(/^\/api\/measuring\/([\w-]+)$/);
    if (measuringMatch) {
        const category = measuringMatch[1];
        if (!MEASURING_FILES.includes(category)) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `unknown category: ${category}` }));
            return;
        }
        try {
            const geojson = measuringGeojson(category);
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
            });
            res.end(JSON.stringify(geojson));
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (pathname === "/api/pois") {
        try {
            const geojson = poisGeojson();
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
            });
            res.end(JSON.stringify(geojson));
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (pathname === "/api/zones") {
        try {
            const geojson = zonesGeojson();
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
            });
            res.end(JSON.stringify(geojson));
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (pathname === "/api/transit-routes") {
        try {
            const bundle = readJson("assets/transit/japan-kanto.json");
            const geojson = transitGeojson.buildRouteFeatureCollection(
                bundle.presets ?? [],
            );
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
            });
            res.end(JSON.stringify(geojson));
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (pathname === "/api/transit-stations") {
        try {
            const bundle = readJson("assets/transit/japan-kanto.json");
            const stations = transitGeojson.getSelectedStations(
                bundle.presets ?? [],
            );
            const geojson =
                transitGeojson.buildAllWedgeFeatureCollections(stations);
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
            });
            res.end(JSON.stringify(geojson));
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // Pack-associated routes (only if --pack <dir> was specified).
    if (packDistDir) {
        // /api/pack/regions — list available pack regions
        if (pathname === "/api/pack/regions") {
            try {
                const { readdirSync } = require("node:fs");
                const regions = readdirSync(packDistDir, {
                    withFileTypes: true,
                })
                    .filter((d) => d.isDirectory())
                    .map((d) => d.name)
                    .filter((name) =>
                        existsSync(join(packDistDir, name, "meta.json")),
                    );
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                });
                res.end(JSON.stringify(regions));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // /api/pack/<regionId>/meta — return parsed meta.json
        const packMetaMatch = pathname.match(/^\/api\/pack\/([\w-]+)\/meta$/);
        if (packMetaMatch) {
            const regionId = packMetaMatch[1];
            const metaPath = join(packDistDir, regionId, "meta.json");
            if (!existsSync(metaPath)) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "meta.json not found" }));
                return;
            }
            try {
                const meta = JSON.parse(readFileSync(metaPath, "utf8"));
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                });
                res.end(JSON.stringify(meta));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // /api/pack/<regionId>/poi/<category> — columnar→Point features
        const packPoiMatch = pathname.match(
            /^\/api\/pack\/([\w-]+)\/poi\/([\w-]+)$/,
        );
        if (packPoiMatch) {
            const regionId = packPoiMatch[1];
            const category = packPoiMatch[2];
            try {
                const gzPath = join(packDistDir, regionId, "poi.json.gz");
                if (!existsSync(gzPath)) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "poi.json.gz not found" }));
                    return;
                }
                const gzBytes = readFileSync(gzPath);
                const uncompressed = gunzipSync(gzBytes);
                const artifact = JSON.parse(uncompressed.toString("utf8"));
                const cats = artifact.categories || {};
                const cat = cats[category];
                if (!cat) {
                    res.writeHead(200, {
                        "Content-Type": "application/json",
                        "Cache-Control": "no-cache",
                    });
                    res.end(
                        JSON.stringify({
                            type: "FeatureCollection",
                            features: [],
                        }),
                    );
                    return;
                }
                const geojson = columnarToGeojson.categoryToFeatures(
                    category,
                    cat,
                );
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                });
                res.end(JSON.stringify(geojson));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // /api/pack/<regionId>/measuring/<category> — features from bundle
        const packMeasuringMatch = pathname.match(
            /^\/api\/pack\/([\w-]+)\/measuring\/([\w-]+)$/,
        );
        if (packMeasuringMatch) {
            const regionId = packMeasuringMatch[1];
            const category = packMeasuringMatch[2];
            try {
                const gzPath = join(
                    packDistDir,
                    regionId,
                    `measuring-${category}.json.gz`,
                );
                if (!existsSync(gzPath)) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            error: `measuring-${category}.json.gz not found`,
                        }),
                    );
                    return;
                }
                const gzBytes = readFileSync(gzPath);
                const uncompressed = gunzipSync(gzBytes);
                const artifact = JSON.parse(uncompressed.toString("utf8"));
                const geojson = {
                    type: "FeatureCollection",
                    features: artifact.features ?? [],
                };
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                });
                res.end(JSON.stringify(geojson));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // /api/pack/<regionId>/transit — reuse lib/transitGeojson.js
        const packTransitMatch = pathname.match(
            /^\/api\/pack\/([\w-]+)\/transit\/(routes|stations)$/,
        );
        if (packTransitMatch) {
            const regionId = packTransitMatch[1];
            const sub = packTransitMatch[2];
            try {
                const gzPath = join(packDistDir, regionId, "transit.json.gz");
                if (!existsSync(gzPath)) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({
                            error: "transit.json.gz not found",
                        }),
                    );
                    return;
                }
                const gzBytes = readFileSync(gzPath);
                const uncompressed = gunzipSync(gzBytes);
                const artifact = JSON.parse(uncompressed.toString("utf8"));
                const presets = artifact.presets ?? [];
                let geojson;
                if (sub === "routes") {
                    geojson =
                        transitGeojson.buildRouteFeatureCollection(presets);
                } else {
                    const stations =
                        transitGeojson.getSelectedStations(presets);
                    geojson =
                        transitGeojson.buildAllWedgeFeatureCollections(
                            stations,
                        );
                }
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                });
                res.end(JSON.stringify(geojson));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Keep existing /api/pack/<regionId>/boundaries/<level>
        const packBoundariesMatch = pathname.match(
            /^\/api\/pack\/([\w-]+)\/boundaries\/(\d+)$/,
        );
        if (packBoundariesMatch) {
            const regionId = packBoundariesMatch[1];
            const level = parseInt(packBoundariesMatch[2], 10);
            try {
                const geojson = packBoundariesGeojson(regionId, level);
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                });
                res.end(JSON.stringify(geojson));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }
    } // closes if (packDistDir)

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    const msg = `Data viewer running at http://localhost:${PORT}`;
    console.log(msg);
    if (packDistDir) {
        console.log(`  Pack directory: ${packDistDir}`);
    }
});

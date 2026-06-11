import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const transitGeojson = require("./lib/transitGeojson.js");

const ROOT = resolve(import.meta.dirname, "../..");
const PORT = 3210;

const MEASURING_FILES = [
    "coastline",
    "high-speed-rail",
    "body-of-water",
    "admin-1st-border",
    "admin-2nd-border",
];

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
                transitGeojson.buildStationFeatureCollection(stations);
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

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Data viewer running at http://localhost:${PORT}`);
});

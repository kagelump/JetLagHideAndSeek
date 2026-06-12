/**
 * Tests for shared data-viewer transforms (columnar→GeoJSON, payload-kind
 * sniffing, transit pass-through).
 *
 * Run with: node --test tools/data-viewer/__tests__/sharedTransforms.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const columnarToGeojson = require("../lib/columnarToGeojson.js");
const { sniffKind } = require("../lib/sniffKind.js");

// ── Columnar → GeoJSON ─────────────────────────────────────────────────────

describe("columnarToGeojson", () => {
    it("converts a non-empty category", () => {
        const cat = {
            count: 2,
            lon: [139.7, 139.8],
            lat: [35.7, 35.8],
            name: ["Tokyo Stn", "Shinjuku Stn"],
            osmId: [1, 2],
            osmType: ["node", "node"],
        };
        const result = columnarToGeojson.categoryToFeatures("station", cat);
        assert.equal(result.type, "FeatureCollection");
        assert.equal(result.features.length, 2);

        const f0 = result.features[0];
        assert.deepEqual(f0.geometry.coordinates, [139.7, 35.7]);
        assert.equal(f0.properties.name, "Tokyo Stn");
        assert.equal(f0.properties.osmId, 1);
        assert.equal(f0.properties.category, "station");

        const f1 = result.features[1];
        assert.deepEqual(f1.geometry.coordinates, [139.8, 35.8]);
    });

    it("handles empty category", () => {
        const cat = {
            count: 0,
            lon: [],
            lat: [],
            name: [],
            osmId: [],
            osmType: [],
        };
        const result = columnarToGeojson.categoryToFeatures("empty-cat", cat);
        assert.equal(result.type, "FeatureCollection");
        assert.equal(result.features.length, 0);
    });

    it("converts all categories from a POI bundle", () => {
        const bundle = {
            categories: {
                park: {
                    count: 1,
                    lon: [139.7],
                    lat: [35.7],
                    name: ["Yoyogi Park"],
                    osmId: [10],
                    osmType: ["relation"],
                },
                museum: {
                    count: 1,
                    lon: [139.8],
                    lat: [35.8],
                    name: ["Tokyo National Museum"],
                    osmId: [20],
                    osmType: ["node"],
                },
            },
        };
        const result = columnarToGeojson.allCategoriesToFeatures(bundle);
        assert.equal(result.type, "FeatureCollection");
        assert.equal(result.features.length, 2);
    });

    it("includes optional iata and nameLength fields", () => {
        const cat = {
            count: 1,
            lon: [139.8],
            lat: [35.6],
            name: ["Haneda"],
            osmId: [99],
            osmType: ["node"],
            iata: ["HND"],
            nameLength: [6],
        };
        const result = columnarToGeojson.categoryToFeatures("airport", cat);
        assert.equal(result.features[0].properties.iata, "HND");
        assert.equal(result.features[0].properties.nameLength, 6);
    });

    it("allCategoriesToFeatures handles missing categories", () => {
        const bundle = {};
        const result = columnarToGeojson.allCategoriesToFeatures(bundle);
        assert.equal(result.features.length, 0);
    });
});

// ── Payload kind sniffing (for drag-drop) ───────────────────────────────────

describe("payload kind sniffing", () => {
    it("sniffs POI bundle", () => {
        const kind = sniffKind({
            categories: {
                park: {
                    count: 1,
                    lon: [],
                    lat: [],
                    name: [],
                    osmId: [],
                    osmType: [],
                },
            },
            totalCount: 1,
        });
        assert.equal(kind, "poi");
    });

    it("sniffs measuring bundle", () => {
        const kind = sniffKind({
            category: "coastline",
            features: [
                {
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: [] },
                },
            ],
        });
        assert.equal(kind, "measuring");
    });

    it("sniffs boundaries artifact", () => {
        const kind = sniffKind({
            index: [{ relationId: 1, adminLevel: 4, name: "Test" }],
            polygons: { 1: [1, 0, 0, 0] },
        });
        assert.equal(kind, "boundaries");
    });

    it("sniffs transit bundle", () => {
        const kind = sniffKind({
            presets: [{ id: "test", stations: [], routes: [] }],
        });
        assert.equal(kind, "transit");
    });

    it("sniffs meta", () => {
        const kind = sniffKind({
            regionId: "europe-netherlands",
            adminLevels: { matching: [4, 8] },
        });
        assert.equal(kind, "meta");
    });

    it("returns null for unknown shape", () => {
        const kind = sniffKind({ foo: "bar" });
        assert.equal(kind, null);
    });

    it("returns null for null payload", () => {
        assert.equal(sniffKind(null), null);
    });
});

// ── Transit pass-through ────────────────────────────────────────────────────

describe("transit pass-through", () => {
    it("transitGeojson module loads and functions exist", () => {
        const tg = require("../lib/transitGeojson.js");
        assert.equal(typeof tg.buildRouteFeatureCollection, "function");
        assert.equal(typeof tg.buildStationFeatureCollection, "function");
        assert.equal(typeof tg.getSelectedStations, "function");
    });

    it("transit buildRouteFeatureCollection handles pack-style presets (post-N3 schema)", () => {
        const tg = require("../lib/transitGeojson.js");
        const presets = [
            {
                id: "test-route",
                label: "Test Line",
                routes: [
                    {
                        id: "route1",
                        name: "Test Route",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [139.7, 35.7],
                                [139.8, 35.8],
                            ],
                        },
                        color: "#ff0000",
                    },
                ],
                stations: [
                    {
                        id: "s1",
                        mergeKey: "mk1",
                        lat: 35.7,
                        lon: 139.7,
                        name: "Station A",
                        routeIds: ["route1"],
                    },
                    {
                        id: "s2",
                        mergeKey: "mk2",
                        lat: 35.8,
                        lon: 139.8,
                        name: "Station B",
                        routeIds: ["route1"],
                    },
                ],
            },
        ];

        const routes = tg.buildRouteFeatureCollection(presets);
        assert.equal(routes.type, "FeatureCollection");
        assert.equal(routes.features.length, 1);
        assert.equal(routes.features[0].properties.color, "#ff0000");
        assert.equal(routes.features[0].properties.name, "Test Route");

        const stations = tg.getSelectedStations(presets);
        assert.equal(stations.length, 2);

        const stationFeatures = tg.buildStationFeatureCollection(stations);
        assert.equal(stationFeatures.type, "FeatureCollection");
        assert.equal(stationFeatures.features.length, 2);
    });
});

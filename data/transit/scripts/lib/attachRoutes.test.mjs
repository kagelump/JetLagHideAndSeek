import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachRoutesToPresets } from "./attachRoutes.mjs";

function makePreset(id, operator, stations) {
    return {
        id,
        operator,
        defaultColor: "#1f6f78",
        routes: [],
        stations: stations.map((s) => ({
            id: s.id,
            sourceId: s.id,
            mergeKey: s.mergeKey || s.id,
            name: s.name,
            routeIds: [],
        })),
    };
}

describe("attachRoutesToPresets", () => {
    it("places a route in its operator preset and colors member stations there", () => {
        const presets = [
            makePreset("p-a", "Operator A", [
                { id: "osm:node:1", name: "Hub" },
            ]),
        ];
        const lines = [
            {
                id: "osm:relation:10",
                name: "A Line",
                color: "#FF0000",
                sourceId: "10",
                operator: "Operator A",
                memberStationIds: ["osm:node:1"],
                geometry: { type: "MultiLineString", coordinates: [] },
            },
        ];

        attachRoutesToPresets(presets, lines, (op) => op);

        assert.equal(presets[0].routes.length, 1);
        assert.deepEqual(presets[0].stations[0].routeIds, ["osm:relation:10"]);
    });

    it("attaches routeId to member stations in other operator presets", () => {
        const presets = [
            makePreset("p-a", "Operator A", [
                { id: "osm:node:1", name: "Hub", mergeKey: "osm:node:1" },
            ]),
            makePreset("p-b", "Operator B", [
                { id: "osm:node:1", name: "Hub", mergeKey: "osm:node:1" },
            ]),
            makePreset("p-cov", "other", [
                { id: "osm:node:1", name: "Hub", mergeKey: "osm:node:1" },
            ]),
        ];
        const lines = [
            {
                id: "osm:relation:20",
                name: "Shared Line",
                color: "#00AA00",
                sourceId: "20",
                operator: "Operator A",
                memberStationIds: ["osm:node:1"],
                geometry: { type: "MultiLineString", coordinates: [] },
            },
        ];

        attachRoutesToPresets(presets, lines, (op) => op);

        assert.deepEqual(presets[0].stations[0].routeIds, ["osm:relation:20"]);
        assert.deepEqual(presets[1].stations[0].routeIds, ["osm:relation:20"]);
        assert.deepEqual(presets[2].stations[0].routeIds, ["osm:relation:20"]);
    });

    it("skips routes whose operator has no matching preset", () => {
        const presets = [
            makePreset("p-a", "Operator A", [
                { id: "osm:node:1", name: "Hub" },
            ]),
        ];
        const lines = [
            {
                id: "osm:relation:30",
                name: "Orphan Line",
                color: "#0000FF",
                sourceId: "30",
                operator: "Unknown Operator",
                memberStationIds: ["osm:node:1"],
                geometry: { type: "MultiLineString", coordinates: [] },
            },
        ];

        attachRoutesToPresets(presets, lines, (op) => op);

        assert.equal(presets[0].routes.length, 0);
        assert.deepEqual(presets[0].stations[0].routeIds, ["osm:relation:30"]);
    });
});

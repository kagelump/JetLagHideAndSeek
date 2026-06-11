import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { processOsmRoutes } from "./osmRoutes.mjs";

describe("processOsmRoutes", () => {
    it("groups route variants under a route_master into one line", () => {
        const relations = [
            {
                id: 100,
                properties: {
                    tags: {
                        route_master: "train",
                        name: "Red Line",
                        colour: "#FF0000",
                        operator: "TestCo",
                    },
                },
                members: [
                    { ref: "101", role: "route" },
                    { ref: "102", role: "route" },
                ],
            },
            {
                id: 101,
                properties: {
                    tags: { route: "train", name: "Red Line North" },
                },
                members: [
                    { ref: "1", role: "stop" },
                    { ref: "2", role: "stop" },
                ],
            },
            {
                id: 102,
                properties: {
                    tags: { route: "train", name: "Red Line South" },
                },
                members: [
                    { ref: "1", role: "stop" },
                    { ref: "3", role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:1", name: "Station A", lat: 35.0, lon: 139.0 },
            { id: "osm:node:2", name: "Station B", lat: 35.1, lon: 139.1 },
            { id: "osm:node:3", name: "Station C", lat: 35.2, lon: 139.2 },
        ];

        const localeConfig = { nameSuffixes: ["駅"], operators: [] };

        const { lines, stats } = processOsmRoutes(
            relations,
            stationRecords,
            localeConfig,
        );

        assert.equal(stats.masterCount, 1);
        assert.equal(stats.masterlessCount, 0);
        assert.equal(lines.length, 1);
        assert.equal(lines[0].name, "Red Line");
        assert.equal(lines[0].color, "#FF0000");
        assert.ok(lines[0].memberStationIds.length >= 2);
    });

    it("masterless route becomes its own line", () => {
        const relations = [
            {
                id: 200,
                properties: { tags: { route: "train", name: "Lone Line" } },
                members: [
                    { ref: "10", role: "stop" },
                    { ref: "11", role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:10", name: "Station X", lat: 35.0, lon: 139.0 },
            { id: "osm:node:11", name: "Station Y", lat: 35.1, lon: 139.1 },
        ];

        const { lines, stats } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
        });

        assert.equal(stats.masterlessCount, 1);
        assert.equal(lines.length, 1);
        assert.equal(lines[0].id, "osm:relation:200");
    });

    it("drops lines with fewer than 2 resolved stations", () => {
        const relations = [
            {
                id: 300,
                properties: { tags: { route: "train", name: "Stub" } },
                members: [{ ref: "20", role: "stop" }],
            },
        ];

        const stationRecords = [
            { id: "osm:node:20", name: "Only Stop", lat: 35.0, lon: 139.0 },
        ];

        const { lines, stats } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
        });

        assert.equal(lines.length, 0);
        assert.equal(stats.linesTooFewStations, 1);
    });

    it("drops OSM lines whose operator is declared routeSource: gtfs", () => {
        const relations = [
            {
                id: 400,
                properties: {
                    tags: {
                        route_master: "train",
                        name: "Metro Line",
                        operator: "東京メトロ",
                    },
                },
                members: [{ ref: "401", role: "route" }],
            },
            {
                id: 401,
                properties: { tags: { route: "train", name: "Metro Line" } },
                members: [
                    { ref: "30", role: "stop" },
                    { ref: "31", role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:30", name: "Stop 30", lat: 35.0, lon: 139.0 },
            { id: "osm:node:31", name: "Stop 31", lat: 35.1, lon: 139.1 },
        ];

        const localeConfig = {
            nameSuffixes: ["駅"],
            operators: [
                {
                    match: {
                        gtfsNamespace: "odpt-tokyo-metro",
                        osmOperator: ["東京メトロ", "Tokyo Metro"],
                    },
                    routeSource: "gtfs",
                },
            ],
        };

        const { lines, stats } = processOsmRoutes(
            relations,
            stationRecords,
            localeConfig,
        );

        assert.equal(stats.linesDroppedGtfs, 1);
        assert.equal(lines.length, 0);
    });
});

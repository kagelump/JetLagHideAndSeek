import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    processOsmRoutes,
    lineNameKey,
    lineDisplayName,
    resolveLineColor,
} from "./osmRoutes.mjs";

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

    it("collapses masterless per-train variants into one logical line", () => {
        const relations = [
            {
                id: 501,
                properties: {
                    tags: {
                        route: "train",
                        name: "Express 101 Downtown→Uptown",
                        operator: "TestRail",
                    },
                },
                members: [
                    { ref: "40", role: "stop" },
                    { ref: "41", role: "stop" },
                ],
            },
            {
                id: 502,
                properties: {
                    tags: {
                        route: "train",
                        name: "Express 202 Uptown→Downtown",
                        operator: "TestRail",
                    },
                },
                members: [
                    { ref: "41", role: "stop" },
                    { ref: "42", role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:40", name: "Downtown", lat: 35.0, lon: 139.0 },
            { id: "osm:node:41", name: "Midtown", lat: 35.1, lon: 139.1 },
            { id: "osm:node:42", name: "Uptown", lat: 35.2, lon: 139.2 },
        ];

        const { lines, stats } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
        });

        assert.equal(lines.length, 1);
        assert.equal(lines[0].name, "Express");
        assert.deepEqual(
            new Set(lines[0].memberStationIds),
            new Set(["osm:node:40", "osm:node:41", "osm:node:42"]),
        );
        assert.ok(stats.collapsedGroups >= 1);
    });

    it("applies deterministic color fallback to uncolored lines", () => {
        const relations = [
            {
                id: 600,
                properties: {
                    tags: {
                        route: "train",
                        name: "Uncolored Line",
                        operator: "TestRail",
                    },
                },
                members: [
                    { ref: "50", role: "stop" },
                    { ref: "51", role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:50", name: "Stop 50", lat: 35.0, lon: 139.0 },
            { id: "osm:node:51", name: "Stop 51", lat: 35.1, lon: 139.1 },
        ];

        const { lines } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
        });

        assert.equal(lines.length, 1);
        assert.match(lines[0].color, /^#[0-9a-fA-F]{6}$/);
        assert.notEqual(lines[0].color.toLowerCase(), "#1f6f78");
    });

    it("applies transitOverrides routeColors in processOsmRoutes", () => {
        const relations = [
            {
                id: 601,
                properties: {
                    tags: {
                        route: "train",
                        name: "Special Service 123",
                        operator: "TestRail",
                    },
                },
                members: [
                    { ref: "52", role: "stop" },
                    { ref: "53", role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:52", name: "Stop 52", lat: 35.0, lon: 139.0 },
            { id: "osm:node:53", name: "Stop 53", lat: 35.1, lon: 139.1 },
        ];

        const { lines } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
            routeColors: { "special service": "#AABBCC" },
        });

        assert.equal(lines.length, 1);
        assert.equal(lines[0].color.toLowerCase(), "#aabbcc");
    });
});

describe("lineNameKey", () => {
    it("strips train numbers and direction arrows", () => {
        assert.equal(lineNameKey("台灣高鐵 603 南港→左營"), "台灣高鐵");
    });

    it("strips parenthetical direction notes", () => {
        assert.equal(
            lineNameKey("臺北捷運環狀線（大坪林→新北產業園區）"),
            "臺北捷運環狀線",
        );
    });

    it("strips configured direction tokens", () => {
        assert.equal(
            lineNameKey("Red Line Inbound", ["inbound", "outbound"]),
            "red line",
        );
    });

    it("returns empty for missing names", () => {
        assert.equal(lineNameKey(""), "");
        assert.equal(lineNameKey(null), "");
    });

    it("strips bare arrow direction suffixes", () => {
        assert.equal(lineNameKey("A→B"), "a");
    });

    it("strips CJK direction tokens as substrings", () => {
        assert.equal(lineNameKey("快速上り"), "快速");
    });

    it("strips trailing dash direction suffixes", () => {
        assert.equal(
            lineNameKey("Red Line - Inbound", ["inbound", "outbound"]),
            "red line",
        );
    });

    it("strips whole name when only direction token remains", () => {
        assert.equal(lineNameKey("101 Inbound", ["inbound", "outbound"]), "");
    });

    it("returns empty for undefined", () => {
        assert.equal(lineNameKey(undefined), "");
    });

    it("matches caller tokens case-insensitively", () => {
        assert.equal(lineNameKey("Mixed Inbound", ["inBound"]), "mixed");
    });

    it("documents compound dash + caller token suffix behavior", () => {
        assert.equal(
            lineNameKey("Red Line - North Inbound", ["inbound", "outbound"]),
            "red line",
        );
    });

    it("handles multiple arrow variants", () => {
        assert.equal(lineNameKey("A -> B"), "a");
        assert.equal(lineNameKey("Line A ⇒ B"), "line a");
    });

    it("preserves hyphenated core names", () => {
        assert.equal(lineNameKey("A-B Line"), "a-b line");
    });

    it("strips dash + cardinal direction suffix", () => {
        assert.equal(lineNameKey("Red Line-North"), "red line");
    });

    it("NFKC-normalizes fullwidth numbers", () => {
        assert.equal(lineNameKey("Line １２３"), "line");
    });

    it("collapses varied whitespace", () => {
        assert.equal(lineNameKey("Line　A　Inbound"), "line a");
    });
});

describe("lineDisplayName", () => {
    it("strips train numbers and arrows while preserving casing", () => {
        assert.equal(lineDisplayName("台灣高鐵 603 南港→左營"), "台灣高鐵");
    });

    it("strips parenthetical direction notes while preserving casing", () => {
        assert.equal(
            lineDisplayName("臺北捷運環狀線（大坪林→新北產業園區）"),
            "臺北捷運環狀線",
        );
    });

    it("preserves JR/English casing", () => {
        assert.equal(lineDisplayName("JR仙山線"), "JR仙山線");
    });

    it("removes direction tokens while preserving casing", () => {
        assert.equal(
            lineDisplayName("Red Line Inbound", ["inbound", "outbound"]),
            "Red Line",
        );
    });
});

describe("resolveLineColor", () => {
    it("preserves OSM color when present", () => {
        assert.equal(
            resolveLineColor({ color: "#FF0000", name: "X" }),
            "#FF0000",
        );
    });

    it("uses transitOverrides routeColors", () => {
        assert.equal(
            resolveLineColor({ name: "台灣高鐵 603" }, { 台灣高鐵: "#C41230" }),
            "#C41230",
        );
    });

    it("falls back to a deterministic hue", () => {
        const a = resolveLineColor({ name: "Uncolored A" });
        const b = resolveLineColor({ name: "Uncolored B" });
        assert.match(a, /^#[0-9a-fA-F]{6}$/);
        assert.match(b, /^#[0-9a-fA-F]{6}$/);
        assert.notEqual(a.toLowerCase(), b.toLowerCase());
    });

    it("looks up color by operator when no line key match", () => {
        assert.equal(
            resolveLineColor(
                { name: "Local 101", operator: "TRA" },
                { TRA: "#0033A0" },
            ),
            "#0033A0",
        );
    });

    it("prefers routeColors line key over operator", () => {
        assert.equal(
            resolveLineColor(
                { name: "Special Line", operator: "Op" },
                { "special line": "#111111", op: "#222222" },
            ),
            "#111111",
        );
    });

    it("deterministic fallback is stable", () => {
        const a = resolveLineColor({ name: "Same" });
        const b = resolveLineColor({ name: "Same" });
        assert.equal(a, b);
    });
});

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

    it("drops route=train relations when useRailwayInfrastructure is set", () => {
        const relations = [
            {
                id: 700,
                properties: {
                    tags: {
                        route_master: "train",
                        name: "Train Master",
                        operator: "TestRail",
                    },
                },
                members: [{ ref: "701", role: "route" }],
            },
            {
                id: 701,
                properties: {
                    tags: { route: "train", name: "Train Directional" },
                },
                members: [
                    { ref: "60", role: "stop" },
                    { ref: "61", role: "stop" },
                ],
            },
            {
                id: 702,
                properties: {
                    tags: {
                        route: "railway",
                        name: "Railway Line",
                        operator: "TestRail",
                    },
                },
                members: [
                    { ref: "60", role: "stop" },
                    { ref: "61", role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:60", name: "Stop 60", lat: 35.0, lon: 139.0 },
            { id: "osm:node:61", name: "Stop 61", lat: 35.1, lon: 139.1 },
        ];

        const { lines } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
            useRailwayInfrastructure: true,
        });

        // Train master + directional should be dropped.
        const trainLines = lines.filter(
            (l) =>
                l.name.includes("Train") ||
                l.sourceId === "700" ||
                l.sourceId === "701",
        );
        assert.equal(trainLines.length, 0);

        // Railway line should be kept.
        const railwayLine = lines.find((l) => l.sourceId === "702");
        assert.ok(railwayLine, "railway line kept");
    });

    it("groups route_master=railway with its directional route=railway variants", () => {
        const relations = [
            {
                id: 800,
                properties: {
                    tags: {
                        route_master: "railway",
                        name: "North Line",
                        colour: "#FF0000",
                        operator: "TestRail",
                    },
                },
                members: [
                    { ref: "801", role: "route" },
                    { ref: "802", role: "route" },
                ],
            },
            {
                id: 801,
                properties: {
                    tags: { route: "railway", name: "North Line Eastbound" },
                },
                members: [
                    { ref: "70", role: "stop" },
                    { ref: "71", role: "stop" },
                ],
            },
            {
                id: 802,
                properties: {
                    tags: { route: "railway", name: "North Line Westbound" },
                },
                members: [
                    { ref: "71", role: "stop" },
                    { ref: "72", role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:70", name: "Station A", lat: 35.0, lon: 139.0 },
            { id: "osm:node:71", name: "Station B", lat: 35.1, lon: 139.1 },
            { id: "osm:node:72", name: "Station C", lat: 35.2, lon: 139.2 },
        ];

        const { lines } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
            useRailwayInfrastructure: true,
        });

        assert.equal(lines.length, 1);
        assert.equal(lines[0].name, "North Line");
        assert.equal(lines[0].color, "#FF0000");
        assert.ok(lines[0].memberStationIds.length >= 2);
    });

    it("spatially attaches stations near stitched way geometry", () => {
        const relations = [
            {
                id: 900,
                properties: {
                    tags: {
                        route: "railway",
                        name: "Infra Line",
                        operator: "TestRail",
                    },
                },
                members: [
                    { type: "way", ref: 901, role: "" },
                    { type: "node", ref: 80, role: "stop" },
                    { type: "node", ref: 81, role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:80", name: "End A", lat: 35.0, lon: 139.0 },
            { id: "osm:node:81", name: "End B", lat: 35.1, lon: 139.1 },
            { id: "osm:node:82", name: "Nearby", lat: 35.05, lon: 139.05 },
        ];

        const nodeCoords = new Map([
            [80, { lat: 35.0, lon: 139.0 }],
            [81, { lat: 35.1, lon: 139.1 }],
        ]);

        const ways = new Map([[901, [80, 81]]]);

        const { lines } = processOsmRoutes(
            relations,
            stationRecords,
            {
                nameSuffixes: [],
                operators: [],
                useRailwayInfrastructure: true,
                railwayAttachMeters: 500,
            },
            nodeCoords,
            ways,
        );

        assert.equal(lines.length, 1);
        // Station 82 is near the line geometry and should be attached.
        assert.ok(
            lines[0].memberStationIds.includes("osm:node:82"),
            "spatially nearby station attached",
        );
    });

    it("builds mastered-line geometry from variant ways (0 stops), not the master's stray ways", () => {
        // Regression: a route_master whose directional variants carry the real
        // track ways AND zero stop members, while the master itself carries a
        // couple of incidental/connector ways. The line must (a) survive (not be
        // dropped by the <2-stop guard) and (b) take geometry from the variant
        // track ways, not the master's stray ways.
        const relations = [
            {
                id: 800,
                properties: {
                    tags: {
                        route_master: "railway",
                        name: "Trunk Line",
                        colour: "#0033A0",
                        operator: "TestRail",
                    },
                },
                // Master carries a stray connector way + the two variants.
                members: [
                    { type: "way", ref: 950, role: "" },
                    { type: "relation", ref: 801, role: "route" },
                    { type: "relation", ref: 802, role: "route" },
                ],
            },
            {
                id: 801,
                properties: {
                    tags: { route: "railway", name: "Trunk Line (北上)" },
                },
                // Real track ways, ZERO stop members.
                members: [{ type: "way", ref: 901, role: "" }],
            },
            {
                id: 802,
                properties: {
                    tags: { route: "railway", name: "Trunk Line (南下)" },
                },
                members: [{ type: "way", ref: 902, role: "" }],
            },
        ];

        const stationRecords = [
            { id: "osm:node:80", name: "Alpha", lat: 35.0, lon: 139.0 },
            { id: "osm:node:81", name: "Beta", lat: 35.1, lon: 139.1 },
            { id: "osm:node:82", name: "Gamma", lat: 35.2, lon: 139.2 },
        ];

        const nodeCoords = new Map([
            [80, { lat: 35.0, lon: 139.0 }],
            [81, { lat: 35.1, lon: 139.1 }],
            [82, { lat: 35.2, lon: 139.2 }],
            // Stray-way nodes far from any station.
            [990, { lat: 10.0, lon: 100.0 }],
            [991, { lat: 10.1, lon: 100.1 }],
        ]);

        const ways = new Map([
            [950, [990, 991]], // master stray way — must NOT be used
            [901, [80, 81]], // variant track
            [902, [81, 82]], // variant track
        ]);

        const { lines } = processOsmRoutes(
            relations,
            stationRecords,
            {
                nameSuffixes: [],
                operators: [],
                useRailwayInfrastructure: true,
                railwayAttachMeters: 500,
            },
            nodeCoords,
            ways,
        );

        assert.equal(lines.length, 1, "0-stop way-only mastered line survives");
        const line = lines[0];
        // All three stations spatially attached along the variant track.
        assert.ok(
            ["osm:node:80", "osm:node:81", "osm:node:82"].every((id) =>
                line.memberStationIds.includes(id),
            ),
            "stations attached from variant track geometry",
        );
        // Geometry uses the variant track coords, never the stray-way junk.
        const flat = line.geometry.coordinates.flat();
        assert.ok(
            flat.some((c) => c[0] === 139.0 && c[1] === 35.0),
            "geometry includes variant track coords",
        );
        assert.ok(
            !flat.some((c) => c[0] === 100.0 && c[1] === 10.0),
            "geometry excludes the master's stray-way coords",
        );
    });

    it("does not over-attach stations to parallel lines", () => {
        // Two parallel lines (海線 and 臺中線) running close together.
        // A station on 海線 should NOT attach to 臺中線.
        const relations = [
            {
                id: 1000,
                properties: {
                    tags: {
                        route: "railway",
                        name: "海線",
                        operator: "TestRail",
                    },
                },
                members: [
                    { type: "node", ref: 90, role: "stop" },
                    { type: "node", ref: 91, role: "stop" },
                ],
            },
            {
                id: 1001,
                properties: {
                    tags: {
                        route: "railway",
                        name: "臺中線",
                        operator: "TestRail",
                    },
                },
                members: [
                    { type: "node", ref: 92, role: "stop" },
                    { type: "node", ref: 93, role: "stop" },
                ],
            },
        ];

        // Station 90 is on 海線, station 92 is on 臺中線.
        // They are 2km apart — beyond railwayAttachMeters.
        const stationRecords = [
            { id: "osm:node:90", name: "Coast A", lat: 35.0, lon: 139.0 },
            { id: "osm:node:91", name: "Coast B", lat: 35.1, lon: 139.1 },
            { id: "osm:node:92", name: "Central A", lat: 35.0, lon: 139.02 },
            { id: "osm:node:93", name: "Central B", lat: 35.1, lon: 139.12 },
        ];

        const { lines } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
            useRailwayInfrastructure: true,
            railwayAttachMeters: 120,
        });

        assert.equal(lines.length, 2);
        const haiLine = lines.find((l) => l.name === "海線");
        const zhongLine = lines.find((l) => l.name === "臺中線");
        assert.ok(haiLine, "海線 line exists");
        assert.ok(zhongLine, "臺中線 line exists");

        // Station 90 should only be on 海線, not 臺中線.
        assert.ok(
            haiLine.memberStationIds.includes("osm:node:90"),
            "海線 has station 90",
        );
        assert.ok(
            !zhongLine.memberStationIds.includes("osm:node:90"),
            "臺中線 does not have station 90",
        );
    });

    it("drops unopened relations and does not spatially attach their ways", () => {
        // Relation 11122080-style: construction:route=subway but route=railway.
        // It has 0 stops and only ways; without the unopened filter, T16 spatial
        // attach would pull in a nearby station.
        const relations = [
            {
                id: 1111,
                properties: {
                    tags: {
                        route: "railway",
                        "construction:route": "subway",
                        name: "Circular Line Extension",
                        operator: "TestRail",
                    },
                },
                members: [{ type: "way", ref: 1112, role: "" }],
            },
        ];

        const stationRecords = [
            { id: "osm:node:100", name: "Nearby", lat: 35.05, lon: 139.05 },
        ];

        const nodeCoords = new Map([
            [100, { lat: 35.05, lon: 139.05 }],
            [101, { lat: 35.0, lon: 139.0 }],
            [102, { lat: 35.1, lon: 139.1 }],
        ]);

        const ways = new Map([[1112, [101, 102]]]);

        const { lines, stats } = processOsmRoutes(
            relations,
            stationRecords,
            {
                nameSuffixes: [],
                operators: [],
                useRailwayInfrastructure: true,
                railwayAttachMeters: 500,
            },
            nodeCoords,
            ways,
        );

        assert.equal(stats.linesDroppedUnopened, 1);
        assert.equal(lines.length, 0);
    });

    it("does not drop opened route/railway relations", () => {
        // Regression guard: normal in-service relations must not be filtered.
        const relations = [
            {
                id: 1200,
                properties: {
                    tags: {
                        route: "railway",
                        name: "Open Line",
                        operator: "TestRail",
                    },
                },
                members: [
                    { type: "node", ref: 110, role: "stop" },
                    { type: "node", ref: 111, role: "stop" },
                ],
            },
        ];

        const stationRecords = [
            { id: "osm:node:110", name: "Open A", lat: 35.0, lon: 139.0 },
            { id: "osm:node:111", name: "Open B", lat: 35.1, lon: 139.1 },
        ];

        const { lines, stats } = processOsmRoutes(relations, stationRecords, {
            nameSuffixes: [],
            operators: [],
            useRailwayInfrastructure: true,
        });

        assert.equal(stats.linesDroppedUnopened, 0);
        assert.equal(lines.length, 1);
        assert.equal(lines[0].name, "Open Line");
    });

    it("falls back to stop-position geometry when wayGeometry is false", () => {
        const master = {
            id: 900,
            properties: {
                "@id": 900,
                tags: { route_master: "subway", name: "Wayless Fallback Line" },
            },
        };
        const variant = {
            id: 901,
            properties: {
                "@id": 901,
                tags: { route: "subway", name: "Wayless Fallback Line Inbound" },
            },
            members: [
                { type: "node", ref: 10, role: "stop" },
                { type: "node", ref: 11, role: "stop" },
                { type: "way", ref: 500, role: "" },
            ],
        };
        const stationRecords = [
            {
                id: "osm:node:10",
                name: "Alpha",
                lat: 35.0,
                lon: 139.0,
                tags: { railway: "station" },
            },
            {
                id: "osm:node:11",
                name: "Beta",
                lat: 35.2,
                lon: 139.2,
                tags: { railway: "station" },
            },
        ];
        const nodeCoords = new Map([
            [10, { lat: 35.0, lon: 139.0 }],
            [11, { lat: 35.2, lon: 139.2 }],
            [100, { lat: 35.05, lon: 139.05 }],
            [101, { lat: 35.15, lon: 139.15 }],
        ]);
        const ways = new Map([[500, [100, 101]]]);

        const { lines } = processOsmRoutes(
            [master, variant],
            stationRecords,
            { maxClusterMeters: 150, wayGeometry: false },
            nodeCoords,
            ways,
        );
        assert.equal(lines.length, 1);
        const line = lines[0];
        assert.equal(line.geometry.type, "MultiLineString");
        assert.equal(line.geometry.coordinates.length, 1);
        // Stop-position fallback uses station coordinates, not way nodes.
        assert.deepEqual(line.geometry.coordinates[0][0], [139.0, 35.0]);
        assert.deepEqual(line.geometry.coordinates[0][1], [139.2, 35.2]);
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

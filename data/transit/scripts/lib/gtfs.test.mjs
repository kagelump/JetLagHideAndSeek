import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    parseCsv,
    collapseParentStations,
    filterRoutesByType,
    isRouteTypeAllowed,
    normalizeAllowlist,
    groupRoutesIntoLines,
    splitByAgency,
    processGtfsFeed,
    normalizeColor,
    calculateBbox,
} from "./gtfs.mjs";

import { createGtfsRouteId, createGtfsStopId } from "./gtfs.mjs";

// ─── parseCsv ───────────────────────────────────────────────────────────────

describe("parseCsv", () => {
    it("parses simple CSV", () => {
        const rows = parseCsv("id,name\n1,Alice\n2,Bob\n");
        assert.equal(rows.length, 2);
        assert.equal(rows[0].id, "1");
        assert.equal(rows[0].name, "Alice");
    });

    it("handles quoted fields with commas", () => {
        const rows = parseCsv('id,desc\n1,"hello, world"\n');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].desc, "hello, world");
    });

    it("handles escaped quotes", () => {
        const rows = parseCsv('id,name\n1,"say ""hi"""\n');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].name, 'say "hi"');
    });

    it("handles CRLF line endings", () => {
        const rows = parseCsv("id,name\r\n1,Alice\r\n2,Bob\r\n");
        assert.equal(rows.length, 2);
    });

    it("filters empty rows", () => {
        const rows = parseCsv("id,name\n\n1,Alice\n\n");
        assert.equal(rows.length, 1);
    });
});

// ─── collapseParentStations ─────────────────────────────────────────────────

describe("collapseParentStations", () => {
    it("passes through stops without parent", () => {
        const stops = [
            {
                stop_id: "1",
                stop_name: "Station A",
                stop_lat: "35.0",
                stop_lon: "139.0",
            },
        ];
        const { stationStops, childToStation } = collapseParentStations(stops);
        assert.equal(stationStops.size, 1);
        assert.equal(childToStation.size, 0);
        assert.equal(stationStops.get("1").name, "Station A");
    });

    it("collapses child stops into their parent", () => {
        const stops = [
            {
                stop_id: "parent",
                stop_name: "Grand Central",
                stop_lat: "35.0",
                stop_lon: "139.0",
                location_type: "1",
            },
            {
                stop_id: "child1",
                stop_name: "Grand Central Platform 1",
                stop_lat: "35.001",
                stop_lon: "139.001",
                parent_station: "parent",
            },
            {
                stop_id: "child2",
                stop_name: "Grand Central Platform 2",
                stop_lat: "35.002",
                stop_lon: "139.002",
                parent_station: "parent",
            },
        ];
        const { stationStops, childToStation } = collapseParentStations(stops);
        assert.equal(stationStops.size, 1);
        assert.equal(childToStation.get("child1"), "parent");
        assert.equal(childToStation.get("child2"), "parent");
        const station = stationStops.get("parent");
        assert.deepEqual(station.childIds, ["child1", "child2"]);
    });

    it("creates parent entry from child reference when parent not in stops", () => {
        const stops = [
            {
                stop_id: "parent1",
                stop_name: "Grand Central",
                stop_lat: "35.0",
                stop_lon: "139.0",
                location_type: "1",
            },
            {
                stop_id: "child1",
                stop_name: "Platform 1",
                stop_lat: "35.0",
                stop_lon: "139.0",
                parent_station: "parent1",
            },
        ];
        const { stationStops, childToStation } = collapseParentStations(stops);
        // Parent is recognized from its own location_type=1 row.
        assert.equal(childToStation.get("child1"), "parent1");
        assert.ok(stationStops.has("parent1"));
    });
});

// ─── isRouteTypeAllowed / filterRoutesByType ────────────────────────────────

describe("filterRoutesByType", () => {
    it("keeps subway (1) when allowed", () => {
        const routes = [
            { route_id: "1", route_type: "1" },
            { route_id: "2", route_type: "3" },
        ];
        const result = filterRoutesByType(routes, [0, 1, 2]);
        assert.equal(result.length, 1);
        assert.equal(result[0].route_id, "1");
    });

    it("filters out bus (3) by default", () => {
        const routes = [{ route_id: "bus1", route_type: "3" }];
        const result = filterRoutesByType(routes, [0, 1, 2]);
        assert.equal(result.length, 0);
    });

    it("supports extended route type ranges", () => {
        const routes = [
            { route_id: "r100", route_type: "100" },
            { route_id: "r117", route_type: "117" },
            { route_id: "r118", route_type: "118" }, // outside rail range
            { route_id: "r700", route_type: "700" }, // bus
        ];
        const allowlist = [[100, 117]];
        const result = filterRoutesByType(routes, allowlist);
        assert.equal(result.length, 2);
        assert.ok(result.find((r) => r.route_id === "r100"));
        assert.ok(result.find((r) => r.route_id === "r117"));
    });

    it("keeps extended metro types (400-404)", () => {
        const routes = [
            { route_id: "m1", route_type: "400" },
            { route_id: "m2", route_type: "404" },
            { route_id: "m3", route_type: "405" }, // outside metro range
        ];
        const allowlist = [[400, 404]];
        const result = filterRoutesByType(routes, allowlist);
        assert.equal(result.length, 2);
    });

    it("handles mixed single values and ranges", () => {
        const allowlist = [0, 1, 2, [100, 117], [400, 404]];
        assert.ok(isRouteTypeAllowed(1, allowlist));
        assert.ok(isRouteTypeAllowed(109, allowlist));
        assert.ok(isRouteTypeAllowed(402, allowlist));
        assert.ok(!isRouteTypeAllowed(3, allowlist));
        assert.ok(!isRouteTypeAllowed(700, allowlist));
    });
});

// ─── normalizeAllowlist ─────────────────────────────────────────────────────

describe("normalizeAllowlist", () => {
    it("converts config ranges to tuples", () => {
        const raw = [0, 1, [100, 117]];
        const result = normalizeAllowlist(raw);
        assert.deepEqual(result, [0, 1, [100, 117]]);
    });

    it("throws on invalid range length", () => {
        assert.throws(() => normalizeAllowlist([[100]]), /exactly 2/);
    });
});

// ─── groupRoutesIntoLines ───────────────────────────────────────────────────

describe("groupRoutesIntoLines", () => {
    it("route_id mode: every route is its own line", () => {
        const routes = [
            {
                route_id: "1",
                route_short_name: "Ginza",
                route_long_name: "Ginza Line",
            },
            {
                route_id: "2",
                route_short_name: "Marunouchi",
                route_long_name: "Marunouchi Line",
            },
        ];
        const { lines, routeLineIndex } = groupRoutesIntoLines(
            routes,
            "route_id",
        );
        assert.equal(lines.length, 2);
        assert.equal(lines[0].routeIds.length, 1);
        assert.equal(lines[0].anchorRouteId, "1");
        assert.ok(routeLineIndex.has("1"));
    });

    it("short_name mode: groups directional variants by short_name", () => {
        const routes = [
            {
                route_id: "1_north",
                agency_id: "A",
                route_short_name: "Red",
                route_long_name: "Red Line North",
            },
            {
                route_id: "1_south",
                agency_id: "A",
                route_short_name: "Red",
                route_long_name: "Red Line South",
            },
            {
                route_id: "2",
                agency_id: "A",
                route_short_name: "Blue",
                route_long_name: "Blue Line",
            },
        ];
        const { lines, routeLineIndex } = groupRoutesIntoLines(
            routes,
            "short_name",
        );
        assert.equal(lines.length, 2);
        // Red line should have 2 route_ids.
        const redLine = lines.find((l) => l.name === "Red");
        assert.ok(redLine);
        assert.deepEqual(redLine.routeIds.sort(), ["1_north", "1_south"]);
        // Anchor = lexicographically smallest.
        assert.equal(redLine.anchorRouteId, "1_north");
        // Both variants map to same line.
        assert.equal(routeLineIndex.get("1_north"), redLine);
        assert.equal(routeLineIndex.get("1_south"), redLine);
    });

    it("short_name mode: falls back to long_name when short_name is empty", () => {
        const routes = [
            {
                route_id: "1",
                agency_id: "A",
                route_short_name: "",
                route_long_name: "Long Name Line",
            },
        ];
        const { lines } = groupRoutesIntoLines(routes, "short_name");
        assert.equal(lines.length, 1);
        assert.equal(lines[0].name, "Long Name Line");
    });

    it("short_name mode: falls back to route_id when both names are empty", () => {
        const routes = [
            {
                route_id: "orphan",
                agency_id: "A",
                route_short_name: "",
                route_long_name: "",
            },
        ];
        const { lines } = groupRoutesIntoLines(routes, "short_name");
        assert.equal(lines.length, 1);
        assert.equal(lines[0].name, "orphan");
    });

    it("short_name mode: groups by agency_id independently", () => {
        const routes = [
            {
                route_id: "a1",
                agency_id: "A",
                route_short_name: "Red",
                route_long_name: "",
            },
            {
                route_id: "b1",
                agency_id: "B",
                route_short_name: "Red",
                route_long_name: "",
            },
        ];
        const { lines } = groupRoutesIntoLines(routes, "short_name");
        assert.equal(lines.length, 2);
    });
});

// ─── splitByAgency ──────────────────────────────────────────────────────────

describe("splitByAgency", () => {
    it("returns one preset when no presets config", () => {
        const feedConfig = { id: "test", label: "Test Feed" };
        const lines = [{ id: "l1", routeIds: ["1"] }];
        const stations = [{ id: "s1", routeIds: ["l1"] }];
        const result = splitByAgency(feedConfig, new Map(), lines, stations);
        assert.equal(result.length, 1);
        assert.equal(result[0].presetId, "test");
    });

    it("splits by agency when presets are configured", () => {
        const feedConfig = {
            id: "regional",
            presets: [
                { agency: "A", id: "agency-a", label: "Agency A" },
                { agency: "B", id: "agency-b", label: "Agency B" },
            ],
        };
        const routeAgencyMap = new Map([
            ["1", "A"],
            ["2", "B"],
        ]);
        const lines = [
            { id: "l1", routeIds: ["1"] },
            { id: "l2", routeIds: ["2"] },
        ];
        const stations = [
            { id: "s1", routeIds: ["l1"] },
            { id: "s2", routeIds: ["l2"] },
        ];
        const result = splitByAgency(
            feedConfig,
            routeAgencyMap,
            lines,
            stations,
        );
        assert.equal(result.length, 2);
        const aPreset = result.find((p) => p.presetId === "agency-a");
        const bPreset = result.find((p) => p.presetId === "agency-b");
        assert.ok(aPreset);
        assert.ok(bPreset);
    });
});

// ─── normalizeColor ─────────────────────────────────────────────────────────

describe("normalizeColor", () => {
    it("adds # prefix", () => {
        assert.equal(normalizeColor("FF9500"), "#FF9500");
    });

    it("keeps existing #", () => {
        assert.equal(normalizeColor("#FF9500"), "#FF9500");
    });

    it("returns fallback for empty", () => {
        assert.equal(normalizeColor("", "#888888"), "#888888");
    });
});

// ─── calculateBbox ──────────────────────────────────────────────────────────

describe("calculateBbox", () => {
    it("computes bbox from points", () => {
        const bbox = calculateBbox([
            [139.0, 35.0],
            [140.0, 36.0],
        ]);
        assert.deepEqual(bbox, [139.0, 35.0, 140.0, 36.0]);
    });

    it("returns zeros for empty input", () => {
        assert.deepEqual(calculateBbox([]), [0, 0, 0, 0]);
    });
});

// ─── canonical ids ──────────────────────────────────────────────────────────

describe("canonical ids", () => {
    it("createGtfsRouteId produces expected format", () => {
        assert.equal(
            createGtfsRouteId("odpt-tokyo-metro", "1"),
            "gtfs:odpt-tokyo-metro:route:1",
        );
    });

    it("createGtfsStopId produces expected format (no coord suffix)", () => {
        const id = createGtfsStopId("odpt-tokyo-metro", "101");
        assert.equal(id, "gtfs:odpt-tokyo-metro:stop:101");
    });
});

// ─── processGtfsFeed integration ────────────────────────────────────────────

describe("processGtfsFeed", () => {
    it("canonical stop id format has no coord suffix", () => {
        const id = createGtfsStopId("test-ns", "s1");
        assert.equal(id, "gtfs:test-ns:stop:s1");
        assert.ok(!id.includes(","));
    });

    it("canonical route id format matches persisted questions", () => {
        const id = createGtfsRouteId("odpt-tokyo-metro", "3");
        assert.equal(id, "gtfs:odpt-tokyo-metro:route:3");
    });
});

// ─── ODPT regression ────────────────────────────────────────────────────────

describe("ODPT regression", () => {
    it("produces same route ids as the old ODPT pipeline", () => {
        // These are the same inputs the old fetch-odpt.mjs test uses.
        const tables = {
            routes: [
                {
                    route_color: "B5B5AC",
                    route_id: "3",
                    route_long_name: "Line 3",
                    route_type: "1",
                },
            ],
            shapes: [],
            stops: [
                {
                    stop_id: "303",
                    stop_lat: "35.651499",
                    stop_lon: "139.722209",
                    stop_name: "Station 303",
                },
                {
                    stop_id: "304",
                    stop_lat: "35.662800",
                    stop_lon: "139.731155",
                    stop_name: "Station 304",
                },
            ],
            stopTimes: [
                { stop_id: "303", stop_sequence: "1", trip_id: "trip-1" },
                { stop_id: "304", stop_sequence: "2", trip_id: "trip-1" },
            ],
            trips: [{ route_id: "3", trip_id: "trip-1" }],
        };

        const feedConfig = {
            id: "tokyo-metro",
            label: "Tokyo Metro",
            namespace: "odpt-tokyo-metro",
            lineGrouping: "route_id",
            routeTypes: [1],
            defaultColor: "#009BBF",
        };

        // Build the tables manually, process them with the new pipeline logic.
        const { stationStops } = collapseParentStations(tables.stops);
        const allowlist = normalizeAllowlist(feedConfig.routeTypes);
        const keptRoutes = filterRoutesByType(tables.routes, allowlist);
        const { lines } = groupRoutesIntoLines(
            keptRoutes,
            feedConfig.lineGrouping,
        );

        // Verify route id format matches the old pipeline.
        // Old pipeline: createGtfsRouteId("odpt-tokyo-metro", "3")
        // → "gtfs:odpt-tokyo-metro:route:3"
        assert.equal(lines.length, 1);
        const line = lines[0];
        const canonicalRouteId = createGtfsRouteId(
            feedConfig.namespace,
            line.anchorRouteId,
        );
        assert.equal(canonicalRouteId, "gtfs:odpt-tokyo-metro:route:3");

        // Verify station id format: no coordinate suffix in mergeKey.
        const stationStopId = [...stationStops.keys()][0];
        const canonicalStationId = createGtfsStopId(
            feedConfig.namespace,
            stationStopId,
        );
        assert.ok(canonicalStationId.startsWith("gtfs:odpt-tokyo-metro:stop:"));
        // No coord suffix — the old mergeKey was "303:139.72221,35.65150".
        assert.ok(!canonicalStationId.includes(","));
    });

    it("produces deterministic line anchors for short_name grouping", () => {
        const routes = [
            {
                route_id: "B_north",
                agency_id: "A",
                route_short_name: "Red",
                route_long_name: "",
            },
            {
                route_id: "A_south",
                agency_id: "A",
                route_short_name: "Red",
                route_long_name: "",
            },
            {
                route_id: "C_express",
                agency_id: "A",
                route_short_name: "Red",
                route_long_name: "",
            },
        ];
        const { lines } = groupRoutesIntoLines(routes, "short_name");
        assert.equal(lines.length, 1);
        // Anchor = lexicographically smallest (A_south < B_north < C_express).
        assert.equal(lines[0].anchorRouteId, "A_south");
    });

    // ── Full ODPT regression (requires cached zips) ─────────────────────
    // Skips when data/odpt/cache/ zips are not present.

    it("ODPT full regression: matches reference preset stats, route ids, and station names", async () => {
        const { existsSync, readFileSync } = await import("node:fs");
        const { resolve, dirname } = await import("node:path");
        const { fileURLToPath } = await import("node:url");

        const scriptDir = dirname(fileURLToPath(import.meta.url));
        const transitDir = resolve(scriptDir, "..", "..");
        const odptCacheDir = resolve(transitDir, "..", "odpt", "cache");
        const odptJsonPath = resolve(
            transitDir,
            "..",
            "odpt",
            "generated",
            "hiding-zone-presets.json",
        );

        if (!existsSync(odptJsonPath)) {
            console.log("  (skipped — ODPT reference JSON not found)");
            return;
        }

        const odpt = JSON.parse(readFileSync(odptJsonPath, "utf8"));
        const { loadConfig } = await import("./config.mjs");
        const configPath = resolve(transitDir, "config.yaml");
        const config = await loadConfig(configPath);
        const locale = config.locales[0];

        for (const feed of locale.gtfs) {
            // Try both cache locations.
            let cachePath = resolve(odptCacheDir, `${feed.id}.zip`);
            if (!existsSync(cachePath)) {
                cachePath = resolve(transitDir, "cache", `${feed.id}.zip`);
            }
            if (!existsSync(cachePath)) {
                console.log(`  (skipped ${feed.id} — zip not cached)`);
                continue;
            }

            const zipBytes = new Uint8Array(readFileSync(cachePath));
            const { presets } = processGtfsFeed(feed, zipBytes);

            const refPreset = odpt.presets.find((p) => p.id === feed.id);
            assert.ok(refPreset, `Reference preset ${feed.id} not found`);

            const genPreset = presets[0];
            assert.ok(genPreset, `Generated preset ${feed.id} missing`);

            // Same station count.
            assert.equal(
                genPreset.stations.length,
                refPreset.stations.length,
                `${feed.id}: station count mismatch`,
            );

            // Same route count.
            assert.equal(
                genPreset.routes.length,
                refPreset.routes.length,
                `${feed.id}: route count mismatch`,
            );

            // Same route IDs.
            const refRouteIds = new Set(refPreset.routes.map((r) => r.id));
            const genRouteIds = new Set(genPreset.routes.map((r) => r.id));
            assert.equal(refRouteIds.size, genRouteIds.size);
            for (const id of refRouteIds) {
                assert.ok(
                    genRouteIds.has(id),
                    `${feed.id}: route id ${id} missing from generated output`,
                );
            }

            // Same station names.
            const refNames = new Set(refPreset.stations.map((s) => s.name));
            const genNames = new Set(genPreset.stations.map((s) => s.name));
            assert.equal(refNames.size, genNames.size);
            for (const name of refNames) {
                assert.ok(
                    genNames.has(name),
                    `${feed.id}: station "${name}" missing from generated output`,
                );
            }

            // MergeKeys differ by design (old: coord suffix, new: canonical id).
            const refKey = refPreset.stations[0].mergeKey;
            const genKey = genPreset.stations[0].mergeKey;
            assert.ok(
                refKey.includes(","),
                "ref mergeKey should have coord suffix",
            );
            assert.ok(
                !genKey.includes(","),
                "gen mergeKey should be canonical id (no coord)",
            );
        }
    });
});

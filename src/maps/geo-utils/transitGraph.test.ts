import { describe, expect, test } from "vitest";

import {
    emptyTransitGraph,
    filterStationIdsByTransitLine,
    getLinesForStation,
    hasTransitGraph,
    resolveAutoTransitLine,
    resolveTransitLine,
    type TransitGraph,
    type TransitGraphLine,
    type TransitGraphStation,
} from "./transitGraph";

// ---- helpers ----

function st(
    id: string,
    label: string,
    coordinates?: [number, number],
): TransitGraphStation {
    return { id, label, coordinates: coordinates ?? [139, 35] };
}

function ln(id: string, label: string, operator?: string): TransitGraphLine {
    return { id, label, operator };
}

function makeGraph(
    stations: TransitGraphStation[],
    lines: TransitGraphLine[],
    stationLineIds: Record<string, string[]>,
): TransitGraph {
    const stationsById: Record<string, TransitGraphStation> = {};
    for (const s of stations) stationsById[s.id] = s;
    const linesById: Record<string, TransitGraphLine> = {};
    for (const l of lines) linesById[l.id] = l;
    const lineStationIds: Record<string, string[]> = {};
    for (const [sid, lids] of Object.entries(stationLineIds)) {
        for (const lid of lids) {
            (lineStationIds[lid] ??= []).push(sid);
        }
    }
    return { stationsById, linesById, stationLineIds, lineStationIds };
}

// ---- tests ----

describe("emptyTransitGraph", () => {
    test("returns an empty graph with all four properties as empty objects", () => {
        const graph = emptyTransitGraph();
        expect(graph).toEqual({
            stationsById: {},
            linesById: {},
            stationLineIds: {},
            lineStationIds: {},
        });
    });
});

describe("hasTransitGraph", () => {
    test("returns false for null", () => {
        expect(hasTransitGraph(null)).toBe(false);
    });

    test("returns false for undefined", () => {
        expect(hasTransitGraph(undefined)).toBe(false);
    });

    test("returns false for empty graph (stationsById is {})", () => {
        const graph = makeGraph([], [], {});
        expect(hasTransitGraph(graph)).toBe(false);
    });

    test("returns true for graph with at least one station", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac", [139.6917, 35.6895])],
            [],
            {},
        );
        expect(hasTransitGraph(graph)).toBe(true);
    });
});

describe("getLinesForStation", () => {
    test("returns empty array for station not in stationsById", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac")],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": ["l-1"] },
        );
        expect(getLinesForStation(graph, "s-nonexistent")).toEqual([]);
    });

    test("returns empty array for station with stationLineIds missing", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac"), st("s-2", "\u6e0b\u8c37")],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": ["l-1"] },
        );
        expect(getLinesForStation(graph, "s-2")).toEqual([]);
    });

    test("returns empty array for station with empty stationLineIds array", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac")],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": [] },
        );
        expect(getLinesForStation(graph, "s-1")).toEqual([]);
    });

    test("returns single line when station has one line", () => {
        const line = ln("l-1", "\u5c71\u624b\u7dda", "JR East");
        const graph = makeGraph([st("s-1", "\u6771\u4eac")], [line], {
            "s-1": ["l-1"],
        });
        expect(getLinesForStation(graph, "s-1")).toEqual([line]);
    });

    test("returns lines sorted by label using localeCompare", () => {
        const lineA = ln("l-a", "\u3042\u53f7\u7dda");
        const lineI = ln("l-i", "\u3044\u53f7\u7dda");
        const lineU = ln("l-u", "\u3046\u53f7\u7dda");
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac")],
            [lineU, lineA, lineI],
            { "s-1": ["l-u", "l-a", "l-i"] },
        );
        const result = getLinesForStation(graph, "s-1");
        expect(result).toEqual([lineA, lineI, lineU]);
    });

    test("returns lines sorted by id when labels are equal", () => {
        const lineB = ln("l-b", "X Line");
        const lineA = ln("l-a", "X Line");
        const graph = makeGraph([st("s-1", "\u6771\u4eac")], [lineB, lineA], {
            "s-1": ["l-b", "l-a"],
        });
        const result = getLinesForStation(graph, "s-1");
        expect(result).toEqual([lineA, lineB]);
    });
});

describe("resolveTransitLine", () => {
    test.each([
        ["emptyTransitGraph()", emptyTransitGraph()],
        [
            "manual empty graph",
            {
                stationsById: {} as Record<string, TransitGraphStation>,
                linesById: { "l-1": ln("l-1", "X") },
                stationLineIds: {},
                lineStationIds: {},
            },
        ],
    ])("returns missing-graph for %s", (_, graph) => {
        expect(resolveTransitLine(graph, "any-line").status).toBe(
            "missing-graph",
        );
    });

    test("returns missing-line when lineId not in linesById", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac")],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": ["l-1"] },
        );
        const result = resolveTransitLine(graph, "l-nonexistent");
        expect(result.status).toBe("missing-line");
        expect(result.line).toBeUndefined();
        expect(result.stationIds).toEqual([]);
        expect(result.stationLabels).toEqual([]);
    });

    test("returns empty-line when lineStationIds[lineId] is missing", () => {
        const graph: TransitGraph = {
            stationsById: { "s-1": st("s-1", "\u6771\u4eac") },
            linesById: { "l-1": ln("l-1", "\u5c71\u624b\u7dda") },
            stationLineIds: { "s-1": [] },
            lineStationIds: {},
        };
        const result = resolveTransitLine(graph, "l-1");
        expect(result.status).toBe("empty-line");
    });

    test("returns empty-line when lineStationIds[lineId] is an empty array", () => {
        const graph: TransitGraph = {
            stationsById: { "s-1": st("s-1", "\u6771\u4eac") },
            linesById: { "l-1": ln("l-1", "\u5c71\u624b\u7dda") },
            stationLineIds: { "s-1": [] },
            lineStationIds: { "l-1": [] },
        };
        const result = resolveTransitLine(graph, "l-1");
        expect(result.status).toBe("empty-line");
    });

    test("returns ok with correct line object, stationIds sorted by label (localeCompare), stationLabels in matching order", () => {
        const stationA = st("s-a", "\u3042\u99c5", [139.7, 35.6]);
        const stationI = st("s-i", "\u3044\u99c5", [139.7, 35.65]);
        const stationU = st("s-u", "\u3046\u99c5", [139.7, 35.7]);
        const line = ln("l-1", "\u30c6\u30b9\u30c8\u7dda");
        const graph = makeGraph([stationU, stationA, stationI], [line], {
            "s-a": ["l-1"],
            "s-i": ["l-1"],
            "s-u": ["l-1"],
        });

        const result = resolveTransitLine(graph, "l-1");
        expect(result.status).toBe("ok");
        expect(result.line).toEqual(line);
        expect(result.stationIds).toEqual(["s-a", "s-i", "s-u"]);
        expect(result.stationLabels).toEqual([
            "\u3042\u99c5",
            "\u3044\u99c5",
            "\u3046\u99c5",
        ]);
    });

    test("returns ok with stationIds sorted by id when labels are equal", () => {
        const stationB = st("s-b", "\u99c5");
        const stationA = st("s-a", "\u99c5");
        const line = ln("l-1", "\u30c6\u30b9\u30c8\u7dda");
        const graph = makeGraph([stationB, stationA], [line], {
            "s-a": ["l-1"],
            "s-b": ["l-1"],
        });

        const result = resolveTransitLine(graph, "l-1");
        expect(result.status).toBe("ok");
        expect(result.stationIds).toEqual(["s-a", "s-b"]);
        expect(result.stationLabels).toEqual(["\u99c5", "\u99c5"]);
    });
});

describe("resolveAutoTransitLine", () => {
    test("returns missing-graph when graph is empty", () => {
        const result = resolveAutoTransitLine(emptyTransitGraph(), "any");
        expect(result.status).toBe("missing-graph");
    });

    test("returns missing-station when stationId not in stationsById", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac")],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": ["l-1"] },
        );
        const result = resolveAutoTransitLine(graph, "s-nonexistent");
        expect(result.status).toBe("missing-station");
    });

    test("returns missing-line when station exists but has no lines (stationLineIds entry missing)", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac"), st("s-2", "\u6e0b\u8c37")],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": ["l-1"] },
        );
        const result = resolveAutoTransitLine(graph, "s-2");
        expect(result.status).toBe("missing-line");
    });

    test("returns missing-line when station exists but has empty stationLineIds array", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac")],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": [] },
        );
        const result = resolveAutoTransitLine(graph, "s-1");
        expect(result.status).toBe("missing-line");
    });

    test("returns ok for station with exactly one line", () => {
        const line = ln("l-1", "\u5c71\u624b\u7dda");
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac", [139.6917, 35.6895])],
            [line],
            { "s-1": ["l-1"] },
        );
        const result = resolveAutoTransitLine(graph, "s-1");
        expect(result.status).toBe("ok");
        expect(result.line).toEqual(line);
        expect(result.stationIds).toEqual(["s-1"]);
        expect(result.stationLabels).toEqual(["\u6771\u4eac"]);
    });

    test("picks the first sorted line when station has multiple lines", () => {
        const lineB = ln("l-b", "B Line");
        const lineA = ln("l-a", "A Line");
        const lineC = ln("l-c", "C Line");
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac")],
            [lineB, lineA, lineC],
            { "s-1": ["l-b", "l-a", "l-c"] },
        );
        const result = resolveAutoTransitLine(graph, "s-1");
        expect(result.status).toBe("ok");
        expect(result.line).toEqual(lineA);
    });
});

describe("filterStationIdsByTransitLine", () => {
    test("same=true returns Set of station ids for the given line", () => {
        const graph = makeGraph(
            [
                st("s-1", "\u6771\u4eac"),
                st("s-2", "\u6e0b\u8c37"),
                st("s-3", "\u65b0\u5bbf"),
            ],
            [ln("l-1", "\u5c71\u624b\u7dda"), ln("l-2", "\u4e2d\u592e\u7dda")],
            { "s-1": ["l-1"], "s-2": ["l-1"], "s-3": ["l-2"] },
        );
        const result = filterStationIdsByTransitLine(graph, "l-1", true);
        expect(result).toEqual(new Set(["s-1", "s-2"]));
    });

    test("same=true returns empty Set when lineStationIds[lineId] is missing", () => {
        const graph: TransitGraph = {
            stationsById: { "s-1": st("s-1", "\u6771\u4eac") },
            linesById: { "l-1": ln("l-1", "\u5c71\u624b\u7dda") },
            stationLineIds: {},
            lineStationIds: {},
        };
        const result = filterStationIdsByTransitLine(graph, "l-1", true);
        expect(result).toEqual(new Set());
    });

    test("same=true returns empty Set when lineStationIds[lineId] is empty array", () => {
        const graph: TransitGraph = {
            stationsById: { "s-1": st("s-1", "\u6771\u4eac") },
            linesById: { "l-1": ln("l-1", "\u5c71\u624b\u7dda") },
            stationLineIds: {},
            lineStationIds: { "l-1": [] },
        };
        const result = filterStationIdsByTransitLine(graph, "l-1", true);
        expect(result).toEqual(new Set());
    });

    test("same=false returns all station ids EXCEPT those on the line", () => {
        const graph = makeGraph(
            [
                st("s-1", "\u6771\u4eac"),
                st("s-2", "\u6e0b\u8c37"),
                st("s-3", "\u65b0\u5bbf"),
            ],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": ["l-1"], "s-2": ["l-1"], "s-3": [] },
        );
        const result = filterStationIdsByTransitLine(graph, "l-1", false);
        expect(result).toEqual(new Set(["s-3"]));
    });

    test("same=false returns all station ids when lineStationIds[lineId] is missing", () => {
        const graph = makeGraph(
            [st("s-1", "\u6771\u4eac"), st("s-2", "\u6e0b\u8c37")],
            [ln("l-1", "\u5c71\u624b\u7dda")],
            { "s-1": [], "s-2": [] },
        );
        const result = filterStationIdsByTransitLine(graph, "l-1", false);
        expect(result).toEqual(new Set(["s-1", "s-2"]));
    });

    test("same=false returns all station ids when lineStationIds[lineId] is empty array", () => {
        const graph: TransitGraph = {
            stationsById: {
                "s-1": st("s-1", "\u6771\u4eac"),
                "s-2": st("s-2", "\u6e0b\u8c37"),
            },
            linesById: { "l-1": ln("l-1", "\u5c71\u624b\u7dda") },
            stationLineIds: {},
            lineStationIds: { "l-1": [] },
        };
        const result = filterStationIdsByTransitLine(graph, "l-1", false);
        expect(result).toEqual(new Set(["s-1", "s-2"]));
    });
});

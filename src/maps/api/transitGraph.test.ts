import { beforeEach, describe, expect, test, vi } from "vitest";

import type { StationPlace } from "@/maps/api/types";

import { buildTransitGraphForStations } from "./transitGraph";

vi.mock("./overpass", () => ({
    getOverpassData: vi.fn(),
}));

import { getOverpassData } from "./overpass";

const mockedGetOverpassData = getOverpassData as ReturnType<typeof vi.fn>;

function makeStationPlace(
    id: string,
    lat: number,
    lng: number,
    tags: Record<string, string> = {},
): StationPlace {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { id, name: tags.name ?? id, ...tags },
    };
}

function makeOverpassResponse(elements: any[]): any {
    return { elements };
}

function makeRelationElement(
    id: number,
    tags: Record<string, string>,
    nodeMembers: number[],
): any {
    return {
        type: "relation",
        id,
        tags,
        members: nodeMembers.map((ref) => ({
            type: "node",
            ref,
            role: "stop",
        })),
    };
}

describe("buildTransitGraphForStations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("returns empty graph for empty stations array", async () => {
        const graph = await buildTransitGraphForStations([], {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(graph.stationsById).toEqual({});
        expect(graph.linesById).toEqual({});
        expect(graph.stationLineIds).toEqual({});
        expect(graph.lineStationIds).toEqual({});
        expect(mockedGetOverpassData).not.toHaveBeenCalled();
    });

    test("builds stationsById from input Stations", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, {
                name: "Tokyo Station",
            }),
            makeStationPlace("node/2", 35.69, 139.7, {
                name: "Shinjuku Station",
            }),
        ];

        mockedGetOverpassData.mockResolvedValue(makeOverpassResponse([]));

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(Object.keys(graph.stationsById)).toHaveLength(2);
        expect(graph.stationsById["node/1"]).toEqual({
            id: "node/1",
            label: "Tokyo Station",
            coordinates: [139.76, 35.68],
            operator: undefined,
            network: undefined,
        });
        expect(graph.stationsById["node/2"]).toEqual({
            id: "node/2",
            label: "Shinjuku Station",
            coordinates: [139.7, 35.69],
            operator: undefined,
            network: undefined,
        });
    });

    test("uses native-preferred for station labels when strategy is native-preferred", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, {
                name: "東京",
                "name:en": "Tokyo",
            }),
        ];

        mockedGetOverpassData.mockResolvedValue(makeOverpassResponse([]));

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "native-preferred",
            operatorFilter: [],
        });

        expect(graph.stationsById["node/1"]!.label).toBe("東京");
    });

    test("falls back to coordinates as label when no name", async () => {
        const stations: StationPlace[] = [
            {
                type: "Feature",
                geometry: { type: "Point", coordinates: [139.6917, 35.6895] },
                properties: { id: "node/1" },
            },
        ];

        mockedGetOverpassData.mockResolvedValue(makeOverpassResponse([]));

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(graph.stationsById["node/1"]!.label).not.toBe("");
        expect(graph.stationsById["node/1"]!.label).toContain("°");
    });

    test("builds lines from Overpass route relations", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Shinjuku" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(100, { route: "train", name: "Line A" }, [
                    1,
                ]),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(Object.keys(graph.linesById)).toHaveLength(1);
        expect(graph.linesById["relation/100"]).toEqual({
            id: "relation/100",
            label: "Line A",
            operator: undefined,
            network: undefined,
        });
        expect(graph.stationLineIds["node/1"]).toEqual(["relation/100"]);
        expect(graph.lineStationIds["relation/100"]).toEqual(["node/1"]);
    });

    test("uses name:en as line label when available", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Shinjuku" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(
                    100,
                    {
                        route: "train",
                        "name:en": "Yamanote Line",
                        name: "山手線",
                    },
                    [1],
                ),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(graph.linesById["relation/100"]!.label).toBe("Yamanote Line");
    });

    test("falls back to name then ref for line label", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Shinjuku" }),
            makeStationPlace("node/2", 35.69, 139.7, { name: "Tokyo" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(
                    100,
                    { route: "train", name: "Chuo Line" },
                    [1],
                ),
                makeRelationElement(200, { route: "train", ref: "JC" }, [2]),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(graph.linesById["relation/100"]!.label).toBe("Chuo Line");
        expect(graph.linesById["relation/200"]!.label).toBe("JC");
    });

    test("falls back to relation/id for line label when no name/name:en/ref", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Shinjuku" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(123, { route: "train" }, [1]),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(graph.linesById["relation/123"]!.label).toBe("relation/123");
    });

    test("filters lines by operatorFilter when non-empty", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Shibuya" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(
                    100,
                    { route: "train", name: "JR Line", operator: "JR East" },
                    [1],
                ),
                makeRelationElement(
                    200,
                    {
                        route: "subway",
                        name: "Metro Line",
                        operator: "Tokyo Metro",
                    },
                    [1],
                ),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: ["JR East"],
        });

        expect(Object.keys(graph.linesById)).toHaveLength(1);
        expect(graph.linesById["relation/100"]).toBeDefined();
        expect(graph.linesById["relation/200"]).toBeUndefined();
    });

    test("includes all lines when operatorFilter is empty", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Shibuya" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(
                    100,
                    { route: "train", name: "Line A", operator: "JR East" },
                    [1],
                ),
                makeRelationElement(
                    200,
                    {
                        route: "subway",
                        name: "Line B",
                        operator: "Tokyo Metro",
                    },
                    [1],
                ),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(Object.keys(graph.linesById)).toHaveLength(2);
    });

    test("removes lines with zero configured station members", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Shinjuku" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(
                    100,
                    { route: "train", name: "Unrelated Line" },
                    [999],
                ),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(graph.linesById).toEqual({});
        expect(graph.lineStationIds).toEqual({});
    });

    test("maps station-line membership via relation member nodes", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Station A" }),
            makeStationPlace("node/2", 35.69, 139.7, { name: "Station B" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(
                    100,
                    { route: "train", name: "Shared Line" },
                    [1, 2],
                ),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(graph.stationLineIds["node/1"]).toEqual(["relation/100"]);
        expect(graph.stationLineIds["node/2"]).toEqual(["relation/100"]);
        expect(graph.lineStationIds["relation/100"]).toEqual([
            "node/1",
            "node/2",
        ]);
    });

    test("correctly handles stations not on any line", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Connected" }),
            makeStationPlace("node/2", 35.69, 139.7, { name: "Orphan" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(
                    100,
                    { route: "train", name: "Single Stop Line" },
                    [1],
                ),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(graph.stationLineIds["node/1"]).toEqual(["relation/100"]);
        expect(graph.stationLineIds["node/2"]).toEqual([]);
    });

    test("returns stations-only graph when Overpass fails", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Shibuya" }),
        ];

        mockedGetOverpassData.mockRejectedValue(new Error("Network error"));

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(Object.keys(graph.stationsById)).toHaveLength(1);
        expect(graph.stationsById["node/1"]).toBeDefined();
        expect(graph.linesById).toEqual({});
        expect(graph.stationLineIds).toEqual({ "node/1": [] });
        expect(graph.lineStationIds).toEqual({});
    });

    test("handles duplicate relation entries deterministically", async () => {
        const stations: StationPlace[] = [
            makeStationPlace("node/1", 35.68, 139.76, { name: "Station" }),
        ];

        mockedGetOverpassData.mockResolvedValue(
            makeOverpassResponse([
                makeRelationElement(
                    100,
                    { route: "train", name: "Dupe Line" },
                    [1],
                ),
                makeRelationElement(
                    100,
                    { route: "train", name: "Dupe Line Again" },
                    [1],
                ),
            ]),
        );

        const graph = await buildTransitGraphForStations(stations, {
            stationNameStrategy: "english-preferred",
            operatorFilter: [],
        });

        expect(Object.keys(graph.linesById)).toHaveLength(1);
    });
});

import { bboxIntersects, type Bbox } from "@/shared/geojson";
import {
    buildHidingZoneFeatureCollection,
    buildRouteFeatureCollection,
    buildStationFeatureCollection,
    clipStationsToPlayArea,
    getPresetPlayAreaStats,
    getSelectedRoutes,
    getSelectedStations,
    getSuggestedPresetIds,
    partitionPresetsByScope,
} from "../hidingZone";
import type { HidingZonePreset } from "../hidingZoneTypes";

const EARTH_RADIUS_METERS = 6371008.8;

const preset: HidingZonePreset = {
    bbox: [139.6, 35.6, 139.8, 35.8],
    defaultColor: "#009BBF",
    id: "tokyo-metro",
    label: "Tokyo Metro",
    operator: "TokyoMetro",
    routes: [
        {
            color: "#FF9500",
            geometry: {
                coordinates: [
                    [
                        [139.76, 35.68],
                        [139.77, 35.69],
                    ],
                ],
                type: "MultiLineString",
            },
            id: "gtfs:test:route:route-a",
            name: "Route A",
            sourceId: "route-a",
        },
    ],
    source: { kind: "gtfs", namespace: "test" },
    stations: [
        {
            id: "gtfs:test:stop:station-a",
            lat: 35.68,
            lon: 139.76,
            mergeKey: "station-a-merge",
            name: "Station A",
            routeIds: ["gtfs:test:route:route-a"],
            sourceId: "station-a",
        },
    ],
};

function collectCoordinates(geometry: any): number[][] {
    if (geometry.type === "Polygon") {
        return geometry.coordinates.flat();
    }
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.flat(2);
    }
    return [];
}

function projectedRingArea(
    coordinates: number[][],
    originLatitude: number,
): number {
    const originLatitudeRadians = (originLatitude * Math.PI) / 180;
    let area = 0;

    for (let index = 0; index < coordinates.length - 1; index += 1) {
        const [lonA, latA] = coordinates[index];
        const [lonB, latB] = coordinates[index + 1];
        const xA =
            EARTH_RADIUS_METERS *
            ((lonA * Math.PI) / 180) *
            Math.cos(originLatitudeRadians);
        const yA = EARTH_RADIUS_METERS * ((latA * Math.PI) / 180);
        const xB =
            EARTH_RADIUS_METERS *
            ((lonB * Math.PI) / 180) *
            Math.cos(originLatitudeRadians);
        const yB = EARTH_RADIUS_METERS * ((latB * Math.PI) / 180);

        area += xA * yB - xB * yA;
    }

    return Math.abs(area) / 2;
}

function polygonAreaMeters(feature: any, originLatitude: number): number {
    if (feature.geometry.type === "Polygon") {
        const [outerRing, ...holes] = feature.geometry.coordinates;
        return (
            projectedRingArea(outerRing, originLatitude) -
            holes.reduce(
                (area: number, ring: number[][]) =>
                    area + projectedRingArea(ring, originLatitude),
                0,
            )
        );
    }

    if (feature.geometry.type === "MultiPolygon") {
        return feature.geometry.coordinates.reduce(
            (area: number, polygon: number[][][]) =>
                area +
                polygonAreaMeters(
                    {
                        geometry: {
                            coordinates: polygon,
                            type: "Polygon",
                        },
                    },
                    originLatitude,
                ),
            0,
        );
    }

    return 0;
}

describe("hidingZone helpers", () => {
    it("detects bbox intersections", () => {
        expect(bboxIntersects([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true);
        expect(bboxIntersects([0, 0, 2, 2], [3, 3, 4, 4])).toBe(false);
    });

    it("suggests presets when their bbox intersects the play area bbox", () => {
        expect(getSuggestedPresetIds([preset], [139.7, 35.7, 140, 36])).toEqual(
            ["tokyo-metro"],
        );
        expect(getSuggestedPresetIds([preset], [140, 36, 141, 37])).toEqual([]);
    });

    it("deduplicates selected station contributions by merge key", () => {
        const duplicatePreset: HidingZonePreset = {
            ...preset,
            id: "toei-subway",
            stations: [
                {
                    ...preset.stations[0],
                    id: "gtfs:toei:stop:station-b",
                    routeIds: ["gtfs:toei:route:route-b"],
                    sourceId: "station-b",
                },
            ],
        };

        expect(getSelectedStations([preset, duplicatePreset])).toEqual([
            {
                id: "station-a-merge",
                lat: 35.68,
                lon: 139.76,
                name: "Station A",
                routeColors: ["#FF9500", "#009BBF"],
                routeIds: [
                    "gtfs:test:route:route-a",
                    "gtfs:toei:route:route-b",
                ],
                sourceStationIds: [
                    "gtfs:test:stop:station-a",
                    "gtfs:toei:stop:station-b",
                ],
            },
        ]);
    });

    it("keeps source-adapter route ids distinct", () => {
        const collidingPreset: HidingZonePreset = {
            ...preset,
            id: "toei-subway",
            routes: [
                {
                    ...preset.routes[0],
                    color: "#6CBB5A",
                    id: "gtfs:toei:route:route-a",
                    name: "Different Route A",
                },
            ],
            source: { kind: "gtfs", namespace: "toei" },
            stations: [
                {
                    id: "gtfs:toei:stop:station-b",
                    lat: 35.69,
                    lon: 139.77,
                    mergeKey: "station-b-merge",
                    name: "Station B",
                    routeIds: ["gtfs:toei:route:route-a"],
                    sourceId: "station-b",
                },
            ],
        };

        expect(
            getSelectedRoutes([preset, collidingPreset]).map((route) => ({
                id: route.id,
                name: route.name,
            })),
        ).toEqual([
            { id: "gtfs:test:route:route-a", name: "Route A" },
            { id: "gtfs:toei:route:route-a", name: "Different Route A" },
        ]);
        expect(
            getSelectedStations([preset, collidingPreset]).map((station) => ({
                id: station.id,
                routeIds: station.routeIds,
            })),
        ).toEqual([
            {
                id: "station-a-merge",
                routeIds: ["gtfs:test:route:route-a"],
            },
            {
                id: "station-b-merge",
                routeIds: ["gtfs:toei:route:route-a"],
            },
        ]);
    });

    it("resolves cross-preset route colors at interchange stations", () => {
        // Operator A owns line L with a real color.
        const operatorA: HidingZonePreset = {
            ...preset,
            id: "operator-a",
            defaultColor: "#009BBF",
            routes: [
                {
                    color: "#FF0000",
                    geometry: {
                        coordinates: [
                            [
                                [139.76, 35.68],
                                [139.77, 35.69],
                            ],
                        ],
                        type: "MultiLineString",
                    },
                    id: "cross-preset:route:line-l",
                    name: "Line L",
                    sourceId: "line-l",
                },
            ],
            stations: [],
        };

        // Operator B has a station that references line L (interchange).
        const operatorB: HidingZonePreset = {
            ...preset,
            id: "operator-b",
            defaultColor: "#40E0D0",
            routes: [
                {
                    color: "#0000FF",
                    geometry: {
                        coordinates: [
                            [
                                [139.76, 35.68],
                                [139.78, 35.7],
                            ],
                        ],
                        type: "MultiLineString",
                    },
                    id: "cross-preset:route:line-m",
                    name: "Line M",
                    sourceId: "line-m",
                },
            ],
            stations: [
                {
                    id: "cross-preset:stop:interchange",
                    lat: 35.68,
                    lon: 139.76,
                    mergeKey: "interchange-merge",
                    name: "Interchange",
                    routeIds: [
                        "cross-preset:route:line-l",
                        "cross-preset:route:line-m",
                    ],
                    sourceId: "interchange",
                },
            ],
        };

        const stations = getSelectedStations([operatorA, operatorB]);
        expect(stations).toHaveLength(1);
        // Line L's real color (#FF0000) must resolve even though the station
        // lives in operator B's preset; line M also keeps its real color.
        expect(stations[0].routeColors).toEqual(
            expect.arrayContaining(["#FF0000", "#0000FF"]),
        );
        expect(stations[0].routeColors).not.toContain(operatorB.defaultColor);
    });

    it("resolves cross-preset route colors even when the owner preset is unselected", () => {
        // Operator A owns line L with a real color. It is NOT selected.
        const operatorA: HidingZonePreset = {
            ...preset,
            id: "operator-a",
            defaultColor: "#009BBF",
            routes: [
                {
                    color: "#FF0000",
                    geometry: {
                        coordinates: [
                            [
                                [139.76, 35.68],
                                [139.77, 35.69],
                            ],
                        ],
                        type: "MultiLineString",
                    },
                    id: "cross-preset:route:line-l",
                    name: "Line L",
                    sourceId: "line-l",
                },
            ],
            stations: [],
        };

        // Operator B is selected and has a station that references line L.
        const operatorB: HidingZonePreset = {
            ...preset,
            id: "operator-b",
            defaultColor: "#40E0D0",
            routes: [
                {
                    color: "#0000FF",
                    geometry: {
                        coordinates: [
                            [
                                [139.76, 35.68],
                                [139.78, 35.7],
                            ],
                        ],
                        type: "MultiLineString",
                    },
                    id: "cross-preset:route:line-m",
                    name: "Line M",
                    sourceId: "line-m",
                },
            ],
            stations: [
                {
                    id: "cross-preset:stop:interchange",
                    lat: 35.68,
                    lon: 139.76,
                    mergeKey: "interchange-merge",
                    name: "Interchange",
                    routeIds: [
                        "cross-preset:route:line-l",
                        "cross-preset:route:line-m",
                    ],
                    sourceId: "interchange",
                },
            ],
        };

        const stations = getSelectedStations(
            [operatorB],
            [operatorA, operatorB],
        );
        expect(stations).toHaveLength(1);
        expect(stations[0].routeColors).toEqual(
            expect.arrayContaining(["#FF0000", "#0000FF"]),
        );
        expect(stations[0].routeColors).not.toContain(operatorB.defaultColor);
    });

    it("preserves route colors and falls back only when a route color is absent", () => {
        const presetWithFallbackRoute: HidingZonePreset = {
            ...preset,
            routes: [
                ...preset.routes,
                {
                    color: "",
                    geometry: {
                        coordinates: [
                            [
                                [139.75, 35.67],
                                [139.78, 35.7],
                            ],
                        ],
                        type: "MultiLineString",
                    },
                    id: "gtfs:test:route:route-fallback",
                    name: "Fallback Route",
                    sourceId: "route-fallback",
                },
            ],
        };

        const routeFeatures = buildRouteFeatureCollection([
            presetWithFallbackRoute,
        ]);

        expect(routeFeatures.features).toHaveLength(2);
        expect(routeFeatures.features[0].properties.color).toBe("#FF9500");
        expect(routeFeatures.features[0].properties.id).toBe(
            "gtfs:test:route:route-a",
        );
        expect(routeFeatures.features[1].properties.color).toBe(
            preset.defaultColor,
        );
    });

    it("expands station features into route-colored rings", () => {
        const stationFeatures = buildStationFeatureCollection([
            {
                id: "station-a",
                lat: 35.68,
                lon: 139.76,
                name: "Station A",
                routeColors: ["#FF9500", "#F62E36"],
                routeIds: ["route-a", "route-b"],
            },
        ]);

        expect(stationFeatures.features).toHaveLength(2);
        expect(
            stationFeatures.features.map((feature) => feature.properties),
        ).toEqual([
            {
                color: "#FF9500",
                id: "station-a",
                name: "Station A",
                ringCount: 2,
                ringIndex: 0,
            },
            {
                color: "#F62E36",
                id: "station-a",
                name: "Station A",
                ringCount: 2,
                ringIndex: 1,
            },
        ]);
    });

    it("builds empty hiding-zone feature collections", () => {
        expect(buildHidingZoneFeatureCollection([], 600).features).toEqual([]);
    });

    it("builds a finite polygon around a selected station", () => {
        const zone = buildHidingZoneFeatureCollection(preset.stations, 600);
        const feature = zone.features[0];
        const coordinates = collectCoordinates(feature.geometry);
        const lons = coordinates.map(([lon]) => lon);
        const lats = coordinates.map(([, lat]) => lat);
        const area = polygonAreaMeters(feature, preset.stations[0].lat);
        const expectedArea = Math.PI * 600 * 600;

        expect(zone.features).toHaveLength(1);
        expect(feature.geometry.type).toBe("Polygon");
        expect(feature.properties.radiusMeters).toBe(600);
        expect(coordinates.length).toBeGreaterThan(4);
        expect(
            coordinates.every(([lon, lat]) =>
                [lon, lat].every(Number.isFinite),
            ),
        ).toBe(true);
        expect(Math.min(...lons)).toBeLessThan(preset.stations[0].lon);
        expect(Math.max(...lons)).toBeGreaterThan(preset.stations[0].lon);
        expect(Math.min(...lats)).toBeLessThan(preset.stations[0].lat);
        expect(Math.max(...lats)).toBeGreaterThan(preset.stations[0].lat);
        expect(area).toBeGreaterThan(expectedArea * 0.85);
        expect(area).toBeLessThan(expectedArea * 1.15);
    });

    it("reuses cached geometry for the same stations and radius", () => {
        expect(buildHidingZoneFeatureCollection(preset.stations, 600)).toBe(
            buildHidingZoneFeatureCollection(preset.stations, 600),
        );
    });

    it("merges multiple station buffers and grows when radius increases", () => {
        const nearbyStations = [
            preset.stations[0],
            {
                id: "station-b",
                lat: 35.681,
                lon: 139.766,
                name: "Station B",
                routeIds: ["route-b"],
            },
        ];

        const zone600 = buildHidingZoneFeatureCollection(nearbyStations, 600);
        const zone1000 = buildHidingZoneFeatureCollection(nearbyStations, 1000);
        const feature600 = zone600.features[0];
        const feature1000 = zone1000.features[0];

        expect(zone600.features).toHaveLength(1);
        expect(["Polygon", "MultiPolygon"]).toContain(feature600.geometry.type);
        expect(feature600.properties.radiusMeters).toBe(600);
        expect(feature1000.properties.radiusMeters).toBe(1000);
        expect(
            polygonAreaMeters(feature1000, nearbyStations[0].lat),
        ).toBeGreaterThan(polygonAreaMeters(feature600, nearbyStations[0].lat));
    });

    it("does not reuse cached geometry when a station coordinate changes", () => {
        const first = buildHidingZoneFeatureCollection(preset.stations, 600);
        const moved = buildHidingZoneFeatureCollection(
            [{ ...preset.stations[0], lon: 139.9 }],
            600,
        );
        const movedCoordinates = collectCoordinates(moved.features[0].geometry);

        expect(moved).not.toBe(first);
        expect(
            Math.min(...movedCoordinates.map(([lon]) => lon)),
        ).toBeGreaterThan(139.8);
    });
});

describe("getPresetPlayAreaStats", () => {
    it("counts stations within the play area bbox", () => {
        const presets = [
            {
                id: "test-preset",
                stations: [
                    { lon: 139.7, lat: 35.6 }, // inside
                    { lon: 139.8, lat: 35.7 }, // inside
                    { lon: 140.5, lat: 36.0 }, // outside
                ],
            },
        ] as any;
        const bbox: Bbox = [139.5, 35.5, 140.0, 35.8];
        const stats = getPresetPlayAreaStats(presets, bbox);
        expect(stats).toEqual([{ presetId: "test-preset", stationsInArea: 2 }]);
    });

    it("returns zero for presets with no stations in bbox", () => {
        const presets = [
            {
                id: "far-preset",
                stations: [{ lon: 141.0, lat: 36.0 }],
            },
        ] as any;
        const bbox: Bbox = [139.5, 35.5, 140.0, 35.8];
        expect(getPresetPlayAreaStats(presets, bbox)).toEqual([
            { presetId: "far-preset", stationsInArea: 0 },
        ]);
    });

    it("handles multiple presets", () => {
        const presets = [
            {
                id: "a",
                stations: [{ lon: 139.7, lat: 35.6 }],
            },
            {
                id: "b",
                stations: [
                    { lon: 139.7, lat: 35.6 },
                    { lon: 140.5, lat: 36.0 },
                ],
            },
        ] as any;
        const bbox: Bbox = [139.5, 35.5, 140.0, 35.8];
        expect(getPresetPlayAreaStats(presets, bbox)).toEqual([
            { presetId: "a", stationsInArea: 1 },
            { presetId: "b", stationsInArea: 1 },
        ]);
    });
});

describe("clipStationsToPlayArea", () => {
    const stations: any[] = [
        { id: "inside", lon: 139.7, lat: 35.6 },
        { id: "outside", lon: 141.0, lat: 36.0 },
        { id: "edge", lon: 139.9, lat: 35.7 },
    ];
    const bbox: Bbox = [139.5, 35.5, 140.0, 35.8];

    it("filters stations outside the play area", () => {
        const result = clipStationsToPlayArea(stations, bbox, 600);
        expect(result).toHaveLength(2);
        expect(result.map((s: any) => s.id)).toEqual(["inside", "edge"]);
    });

    it("keeps stations just outside the bbox when radius margin covers them", () => {
        const edgeStations = [
            { id: "barely-out", lon: 140.001, lat: 35.6 },
        ] as any;
        const result = clipStationsToPlayArea(edgeStations, bbox, 600);
        // 600m ~ 0.0054 deg, so 140.001 is within expanded bbox
        expect(result).toHaveLength(1);
    });

    it("returns all stations when play area is undefined", () => {
        const result = clipStationsToPlayArea(stations, undefined, 600);
        expect(result).toEqual(stations);
    });

    it("returns empty array for empty stations", () => {
        const result = clipStationsToPlayArea([], bbox, 600);
        expect(result).toEqual([]);
    });
});

describe("partitionPresetsByScope", () => {
    const playAreaBbox: Bbox = [139.6, 35.6, 139.8, 35.8];

    function makePreset(
        id: string,
        kind: HidingZonePreset["kind"],
        stationCoords: [number, number][],
    ): HidingZonePreset {
        return {
            bbox: playAreaBbox,
            defaultColor: "#009BBF",
            id,
            kind,
            label: id,
            operator: id,
            routes: [],
            source: { kind: "osm-pack", namespace: "test" },
            stations: stationCoords.map(([lon, lat], i) => ({
                id: `${id}:stop:${i}`,
                lat,
                lon,
                mergeKey: `${id}-merge-${i}`,
                name: `${id} Station ${i}`,
                routeIds: [],
                sourceId: `${id}-${i}`,
            })),
        };
    }

    // A coverage preset and operators, all with stations inside the play area.
    const operator = makePreset("operator", "operator", [
        [139.7, 35.7],
        [139.71, 35.71],
    ]);
    const operatorFewer = makePreset("operator-fewer", "operator", [
        [139.72, 35.72],
    ]);
    const coverage = makePreset("coverage", "coverage", [[139.73, 35.73]]);
    const undefinedKind = makePreset("legacy", undefined, [[139.74, 35.74]]);
    // No stations inside the play-area bbox → "other".
    const outside = makePreset("outside", "operator", [[140.5, 36.5]]);

    const presets = [operator, operatorFewer, coverage, undefinedKind, outside];

    it("routes coverage-kind presets to coveragePresets, not operators (regression)", () => {
        const stats = getPresetPlayAreaStats(presets, playAreaBbox);
        const { operatorPresets, coveragePresets, otherPresets } =
            partitionPresetsByScope(presets, stats);

        // The coverage preset must land in its own group.
        expect(coveragePresets.map((p) => p.id)).toEqual(["coverage"]);
        // Operators (incl. the undefined-kind preset defaulting to operator)
        // must NOT contain the coverage preset.
        expect(operatorPresets.map((p) => p.id)).not.toContain("coverage");
        expect(operatorPresets.map((p) => p.id).sort()).toEqual([
            "legacy",
            "operator",
            "operator-fewer",
        ]);
        // Zero-in-area presets fall through to "other".
        expect(otherPresets.map((p) => p.id)).toEqual(["outside"]);
    });

    it("sorts operators by in-area station count descending", () => {
        const stats = getPresetPlayAreaStats(presets, playAreaBbox);
        const { operatorPresets } = partitionPresetsByScope(presets, stats);
        // operator (2 stations) before operator-fewer / legacy (1 each).
        expect(operatorPresets[0].id).toBe("operator");
    });

    it("puts everything in otherPresets when there is no play area", () => {
        const { operatorPresets, coveragePresets, otherPresets } =
            partitionPresetsByScope(presets, null);
        expect(operatorPresets).toEqual([]);
        expect(coveragePresets).toEqual([]);
        expect(otherPresets).toHaveLength(presets.length);
    });
});

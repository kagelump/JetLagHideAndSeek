import {
    bboxIntersects,
    buildHidingZoneFeatureCollection,
    fromMeters,
    getSelectedStations,
    getSuggestedPresetIds,
    toMeters,
} from "../hidingZone";
import type { HidingZonePreset } from "../hidingZoneTypes";

const preset: HidingZonePreset = {
    bbox: [139.6, 35.6, 139.8, 35.8],
    defaultColor: "#009BBF",
    id: "tokyo-metro",
    label: "Tokyo Metro",
    operator: "TokyoMetro",
    routes: [],
    stations: [
        {
            id: "station-a",
            lat: 35.68,
            lon: 139.76,
            name: "Station A",
            routeIds: ["route-a"],
        },
    ],
};

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

    it("converts radius display values to backend meters", () => {
        expect(toMeters("600", "m")).toBe(600);
        expect(toMeters("0.6", "km")).toBe(600);
        expect(Math.round(toMeters("1", "mi") ?? 0)).toBe(1609);
        expect(fromMeters(600, "km")).toBe("0.60");
    });

    it("deduplicates selected stations by generated station id", () => {
        const duplicatePreset: HidingZonePreset = {
            ...preset,
            id: "toei-subway",
            stations: [
                {
                    ...preset.stations[0],
                    routeIds: ["route-b"],
                },
            ],
        };

        expect(getSelectedStations([preset, duplicatePreset])).toEqual([
            {
                ...preset.stations[0],
                routeIds: ["route-a", "route-b"],
            },
        ]);
    });

    it("builds empty or merged hiding-zone feature collections", () => {
        expect(buildHidingZoneFeatureCollection([], 600).features).toEqual([]);

        const zone = buildHidingZoneFeatureCollection(preset.stations, 600);
        expect(zone.features).toHaveLength(1);
        expect(zone.features[0].properties.radiusMeters).toBe(600);
    });
});

import type { PlayArea } from "@/features/map/playArea";
import { unsetPlayArea } from "@/features/map/playArea";
import {
    defaultUnitSystemForPlayArea,
    isUnitedStatesLngLat,
} from "@/shared/unitSystemDefaults";

function playAreaAt(center: [number, number]): PlayArea {
    return {
        bbox: [
            center[0] - 0.1,
            center[1] - 0.1,
            center[0] + 0.1,
            center[1] + 0.1,
        ],
        boundary: { type: "FeatureCollection", features: [] },
        center,
        label: "Test",
        osmId: 123,
        osmType: "R",
    };
}

describe("isUnitedStatesLngLat", () => {
    it("matches US locations across regions", () => {
        expect(isUnitedStatesLngLat([-122.42, 37.77])).toBe(true); // San Francisco
        expect(isUnitedStatesLngLat([-73.94, 40.72])).toBe(true); // New York
        expect(isUnitedStatesLngLat([-149.9, 61.2])).toBe(true); // Anchorage
        expect(isUnitedStatesLngLat([-157.85, 21.3])).toBe(true); // Honolulu
        expect(isUnitedStatesLngLat([-66.1, 18.46])).toBe(true); // San Juan, PR
    });

    it("matches US cities near the Canadian border", () => {
        expect(isUnitedStatesLngLat([-122.33, 47.61])).toBe(true); // Seattle
        expect(isUnitedStatesLngLat([-78.88, 42.89])).toBe(true); // Buffalo
        expect(isUnitedStatesLngLat([-83.05, 42.33])).toBe(true); // Detroit
        expect(isUnitedStatesLngLat([-73.21, 44.48])).toBe(true); // Burlington, VT
        expect(isUnitedStatesLngLat([-70.26, 43.66])).toBe(true); // Portland, ME
    });

    it("rejects non-US locations", () => {
        expect(isUnitedStatesLngLat([139.7, 35.7])).toBe(false); // Tokyo
        expect(isUnitedStatesLngLat([-0.13, 51.5])).toBe(false); // London
        expect(isUnitedStatesLngLat([-99.13, 19.43])).toBe(false); // Mexico City
    });

    it("rejects Canadian cities that a naive US box would catch", () => {
        expect(isUnitedStatesLngLat([-79.38, 43.65])).toBe(false); // Toronto
        expect(isUnitedStatesLngLat([-73.57, 45.5])).toBe(false); // Montreal
        expect(isUnitedStatesLngLat([-123.12, 49.28])).toBe(false); // Vancouver
        expect(isUnitedStatesLngLat([-75.7, 45.42])).toBe(false); // Ottawa
    });
});

describe("defaultUnitSystemForPlayArea", () => {
    it("returns imperial for a US play area", () => {
        expect(defaultUnitSystemForPlayArea(playAreaAt([-122.42, 37.77]))).toBe(
            "imperial",
        );
    });

    it("returns metric for a non-US play area", () => {
        expect(defaultUnitSystemForPlayArea(playAreaAt([139.7, 35.7]))).toBe(
            "metric",
        );
    });

    it("returns metric for an unset play area", () => {
        expect(defaultUnitSystemForPlayArea(unsetPlayArea)).toBe("metric");
    });
});

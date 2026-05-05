import * as turf from "@turf/turf";
import { describe, expect, it, vi } from "vitest";

import type { StationCircle } from "@/maps/api";
import type { TransitGraph } from "@/maps/geo-utils";

vi.mock("@/lib/context", () => {
    const atom = (value: unknown = undefined) => ({ get: () => value });
    return {
        hiderMode: atom(false),
        mapGeoJSON: atom(null),
        mapGeoLocation: atom(null),
        playAreaMode: atom("normal"),
        polyGeoJSON: atom(null),
        trainStations: atom([]),
        transitGraph: atom(null),
    };
});

import {
    buildStationLineBoundary,
    pointInPolygonSafe,
    sanitizeMatchingQuestionDataOnTypeChange,
} from "./matching";

function makeTransitGraph(): TransitGraph {
    return {
        stationsById: {
            "node/1": {
                id: "node/1",
                label: "Hiroo",
                coordinates: [139.7222, 35.6512],
            },
            "node/2": {
                id: "node/2",
                label: "Roppongi",
                coordinates: [139.7311, 35.6628],
            },
            "node/3": {
                id: "node/3",
                label: "Ebisu",
                coordinates: [139.7101, 35.6467],
            },
        },
        linesById: {
            "relation/hibiya": {
                id: "relation/hibiya",
                label: "Hibiya Line",
            },
        },
        stationLineIds: {
            "node/1": ["relation/hibiya"],
            "node/2": ["relation/hibiya"],
            "node/3": [],
        },
        lineStationIds: {
            "relation/hibiya": ["node/1", "node/2"],
        },
    };
}

function stationCircle(id: string, lng: number, lat: number): StationCircle {
    const stationPoint = turf.point([lng, lat], { id, name: id });
    return turf.circle([lng, lat], 0.1, {
        units: "kilometers",
        properties: stationPoint,
    }) as StationCircle;
}

describe("pointInPolygonSafe", () => {
    it("returns true for valid containing polygon", () => {
        const pt = turf.point([139.7, 35.7]);
        const poly = turf.polygon([
            [
                [139.6, 35.6],
                [139.8, 35.6],
                [139.8, 35.8],
                [139.6, 35.8],
                [139.6, 35.6],
            ],
        ]);
        expect(pointInPolygonSafe(pt, poly)).toBe(true);
    });

    it("returns false when point lies outside", () => {
        const pt = turf.point([3, 3]);
        const poly = turf.polygon([
            [
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1],
                [-1, -1],
            ],
        ]);
        expect(pointInPolygonSafe(pt, poly)).toBe(false);
    });
});

describe("buildStationLineBoundary", () => {
    it("builds the selected line boundary for same answers", () => {
        const boundary = buildStationLineBoundary(
            {
                type: "same-train-line",
                lat: 35.6512,
                lng: 139.7222,
                drag: false,
                same: true,
                color: "black",
                collapsed: false,
                selectedTrainLineId: "relation/hibiya",
            },
            makeTransitGraph(),
            [
                stationCircle("node/1", 139.7222, 35.6512),
                stationCircle("node/2", 139.7311, 35.6628),
                stationCircle("node/3", 139.7101, 35.6467),
            ],
        );

        expect(
            boundary?.features.map((s) => s.properties.properties.id),
        ).toEqual(["node/1", "node/2"]);
    });

    it("still builds the selected line boundary for different answers", () => {
        const boundary = buildStationLineBoundary(
            {
                type: "same-train-line",
                lat: 35.6512,
                lng: 139.7222,
                drag: false,
                same: false,
                color: "black",
                collapsed: false,
                selectedTrainLineId: "relation/hibiya",
            },
            makeTransitGraph(),
            [
                stationCircle("node/1", 139.7222, 35.6512),
                stationCircle("node/2", 139.7311, 35.6628),
                stationCircle("node/3", 139.7101, 35.6467),
            ],
        );

        expect(
            boundary?.features.map((s) => s.properties.properties.id),
        ).toEqual(["node/1", "node/2"]);
    });
});

describe("sanitizeMatchingQuestionDataOnTypeChange", () => {
    it("strips cat when switching from zone to same-train-line", () => {
        const input = {
            type: "zone",
            cat: { adminLevel: 4 },
            lat: 35.68,
            lng: 139.77,
            drag: false,
            color: "black",
            collapsed: true,
            same: true,
        };
        const result = sanitizeMatchingQuestionDataOnTypeChange(
            input,
            "same-train-line",
        );
        expect(result.type).toBe("same-train-line");
        expect(result).not.toHaveProperty("cat");
        expect(result.lat).toBe(35.68);
        expect(result.lng).toBe(139.77);
        expect(result.drag).toBe(false);
        expect(result.color).toBe("black");
        expect(result.collapsed).toBe(true);
        expect(result.same).toBe(true);
    });

    it("adds cat with default when switching to zone", () => {
        const input = {
            type: "airport",
            lat: 35.68,
            lng: 139.77,
            drag: false,
            color: "black",
            collapsed: true,
        };
        const result = sanitizeMatchingQuestionDataOnTypeChange(input, "zone", {
            defaultAdminLevel: 4,
        });
        expect(result.type).toBe("zone");
        expect(result.cat).toEqual({ adminLevel: 4 });
        expect(result.lat).toBe(35.68);
        expect(result.lng).toBe(139.77);
        expect(result.drag).toBe(false);
        expect(result.color).toBe("black");
        expect(result.collapsed).toBe(true);
    });

    it("strips selectedTrainLineId when switching away from same-train-line", () => {
        const input = {
            type: "same-train-line",
            selectedTrainLineId: "relation/8026074",
            selectedTrainLineLabel: "Tokyo Metro Ginza Line",
            lat: 35.68,
            lng: 139.77,
            drag: false,
            color: "black",
            collapsed: true,
            same: true,
        };
        const result = sanitizeMatchingQuestionDataOnTypeChange(
            input,
            "airport",
        );
        expect(result.type).toBe("airport");
        expect(result).not.toHaveProperty("selectedTrainLineId");
        expect(result).not.toHaveProperty("selectedTrainLineLabel");
    });

    it("strips geo when switching away from custom-zone", () => {
        const input = {
            type: "custom-zone",
            geo: { type: "FeatureCollection", features: [] },
            lat: 35.68,
            lng: 139.77,
            drag: false,
            color: "black",
            collapsed: true,
            same: true,
        };
        const result = sanitizeMatchingQuestionDataOnTypeChange(
            input,
            "airport",
        );
        expect(result.type).toBe("airport");
        expect(result).not.toHaveProperty("geo");
    });

    it("same-length-station sets lengthComparison and same", () => {
        const input = {
            type: "airport",
            lat: 35.68,
            lng: 139.77,
            drag: false,
            color: "black",
            collapsed: true,
            same: true,
        };
        const result = sanitizeMatchingQuestionDataOnTypeChange(
            input,
            "same-length-station",
        );
        expect(result.type).toBe("same-length-station");
        expect(result.lengthComparison).toBe("same");
        expect(result.same).toBe(true);
    });

    it("preserves base fields and same:false across type change", () => {
        const input = {
            type: "same-train-line",
            selectedTrainLineId: "relation/8026074",
            lat: 35.68,
            lng: 139.77,
            drag: false,
            color: "red",
            collapsed: true,
            same: false,
        };
        const result = sanitizeMatchingQuestionDataOnTypeChange(input, "zone", {
            defaultAdminLevel: 5,
        });
        expect(result.lat).toBe(35.68);
        expect(result.lng).toBe(139.77);
        expect(result.drag).toBe(false);
        expect(result.color).toBe("red");
        expect(result.collapsed).toBe(true);
        expect(result.same).toBe(false);
        expect(result.cat).toEqual({ adminLevel: 5 });
    });

    it("strips extra unknown keys", () => {
        const input = {
            type: "airport",
            cat: { adminLevel: 4 },
            foo: "bar",
            baz: 123,
            lat: 35.68,
            lng: 139.77,
            drag: false,
            color: "black",
            collapsed: true,
        };
        const result = sanitizeMatchingQuestionDataOnTypeChange(
            input,
            "airport",
        );
        expect(result).not.toHaveProperty("cat");
        expect(result).not.toHaveProperty("foo");
        expect(result).not.toHaveProperty("baz");
        expect(result.type).toBe("airport");
        expect(result.lat).toBe(35.68);
        expect(result.lng).toBe(139.77);
    });

    it("is idempotent — already-clean data unchanged", () => {
        const input = {
            type: "same-train-line",
            selectedTrainLineId: "relation/8026074",
            selectedTrainLineLabel: "Tokyo Metro Ginza Line",
            lat: 35.68,
            lng: 139.77,
            drag: false,
            color: "black",
            collapsed: true,
            same: true,
        };
        const result = sanitizeMatchingQuestionDataOnTypeChange(
            input,
            "same-train-line",
        );
        expect(result).toEqual(input);
    });
});

import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";

import {
    pointInPolygonSafe,
    sanitizeMatchingQuestionDataOnTypeChange,
} from "./matching";

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

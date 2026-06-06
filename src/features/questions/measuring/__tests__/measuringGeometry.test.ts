import {
    buildMeasuringRenderState,
    clearMeasuringCircleCache,
} from "@/features/questions/measuring/measuringGeometry";
import type { MeasuringQuestion } from "@/features/questions/measuring/measuringTypes";
import type { QuestionState } from "@/features/questions/questionTypes";

function makeMeasuringQuestion(
    overrides: Partial<MeasuringQuestion> = {},
): MeasuringQuestion {
    return {
        answer: "unanswered",
        candidates: [
            {
                lat: 35.681,
                lon: 139.761,
                name: "Target POI",
                osmId: 100,
                osmType: "node",
                tags: {},
                distanceMeters: 1200,
            },
            {
                lat: 35.69,
                lon: 139.77,
                name: "Other POI",
                osmId: 200,
                osmType: "way",
                tags: {},
                distanceMeters: 2500,
            },
        ],
        category: "museum",
        center: [139.75, 35.675], // seeker pin — far from target
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "q-measuring-test",
        isLocked: false,
        seekerDistanceMeters: 1200,
        seekerDistanceUnit: "m",
        selectedOsmId: 100,
        selectedOsmType: "node",
        type: "measuring",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("buildMeasuringRenderState", () => {
    beforeEach(() => {
        clearMeasuringCircleCache();
    });

    it("returns empty collections for empty input", () => {
        const result = buildMeasuringRenderState([]);
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        expect(result.missMaskFeatures.features).toHaveLength(0);
    });

    it("returns empty collections when no measuring questions exist", () => {
        const radarQuestion = {
            id: "q-radar",
            type: "radar",
            answer: "positive",
            center: [139.75, 35.675],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            distanceMeters: 1000,
            distanceOption: "1km",
            distanceUnit: "m",
            isLocked: false,
        } as QuestionState;
        const result = buildMeasuringRenderState([radarQuestion]);
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        expect(result.missMaskFeatures.features).toHaveLength(0);
    });

    describe("Closer (positive answer)", () => {
        it("places circle in hitMaskFeatures", () => {
            const q = makeMeasuringQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState([q]);
            expect(result.hitMaskFeatures.features).toHaveLength(1);
            expect(result.missMaskFeatures.features).toHaveLength(0);
        });

        it("centers the circle on the target POI, not the seeker pin", () => {
            const q = makeMeasuringQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState([q]);
            const circle = result.hitMaskFeatures.features[0];
            // The circle should be centered near target POI [139.761, 35.681]
            const coords = circle.geometry.coordinates[0] as [number, number][];
            // Compute approximate centroid
            let sumLon = 0;
            let sumLat = 0;
            for (const [lon, lat] of coords) {
                sumLon += lon;
                sumLat += lat;
            }
            const avgLon = sumLon / coords.length;
            const avgLat = sumLat / coords.length;

            // Should be close to target POI [139.761, 35.681]
            expect(Math.abs(avgLon - 139.761)).toBeLessThan(0.02);
            expect(Math.abs(avgLat - 35.681)).toBeLessThan(0.02);

            // Should NOT be close to seeker pin [139.75, 35.675]
            // The distance from circle center to seeker pin should be significant
            const distFromSeeker = Math.sqrt(
                (avgLon - 139.75) ** 2 + (avgLat - 35.675) ** 2,
            );
            expect(distFromSeeker).toBeGreaterThan(0.005);
        });
    });

    describe("Farther (negative answer)", () => {
        it("places circle in missMaskFeatures", () => {
            const q = makeMeasuringQuestion({ answer: "negative" });
            const result = buildMeasuringRenderState([q]);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
            expect(result.missMaskFeatures.features).toHaveLength(1);
        });
    });

    describe("Unanswered", () => {
        it("produces neither hit nor miss features", () => {
            const q = makeMeasuringQuestion({ answer: "unanswered" });
            const result = buildMeasuringRenderState([q]);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
            expect(result.missMaskFeatures.features).toHaveLength(0);
        });
    });

    describe("Missing selection", () => {
        it("skips question when selectedOsmId is null", () => {
            const q = makeMeasuringQuestion({
                answer: "positive",
                selectedOsmId: null,
            });
            const result = buildMeasuringRenderState([q]);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
        });
    });

    describe("Zero or negative distance", () => {
        it("skips question when seekerDistanceMeters is 0", () => {
            const q = makeMeasuringQuestion({
                answer: "positive",
                seekerDistanceMeters: 0,
            });
            const result = buildMeasuringRenderState([q]);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
        });

        it("skips question when seekerDistanceMeters is negative", () => {
            const q = makeMeasuringQuestion({
                answer: "positive",
                seekerDistanceMeters: -100,
            });
            const result = buildMeasuringRenderState([q]);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
        });
    });

    describe("Missing target in candidates", () => {
        it("skips question when selectedOsmId is not in candidates", () => {
            const q = makeMeasuringQuestion({
                answer: "positive",
                selectedOsmId: 999,
            });
            const result = buildMeasuringRenderState([q]);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
        });
    });

    describe("LRU caching", () => {
        it("returns the same circle reference for identical inputs", () => {
            const q = makeMeasuringQuestion({ answer: "positive" });
            const result1 = buildMeasuringRenderState([q]);
            const result2 = buildMeasuringRenderState([q]);
            expect(result1.hitMaskFeatures.features[0]).toBe(
                result2.hitMaskFeatures.features[0],
            );
        });

        it("returns different circles after cache clear", () => {
            const q = makeMeasuringQuestion({ answer: "positive" });
            const result1 = buildMeasuringRenderState([q]);
            clearMeasuringCircleCache();
            const result2 = buildMeasuringRenderState([q]);
            expect(result1.hitMaskFeatures.features[0]).not.toBe(
                result2.hitMaskFeatures.features[0],
            );
        });

        it("uses different circles for different distances", () => {
            const q1 = makeMeasuringQuestion({
                answer: "positive",
                seekerDistanceMeters: 1200,
            });
            const q2 = makeMeasuringQuestion({
                answer: "positive",
                seekerDistanceMeters: 2500,
            });
            const result1 = buildMeasuringRenderState([q1]);
            const result2 = buildMeasuringRenderState([q2]);
            expect(result1.hitMaskFeatures.features[0]).not.toBe(
                result2.hitMaskFeatures.features[0],
            );
        });

        it("uses different circles for different target POIs", () => {
            const q1 = makeMeasuringQuestion({
                answer: "positive",
                selectedOsmId: 100,
                selectedOsmType: "node",
            });
            const q2 = makeMeasuringQuestion({
                answer: "positive",
                selectedOsmId: 200,
                selectedOsmType: "way",
            });
            const result1 = buildMeasuringRenderState([q1]);
            const result2 = buildMeasuringRenderState([q2]);
            expect(result1.hitMaskFeatures.features[0]).not.toBe(
                result2.hitMaskFeatures.features[0],
            );
        });
    });
});

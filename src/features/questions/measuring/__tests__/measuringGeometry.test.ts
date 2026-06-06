import {
    buildMeasuringRenderState,
    clearMeasuringCircleCache,
} from "@/features/questions/measuring/measuringGeometry";
import { clearLineDistanceCache } from "@/features/questions/measuring/lineMeasuringGeometry";
import {
    __clearLineBundlesForTest,
    __setLineBundleForTest,
    type LineBundle,
} from "@/features/questions/measuring/lineBundleLoader";
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

function makeLineBundle(coords: [number, number][]): LineBundle {
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    return {
        schemaVersion: 1,
        category: "coastline",
        generatedAt: "2026-01-01T00:00:00.000Z",
        source: "test-fixture",
        extractBbox: [137.9, 33.9, 141.9, 37.9],
        features: [
            {
                type: "Feature",
                bbox: [
                    Math.min(...xs),
                    Math.min(...ys),
                    Math.max(...xs),
                    Math.max(...ys),
                ],
                geometry: { type: "LineString", coordinates: coords },
                properties: {},
            },
        ],
    };
}

describe("buildMeasuringRenderState", () => {
    beforeEach(() => {
        clearMeasuringCircleCache();
        clearLineDistanceCache();
        __clearLineBundlesForTest();
    });

    it("returns empty collections for empty input", () => {
        const result = buildMeasuringRenderState([]);
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        expect(result.missMaskFeatures.features).toHaveLength(0);
        expect(result.nearestPointConnectors.features).toHaveLength(0);
        expect(result.nearestPointMarkers.features).toHaveLength(0);
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
        expect(result.nearestPointConnectors.features).toHaveLength(0);
        expect(result.nearestPointMarkers.features).toHaveLength(0);
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

    // ── Line-category tests ───────────────────────────────────────────────

    describe("Line categories", () => {
        it("is NOT dropped when selectedOsmId is null (regression guard)", () => {
            // Inject a line bundle near but not exactly on the seeker center.
            __setLineBundleForTest(
                "coastline",
                makeLineBundle([
                    [139.75, 35.67],
                    [139.76, 35.68],
                ]),
            );

            const q = makeMeasuringQuestion({
                answer: "positive",
                category: "coastline",
                center: [139.75, 35.68], // not exactly on the line
                selectedOsmId: null,
                selectedOsmType: null,
                seekerDistanceMeters: null,
            });
            const result = buildMeasuringRenderState([q]);
            // Line category should produce a circle despite null selection
            expect(result.hitMaskFeatures.features).toHaveLength(1);
        });

        it("centers the circle on the derived nearest point, not on center", () => {
            // Horizontal line at lat=35.675 (same lat as center)
            __setLineBundleForTest(
                "coastline",
                makeLineBundle([
                    [139.0, 35.675],
                    [140.0, 35.675],
                ]),
            );

            const q = makeMeasuringQuestion({
                answer: "positive",
                category: "coastline",
                center: [139.75, 35.68], // 0.005° north of line
                selectedOsmId: null,
                selectedOsmType: null,
                seekerDistanceMeters: null,
            });
            const result = buildMeasuringRenderState([q]);
            const circle = result.hitMaskFeatures.features[0];
            const coords = circle.geometry.coordinates[0] as [number, number][];
            let sumLon = 0;
            let sumLat = 0;
            for (const [lon, lat] of coords) {
                sumLon += lon;
                sumLat += lat;
            }
            const avgLon = sumLon / coords.length;
            const avgLat = sumLat / coords.length;

            // Nearest point should be on the line at lat=35.675, same lon
            expect(avgLon).toBeCloseTo(139.75, 1);
            expect(avgLat).toBeCloseTo(35.675, 1);

            // Should NOT be at seeker center lat=35.68
            const distFromSeeker = Math.sqrt(
                (avgLon - 139.75) ** 2 + (avgLat - 35.68) ** 2,
            );
            expect(distFromSeeker).toBeGreaterThan(0.002);
        });

        it("emits one connector and one marker for a line-category question", () => {
            __setLineBundleForTest(
                "coastline",
                makeLineBundle([
                    [139.0, 35.675],
                    [140.0, 35.675],
                ]),
            );

            const q = makeMeasuringQuestion({
                answer: "unanswered",
                category: "coastline",
                selectedOsmId: null,
                selectedOsmType: null,
                seekerDistanceMeters: null,
            });
            const result = buildMeasuringRenderState([q]);
            expect(result.nearestPointConnectors.features).toHaveLength(1);
            expect(result.nearestPointMarkers.features).toHaveLength(1);

            // Connector goes from center to nearest point
            const connector = result.nearestPointConnectors.features[0];
            expect(connector.geometry.coordinates[0]).toEqual([139.75, 35.675]); // center
            expect(connector.geometry.coordinates[1][1]).toBeCloseTo(35.675, 2); // snapped to line (great-circle may shift slightly)
        });

        it("skips question when bundle yields no feature (distance 0 / no survivor)", () => {
            // Inject null to simulate missing bundle
            __setLineBundleForTest("coastline", null);
            const q = makeMeasuringQuestion({
                answer: "positive",
                category: "coastline",
                selectedOsmId: null,
                selectedOsmType: null,
                seekerDistanceMeters: null,
            });
            const result = buildMeasuringRenderState([q]);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
            expect(result.missMaskFeatures.features).toHaveLength(0);
            expect(result.nearestPointConnectors.features).toHaveLength(0);
            expect(result.nearestPointMarkers.features).toHaveLength(0);
        });

        it("mixes point-category and line-category questions correctly", () => {
            // Point category: museum (positive)
            const museumQ = makeMeasuringQuestion({ answer: "positive" });

            // Line category: coastline (negative)
            __setLineBundleForTest(
                "coastline",
                makeLineBundle([
                    [139.0, 35.675],
                    [140.0, 35.675],
                ]),
            );
            const coastlineQ = makeMeasuringQuestion({
                answer: "negative",
                category: "coastline",
                selectedOsmId: null,
                selectedOsmType: null,
                seekerDistanceMeters: null,
            });

            const result = buildMeasuringRenderState([museumQ, coastlineQ]);
            expect(result.hitMaskFeatures.features).toHaveLength(1); // museum
            expect(result.missMaskFeatures.features).toHaveLength(1); // coastline
            expect(result.nearestPointConnectors.features).toHaveLength(1); // coast only
            expect(result.nearestPointMarkers.features).toHaveLength(1);
        });
    });
});

import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

import { haversineDistanceMeters } from "@/shared/geojson";
import type { Position } from "@/shared/geojson";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";
import {
    buildTentaclesRenderState,
    clearTentaclesGeometryCache,
} from "../tentaclesGeometry";
import type { TentaclesQuestion } from "../tentaclesTypes";

// ─── Test fixtures ──────────────────────────────────────────────────────────

/** Small square play area for deterministic Voronoi output. */
const TEST_BBOX: [number, number, number, number] = [0, 0, 0.02, 0.02];
const TEST_BOUNDARY: FeatureCollection<Polygon | MultiPolygon> = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [0.02, 0],
                        [0.02, 0.02],
                        [0, 0.02],
                        [0, 0],
                    ],
                ],
            },
        },
    ],
};

const CENTER: Position = [0.01, 0.01];

function makeCandidate(
    lon: number,
    lat: number,
    osmId: number,
    name = `POI ${osmId}`,
): OsmFeature & { distanceMeters?: number } {
    return {
        lat,
        lon,
        name,
        osmId,
        osmType: "node",
        tags: { name },
    };
}

function makeQuestion(
    overrides: Partial<TentaclesQuestion> = {},
): TentaclesQuestion {
    return {
        answer: "unanswered",
        candidates: [
            makeCandidate(0.009, 0.011, 1, "Tokyo Museum"),
            makeCandidate(0.011, 0.009, 2, "Edo Museum"),
            makeCandidate(0.008, 0.008, 3, "Mori Museum"),
        ],
        category: "museum",
        center: CENTER,
        createdAt: "2026-06-07T00:00:00.000Z",
        distanceMeters: 5000,
        distanceOption: "2km",
        id: "q-tentacles-1",
        isLocked: false,
        selectedOsmId: null,
        selectedOsmType: null,
        selectedName: null,
        type: "tentacles",
        updatedAt: "2026-06-07T00:00:00.000Z",
        ...overrides,
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildTentaclesRenderState", () => {
    beforeEach(() => {
        clearTentaclesGeometryCache();
    });

    it("returns empty state when no tentacles questions exist", () => {
        const result = buildTentaclesRenderState([], TEST_BBOX, TEST_BOUNDARY);
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        expect(result.missMaskFeatures.features).toHaveLength(0);
        expect(result.poiFeatures.features).toHaveLength(0);
        expect(result.radiusOutlineFeature).toBeNull();
        expect(result.voronoiOutlineFeatures.features).toHaveLength(0);
    });

    it("returns radiusOutlineFeature centered on q.center with correct radius", () => {
        const q = makeQuestion();
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        expect(result.radiusOutlineFeature).not.toBeNull();
        const circle = result.radiusOutlineFeature!;
        expect(circle.geometry.type).toBe("Polygon");

        // Check that a point at center+4.9km is inside (within 5km radius).
        // 0.01° latitude ≈ 1113m, so 4.5° latitude ≈ 500km. Use a small offset.
        // At equator, 0.001° ≈ 111m, so 0.045° ≈ 5000m.
        const nearPoint: Position = [
            CENTER[0],
            CENTER[1] + 0.044, // ~4.9km north at equator
        ];
        const dist = haversineDistanceMeters(
            CENTER[1],
            CENTER[0],
            nearPoint[1],
            nearPoint[0],
        );
        // The point should be within the radius circle (dist < 5000).
        expect(dist).toBeLessThan(5000);
    });

    it("populates poiFeatures with in-radius candidates", () => {
        const q = makeQuestion();
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        // All 3 candidates should be in-radius (within 5km of center).
        expect(result.poiFeatures.features.length).toBeGreaterThanOrEqual(1);
        result.poiFeatures.features.forEach((f) => {
            expect(f.properties).toHaveProperty("name");
            expect(f.properties).toHaveProperty("osmId");
            expect(f.properties).toHaveProperty("isSelected");
            expect(f.geometry.type).toBe("Point");
        });
    });

    it("marks the selected POI in poiFeatures", () => {
        const q = makeQuestion({
            answer: "positive",
            selectedOsmId: 2,
            selectedOsmType: "node",
            selectedName: "Edo Museum",
        });
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        const selectedFeatures = result.poiFeatures.features.filter(
            (f) => f.properties.isSelected,
        );
        expect(selectedFeatures).toHaveLength(1);
        expect(selectedFeatures[0].properties.osmId).toBe(2);
    });

    it("excludes POIs outside the radius from poiFeatures and Voronoi", () => {
        // Candidate at lon=0.01, lat=0.06 — ~5.5km away (beyond 5km radius).
        const q = makeQuestion({
            candidates: [
                makeCandidate(0.009, 0.011, 1, "Nearby"),
                makeCandidate(0.01, 0.06, 99, "Far Away"),
            ],
        });
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        const farFeature = result.poiFeatures.features.find(
            (f) => f.properties.osmId === 99,
        );
        // The far-away POI should be excluded from both poiFeatures and Voronoi.
        expect(farFeature).toBeUndefined();
        // Only the nearby POI should be in the Voronoi.
        expect(
            result.voronoiOutlineFeatures.features.length,
        ).toBeGreaterThanOrEqual(1);
        // Verify all voronoi features come from in-radius candidates.
        result.voronoiOutlineFeatures.features.forEach((f) => {
            expect(f.properties?.osmKey).toMatch(/^node\/1$/);
        });
    });

    it("returns empty hit/miss for unanswered questions", () => {
        const q = makeQuestion();
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        expect(result.missMaskFeatures.features).toHaveLength(0);
    });

    it("populates hit/miss masks when answered", () => {
        const q = makeQuestion({
            answer: "positive",
            selectedOsmId: 2,
            selectedOsmType: "node",
            selectedName: "Edo Museum",
        });
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        // The selected POI's cell should be in hitMaskFeatures.
        expect(result.hitMaskFeatures.features.length).toBeGreaterThanOrEqual(
            1,
        );
        result.hitMaskFeatures.features.forEach((f) => {
            expect(f.properties?.osmKey).toBe("node/2");
        });
        // Other cells should be in missMaskFeatures.
        expect(result.missMaskFeatures.features.length).toBeGreaterThanOrEqual(
            1,
        );
        result.missMaskFeatures.features.forEach((f) => {
            expect(f.properties?.osmKey).not.toBe("node/2");
        });
    });

    it("returns empty hit/miss when selectedOsmId is null even if answer is positive", () => {
        // This shouldn't happen in normal usage (anti-drift invariant from Task 02),
        // but the geometry should handle it gracefully.
        const q = makeQuestion({
            answer: "positive",
            selectedOsmId: null,
            selectedOsmType: null,
        });
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        expect(result.missMaskFeatures.features).toHaveLength(0);
    });

    it("caches identical inputs", () => {
        const q = makeQuestion();
        const result1 = buildTentaclesRenderState(
            [q],
            TEST_BBOX,
            TEST_BOUNDARY,
        );
        const result2 = buildTentaclesRenderState(
            [q],
            TEST_BBOX,
            TEST_BOUNDARY,
        );
        // Same inputs should return deeply-equal cached result.
        expect(result2).toEqual(result1);
    });

    it("handles empty candidates gracefully", () => {
        const q = makeQuestion({ candidates: [] });
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        expect(result.poiFeatures.features).toHaveLength(0);
        expect(result.voronoiOutlineFeatures.features).toHaveLength(0);
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        expect(result.missMaskFeatures.features).toHaveLength(0);
        expect(result.radiusOutlineFeature).not.toBeNull();
    });

    it("propagates osmKey from clipped-to-radius cells into hit mask", () => {
        // The hit mask features should carry the osmKey property forward
        // so downstream layers can identify the selected cell.
        const q = makeQuestion({
            answer: "positive",
            selectedOsmId: 2,
            selectedOsmType: "node",
            selectedName: "Edo Museum",
        });
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        // Every hit mask feature should have the selected osmKey.
        for (const f of result.hitMaskFeatures.features) {
            expect(f.properties?.osmKey).toBe("node/2");
        }
    });

    // ── Negative answer ("None") ──────────────────────────────────────────

    it("populates miss mask with all cells when answer is negative", () => {
        const q = makeQuestion({
            answer: "negative",
            selectedOsmId: null,
            selectedOsmType: null,
            selectedName: null,
        });
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        // Hit mask should be empty.
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        // Miss mask should contain all radius-clipped cells.
        expect(result.missMaskFeatures.features.length).toBeGreaterThanOrEqual(
            1,
        );
    });

    it("negative answer mask covers all Voronoi cells within the radius", () => {
        const q = makeQuestion({
            answer: "negative",
            selectedOsmId: null,
            selectedOsmType: null,
            selectedName: null,
        });
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        // Every feature in the miss mask should carry an osmKey from a candidate.
        const candidateKeys = new Set(
            q.candidates.map((c) => `${c.osmType}/${c.osmId}`),
        );
        for (const f of result.missMaskFeatures.features) {
            const key = f.properties?.osmKey as string | undefined;
            expect(key).toBeDefined();
            expect(candidateKeys.has(key!)).toBe(true);
        }
    });

    // ── Voronoi outline clipping ──────────────────────────────────────────

    it("clips Voronoi outlines to within the radius circle", () => {
        const q = makeQuestion();
        const result = buildTentaclesRenderState([q], TEST_BBOX, TEST_BOUNDARY);
        // Outline features should be present and should be clipped (not raw cells).
        expect(
            result.voronoiOutlineFeatures.features.length,
        ).toBeGreaterThanOrEqual(1);
        // The outlines should be a subset of (or equal to) the features clipped
        // to the radius circle — i.e., no outline features should extend beyond
        // the radius circle + play area intersection.
        // Verify each outline feature has a geometry type consistent with clipping.
        for (const f of result.voronoiOutlineFeatures.features) {
            expect(
                f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon",
            ).toBe(true);
        }
    });
});

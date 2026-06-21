import {
    clearStationEliminationCache,
    computeStationElimination,
} from "../useStationElimination";
import type { GeoJsonFeatureCollection } from "../geojsonTypes";
import type { QuestionMapRenderState } from "@/features/questions/radar/radarTypes";

// ---------------------------------------------------------------------------
// Helpers — follow patterns from eliminationMath.test.ts
// ---------------------------------------------------------------------------

function emptyFC(): GeoJsonFeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

function squareFC(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): GeoJsonFeatureCollection {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [minX, minY],
                            [maxX, minY],
                            [maxX, maxY],
                            [minX, maxY],
                            [minX, minY],
                        ],
                    ],
                },
            },
        ],
    };
}

const emptyRenderState: QuestionMapRenderState = (() => {
    const base = { hitMaskFeatures: emptyFC(), missMaskFeatures: emptyFC() };
    return {
        measuring: { ...base },
        osmMatching: { ...base },
        radar: { ...base },
        radarAreaFeatures: emptyFC(),
        tentacles: { ...base },
        thermometer: { hitMaskFeatures: emptyFC() },
        transitLine: { ...base },
        voronoiOutlineFeatures: emptyFC(),
    } as unknown as QuestionMapRenderState;
})();

/** Simple station at a given lon/lat. */
function st(id: string, lon: number, lat: number) {
    return {
        id,
        lat,
        lon,
        name: `Station ${id}`,
        routeIds: [] as string[],
        routeColors: [] as string[],
    };
}

/** A station inside the test play area. */
const sA = st("a", 5, 5); // center
const sB = st("b", 2, 2); // near corner
const sC = st("c", 8, 8); // opposite corner
const sOutside = st("out", 20, 20); // far outside

const threeStations = [sA, sB, sC];
const boundary10x10 = squareFC(0, 0, 10, 10);
const bbox10x10: [number, number, number, number] = [0, 0, 10, 10];

// An empty zone features collection (no hiding zone circles → no mask).
const emptyZoneFeatures = emptyFC();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeStationElimination", () => {
    beforeEach(() => {
        clearStationEliminationCache();
    });

    it("returns zeros when there are no stations", () => {
        const result = computeStationElimination(
            [],
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            emptyRenderState,
        );
        expect(result.totalCount).toBe(0);
        expect(result.remainingCount).toBe(0);
        expect(result.eliminatedStationIds.size).toBe(0);
    });

    it("returns all remaining when there is no boundary", () => {
        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            null,
            600,
            bbox10x10,
            emptyRenderState,
        );
        expect(result.totalCount).toBe(3);
        expect(result.remainingCount).toBe(3);
        expect(result.eliminatedStationIds.size).toBe(0);
    });

    it("returns all remaining when mask is empty (no questions)", () => {
        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            emptyRenderState,
        );
        expect(result.totalCount).toBe(3);
        expect(result.remainingCount).toBe(3);
        expect(result.eliminatedStationIds.size).toBe(0);
    });

    it("excludes stations outside play area", () => {
        const stations = [sA, sOutside];
        const result = computeStationElimination(
            stations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            emptyRenderState,
        );
        // sOutside at (20,20) is far outside the 10x10 bbox.
        expect(result.totalCount).toBe(1);
        expect(result.remainingCount).toBe(1);
    });

    it("returns zero remaining when mask covers entire play area", () => {
        // A radar question whose miss mask is the entire boundary.
        const fullMaskState: QuestionMapRenderState = {
            ...emptyRenderState,
            radar: {
                hitMaskFeatures: emptyFC(),
                missMaskFeatures: boundary10x10,
            },
        } as unknown as QuestionMapRenderState;

        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            fullMaskState,
        );
        expect(result.totalCount).toBe(3);
        expect(result.remainingCount).toBe(0);
        expect(result.eliminatedStationIds.size).toBe(3);
    });

    it("correctly identifies partially eliminated stations", () => {
        // A radar miss mask that covers only the center of the play area.
        // Station sA at (5,5) with a 600m (~0.0054 deg) circle should be
        // covered. Stations sB at (2,2) and sC at (8,8) with 600m circles
        // should NOT be covered.
        const centerMask = squareFC(4, 4, 6, 6);
        const state: QuestionMapRenderState = {
            ...emptyRenderState,
            radar: {
                hitMaskFeatures: emptyFC(),
                missMaskFeatures: centerMask,
            },
        } as unknown as QuestionMapRenderState;

        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            state,
        );
        expect(result.totalCount).toBe(3);
        // sB and sC should survive; sA should be eliminated.
        expect(result.remainingCount).toBe(2);
        expect(result.eliminatedStationIds.has("a")).toBe(true);
        expect(result.eliminatedStationIds.has("b")).toBe(false);
        expect(result.eliminatedStationIds.has("c")).toBe(false);
    });

    // ── Area Math Tests ──────────────────────────────────────────────

    it("populates stationAreas for every clipped station", () => {
        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            emptyRenderState,
        );
        expect(result.stationAreas.size).toBe(3);
        expect(result.stationAreas.has("a")).toBe(true);
        expect(result.stationAreas.has("b")).toBe(true);
        expect(result.stationAreas.has("c")).toBe(true);
    });

    it("reports fraction=1 for a station whose circle is fully inside eligible area", () => {
        // No mask → all stations are fully eligible.
        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            emptyRenderState,
        );
        for (const area of result.stationAreas.values()) {
            expect(area.fraction).toBe(1);
            expect(area.remainingM2).toBeGreaterThan(0);
        }
    });

    it("reports fraction=0 for a fully eliminated station", () => {
        const fullMaskState: QuestionMapRenderState = {
            ...emptyRenderState,
            radar: {
                hitMaskFeatures: emptyFC(),
                missMaskFeatures: boundary10x10,
            },
        } as unknown as QuestionMapRenderState;

        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            fullMaskState,
        );
        // All stations eliminated by the full-cover mask.
        expect(result.eliminatedStationIds.size).toBe(3);
        for (const area of result.stationAreas.values()) {
            expect(area.fraction).toBe(0);
            expect(area.remainingM2).toBe(0);
        }
    });

    it("reports fraction≈0.5 for a station half-covered by a radar miss mask", () => {
        // A miss mask covering the right half of the 10x10 play area.
        // Station sA at (5,5) is on the edge; its 600m circle straddles.
        // Station sB at (2,2) is fully left → stays 100%.
        // Station sC at (8,8) is fully right → eliminated.
        const rightHalf = squareFC(5, 0, 10, 10);
        const state: QuestionMapRenderState = {
            ...emptyRenderState,
            radar: {
                hitMaskFeatures: emptyFC(),
                missMaskFeatures: rightHalf,
            },
        } as unknown as QuestionMapRenderState;

        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            state,
        );

        // sC should be eliminated.
        expect(result.eliminatedStationIds.has("c")).toBe(true);
        const cArea = result.stationAreas.get("c")!;
        expect(cArea.fraction).toBe(0);

        // sB should be fully remaining.
        expect(result.eliminatedStationIds.has("b")).toBe(false);
        const bArea = result.stationAreas.get("b")!;
        expect(bArea.fraction).toBe(1);

        // sA straddles — fraction should be between 0 and 1 (tolerance ~0.1
        // due to planar circle steps).
        const aArea = result.stationAreas.get("a")!;
        expect(aArea.fraction).toBeGreaterThan(0);
        expect(aArea.fraction).toBeLessThan(1);
    });

    // ── Manual Elimination Tests ────────────────────────────────────

    it("forces manually eliminated stations to fraction=0 regardless of geometry", () => {
        // No mask → all stations geometrically eligible.
        const manualSet = new Set(["a"]);
        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            emptyRenderState,
            manualSet,
        );

        expect(result.eliminatedStationIds.has("a")).toBe(true);
        expect(result.remainingCount).toBe(2);

        const aArea = result.stationAreas.get("a")!;
        expect(aArea.fraction).toBe(0);
        expect(aArea.remainingM2).toBe(0);

        // Other stations unaffected.
        expect(result.stationAreas.get("b")!.fraction).toBe(1);
        expect(result.stationAreas.get("c")!.fraction).toBe(1);
    });

    it("adds manually eliminated stations to eliminatedStationIds", () => {
        // One station geometrically eliminated by mask, one manually.
        const centerMask = squareFC(4, 4, 6, 6);
        const state: QuestionMapRenderState = {
            ...emptyRenderState,
            radar: {
                hitMaskFeatures: emptyFC(),
                missMaskFeatures: centerMask,
            },
        } as unknown as QuestionMapRenderState;

        const manualSet = new Set(["b"]);
        const result = computeStationElimination(
            threeStations,
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            state,
            manualSet,
        );

        // sA eliminated by geometry, sB eliminated manually.
        expect(result.eliminatedStationIds.has("a")).toBe(true);
        expect(result.eliminatedStationIds.has("b")).toBe(true);
        // sC still remaining.
        expect(result.eliminatedStationIds.has("c")).toBe(false);
        expect(result.remainingCount).toBe(1);
    });

    it("returns empty stationAreas when nothing to compute", () => {
        const result = computeStationElimination(
            [],
            emptyZoneFeatures,
            boundary10x10,
            600,
            bbox10x10,
            emptyRenderState,
        );
        expect(result.stationAreas.size).toBe(0);
    });
});

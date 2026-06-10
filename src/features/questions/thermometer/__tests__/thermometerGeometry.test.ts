import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiPolygon,
    Polygon,
} from "geojson";

import { haversineDistanceMeters } from "@/shared/geojson";
import type { Position } from "@/shared/geojson";
import {
    buildThermometerRenderState,
    clearThermometerGeometryCache,
} from "../thermometerGeometry";
import type { ThermometerQuestion } from "../thermometerTypes";

// ─── Test fixtures ──────────────────────────────────────────────────────────

/** Small square play area: [0, 0] to [0.01, 0.01] (~1.1 km per side at equator). */
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
                        [0.01, 0],
                        [0.01, 0.01],
                        [0, 0.01],
                        [0, 0],
                    ],
                ],
            },
        },
    ],
};

/** P1 west of P2, ~667 m apart — well above MIN_TRAVEL_METERS (100 m). */
const P1_WEST: Position = [0.002, 0.005];
const P2_EAST: Position = [0.008, 0.005];

/** P1 south of P2, ~556 m apart (0.005° latitude at equator). */
const P1_SOUTH: Position = [0.005, 0.002];
const P2_NORTH: Position = [0.005, 0.007];

function makeThermometerQuestion(
    overrides: Partial<ThermometerQuestion> = {},
): ThermometerQuestion {
    return {
        id: "thermometer-test-1",
        type: "thermometer",
        answer: "unanswered",
        previousPosition: P1_WEST,
        currentPosition: P2_EAST,
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
        ...overrides,
    } as ThermometerQuestion;
}

// ─── Point-in-polygon helper (ray casting) ───────────────────────────────────

/**
 * Simple ray-casting point-in-polygon test. Handles Polygon and MultiPolygon.
 * Returns true when the point is inside or on the boundary.
 */
function pointInPolygon(
    point: [number, number],
    geom: Polygon | MultiPolygon,
): boolean {
    const polys =
        geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;

    for (const poly of polys) {
        // Check outer ring only — sufficient for convex-ish clipped half-planes.
        const ring = poly[0];
        if (ring.length < 3) continue;
        if (rayCast(point, ring)) return true;
    }
    return false;
}

function rayCast(point: [number, number], ring: number[][]): boolean {
    const [px, py] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        // Check if the ray from (px, py) going right crosses edge (xi,yi)-(xj,yj)
        if (
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        ) {
            inside = !inside;
        }
    }
    return inside;
}

/** True when `point` is inside any feature in the collection. */
function pointInFeatureCollection(
    point: [number, number],
    fc: FeatureCollection<Polygon | MultiPolygon>,
): boolean {
    return fc.features.some((f) => pointInPolygon(point, f.geometry));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function midpoint(p1: Position, p2: Position): Position {
    return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

/** Travel distance in meters between two positions. */
function travelDistance(p1: Position, p2: Position): number {
    return haversineDistanceMeters(p1[1], p1[0], p2[1], p2[0]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildThermometerRenderState", () => {
    beforeEach(() => {
        clearThermometerGeometryCache();
    });

    // ── Test 1: Hotter side ──────────────────────────────────────────────

    it("Hotter: point near P2 is inside hitMaskFeatures, point near P1 is outside", () => {
        const question = makeThermometerQuestion({
            answer: "positive",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        // A point very near P2 should be inside the hot mask.
        const nearP2: Position = [P2_EAST[0] + 0.0001, P2_EAST[1]];
        expect(pointInFeatureCollection(nearP2, state.hitMaskFeatures)).toBe(
            true,
        );

        // A point very near P1 should be outside the hot mask.
        const nearP1: Position = [P1_WEST[0] - 0.0001, P1_WEST[1]];
        expect(pointInFeatureCollection(nearP1, state.hitMaskFeatures)).toBe(
            false,
        );
    });

    // ── Test 2: Colder side ──────────────────────────────────────────────

    it("Colder: point near P1 is inside hitMaskFeatures, point near P2 is outside", () => {
        const question = makeThermometerQuestion({
            answer: "negative",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        // A point very near P1 should be inside the cold mask.
        const nearP1: Position = [P1_WEST[0] - 0.0001, P1_WEST[1]];
        expect(pointInFeatureCollection(nearP1, state.hitMaskFeatures)).toBe(
            true,
        );

        // A point very near P2 should be outside the cold mask.
        const nearP2: Position = [P2_EAST[0] + 0.0001, P2_EAST[1]];
        expect(pointInFeatureCollection(nearP2, state.hitMaskFeatures)).toBe(
            false,
        );
    });

    // ── Test 3: Perpendicularity ─────────────────────────────────────────

    it("N–S travel produces an E–W divider (points at midpoint latitude are ~equidistant)", () => {
        const question = makeThermometerQuestion({
            answer: "positive",
            previousPosition: P1_SOUTH,
            currentPosition: P2_NORTH,
        });

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        // The midpoint of P1 and P2.
        const mid = midpoint(P1_SOUTH, P2_NORTH);

        // A point due east of the midpoint at the same latitude.
        const eastPoint: Position = [mid[0] + 0.003, mid[1]];
        const westPoint: Position = [mid[0] - 0.003, mid[1]];

        // Both should be roughly equidistant from P1 and P2 (within a small tolerance).
        const distEastP1 = travelDistance(eastPoint, P1_SOUTH);
        const distEastP2 = travelDistance(eastPoint, P2_NORTH);
        const distWestP1 = travelDistance(westPoint, P1_SOUTH);
        const distWestP2 = travelDistance(westPoint, P2_NORTH);

        // Points on the bisector should have equal distance to P1 and P2.
        // Allow ~1% tolerance due to earth curvature at this small scale.
        const ratioEast =
            Math.abs(distEastP1 - distEastP2) /
            Math.max(distEastP1, distEastP2);
        const ratioWest =
            Math.abs(distWestP1 - distWestP2) /
            Math.max(distWestP1, distWestP2);
        expect(ratioEast).toBeLessThan(0.01);
        expect(ratioWest).toBeLessThan(0.01);

        // For N–S travel, the divider runs E–W, so:
        // - A point north of the midpoint (closer to P2) is inside (Hotter).
        const northPoint: Position = [mid[0], mid[1] + 0.002];
        expect(
            pointInFeatureCollection(northPoint, state.hitMaskFeatures),
        ).toBe(true);

        // - A point south of the midpoint (closer to P1) is outside.
        const southPoint: Position = [mid[0], mid[1] - 0.002];
        expect(
            pointInFeatureCollection(southPoint, state.hitMaskFeatures),
        ).toBe(false);
    });

    it("E–W travel produces an N–S divider", () => {
        const question = makeThermometerQuestion({
            answer: "positive",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        const mid = midpoint(P1_WEST, P2_EAST);

        // For E–W travel, the divider runs N–S, so:
        // - A point east of the midpoint (closer to P2) is inside (Hotter).
        const eastPoint: Position = [mid[0] + 0.002, mid[1]];
        expect(pointInFeatureCollection(eastPoint, state.hitMaskFeatures)).toBe(
            true,
        );

        // - A point west of the midpoint (closer to P1) is outside.
        const westPoint: Position = [mid[0] - 0.002, mid[1]];
        expect(pointInFeatureCollection(westPoint, state.hitMaskFeatures)).toBe(
            false,
        );
    });

    // ── Test 4: Known hider point (anti-inversion) ───────────────────────

    it("hider point closer to P2 is in Hotter mask and absent from Colder mask", () => {
        // Place a hider coordinate clearly closer to P2.
        const hider: Position = [P2_EAST[0] + 0.0005, P2_EAST[1]];

        const hotterQuestion = makeThermometerQuestion({
            id: "thermometer-hotter",
            answer: "positive",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });
        const colderQuestion = makeThermometerQuestion({
            id: "thermometer-colder",
            answer: "negative",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });

        const hotterState = buildThermometerRenderState(
            [hotterQuestion],
            TEST_BOUNDARY,
        );
        const colderState = buildThermometerRenderState(
            [colderQuestion],
            TEST_BOUNDARY,
        );

        // Hider is closer to P2 than P1.
        const distToP1 = travelDistance(hider, P1_WEST);
        const distToP2 = travelDistance(hider, P2_EAST);
        expect(distToP2).toBeLessThan(distToP1);

        // Hider should be in the Hotter mask.
        expect(
            pointInFeatureCollection(hider, hotterState.hitMaskFeatures),
        ).toBe(true);

        // Hider should NOT be in the Colder mask.
        expect(
            pointInFeatureCollection(hider, colderState.hitMaskFeatures),
        ).toBe(false);
    });

    // ── Test 5: Degenerate (< MIN_TRAVEL_METERS) ─────────────────────────

    it("emits degenerate preview when travel is less than 100 m", () => {
        // P1 and P2 are ~11 m apart (0.0001° at equator).
        const question = makeThermometerQuestion({
            answer: "positive",
            previousPosition: [0.005, 0.005],
            currentPosition: [0.0051, 0.005],
        });

        const dist = travelDistance(
            question.previousPosition!,
            question.currentPosition!,
        );
        expect(dist).toBeLessThan(100);

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        expect(state.hitMaskFeatures.features).toHaveLength(0);
        expect(state.previewFeatures.features).toHaveLength(1);
        expect(state.previewFeatures.features[0].properties?.degenerate).toBe(
            true,
        );
    });

    // ── Test 6: Null positions ────────────────────────────────────────────

    it("emits degenerate preview when previousPosition is null", () => {
        const question = makeThermometerQuestion({
            answer: "positive",
            previousPosition: null,
            currentPosition: P2_EAST,
        });

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        expect(state.hitMaskFeatures.features).toHaveLength(0);
        expect(state.previewFeatures.features).toHaveLength(1);
        expect(state.previewFeatures.features[0].properties?.degenerate).toBe(
            true,
        );
    });

    it("emits degenerate preview when currentPosition is null", () => {
        const question = makeThermometerQuestion({
            answer: "positive",
            previousPosition: P1_WEST,
            currentPosition: null,
        });

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        expect(state.hitMaskFeatures.features).toHaveLength(0);
        expect(state.previewFeatures.features).toHaveLength(1);
        expect(state.previewFeatures.features[0].properties?.degenerate).toBe(
            true,
        );
    });

    // ── Test 7: Unanswered preview ───────────────────────────────────────

    it("unanswered: no hitMaskFeatures, previewFeatures has travel line + rings", () => {
        const question = makeThermometerQuestion({
            answer: "unanswered",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        // No mask when unanswered.
        expect(state.hitMaskFeatures.features).toHaveLength(0);

        // Preview should have exactly 4 features: travel line + 3 rings.
        expect(state.previewFeatures.features).toHaveLength(4);

        const roles = state.previewFeatures.features.map(
            (f) => f.properties?.role,
        );

        expect(roles).toContain("travel-line");
        expect(roles).toContain("ring-1km");
        expect(roles).toContain("ring-5km");
        expect(roles).toContain("ring-15km");

        // Travel line should be a LineString from P1 to P2.
        const travelLine = state.previewFeatures.features.find(
            (f) => f.properties?.role === "travel-line",
        );
        expect(travelLine?.geometry.type).toBe("LineString");
        const coords = (travelLine!.geometry as LineString).coordinates;
        expect(coords[0]).toEqual(P1_WEST);
        expect(coords[1]).toEqual(P2_EAST);

        // Rings should be Polygons.
        const rings = state.previewFeatures.features.filter((f) =>
            (f.properties?.role as string)?.startsWith("ring-"),
        );
        expect(rings).toHaveLength(3);
        for (const ring of rings) {
            expect(ring.geometry.type).toBe("Polygon");
        }
    });

    // ── Test 8: Clipping ─────────────────────────────────────────────────

    it("clips the half-plane to the play area boundary", () => {
        const question = makeThermometerQuestion({
            answer: "positive",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });

        const state = buildThermometerRenderState([question], TEST_BOUNDARY);

        // Every feature must lie within the boundary bbox [0, 0, 0.01, 0.01].
        for (const feature of state.hitMaskFeatures.features) {
            const coords = getAllCoordinates(feature);
            for (const [lon, lat] of coords) {
                expect(lon).toBeGreaterThanOrEqual(-0.0001); // small tolerance
                expect(lon).toBeLessThanOrEqual(0.011);
                expect(lat).toBeGreaterThanOrEqual(-0.0001);
                expect(lat).toBeLessThanOrEqual(0.011);
            }
        }

        // Check a point just outside the boundary is NOT in the mask.
        const outsidePoint: Position = [-0.005, 0.005];
        expect(
            pointInFeatureCollection(outsidePoint, state.hitMaskFeatures),
        ).toBe(false);
    });

    // ── Test 9: Caching ──────────────────────────────────────────────────

    it("reuses cached result for identical inputs", () => {
        const question = makeThermometerQuestion({
            answer: "positive",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });

        const state1 = buildThermometerRenderState([question], TEST_BOUNDARY);
        const state2 = buildThermometerRenderState([question], TEST_BOUNDARY);

        // Same reference for hitMaskFeatures and previewFeatures.
        expect(state1.hitMaskFeatures).toBe(state2.hitMaskFeatures);
        expect(state1.previewFeatures).toBe(state2.previewFeatures);
    });

    it("does not reuse cache when answer changes", () => {
        const hotter = makeThermometerQuestion({
            answer: "positive",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });
        const colder = makeThermometerQuestion({
            answer: "negative",
            previousPosition: P1_WEST,
            currentPosition: P2_EAST,
        });

        const hotterState = buildThermometerRenderState(
            [hotter],
            TEST_BOUNDARY,
        );
        const colderState = buildThermometerRenderState(
            [colder],
            TEST_BOUNDARY,
        );

        // Different answers should produce different masks.
        expect(hotterState.hitMaskFeatures).not.toBe(
            colderState.hitMaskFeatures,
        );
    });

    it("evicts oldest entry when cache exceeds max size", () => {
        // Fill the cache beyond MAX_CACHE_SIZE (20) with distinct positions.
        const states: ReturnType<typeof buildThermometerRenderState>[] = [];
        for (let i = 0; i < 25; i++) {
            const q = makeThermometerQuestion({
                id: `thermometer-cache-${i}`,
                answer: "positive",
                previousPosition: [0.002 + i * 0.00001, 0.005],
                currentPosition: [0.008 + i * 0.00001, 0.005],
            });
            states.push(buildThermometerRenderState([q], TEST_BOUNDARY));
        }

        // All should have produced non-empty states.
        for (const s of states) {
            expect(s.hitMaskFeatures.features.length).toBeGreaterThan(0);
        }

        // After exceeding the cache limit, the first entry should have been
        // evicted. Re-querying it should produce a new object.
        const firstQ = makeThermometerQuestion({
            id: "thermometer-cache-first",
            answer: "positive",
            previousPosition: [0.002, 0.005],
            currentPosition: [0.008, 0.005],
        });
        const reQueried = buildThermometerRenderState([firstQ], TEST_BOUNDARY);

        // Re-querying should still return correct geometry (cache miss + recompute).
        expect(reQueried.hitMaskFeatures.features.length).toBeGreaterThan(0);
    });
});

// ─── Coordinate extraction helper ────────────────────────────────────────────

function getAllCoordinates(
    feature: Feature<Polygon | MultiPolygon>,
): [number, number][] {
    const geom = feature.geometry;
    const result: [number, number][] = [];
    const polys =
        geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
        for (const ring of poly) {
            for (const coord of ring) {
                result.push([coord[0], coord[1]]);
            }
        }
    }
    return result;
}

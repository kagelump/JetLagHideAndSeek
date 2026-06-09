/**
 * Layer 2 — Projection adapter tests (Jest, deterministic).
 *
 * Validates the AEQD projection wrapper against known turf behavior.
 */

import { geoAzimuthalEquidistant } from "d3-geo";
import type { Feature, Polygon } from "geojson";

import {
    projectionFor,
    projectGeometry,
    unprojectGeometry,
    EARTH_RADIUS,
} from "../bufferProjection";

// ---- Helpers ---------------------------------------------------------------

function makePolyFeature(coords: [number, number][][]): Feature<Polygon> {
    return {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: coords },
    };
}

// ---- T2.1 Round-trip -------------------------------------------------------

describe("projection round-trip (T2.1)", () => {
    const tokyoPoly = makePolyFeature([
        [
            [139.7, 35.6],
            [139.8, 35.6],
            [139.8, 35.7],
            [139.7, 35.7],
            [139.7, 35.6],
        ],
    ]);

    test("project then unproject returns original coords within 1e-7°", () => {
        const proj = projectionFor(tokyoPoly);
        const projected = projectGeometry(tokyoPoly.geometry, proj);
        const unprojected = unprojectGeometry(projected, proj);

        const orig = tokyoPoly.geometry.coordinates[0] as [number, number][];
        const result = unprojected.coordinates[0] as [number, number][];
        for (let i = 0; i < orig.length; i++) {
            expect(Math.abs(result[i][0] - orig[i][0])).toBeLessThan(1e-7);
            expect(Math.abs(result[i][1] - orig[i][1])).toBeLessThan(1e-7);
        }
    });

    test("round-trip across Tokyo latitudes", () => {
        // Grid of points across the Tokyo area.
        const proj = projectionFor(tokyoPoly);
        for (let lon = 139.5; lon <= 140.0; lon += 0.1) {
            for (let lat = 35.5; lat <= 35.9; lat += 0.1) {
                const coord: [number, number] = [lon, lat];
                const result = proj(coord);
                expect(result).not.toBeNull();
                if (result) {
                    const inv = proj.invert!(result);
                    expect(inv).not.toBeNull();
                    if (inv) {
                        expect(Math.abs(inv[0] - lon)).toBeLessThan(1e-7);
                        expect(Math.abs(inv[1] - lat)).toBeLessThan(1e-7);
                    }
                }
            }
        }
    });

    test("projected distances are non-zero for distinct points", () => {
        const proj = projectionFor(tokyoPoly);
        // Two points near the center should project to distinct planar coords.
        const a: [number, number] = [139.75, 35.65];
        const b: [number, number] = [139.751, 35.65];
        const pa = proj(a);
        const pb = proj(b);
        expect(pa).not.toBeNull();
        expect(pb).not.toBeNull();
        if (pa && pb) {
            const planarDist = Math.sqrt(
                (pb[0] - pa[0]) ** 2 + (pb[1] - pa[1]) ** 2,
            );
            // Two points ~100m apart should have a measurable planar distance.
            expect(planarDist).toBeGreaterThan(50);
            expect(planarDist).toBeLessThan(200);
        }
    });

    test("round-trip across Osaka latitudes", () => {
        const osakaPoly = makePolyFeature([
            [
                [135.4, 34.6],
                [135.6, 34.6],
                [135.6, 34.8],
                [135.4, 34.8],
                [135.4, 34.6],
            ],
        ]);
        const proj = projectionFor(osakaPoly);
        for (let lon = 135.3; lon <= 135.7; lon += 0.1) {
            for (let lat = 34.5; lat <= 34.9; lat += 0.1) {
                const coord: [number, number] = [lon, lat];
                const result = proj(coord);
                expect(result).not.toBeNull();
                if (result) {
                    const inv = proj.invert!(result);
                    expect(inv).not.toBeNull();
                    if (inv) {
                        expect(Math.abs(inv[0] - lon)).toBeLessThan(1e-7);
                        expect(Math.abs(inv[1] - lat)).toBeLessThan(1e-7);
                    }
                }
            }
        }
    });
});

// ---- T2.2 Turf-parity of projection parameters -----------------------------

describe("turf projection parity (T2.2)", () => {
    test("projection params match turf's exactly", () => {
        const feature = makePolyFeature([
            [
                [139.7, 35.6],
                [139.8, 35.6],
                [139.8, 35.7],
                [139.7, 35.7],
                [139.7, 35.6],
            ],
        ]);

        const ourProj = projectionFor(feature);

        // Build the projection the same way turf does.
        // Turf uses @turf/center to find the centroid, then:
        //   geoAzimuthalEquidistant()
        //     .rotate([-cx, -cy])
        //     .scale(earthRadius)
        const cx = 139.75; // center of 139.7–139.8
        const cy = 35.65; // center of 35.6–35.7
        const turfProj = geoAzimuthalEquidistant()
            .rotate([-cx, -cy])
            .scale(EARTH_RADIUS);

        // Project a test point through both projections.
        const testPoint: [number, number] = [139.72, 35.63];
        const ourResult = ourProj(testPoint);
        const turfResult = turfProj(testPoint);

        expect(ourResult).not.toBeNull();
        expect(turfResult).not.toBeNull();
        if (ourResult && turfResult) {
            // They should be very close (same algorithm, same center).
            expect(Math.abs(ourResult[0] - turfResult[0])).toBeLessThan(1e-6);
            expect(Math.abs(ourResult[1] - turfResult[1])).toBeLessThan(1e-6);
        }
    });

    test("scale is exactly earth radius", () => {
        const feature = makePolyFeature([
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
            ],
        ]);
        const proj = projectionFor(feature);
        // A point 1 radian away from center should be ~6371008.8 meters.
        // Use a point near the center to verify scale.
        // Center of bbox is (0.5, 0.5). Point at (0.5, 0.50001) — roughly 1.1 m.
        const center = proj([0.5, 0.5])!;
        const near = proj([0.5, 0.50001])!;
        const dist = Math.sqrt(
            (near[0] - center[0]) ** 2 + (near[1] - center[1]) ** 2,
        );
        // Expected: 0.00001° × (π/180) × EARTH_RADIUS ≈ 1.11 meters
        const expectedDist = ((0.00001 * Math.PI) / 180) * EARTH_RADIUS;
        expect(Math.abs(dist - expectedDist)).toBeLessThan(0.01); // sub-cm
    });
});

// ---- T2.3 Center parity with @turf/center ----------------------------------

describe("center parity (T2.3)", () => {
    test("projectionFor uses @turf/center and builds a valid projection", () => {
        const feature = makePolyFeature([
            [
                [139.7, 35.6],
                [139.9, 35.6],
                [139.9, 35.8],
                [139.7, 35.8],
                [139.7, 35.6],
            ],
        ]);

        const proj = projectionFor(feature);
        // The @turf/center of this rect is ~ [139.8, 35.7].
        // Projecting the bbox midpoint should yield coords near [0, 0]
        // (within ~1 km for a feature of this size — AEQD is centered
        // on the bbox midpoint computed by @turf/center, which uses
        // @turf/bbox — the center of the bbox is the projection center).
        const center: [number, number] = [139.8, 35.7];
        const result = proj(center);
        expect(result).not.toBeNull();
        if (result) {
            // The projected center should be within 1 km of [0, 0].
            expect(Math.abs(result[0])).toBeLessThan(1000);
            expect(Math.abs(result[1])).toBeLessThan(1000);
        }

        // Verify that projectGeometry + unprojectGeometry round-trips.
        const projected = projectGeometry(feature.geometry, proj);
        const unprojected = unprojectGeometry(projected, proj);
        const orig = feature.geometry.coordinates[0] as [number, number][];
        const result2 = unprojected.coordinates[0] as [number, number][];
        for (let i = 0; i < orig.length; i++) {
            expect(Math.abs(result2[i][0] - orig[i][0])).toBeLessThan(1e-7);
            expect(Math.abs(result2[i][1] - orig[i][1])).toBeLessThan(1e-7);
        }
    });
});

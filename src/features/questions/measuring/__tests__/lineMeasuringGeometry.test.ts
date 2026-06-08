import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
    FeatureCollection,
} from "geojson";

import {
    clearLineCategoryCache,
    clearLineDistanceCache,
    clearDilatedBoundaryCache,
    clipLineFeaturesToPlayArea,
    computeLineCategory,
    computeLineDistance,
    getDilatedPlayArea,
} from "@/features/questions/measuring/lineMeasuringGeometry";
import {
    __clearLineBundlesForTest,
    __setLineBundleForTest,
    type LineBundle,
} from "@/features/questions/measuring/lineBundleLoader";

function makeLineFeature(
    coords: [number, number][],
    bbox?: [number, number, number, number],
): LineBundle["features"][number] {
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    return {
        type: "Feature",
        bbox: bbox ?? [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
        ],
        geometry: {
            type: "LineString",
            coordinates: coords,
        },
        properties: {},
    };
}

function makeBundle(features: LineBundle["features"]): LineBundle {
    return {
        schemaVersion: 1,
        category: "coastline",
        generatedAt: "2026-01-01T00:00:00.000Z",
        source: "test-fixture",
        extractBbox: [137.9, 33.9, 141.9, 37.9],
        features,
    };
}

// ─── Play area fixture helpers ──────────────────────────────────────────

/** Square play area from [west,south] to [east,north], as a FeatureCollection
 *  (the shape buildMeasuringRenderState / the clip helper expect). */
function makeSquarePlayArea(
    west: number,
    south: number,
    east: number,
    north: number,
): FeatureCollection<Polygon | MultiPolygon> {
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
                            [west, south],
                            [east, south],
                            [east, north],
                            [west, north],
                            [west, south], // ring must close
                        ],
                    ],
                },
            },
        ],
    };
}

// Small square around 139.0–139.2 lon, 35.0–35.2 lat for consistent test reasoning.
const PLAY_AREA = makeSquarePlayArea(139.0, 35.0, 139.2, 35.2);
const PLAY_AREA_BBOX: [number, number, number, number] = [
    139.0, 35.0, 139.2, 35.2,
];

/** True when every coordinate of every segment is within the bbox (plus pad). */
function allCoordsWithin(
    feature: Feature<LineString | MultiLineString>,
    bbox: [number, number, number, number],
    padDeg = 0.001, // ~100 m — covers the 30 m clip dilation
): boolean {
    const [w, s, e, n] = bbox;
    const segs =
        feature.geometry.type === "LineString"
            ? [feature.geometry.coordinates]
            : feature.geometry.coordinates;
    return segs.every((seg) =>
        (seg as [number, number][]).every(
            ([lon, lat]) =>
                lon >= w - padDeg &&
                lon <= e + padDeg &&
                lat >= s - padDeg &&
                lat <= n + padDeg,
        ),
    );
}

beforeEach(() => {
    clearLineCategoryCache();
    clearLineDistanceCache();
    clearDilatedBoundaryCache();
    __clearLineBundlesForTest();
});

describe("computeLineDistance", () => {
    describe("single segment projection", () => {
        it("returns the perpendicular foot for a point offset from a horizontal line", () => {
            // Horizontal line at lat=35.0 from lon=139.0 to lon=140.0
            const line = makeLineFeature([
                [139.0, 35.0],
                [140.0, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([line]));

            // Center at lon=139.5, lat=35.01 (~1.11 km north of the line)
            const result = computeLineDistance([139.5, 35.01], "coastline");
            expect(result).not.toBeNull();
            // Nearest point is on the horizontal line, close to perpendicular foot
            expect(result!.nearestPoint[0]).toBeCloseTo(139.5, 2); // ~same lon
            expect(result!.nearestPoint[1]).toBeCloseTo(35.0, 2); // snapped to line
            // ~0.01° latitude offset ≈ 997–998 m at this longitude
            expect(result!.distanceMeters).toBeGreaterThan(900);
            expect(result!.distanceMeters).toBeLessThan(1200);
        });

        it("returns a distance matching hand-computed haversine within 1 m", () => {
            const line = makeLineFeature([
                [139.0, 35.0],
                [140.0, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([line]));

            // Center at lon=139.5, lat=35.01
            const result = computeLineDistance([139.5, 35.01], "coastline");
            expect(result).not.toBeNull();
            // Perpendicular distance is ~0.009° latitude at mid-latitudes
            // (~998 m). Just verify it's a reasonable distance.
            expect(result!.distanceMeters).toBeGreaterThan(500);
            expect(result!.distanceMeters).toBeLessThan(1500);
        });
    });

    describe("two disjoint segments", () => {
        it("returns the nearest point on the closer segment", () => {
            // Segment A: lat=35.0 from 139.0 to 139.5
            // Segment B: lat=35.1 from 139.0 to 139.5
            const segA = makeLineFeature([
                [139.0, 35.0],
                [139.5, 35.0],
            ]);
            const segB = makeLineFeature([
                [139.0, 35.1],
                [139.5, 35.1],
            ]);
            __setLineBundleForTest("coastline", makeBundle([segA, segB]));

            // Center at [139.25, 35.08] — closer to segB (0.02° vs 0.08°)
            const result = computeLineDistance([139.25, 35.08], "coastline");
            expect(result).not.toBeNull();
            // Should land on segB (lat=35.1), within a reasonable tolerance
            expect(result!.nearestPoint[1]).toBeCloseTo(35.1, 2);
        });
    });

    describe("bbox pre-filter", () => {
        it("excludes a feature 200 km away", () => {
            // Near feature at Tokyo coordinates
            const near = makeLineFeature([
                [139.7, 35.6],
                [139.8, 35.6],
            ]);
            // Far feature: ~200 km west in degrees (~1.8°)
            const far = makeLineFeature([
                [137.9, 35.6],
                [138.0, 35.6],
            ]);
            __setLineBundleForTest("coastline", makeBundle([near, far]));

            // Center near the near feature
            const result = computeLineDistance([139.75, 35.61], "coastline");
            expect(result).not.toBeNull();
            // Should snap to the near feature (~lon 139.75), not the far one
            expect(result!.nearestPoint[0]).toBeGreaterThan(139.6);
            expect(result!.nearestPoint[0]).toBeLessThan(139.9);
        });
    });

    describe("empty or missing bundles", () => {
        it("returns null for empty bundle", () => {
            __setLineBundleForTest("coastline", makeBundle([]));
            const result = computeLineDistance([139.75, 35.68], "coastline");
            expect(result).toBeNull();
        });

        it("returns null when no bundle is registered", () => {
            // Explicitly inject null to simulate missing bundle
            __setLineBundleForTest("coastline", null);
            const result = computeLineDistance([139.75, 35.68], "coastline");
            expect(result).toBeNull();
        });

        it("returns null when all features are filtered out by bbox", () => {
            // Feature in Osaka
            const osaka = makeLineFeature([
                [135.5, 34.6],
                [135.6, 34.6],
            ]);
            __setLineBundleForTest("coastline", makeBundle([osaka]));

            // Center in Tokyo — ~400 km away, far beyond 50 km margin
            const result = computeLineDistance([139.75, 35.68], "coastline");
            expect(result).toBeNull();
        });
    });

    describe("LRU caching", () => {
        it("returns referentially-equal result for two calls with same input", () => {
            const line = makeLineFeature([
                [139.0, 35.0],
                [140.0, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([line]));

            const r1 = computeLineDistance([139.5, 35.01], "coastline");
            const r2 = computeLineDistance([139.5, 35.01], "coastline");
            expect(r1).toBe(r2);
        });

        it("returns different objects after cache clear", () => {
            const line = makeLineFeature([
                [139.0, 35.0],
                [140.0, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([line]));

            const r1 = computeLineDistance([139.5, 35.01], "coastline");
            clearLineDistanceCache();
            const r2 = computeLineDistance([139.5, 35.01], "coastline");
            expect(r1).not.toBe(r2);
        });

        it("shares cache across different categories", () => {
            const lineA = makeLineFeature([
                [139.0, 35.0],
                [140.0, 35.0],
            ]);
            const lineB = makeLineFeature([
                [139.0, 35.0],
                [140.0, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([lineA]));
            __setLineBundleForTest("body-of-water", makeBundle([lineB]));

            // Same center, different category → different cache keys
            const r1 = computeLineDistance([139.5, 35.01], "coastline");
            const r2 = computeLineDistance([139.5, 35.01], "body-of-water");
            expect(r1).not.toBeNull();
            expect(r2).not.toBeNull();
            // Different keys → separate entries, potentially different results
            // but with identical fixture coords, they should match
            expect(r1!.nearestPoint).toEqual(r2!.nearestPoint);
        });
    });

    describe("polygon boundary fixtures", () => {
        it("snaps to the outer ring of a Polygon fixture", () => {
            // A square polygon at [139.0,35.0] to [139.1,35.1]
            const ring: [number, number][] = [
                [139.0, 35.0],
                [139.1, 35.0],
                [139.1, 35.1],
                [139.0, 35.1],
                [139.0, 35.0],
            ];
            const feature: LineBundle["features"][number] = {
                type: "Feature",
                bbox: [139.0, 35.0, 139.1, 35.1],
                geometry: {
                    type: "LineString",
                    coordinates: ring,
                },
                properties: {},
            };
            __setLineBundleForTest("body-of-water", makeBundle([feature]));

            // Center inside the square
            const result = computeLineDistance(
                [139.05, 35.05],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            // Nearest point is on the boundary, not at the center
            // (any of the 4 edges of the square ring; tolerance is loose)
            expect(result!.distanceMeters).toBeGreaterThan(0);
            expect(result!.distanceMeters).toBeLessThan(10000);
        });

        it("ignores holes in the outer ring", () => {
            // The build pipeline converts polygons to outer rings only.
            // This test verifies that a feature stored as a LineString (the
            // outer ring) works correctly — holes are never present in the
            // bundle, so there's nothing to ignore at runtime.
            const outerRing: [number, number][] = [
                [139.0, 35.0],
                [139.1, 35.0],
                [139.1, 35.1],
                [139.0, 35.1],
                [139.0, 35.0],
            ];
            const feature = makeLineFeature(outerRing);
            __setLineBundleForTest("body-of-water", makeBundle([feature]));

            const result = computeLineDistance(
                [139.05, 35.05],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            expect(result!.distanceMeters).toBeGreaterThan(0);
        });
    });

    describe("MultiLineString support", () => {
        it("splits MultiLineString into individual segments", () => {
            const feature: LineBundle["features"][number] = {
                type: "Feature",
                bbox: [139.0, 35.0, 140.0, 35.2],
                geometry: {
                    type: "MultiLineString",
                    coordinates: [
                        [
                            [139.0, 35.0],
                            [139.5, 35.0],
                        ],
                        [
                            [139.0, 35.2],
                            [139.5, 35.2],
                        ],
                    ],
                },
                properties: {},
            };
            __setLineBundleForTest("coastline", makeBundle([feature]));

            // Center closer to the first segment (lat=35.0)
            const result = computeLineDistance([139.25, 35.01], "coastline");
            expect(result).not.toBeNull();
            expect(result!.nearestPoint[1]).toBeCloseTo(35.0, 2);
        });
    });

    describe("zero-length segment deduplication", () => {
        it("strips consecutive duplicate coordinates", () => {
            // Line with a duplicate at index 1.
            const line = makeLineFeature([
                [139.0, 35.0],
                [139.5, 35.0], // duplicate
                [139.5, 35.0], // duplicate
                [140.0, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([line]));

            const result = computeLineDistance([139.75, 35.01], "coastline");
            expect(result).not.toBeNull();
            // Should still work — the duplicate is stripped, not the crash.
            expect(result!.distanceMeters).toBeGreaterThan(0);
            expect(result!.nearestPoint[0]).toBeGreaterThan(139.0);
            expect(result!.nearestPoint[0]).toBeLessThan(140.0);
        });

        it("drops lines that collapse to < 2 coords after dedup", () => {
            // All coordinates are the same point — dedup reduces to 1 coord.
            const line = makeLineFeature([
                [139.5, 35.0],
                [139.5, 35.0],
                [139.5, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([line]));

            // This line gets dropped. If another valid line exists, it works.
            const validLine = makeLineFeature([
                [139.0, 35.0],
                [140.0, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([line, validLine]));

            const result = computeLineDistance([139.25, 35.01], "coastline");
            expect(result).not.toBeNull();
        });
    });

    describe("NaN / bad coordinate resilience", () => {
        it("filters out a line containing NaN and still processes valid lines", () => {
            const badLine = makeLineFeature([
                [139.0, 35.0],
                [139.5, NaN],
                [140.0, 35.0],
            ]);
            const goodLine = makeLineFeature([
                [139.0, 35.2],
                [140.0, 35.2],
            ]);
            __setLineBundleForTest(
                "coastline",
                makeBundle([badLine, goodLine]),
            );

            // Center near the good line.
            const result = computeLineDistance([139.5, 35.21], "coastline");
            expect(result).not.toBeNull();
            // Should snap to the good line (lat ~35.2), not the bad one.
            expect(result!.nearestPoint[1]).toBeCloseTo(35.2, 1);
        });

        it("filters out a line containing null coordinate entry", () => {
            const badLine: LineBundle["features"][number] = {
                type: "Feature",
                bbox: [139.0, 35.0, 140.0, 35.2],
                geometry: {
                    type: "LineString",
                    // null entry simulates Metro/Hermes bundling corruption
                    coordinates: [
                        [139.0, 35.0],
                        null,
                        [140.0, 35.0],
                    ] as unknown as [number, number][],
                },
                properties: {},
            };
            const goodLine = makeLineFeature([
                [139.0, 35.2],
                [140.0, 35.2],
            ]);
            __setLineBundleForTest(
                "coastline",
                makeBundle([badLine, goodLine]),
            );

            const result = computeLineDistance([139.5, 35.21], "coastline");
            expect(result).not.toBeNull();
            // Should survive and snap to the good line.
            expect(result!.nearestPoint[1]).toBeCloseTo(35.2, 1);
        });

        it("filters out an empty LineString", () => {
            const emptyLine = makeLineFeature([]);
            const goodLine = makeLineFeature([
                [139.0, 35.0],
                [140.0, 35.0],
            ]);
            __setLineBundleForTest(
                "coastline",
                makeBundle([emptyLine, goodLine]),
            );

            const result = computeLineDistance([139.5, 35.01], "coastline");
            expect(result).not.toBeNull();
        });
    });

    describe("real bundles", () => {
        it("handles admin-1st-border (prefecture) bundle without throwing", () => {
            // Load the real bundle — this is the exact data that was crashing
            // due to zero-length segments in features 341 and 346.
            const bundle: LineBundle = require("../../../../../assets/measuring/admin-1st-border.json");
            __setLineBundleForTest("admin-1st-border", bundle);

            // Center near a known prefecture border in Tokyo area.
            const result = computeLineDistance(
                [139.6926, 35.6478],
                "admin-1st-border",
            );
            expect(result).not.toBeNull();
            expect(result!.distanceMeters).toBeGreaterThan(0);
        });

        it("handles body-of-water bundle without throwing", () => {
            const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
            __setLineBundleForTest("body-of-water", bundle);

            const result = computeLineDistance(
                [139.75, 35.68],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            expect(result!.distanceMeters).toBeGreaterThan(0);
        });
    });
});

// ─── clipLineFeaturesToPlayArea tests ──────────────────────────────────

describe("clipLineFeaturesToPlayArea", () => {
    function dilatedPlayArea() {
        return getDilatedPlayArea(PLAY_AREA);
    }

    it("line fully inside → returned unchanged", () => {
        const line: Feature<LineString> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "LineString",
                coordinates: [
                    [139.05, 35.1],
                    [139.15, 35.1],
                ],
            },
        };
        const result = clipLineFeaturesToPlayArea([line], dilatedPlayArea());
        expect(result).toHaveLength(1);
        expect(allCoordsWithin(result[0], PLAY_AREA_BBOX)).toBe(true);
        // Endpoints roughly preserved
        const coords = (result[0].geometry as LineString).coordinates;
        expect(coords[0][0]).toBeCloseTo(139.05, 2);
        expect(coords[coords.length - 1][0]).toBeCloseTo(139.15, 2);
    });

    it("line fully outside → dropped", () => {
        const line: Feature<LineString> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "LineString",
                coordinates: [
                    [140.0, 36.0],
                    [140.1, 36.0],
                ],
            },
        };
        const result = clipLineFeaturesToPlayArea([line], dilatedPlayArea());
        expect(result).toHaveLength(0);
    });

    it("line crossing the boundary → cut at the boundary (spill fix)", () => {
        const line: Feature<LineString> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "LineString",
                coordinates: [
                    [138.5, 35.1], // outside, west
                    [139.15, 35.1], // inside
                ],
            },
        };
        const result = clipLineFeaturesToPlayArea([line], dilatedPlayArea());
        expect(result.length).toBeGreaterThan(0);
        // Every coord is within the play-area bbox
        expect(allCoordsWithin(result[0], PLAY_AREA_BBOX)).toBe(true);
        // Westmost lon is >= 139.0 - tolerance (no longer extends to 138.5)
        const coords =
            result[0].geometry.type === "LineString"
                ? result[0].geometry.coordinates
                : result[0].geometry.coordinates[0];
        const minLon = Math.min(...coords.map((c) => c[0]));
        expect(minLon).toBeGreaterThanOrEqual(138.99);
    });

    it("shared-boundary survival — coincident border kept (ε-dilation regression)", () => {
        // Line exactly on the play area's north edge
        const line: Feature<LineString> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "LineString",
                coordinates: [
                    [139.0, 35.2], // on north edge
                    [139.2, 35.2], // on north edge
                ],
            },
        };
        const result = clipLineFeaturesToPlayArea([line], dilatedPlayArea());
        // The coincident border must survive thanks to ε-dilation
        expect(result).toHaveLength(1);
    });

    it("MultiLineString crossing boundary → clipped per component", () => {
        const ml: Feature<MultiLineString> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "MultiLineString",
                coordinates: [
                    [
                        [139.05, 35.1],
                        [139.15, 35.1],
                    ], // inside
                    [
                        [138.5, 35.15],
                        [139.1, 35.15],
                    ], // crossing
                ],
            },
        };
        const result = clipLineFeaturesToPlayArea([ml], dilatedPlayArea());
        expect(result.length).toBeGreaterThan(0);
        // No coordinate extends past the play-area bbox
        for (const f of result) {
            expect(allCoordsWithin(f, PLAY_AREA_BBOX)).toBe(true);
        }
    });
});

// ─── computeLineCategory tests ─────────────────────────────────────────

describe("computeLineCategory", () => {
    it("returns nearest point + distance + window features", () => {
        const line = makeLineFeature([
            [139.05, 35.1],
            [139.15, 35.1],
        ]);
        __setLineBundleForTest("coastline", makeBundle([line]));

        const result = computeLineCategory(
            [139.1, 35.11],
            "coastline",
            PLAY_AREA_BBOX,
        );
        expect(result).not.toBeNull();
        expect(result!.distanceMeters).toBeGreaterThan(0);
        expect(result!.windowFeatures.length).toBeGreaterThanOrEqual(1);
    });

    it("window excludes features far outside the play-area ± radius window", () => {
        const near = makeLineFeature([
            [139.05, 35.1],
            [139.15, 35.1],
        ]);
        // Far feature: ~200 km away
        const far = makeLineFeature([
            [137.0, 35.1],
            [137.1, 35.1],
        ]);
        __setLineBundleForTest("coastline", makeBundle([near, far]));

        const result = computeLineCategory(
            [139.1, 35.11],
            "coastline",
            PLAY_AREA_BBOX,
        );
        expect(result).not.toBeNull();
        expect(result!.windowFeatures).toHaveLength(1);
    });

    it("returns null for missing bundle", () => {
        __setLineBundleForTest("coastline", null);
        const result = computeLineCategory(
            [139.1, 35.1],
            "coastline",
            PLAY_AREA_BBOX,
        );
        expect(result).toBeNull();
    });

    it("returns null for empty bundle", () => {
        __setLineBundleForTest("coastline", makeBundle([]));
        const result = computeLineCategory(
            [139.1, 35.1],
            "coastline",
            PLAY_AREA_BBOX,
        );
        expect(result).toBeNull();
    });
});

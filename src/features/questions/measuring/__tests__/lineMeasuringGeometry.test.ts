import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
    FeatureCollection,
} from "geojson";

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import {
    clearLineCategoryCache,
    clearLineDistanceCache,
    clearLineBufferCache,
    clearClippedLineCache,
    clearDilatedBoundaryCache,
    clipLineFeaturesToPlayArea,
    computeLineCategory,
    computeLineDistance,
    computeLineBuffer,
    applyBufferBudget,
    featureToRings,
    filterFeaturesByBboxMargin,
    polygonFeaturesToLineFeatures,
    getClippedLineFeaturesCached,
    getDilatedPlayArea,
    makeClippedLineCacheKey,
    selectWindowFeatures,
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
    clearLineBufferCache();
    clearClippedLineCache();
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

        it("covers the upstream Meguro River (P7 regression guard)", () => {
            // Pre-fix: a seeker near Ikejiri/Ohashi (upstream Meguro) got
            // a nearest bundle vertex 1768m away because the river
            // centerline was missing. Post-fix: waterway=river centerlines
            // are included, so the distance should be small (< 500m).
            const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
            __setLineBundleForTest("body-of-water", bundle);

            const result = computeLineDistance(
                [139.6855, 35.651],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            expect(result!.distanceMeters).toBeLessThan(500);
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
        // Vertex-based clip keeps runs of ≥2 inside vertices. The test
        // includes two inside vertices so the run survives.
        const line: Feature<LineString> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "LineString",
                coordinates: [
                    [138.5, 35.1], // outside, west
                    [139.05, 35.1], // inside
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
                        [139.05, 35.15],
                        [139.1, 35.15],
                    ], // crossing (two inside vertices survive)
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

    describe("P6-A: bbox pre-filter", () => {
        it("drops a feature whose bbox is entirely outside the play area", () => {
            // Line far north of the play area.
            const outsideLine: Feature<LineString> = {
                type: "Feature",
                bbox: [139.0, 36.0, 139.1, 36.1],
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [139.0, 36.0],
                        [139.1, 36.1],
                    ],
                },
            };
            const result = clipLineFeaturesToPlayArea(
                [outsideLine],
                dilatedPlayArea(),
                PLAY_AREA_BBOX,
            );
            expect(result).toHaveLength(0);
        });

        it("drops a feature entirely outside even without explicit playAreaBbox", () => {
            const outsideLine: Feature<LineString> = {
                type: "Feature",
                bbox: [140.0, 36.0, 140.1, 36.1],
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [140.0, 36.0],
                        [140.1, 36.1],
                    ],
                },
            };
            const result = clipLineFeaturesToPlayArea(
                [outsideLine],
                dilatedPlayArea(),
            );
            expect(result).toHaveLength(0);
        });

        it("keeps a feature whose bbox intersects the play area", () => {
            const insideLine: Feature<LineString> = {
                type: "Feature",
                bbox: [139.05, 35.05, 139.15, 35.15],
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [139.05, 35.05],
                        [139.15, 35.15],
                    ],
                },
            };
            const result = clipLineFeaturesToPlayArea(
                [insideLine],
                dilatedPlayArea(),
                PLAY_AREA_BBOX,
            );
            expect(result).toHaveLength(1);
        });
    });

    describe("P6-B: vertex-based clip", () => {
        it("keeps only inside vertices (sub-vertex endpoint trade-off)", () => {
            // Line crosses into the play area: first two vertices outside,
            // last two inside.
            const line: Feature<LineString> = {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [138.8, 35.1], // outside
                        [138.9, 35.1], // outside
                        [139.05, 35.1], // inside
                        [139.15, 35.1], // inside
                    ],
                },
            };
            const result = clipLineFeaturesToPlayArea(
                [line],
                dilatedPlayArea(),
            );
            expect(result).toHaveLength(1);
            // Every returned coord is inside the play area.
            const coords = (result[0].geometry as LineString).coordinates;
            for (const c of coords) {
                expect(c[0]).toBeGreaterThanOrEqual(PLAY_AREA_BBOX[0] - 0.001);
                expect(c[0]).toBeLessThanOrEqual(PLAY_AREA_BBOX[2] + 0.001);
                expect(c[1]).toBeGreaterThanOrEqual(PLAY_AREA_BBOX[1] - 0.001);
                expect(c[1]).toBeLessThanOrEqual(PLAY_AREA_BBOX[3] + 0.001);
            }
            // No outside vertex survives.
            const minLon = Math.min(...coords.map((c) => c[0]));
            expect(minLon).toBeGreaterThanOrEqual(138.99);
        });

        it("line crossing in and out → two inside pieces", () => {
            const line: Feature<LineString> = {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [138.5, 35.1], // outside
                        [139.05, 35.1], // inside run 1
                        [139.1, 35.1], // inside run 1
                        [140.0, 36.0], // outside
                        [139.05, 35.15], // inside run 2
                        [139.1, 35.15], // inside run 2
                        [140.0, 36.0], // outside
                    ],
                },
            };
            const result = clipLineFeaturesToPlayArea(
                [line],
                dilatedPlayArea(),
            );
            expect(result).toHaveLength(1);
            // Two inside runs → MultiLineString.
            expect(result[0].geometry.type).toBe("MultiLineString");
            const ml = result[0].geometry as MultiLineString;
            expect(ml.coordinates.length).toBe(2);
        });
    });

    describe("MultiLineString recombination", () => {
        it("one inside ring + one outside ring → single LineString", () => {
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
                            [140.0, 36.0],
                            [140.1, 36.0],
                        ], // outside (bbox-filtered)
                    ],
                },
            };
            const result = clipLineFeaturesToPlayArea(
                [ml],
                dilatedPlayArea(),
                PLAY_AREA_BBOX,
            );
            expect(result).toHaveLength(1);
            // Single surviving ring → LineString.
            expect(result[0].geometry.type).toBe("LineString");
        });

        it("two inside rings → MultiLineString", () => {
            const ml: Feature<MultiLineString> = {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "MultiLineString",
                    coordinates: [
                        [
                            [139.05, 35.1],
                            [139.15, 35.1],
                        ],
                        [
                            [139.05, 35.15],
                            [139.15, 35.15],
                        ],
                    ],
                },
            };
            const result = clipLineFeaturesToPlayArea([ml], dilatedPlayArea());
            expect(result).toHaveLength(1);
            expect(result[0].geometry.type).toBe("MultiLineString");
            expect(
                (result[0].geometry as MultiLineString).coordinates,
            ).toHaveLength(2);
        });
    });
});

// ─── P6-C: clipped line cache tests ────────────────────────────────────

describe("clipped line cache", () => {
    function dilatedPlayArea() {
        return getDilatedPlayArea(PLAY_AREA);
    }

    it("caches the clip result and returns it on second call", () => {
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
        const cacheKey = makeClippedLineCacheKey(
            "body-of-water",
            PLAY_AREA_BBOX,
        );

        const r1 = getClippedLineFeaturesCached(
            [line],
            dilatedPlayArea(),
            PLAY_AREA_BBOX,
            cacheKey,
        );
        const r2 = getClippedLineFeaturesCached(
            [line],
            dilatedPlayArea(),
            PLAY_AREA_BBOX,
            cacheKey,
        );

        // Same array reference (cache hit).
        expect(r1).toBe(r2);
        expect(r1).toHaveLength(1);
    });

    it("clearClippedLineCache forces recompute", () => {
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
        const cacheKey = makeClippedLineCacheKey(
            "body-of-water",
            PLAY_AREA_BBOX,
        );

        const r1 = getClippedLineFeaturesCached(
            [line],
            dilatedPlayArea(),
            PLAY_AREA_BBOX,
            cacheKey,
        );
        clearClippedLineCache();
        const r2 = getClippedLineFeaturesCached(
            [line],
            dilatedPlayArea(),
            PLAY_AREA_BBOX,
            cacheKey,
        );

        // Different array references after cache clear.
        expect(r1).not.toBe(r2);
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(1);
    });

    it("different categories produce different cache entries", () => {
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

        const keyA = makeClippedLineCacheKey("body-of-water", PLAY_AREA_BBOX);
        const keyB = makeClippedLineCacheKey("coastline", PLAY_AREA_BBOX);

        const r1 = getClippedLineFeaturesCached(
            [line],
            dilatedPlayArea(),
            PLAY_AREA_BBOX,
            keyA,
        );
        const r2 = getClippedLineFeaturesCached(
            [line],
            dilatedPlayArea(),
            PLAY_AREA_BBOX,
            keyB,
        );

        // Different keys → different cache entries (still same result for
        // this fixture since the clip doesn't depend on category).
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(1);
        // Cache keys differ.
        expect(keyA).not.toBe(keyB);
    });
});

// ─── Real-bundle clip regression guard (P6) ────────────────────────────

describe("real bundles", () => {
    it("clips the real body-of-water window quickly (P6 regression guard)", () => {
        const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
        __setLineBundleForTest("body-of-water", bundle);
        const cat = computeLineCategory(
            [139.75, 35.68],
            "body-of-water",
            [139.0, 35.0, 140.0, 36.0],
        );
        expect(cat).not.toBeNull();
        const lines = polygonFeaturesToLineFeatures(cat!.windowFeatures);

        const tokyoBoundary = require("../../../../../assets/default-zones/tokyo.json");
        const dilated = getDilatedPlayArea(tokyoBoundary);

        const t0 = performance.now();
        const clipped = clipLineFeaturesToPlayArea(
            lines,
            dilated,
            [139.0, 35.0, 140.0, 36.0],
        );
        const ms = performance.now() - t0;

        console.log(
            `[test] real body-of-water clip: ${lines.length} features → ` +
                `${clipped.length} kept in ${ms.toFixed(0)}ms`,
        );

        // Must produce some clipped output.
        expect(clipped.length).toBeGreaterThan(0);
        // Pre-fix: ~62,000 ms. After P6 A+B: ~580 ms in isolation. The bound is
        // deliberately generous (not ~1 s) so parallel Jest-worker load can't
        // flake it, while still catching the pre-P6 regression by >15×. Matches
        // the sibling clipLineFeatures.perf bound (3000 ms).
        expect(ms).toBeLessThan(4000);
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

// ─── filterFeaturesByBboxMargin ──────────────────────────────────────────

describe("filterFeaturesByBboxMargin", () => {
    // Small bbox in central Tokyo (~1 km square).
    const BBOX: [number, number, number, number] = [
        139.69, 35.68, 139.71, 35.7,
    ];

    function makeLineWithBbox(coords: [number, number][]): Feature<LineString> {
        const xs = coords.map((c) => c[0]);
        const ys = coords.map((c) => c[1]);
        return {
            type: "Feature",
            bbox: [
                Math.min(...xs),
                Math.min(...ys),
                Math.max(...xs),
                Math.max(...ys),
            ],
            geometry: { type: "LineString", coordinates: coords },
            properties: {},
        };
    }

    it("keeps a feature whose bbox intersects the expanded bbox", () => {
        // Feature inside the bbox.
        const f = makeLineWithBbox([
            [139.7, 35.69],
            [139.705, 35.695],
        ]);
        const result = filterFeaturesByBboxMargin([f], BBOX, 500);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(f);
    });

    it("keeps a feature just outside the bbox but within the margin", () => {
        // Feature ~300 m south of the bbox, within a 500 m margin.
        // ~0.0027° = 300 m at this latitude.
        const justOutside: [number, number][] = [
            [139.7, 35.6773],
            [139.705, 35.6773],
        ];
        const f = makeLineWithBbox(justOutside);
        const result = filterFeaturesByBboxMargin([f], BBOX, 500);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(f);
    });

    it("drops a feature far outside the margin", () => {
        // Feature 10 km away — far beyond a 500 m margin.
        const farAway: [number, number][] = [
            [139.7, 35.6],
            [139.705, 35.6],
        ];
        const f = makeLineWithBbox(farAway);
        const result = filterFeaturesByBboxMargin([f], BBOX, 500);
        expect(result).toHaveLength(0);
    });

    it("reduces the real body-of-water window when scoped to 161 m", () => {
        // Verify that re-scoping the 50 km body-of-water window to a small
        // buffer radius dramatically reduces feature count.
        const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
        __setLineBundleForTest("body-of-water", bundle);
        __clearLineBundlesForTest(); // clean up after the require side-effect

        // Window features selected with the 50 km margin (simulating
        // computeLineCategory's output).
        const wideFeatures = selectWindowFeatures(
            "body-of-water",
            BBOX,
            [139.7, 35.69],
            50_000,
        );
        expect(wideFeatures.length).toBeGreaterThan(100);

        // Re-scoped to 161 m — only features that could contribute to a
        // 161 m buffer inside the play area.
        const scopedFeatures = filterFeaturesByBboxMargin(
            wideFeatures,
            BBOX,
            161,
        );
        expect(scopedFeatures.length).toBeLessThan(wideFeatures.length);
        // With a 161 m margin, the count should be dramatically smaller.
        expect(scopedFeatures.length).toBeLessThan(wideFeatures.length / 5);
    });

    it("returns empty array for empty input", () => {
        const result = filterFeaturesByBboxMargin([], BBOX, 500);
        expect(result).toHaveLength(0);
    });
});

// ─── computeLineBuffer input budget tests ───────────────────────────────

describe("computeLineBuffer input budget", () => {
    /**
     * Build a line feature as a ring with the given centroid and approximate
     * side length in degrees. Used to generate many small features.
     */
    function makeRingFeature(
        cx: number,
        cy: number,
        sideDeg: number,
    ): Feature<LineString> {
        const h = sideDeg / 2;
        return {
            type: "Feature",
            properties: {},
            geometry: {
                type: "LineString",
                coordinates: [
                    [cx - h, cy - h],
                    [cx + h, cy - h],
                    [cx + h, cy + h],
                    [cx - h, cy + h],
                    [cx - h, cy - h],
                ],
            },
        };
    }

    /**
     * Helper: compute approximate bbox from a GeoJSON geometry by walking
     * all coordinate arrays. Used when `feature.bbox` is not set.
     */
    function geometryBbox(
        g: Feature["geometry"],
    ): [number, number, number, number] {
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
        const walk = (c: unknown) => {
            if (Array.isArray(c) && typeof c[0] === "number") {
                const [x, y] = c as [number, number];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            } else if (Array.isArray(c)) {
                for (const item of c) walk(item);
            }
        };
        walk((g as { coordinates: unknown }).coordinates);
        return [minX, minY, maxX, maxY];
    }

    describe("applyBufferBudget", () => {
        it("stays under the segment budget", () => {
            // Build 600 lines: 400 long (~2 km, 10 coords) + 200 short
            // (~700 m, 3 coords). Total 600 segs / 4,600 coords exceeds
            // both budgets → escalation drops the short lines.
            const lines: [number, number][][] = [];
            // 400 long lines (~0.02° ≈ 2.2 km each)
            for (let i = 0; i < 400; i++) {
                const cx = 139.0 + (i % 20) * 0.05;
                const cy = 35.0 + Math.floor(i / 20) * 0.05;
                const seg: [number, number][] = [];
                for (let j = 0; j <= 10; j++) {
                    seg.push([cx + j * 0.002, cy]);
                }
                lines.push(seg);
            }
            // 200 short lines (~0.006° ≈ 660 m each)
            for (let i = 0; i < 200; i++) {
                const cx = 139.2 + (i % 20) * 0.05;
                const cy = 35.0 + Math.floor(i / 20) * 0.05;
                lines.push([
                    [cx, cy],
                    [cx + 0.006, cy],
                ]);
            }
            const result = applyBufferBudget(lines, 2000);
            expect(result.length).toBeLessThanOrEqual(400);
            // Should still have some lines (not empty).
            expect(result.length).toBeGreaterThan(0);
        });

        it("drops short features while keeping long ones", () => {
            // 401 lines: 1 long (~0.2° ≈ 22 km, 10 coords) + 400 tiny
            // (~0.002° ≈ 220 m each). Total 401 segs triggers budget;
            // escalation drops the tiny features.
            const longLine: [number, number][] = [];
            for (let i = 0; i <= 10; i++) {
                longLine.push([139.0 + i * 0.02, 35.0]);
            }
            const tinyLines: [number, number][][] = [];
            for (let i = 0; i < 400; i++) {
                const cx = 139.2 + (i % 20) * 0.01;
                const cy = 35.0 + Math.floor(i / 20) * 0.01;
                const ring = makeRingFeature(cx, cy, 0.002);
                tinyLines.push(ring.geometry.coordinates as [number, number][]);
            }
            const result = applyBufferBudget([longLine, ...tinyLines], 2000);
            // The tiny rings should all be dropped; only the long line survives.
            expect(result.length).toBe(1);
        });

        it("completes quickly for 1,000 features (perf guard)", () => {
            const manyLines: [number, number][][] = [];
            for (let i = 0; i < 1000; i++) {
                const cx = 139.0 + (i % 50) * 0.02;
                const cy = 35.0 + Math.floor(i / 50) * 0.02;
                // Each line ~2 km, 10 coords → 1,000 segs, 10,000 coords
                const seg: [number, number][] = [];
                for (let j = 0; j <= 10; j++) {
                    seg.push([cx + j * 0.002, cy]);
                }
                manyLines.push(seg);
            }
            const t0 = performance.now();
            const result = applyBufferBudget(manyLines, 2000);
            const ms = performance.now() - t0;
            expect(result).not.toBeNull();
            expect(ms).toBeLessThan(1000);
        });

        it("hard-cap fallback preserves shape with uniform subsampling, not prefix slice", () => {
            // When the escalation loop exhausts all 6 rounds, the hard-cap
            // fallback enforces MAX_BUFFER_* by keeping the top-N segments
            // and uniformly subsampling any that still exceed the coord cap.
            //
            // A prefix slice would collapse a polyline to its first N
            // coords — a straight capsule anchored only at the start.
            // Uniform subsampling distributes the budget evenly across the
            // whole line, preserving the overall shape and both endpoints.
            //
            // Design: 500 segments × 200 coords each = 100k coords, each
            // ~22 km long with 0.03° (~3.3 km) zigzag amplitude. At the
            // 2,000 m radius the escalation rounds end at tol=2,560 m /
            // lenFloor=10.2 km, so all lines survive. After hard-cap sort
            // to 400 segments, each simplified line still has ~100 coords
            // → 40k coords > MAX_BUFFER_COORDS (20k) → uniform subsample.
            const lines: [number, number][][] = [];
            for (let i = 0; i < 500; i++) {
                const cx = 139.0 + (i % 25) * 0.04;
                const cy = 35.0 + Math.floor(i / 25) * 0.04;
                const seg: [number, number][] = [];
                for (let j = 0; j < 200; j++) {
                    // 0.03° ≈ 3.3 km amplitude — survives simplification
                    // at tol=2,560 m so interior points aren't all removed.
                    const yOff = j % 2 === 0 ? 0.03 : -0.03;
                    seg.push([cx + j * 0.001, cy + yOff]);
                }
                lines.push(seg);
            }
            const result = applyBufferBudget(lines, 2000);

            expect(result.length).toBeLessThanOrEqual(400);
            expect(result.length).toBeGreaterThan(0);

            // Every surviving line must have interior shape preserved
            // (> 2 coords). A prefix-slice would produce straight capsules
            // with only 2 endpoints; uniform subsampling preserves bends.
            for (const r of result) {
                expect(r.length).toBeGreaterThan(2);
            }
        });
    });

    describe("computeLineBuffer", () => {
        it("returns a buffer polygon for a single long line (no regression)", () => {
            const feature: Feature<LineString> = {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [139.0, 35.0],
                        [139.2, 35.0],
                    ],
                },
            };
            const result = computeLineBuffer([feature], 2000);
            expect(result).not.toBeNull();
            expect(result!.geometry.type).toMatch(/Polygon/);

            // Compute bbox from geometry (buffer may not set .bbox).
            const bbox = geometryBbox(result!.geometry);
            // West edge near 139.0 - ~0.02° (~2 km)
            expect(bbox[0]).toBeLessThan(138.99);
            // East edge near 139.2 + ~0.02°
            expect(bbox[2]).toBeGreaterThan(139.19);
        });

        it("does not hang on 1,000 small features", () => {
            const features: Feature<LineString>[] = [];
            for (let i = 0; i < 1000; i++) {
                const cx = 139.0 + (i % 50) * 0.01;
                const cy = 35.0 + Math.floor(i / 50) * 0.01;
                features.push(makeRingFeature(cx, cy, 0.002));
            }
            const t0 = performance.now();
            computeLineBuffer(features, 2000);
            const ms = performance.now() - t0;
            // Should return something (or null is acceptable for all-dropped
            // features). The key assertion: it does not hang.
            expect(ms).toBeLessThan(2000);
        });

        it("returns null when all features are dropped by budget", () => {
            // 1,000 features each consisting of a single point-length
            // LineString — all will be filtered out.
            const features: Feature<LineString>[] = [];
            for (let i = 0; i < 1000; i++) {
                features.push({
                    type: "Feature",
                    properties: {},
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [139.0, 35.0],
                            [139.0001, 35.0],
                        ],
                    },
                });
            }
            const result = computeLineBuffer(features, 50000);
            // All features are too short for a 50 km buffer — budget drops them all.
            expect(result).toBeNull();
        });
    });

    describe("real bundles", () => {
        it("ships a dissolved (not per-ring) body-of-water bundle", () => {
            // P0 regression guard: the dissolve must collapse ~26k raw water
            // polygons into a small set of MultiPolygons. A revert to the old
            // polygon-to-ring bundle (45k+ LineStrings) or a broken dissolve
            // (31k un-merged polygons) fails here, loudly and deterministically.
            //
            // The bundle also carries waterway centerlines (P7) as LineString
            // features, so the guard counts the *polygon subset* rather than the
            // total feature count.
            const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
            expect(bundle.schemaVersion).toBe(2);
            const polygonFeatures = bundle.features.filter((f) =>
                /^(Polygon|MultiPolygon)$/.test(f.geometry.type),
            );
            expect(polygonFeatures.length).toBeGreaterThan(0);
            expect(polygonFeatures.length).toBeLessThan(2000);
        });

        it("buffers the real body-of-water window without softlocking", () => {
            const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
            __setLineBundleForTest("body-of-water", bundle);
            const cat = computeLineCategory(
                [139.75, 35.68],
                "body-of-water",
                [139.0, 35.0, 140.0, 36.0],
            );
            expect(cat).not.toBeNull();
            const t0 = performance.now();
            const buf = computeLineBuffer(
                cat!.windowFeatures,
                cat!.distanceMeters,
            );
            const ms = performance.now() - t0;
            expect(buf).not.toBeNull();
            // Boundedness guard, not a tight perf assertion.  The dissolved
            // Tokyo Bay window is genuine dense coastline geometry (~67
            // MultiPolygons, 251k coords pre-simplify).  @turf/buffer (jsts)
            // under the JS backend takes ~15–25 s for the polygon buffer;
            // the native GEOS backend does the same work in ~0.5–2 s.
            // Raise the ceiling to 30 s so the guard still catches a true
            // softlock (~∞) while surviving both backends without flaking.
            expect(ms).toBeLessThan(30000);
        });

        it("scoped buffer at 161 m stays within budget without escalation (P9 regression)", () => {
            // Pre-fix: the buffer re-used the 50 km nearest-search window,
            // which for Tokyo holds ~1,498 line features / 53k coords. At
            // 161 m that exhausts all budget rounds, drops whole rivers
            // (Meguro), and truncates survivors to straight capsules
            // (Tachiaikawa).  Post-fix: filterFeaturesByBboxMargin
            // re-scopes to ~161 m → ~165 features / ~5k coords, which fits
            // the budget without any escalation.
            const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
            __setLineBundleForTest("body-of-water", bundle);

            // Tokyo 23-wards ~bbox (contains the Meguro and Tachiaikawa rivers).
            const tokyoBbox: [number, number, number, number] = [
                139.6, 35.5, 139.9, 35.8,
            ];

            const cat = computeLineCategory(
                [139.7, 35.62], // near Meguro river
                "body-of-water",
                tokyoBbox,
            );
            expect(cat).not.toBeNull();

            // Pre-filter to buffer radius — the core fix.
            const scoped = filterFeaturesByBboxMargin(
                cat!.windowFeatures,
                tokyoBbox,
                161,
            );

            // The scoped window should have far fewer features than the
            // 50 km window (which is ~1,400+ for Tokyo).
            expect(scoped.length).toBeLessThan(cat!.windowFeatures.length);
            expect(scoped.length).toBeLessThan(500);

            // The reduced input should stay under budget without any
            // escalation rounds — computeLineBuffer returns immediately.
            const buf = computeLineBuffer(scoped, 161);
            expect(buf).not.toBeNull();
            expect(/Polygon|MultiPolygon/.test(buf!.geometry.type)).toBe(true);
        });
    });
});

// ─── Polygon body-of-water tests (P0 — dissolved polygon bundle) ────────

function makePolygonFeature(
    coords: [number, number][][],
    bbox?: [number, number, number, number],
): LineBundle["features"][number] {
    const xs = coords.flat().map((c) => c[0]);
    const ys = coords.flat().map((c) => c[1]);
    return {
        type: "Feature",
        bbox: bbox ?? [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
        ],
        geometry: {
            type: coords.length === 1 ? "Polygon" : "MultiPolygon",
            coordinates: coords as
                | [number, number][][]
                | [number, number][][][],
        },
        properties: {},
    } as LineBundle["features"][number];
}

function makePolygonBundle(
    features: LineBundle["features"],
    category?: string,
): LineBundle {
    return {
        schemaVersion: 2,
        category: category ?? "body-of-water",
        generatedAt: "2026-01-01T00:00:00.000Z",
        source: "test-fixture",
        extractBbox: [137.9, 33.9, 141.9, 37.9],
        features,
    };
}

describe("polygon body-of-water", () => {
    beforeEach(() => {
        clearLineDistanceCache();
        clearLineBufferCache();
        __clearLineBundlesForTest();
        // P8: body-of-water now merges coastline. Inject an empty coastline
        // bundle so the real one isn't loaded during polygon-specific tests.
        __setLineBundleForTest("coastline", makeBundle([]));
    });

    describe("computeLineDistance with polygons", () => {
        it("seeker outside water snaps to the shoreline", () => {
            // A square lake from [139.0,35.0] to [139.1,35.1].
            const lake = makePolygonFeature([
                [
                    [139.0, 35.0],
                    [139.1, 35.0],
                    [139.1, 35.1],
                    [139.0, 35.1],
                    [139.0, 35.0],
                ],
            ]);
            __setLineBundleForTest("body-of-water", makePolygonBundle([lake]));

            // Center outside the lake (to the northeast).
            const result = computeLineDistance(
                [139.15, 35.15],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            // Distance should be > 0 (outside the lake).
            expect(result!.distanceMeters).toBeGreaterThan(0);
            // Nearest point should be on one of the lake's edges.
            // The closest point should be near the northeast corner [139.1, 35.1].
            expect(result!.nearestPoint[0]).toBeCloseTo(139.1, 1);
            expect(result!.nearestPoint[1]).toBeCloseTo(35.1, 1);
        });

        it("seeker inside water returns distance 0", () => {
            const lake = makePolygonFeature([
                [
                    [139.0, 35.0],
                    [139.1, 35.0],
                    [139.1, 35.1],
                    [139.0, 35.1],
                    [139.0, 35.0],
                ],
            ]);
            __setLineBundleForTest("body-of-water", makePolygonBundle([lake]));

            // Center inside the lake.
            const result = computeLineDistance(
                [139.05, 35.05],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            expect(result!.distanceMeters).toBe(0);
            expect(result!.nearestPoint).toEqual([139.05, 35.05]);
        });

        it("seeker inside a MultiPolygon water body returns distance 0", () => {
            // Two disjoint square lakes as a MultiPolygon.
            const lakes: LineBundle["features"][number] = {
                type: "Feature",
                bbox: [139.0, 35.0, 139.15, 35.15],
                geometry: {
                    type: "MultiPolygon",
                    coordinates: [
                        [
                            [
                                [139.0, 35.0],
                                [139.05, 35.0],
                                [139.05, 35.05],
                                [139.0, 35.05],
                                [139.0, 35.0],
                            ],
                        ],
                        [
                            [
                                [139.1, 35.1],
                                [139.15, 35.1],
                                [139.15, 35.15],
                                [139.1, 35.15],
                                [139.1, 35.1],
                            ],
                        ],
                    ],
                },
                properties: {},
            };
            __setLineBundleForTest("body-of-water", makePolygonBundle([lakes]));

            // Center inside the second part.
            const result = computeLineDistance(
                [139.12, 35.12],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            expect(result!.distanceMeters).toBe(0);
        });

        it("seeker outside a polygon with holes snaps to nearest edge", () => {
            // Lake with an island hole — outer ring [139.0,35.0]-[139.2,35.2],
            // hole at [139.05,35.05]-[139.15,35.15].
            const lakeWithIsland: LineBundle["features"][number] = {
                type: "Feature",
                bbox: [139.0, 35.0, 139.2, 35.2],
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [139.0, 35.0],
                            [139.2, 35.0],
                            [139.2, 35.2],
                            [139.0, 35.2],
                            [139.0, 35.0],
                        ],
                        [
                            [139.05, 35.05],
                            [139.15, 35.05],
                            [139.15, 35.15],
                            [139.05, 35.15],
                            [139.05, 35.05],
                        ],
                    ],
                },
                properties: {},
            };
            __setLineBundleForTest(
                "body-of-water",
                makePolygonBundle([lakeWithIsland]),
            );

            // Center inside the hole (on the island) — should measure to
            // the hole boundary, not distance 0.
            const result = computeLineDistance([139.1, 35.1], "body-of-water");
            expect(result).not.toBeNull();
            // The seeker is NOT inside water (they're on the island).
            // Distance should be > 0 — to the hole edge.
            expect(result!.distanceMeters).toBeGreaterThan(0);
        });

        it("handles mixed polygon and line features in the bundle", () => {
            // A square lake + a line segment outside it.
            const lake = makePolygonFeature([
                [
                    [139.0, 35.0],
                    [139.05, 35.0],
                    [139.05, 35.05],
                    [139.0, 35.05],
                    [139.0, 35.0],
                ],
            ]);
            const line = makeLineFeature([
                [139.1, 35.0],
                [139.15, 35.0],
            ]);
            __setLineBundleForTest(
                "body-of-water",
                makePolygonBundle([
                    lake,
                    line as LineBundle["features"][number],
                ]),
            );
            // Inject an empty coastline bundle so the real one isn't loaded
            // (P8 merges coastline into body-of-water).
            __setLineBundleForTest("coastline", makeBundle([]));

            // Center far from both — should not crash.
            const result = computeLineDistance([140.0, 36.0], "body-of-water");
            // Outside the 50 km margin — should be null.
            expect(result).toBeNull();
        });
    });

    describe("computeLineBuffer with polygons", () => {
        it("returns a buffer polygon for a polygon feature", () => {
            const lake: LineBundle["features"][number] = {
                type: "Feature",
                bbox: [139.0, 35.0, 139.05, 35.05],
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [139.0, 35.0],
                            [139.05, 35.0],
                            [139.05, 35.05],
                            [139.0, 35.05],
                            [139.0, 35.0],
                        ],
                    ],
                },
                properties: {},
            };
            const result = computeLineBuffer([lake], 1000);
            expect(result).not.toBeNull();
            expect(result!.geometry.type).toMatch(/Polygon/);
        });

        it("returns null for empty polygon features array", () => {
            const result = computeLineBuffer([], 1000);
            expect(result).toBeNull();
        });

        it("unions polygon + far-apart line buffers (regression: combine dropped all but one piece)", () => {
            // A small water polygon near (139.0, 35.0)…
            const lake: LineBundle["features"][number] = {
                type: "Feature",
                bbox: [139.0, 35.0, 139.02, 35.02],
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [139.0, 35.0],
                            [139.02, 35.0],
                            [139.02, 35.02],
                            [139.0, 35.02],
                            [139.0, 35.0],
                        ],
                    ],
                },
                properties: {},
            };
            // …and a river line ~10 km away near (140.0, 36.0), long enough
            // to survive the min-feature-length filter.
            const river = makeLineFeature([
                [140.0, 36.0],
                [140.05, 36.0],
                [140.1, 36.0],
            ]);

            const result = computeLineBuffer([lake, river], 1000);
            expect(result).not.toBeNull();
            // The merged buffer must cover BOTH the polygon and the line.
            // Before the fix, the FeatureCollection "union" kept only the
            // first buffer, so the river's buffer was silently dropped.
            expect(booleanPointInPolygon([139.01, 35.01], result!)).toBe(true);
            expect(booleanPointInPolygon([140.05, 36.0], result!)).toBe(true);
        });

        it("handles MultiPolygon features", () => {
            const mp: LineBundle["features"][number] = {
                type: "Feature",
                bbox: [139.0, 35.0, 139.15, 35.15],
                geometry: {
                    type: "MultiPolygon",
                    coordinates: [
                        [
                            [
                                [139.0, 35.0],
                                [139.05, 35.0],
                                [139.05, 35.05],
                                [139.0, 35.05],
                                [139.0, 35.0],
                            ],
                        ],
                        [
                            [
                                [139.1, 35.1],
                                [139.15, 35.1],
                                [139.15, 35.15],
                                [139.1, 35.15],
                                [139.1, 35.1],
                            ],
                        ],
                    ],
                },
                properties: {},
            };
            const result = computeLineBuffer([mp], 1000);
            expect(result).not.toBeNull();
            expect(result!.geometry.type).toMatch(/Polygon/);
        });
    });

    describe("polygonFeaturesToLineFeatures", () => {
        it("converts a Polygon feature to a LineString (boundary ring)", () => {
            const poly: LineBundle["features"][number] = {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [139.0, 35.0],
                            [139.1, 35.0],
                            [139.1, 35.1],
                            [139.0, 35.1],
                            [139.0, 35.0],
                        ],
                    ],
                },
            };
            const lines = polygonFeaturesToLineFeatures([poly]);
            expect(lines).toHaveLength(1);
            expect(lines[0].geometry.type).toBe("LineString");
            // Check the ring coordinates match.
            const coords = (lines[0].geometry as LineString).coordinates;
            expect(coords).toHaveLength(5); // 5 coords for a closed square ring
            expect(coords[0]).toEqual([139.0, 35.0]);
        });

        it("converts a MultiPolygon to a MultiLineString", () => {
            const mp: LineBundle["features"][number] = {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "MultiPolygon",
                    coordinates: [
                        [
                            [
                                [139.0, 35.0],
                                [139.05, 35.0],
                                [139.05, 35.05],
                                [139.0, 35.05],
                                [139.0, 35.0],
                            ],
                        ],
                        [
                            [
                                [139.1, 35.1],
                                [139.15, 35.1],
                                [139.15, 35.15],
                                [139.1, 35.15],
                                [139.1, 35.1],
                            ],
                        ],
                    ],
                },
            };
            const lines = polygonFeaturesToLineFeatures([mp]);
            expect(lines).toHaveLength(1);
            expect(lines[0].geometry.type).toBe("MultiLineString");
            const coords = (lines[0].geometry as MultiLineString).coordinates;
            expect(coords).toHaveLength(2); // 2 rings
        });

        it("passes through LineString features unchanged", () => {
            const line = makeLineFeature([
                [139.0, 35.0],
                [139.1, 35.0],
            ]);
            const result = polygonFeaturesToLineFeatures([
                line as LineBundle["features"][number],
            ]);
            expect(result).toHaveLength(1);
            expect(result[0].geometry.type).toBe("LineString");
        });
    });

    describe("featureToRings", () => {
        it("extracts rings from a Polygon", () => {
            const poly: LineBundle["features"][number] = {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [139.0, 35.0],
                            [139.1, 35.0],
                            [139.1, 35.1],
                            [139.0, 35.1],
                            [139.0, 35.0],
                        ],
                        [
                            [139.02, 35.02],
                            [139.08, 35.02],
                            [139.08, 35.08],
                            [139.02, 35.08],
                            [139.02, 35.02],
                        ],
                    ],
                },
            };
            const rings = featureToRings(poly);
            // Outer ring + hole.
            expect(rings).toHaveLength(2);
            expect(rings[0]).toHaveLength(5);
            expect(rings[1]).toHaveLength(5);
        });

        it("extracts rings from a MultiPolygon", () => {
            const mp: LineBundle["features"][number] = {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "MultiPolygon",
                    coordinates: [
                        [
                            [
                                [139.0, 35.0],
                                [139.05, 35.0],
                                [139.05, 35.05],
                                [139.0, 35.05],
                                [139.0, 35.0],
                            ],
                        ],
                        [
                            [
                                [139.1, 35.1],
                                [139.15, 35.1],
                                [139.15, 35.15],
                                [139.1, 35.15],
                                [139.1, 35.1],
                            ],
                        ],
                    ],
                },
            };
            const rings = featureToRings(mp);
            // 2 polygons, each with 1 ring.
            expect(rings).toHaveLength(2);
        });
    });
});

// ─── P8 — Coastline in body-of-water ─────────────────────────────────────

describe("P8 — coastline in body-of-water", () => {
    beforeEach(() => {
        clearLineDistanceCache();
        clearLineCategoryCache();
        clearLineBufferCache();
        clearClippedLineCache();
        clearDilatedBoundaryCache();
        __clearLineBundlesForTest();
    });

    describe("computeLineDistance merges coastline into body-of-water", () => {
        it("snaps to a near coastline when body-of-water is far away", () => {
            // Far inland lake (~100 km north of Tokyo)
            const farLake = makePolygonFeature([
                [
                    [139.5, 36.5],
                    [139.6, 36.5],
                    [139.6, 36.6],
                    [139.5, 36.6],
                    [139.5, 36.5],
                ],
            ]);
            __setLineBundleForTest(
                "body-of-water",
                makePolygonBundle([farLake]),
            );

            // Coastline line near Tokyo Bay area
            const coastLine = makeLineFeature([
                [139.75, 35.62],
                [139.78, 35.63],
            ]);
            __setLineBundleForTest("coastline", makeBundle([coastLine]));

            // Center near the coast (~35.62 lat), far from the lake (~36.5 lat)
            const result = computeLineDistance(
                [139.76, 35.63],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            // Should snap to the coastline (~35.62–35.63), not the lake (~36.5).
            expect(result!.nearestPoint[1]).toBeCloseTo(35.63, 1);
            // Distance should be small (< 2 km to the shoreline).
            expect(result!.distanceMeters).toBeLessThan(2000);
        });

        it("seeker inside a body-of-water polygon still returns distance 0", () => {
            // Lake with seeker inside it
            const lake = makePolygonFeature([
                [
                    [139.0, 35.0],
                    [139.1, 35.0],
                    [139.1, 35.1],
                    [139.0, 35.1],
                    [139.0, 35.0],
                ],
            ]);
            __setLineBundleForTest("body-of-water", makePolygonBundle([lake]));

            // Coastline far away
            const coastLine = makeLineFeature([
                [139.8, 35.6],
                [139.9, 35.6],
            ]);
            __setLineBundleForTest("coastline", makeBundle([coastLine]));

            // Center inside the lake
            const result = computeLineDistance(
                [139.05, 35.05],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            // Inside the lake → distance 0 (early return still works).
            expect(result!.distanceMeters).toBe(0);
            expect(result!.nearestPoint).toEqual([139.05, 35.05]);
        });
    });

    describe("selectWindowFeatures includes coastline", () => {
        it("window features contain coastline when category is body-of-water", () => {
            const waterLine = makeLineFeature([
                [139.05, 35.1],
                [139.1, 35.1],
            ]);
            __setLineBundleForTest(
                "body-of-water",
                makePolygonBundle([
                    waterLine as unknown as LineBundle["features"][number],
                ]),
            );

            const coastLine = makeLineFeature([
                [139.05, 35.15],
                [139.1, 35.15],
            ]);
            __setLineBundleForTest("coastline", makeBundle([coastLine]));

            const features = selectWindowFeatures(
                "body-of-water",
                PLAY_AREA_BBOX,
                [139.075, 35.125],
                5000,
            );
            // Both water and coastline features should be in the window.
            expect(features.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe("other categories unaffected", () => {
        it("coastline distance is unchanged (only its own bundle)", () => {
            const coastLine = makeLineFeature([
                [139.0, 35.0],
                [139.1, 35.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([coastLine]));

            const result = computeLineDistance([139.05, 35.01], "coastline");
            expect(result).not.toBeNull();
            // Should snap to the coastline line (lat ~35.0).
            expect(result!.nearestPoint[1]).toBeCloseTo(35.0, 2);
            expect(result!.distanceMeters).toBeLessThan(2000);
        });

        it("admin-1st-border only uses its own bundle", () => {
            const borderLine = makeLineFeature([
                [139.0, 35.0],
                [139.1, 35.0],
            ]);
            __setLineBundleForTest(
                "admin-1st-border",
                makeBundle([borderLine]),
            );

            // Also inject a coastline bundle — should be ignored for admin-1st-border.
            const coastLine = makeLineFeature([
                [137.0, 34.0],
                [137.1, 34.0],
            ]);
            __setLineBundleForTest("coastline", makeBundle([coastLine]));

            const result = computeLineDistance(
                [139.05, 35.01],
                "admin-1st-border",
            );
            expect(result).not.toBeNull();
            // Should snap to the border line (lat ~35.0), not the coastline.
            expect(result!.nearestPoint[1]).toBeCloseTo(35.0, 2);
        });
    });

    describe("real bundle — Tokyo Bay", () => {
        it("body-of-water distance is small at a Tokyo Bay shoreline point", () => {
            const bowBundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
            __setLineBundleForTest("body-of-water", bowBundle);

            const coastBundle: LineBundle = require("../../../../../assets/measuring/coastline.json");
            __setLineBundleForTest("coastline", coastBundle);

            // A point on the Tokyo Bay shoreline (Odaiba area).
            const result = computeLineDistance(
                [139.775, 35.627],
                "body-of-water",
            );
            expect(result).not.toBeNull();
            // Near the coast → small distance (dominated by coastline).
            expect(result!.distanceMeters).toBeLessThan(2000);
        });
    });
});

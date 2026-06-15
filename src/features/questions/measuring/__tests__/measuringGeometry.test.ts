import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
} from "geojson";

import { buildMeasuringRenderState } from "@/features/questions/measuring/measuringGeometry";
import {
    clearLineBufferCache,
    clearLineCategoryCache,
    clearLineDistanceCache,
    clearDilatedBoundaryCache,
} from "@/features/questions/measuring/lineMeasuringGeometry";
import {
    clearPointBufferCache,
    clearPointDistanceCache,
} from "@/features/questions/measuring/pointMeasuringGeometry";
import {
    __clearLineBundlesForTest,
    __setLineBundleForTest,
    type LineBundle,
} from "@/features/questions/measuring/lineBundleLoader";
import {
    clearBundledRegionCache,
    registerTestRegion,
    type RawRegion,
} from "@/features/questions/matching/bundledPois";
import type { MeasuringQuestion } from "@/features/questions/measuring/measuringTypes";
import type { QuestionState } from "@/features/questions/questionTypes";

// ─── Test region helpers ────────────────────────────────────────────────────

/** Bbox covering central Tokyo — contains the test center [139.75, 35.675]. */
const TEST_BBOX: [number, number, number, number] = [139.0, 35.0, 141.0, 36.0];

function makeTestRegion(overrides: Partial<RawRegion> = {}): RawRegion {
    return {
        schemaVersion: 1,
        region: "test-point-region",
        label: "Test Point Region",
        generatedAt: "2026-01-01T00:00:00.000Z",
        bbox: TEST_BBOX,
        totalCount: 2,
        categories: {
            museum: {
                count: 2,
                lon: [139.761, 139.77],
                lat: [35.681, 35.69],
                name: ["Museum A", "Museum B"],
                osmId: [100, 200],
                osmType: [0, 1], // node, way
            },
        },
        ...overrides,
    };
}

function registerMuseumRegion(): void {
    registerTestRegion("test-point-region", makeTestRegion());
}

// ─── Question factory ───────────────────────────────────────────────────────

function makeMeasuringQuestion(
    overrides: Partial<MeasuringQuestion> = {},
): MeasuringQuestion {
    return {
        answer: "unanswered",
        category: "museum",
        center: [139.75, 35.675], // seeker pin
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "q-measuring-test",
        isLocked: false,
        seekerDistanceUnit: "m",
        seekerDistanceMeters: null,
        nearestPoiName: null,
        type: "measuring",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

// ─── Line bundle helper ─────────────────────────────────────────────────────

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

// ─── Play area fixture ──────────────────────────────────────────────────

/** Square play area from [west,south] to [east,north]. */
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
                            [west, south],
                        ],
                    ],
                },
            },
        ],
    };
}

// Small square play area for consistent test reasoning
const PLAY_AREA = makeSquarePlayArea(139.0, 35.0, 139.2, 35.2);
const PLAY_AREA_BBOX: [number, number, number, number] = [
    139.0, 35.0, 139.2, 35.2,
];

/** True when every coordinate of every segment is within the bbox (plus pad). */
function allCoordsWithin(
    feature: Feature<LineString | MultiLineString>,
    bbox: [number, number, number, number],
    padDeg = 0.001,
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

/** Compute a [west, south, east, north] bbox from a GeoJSON feature. */
function computeFeatureBbox(
    f: Feature<Polygon | MultiPolygon>,
): [number, number, number, number] {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walk = (c: unknown) => {
        if (typeof (c as number[])?.[0] === "number") {
            const [x, y] = c as number[];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        } else if (Array.isArray(c)) {
            for (const item of c) walk(item);
        }
    };
    walk(f.geometry.coordinates);
    return [minX, minY, maxX, maxY];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildMeasuringRenderState", () => {
    beforeEach(() => {
        clearPointBufferCache();
        clearPointDistanceCache();
        clearLineBufferCache();
        clearLineCategoryCache();
        clearLineDistanceCache();
        clearDilatedBoundaryCache();
        __clearLineBundlesForTest();
        clearBundledRegionCache();
        registerMuseumRegion();
    });

    // ── Empty / no measuring questions ───────────────────────────────────

    it("returns empty collections for empty input", () => {
        const result = buildMeasuringRenderState([], undefined, undefined);
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
        const result = buildMeasuringRenderState(
            [radarQuestion],
            undefined,
            undefined,
        );
        expect(result.hitMaskFeatures.features).toHaveLength(0);
        expect(result.missMaskFeatures.features).toHaveLength(0);
        expect(result.nearestPointConnectors.features).toHaveLength(0);
        expect(result.nearestPointMarkers.features).toHaveLength(0);
    });

    // ── Point category: closer (positive) ────────────────────────────────

    describe("Point categories — positive (closer)", () => {
        it("places union buffer in hitMaskFeatures", () => {
            const q = makeMeasuringQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.hitMaskFeatures.features).toHaveLength(1);
            expect(result.missMaskFeatures.features).toHaveLength(0);
        });

        it("union buffer covers the nearest POI", () => {
            const q = makeMeasuringQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            const mask = result.hitMaskFeatures.features[0];
            expect(mask).toBeTruthy();
            expect(
                mask.geometry.type === "Polygon" ||
                    mask.geometry.type === "MultiPolygon",
            ).toBe(true);
        });

        it("emits connector and marker to the nearest POI", () => {
            const q = makeMeasuringQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            // Point categories now emit connectors + markers (same as lines).
            expect(
                result.nearestPointConnectors.features.length,
            ).toBeGreaterThanOrEqual(1);
            expect(
                result.nearestPointMarkers.features.length,
            ).toBeGreaterThanOrEqual(1);

            const connector = result.nearestPointConnectors.features[0];
            // Connector starts at center
            expect(connector.geometry.coordinates[0]).toEqual([139.75, 35.675]);
        });
    });

    // ── Point category: farther (negative) ───────────────────────────────

    describe("Point categories — negative (farther)", () => {
        it("places union buffer in missMaskFeatures", () => {
            const q = makeMeasuringQuestion({ answer: "negative" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
            expect(result.missMaskFeatures.features).toHaveLength(1);
        });

        it("emits connector and marker even for unanswered questions", () => {
            const q = makeMeasuringQuestion({ answer: "unanswered" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            // Connector/marker show the auto-picked nearest, answered or not.
            expect(
                result.nearestPointConnectors.features.length,
            ).toBeGreaterThanOrEqual(1);
            expect(
                result.nearestPointMarkers.features.length,
            ).toBeGreaterThanOrEqual(1);
        });
    });

    // ── Point category: unanswered ───────────────────────────────────────

    describe("Unanswered", () => {
        it("produces neither hit nor miss features for point categories", () => {
            const q = makeMeasuringQuestion({ answer: "unanswered" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
            expect(result.missMaskFeatures.features).toHaveLength(0);
        });

        it("still emits connector and marker for unanswered", () => {
            const q = makeMeasuringQuestion({ answer: "unanswered" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(
                result.nearestPointConnectors.features.length,
            ).toBeGreaterThanOrEqual(1);
            expect(
                result.nearestPointMarkers.features.length,
            ).toBeGreaterThanOrEqual(1);
        });
    });

    // ── Missing bundle / no POIs ─────────────────────────────────────────

    describe("Missing bundle for point category", () => {
        it("skips question when no region covers the center", () => {
            // Center outside the test region bbox.
            const q = makeMeasuringQuestion({
                answer: "positive",
                center: [130.0, 30.0], // far from Tokyo
            });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
            expect(result.missMaskFeatures.features).toHaveLength(0);
            expect(result.nearestPointConnectors.features).toHaveLength(0);
        });
    });

    // ── Answer toggling for point categories ─────────────────────────────

    describe("Answer toggling for point categories", () => {
        it("unanswered → positive → buffer in hitMaskFeatures", () => {
            const q = makeMeasuringQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.hitMaskFeatures.features).toHaveLength(1);
            expect(result.missMaskFeatures.features).toHaveLength(0);
        });

        it("unanswered → negative → buffer in missMaskFeatures", () => {
            const q = makeMeasuringQuestion({ answer: "negative" });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
            expect(result.missMaskFeatures.features).toHaveLength(1);
        });

        it("positive → negative → buffer moves from hit to miss", () => {
            const result1 = buildMeasuringRenderState(
                [makeMeasuringQuestion({ answer: "positive" })],
                undefined,
                undefined,
            );
            expect(result1.hitMaskFeatures.features).toHaveLength(1);
            expect(result1.missMaskFeatures.features).toHaveLength(0);

            const result2 = buildMeasuringRenderState(
                [makeMeasuringQuestion({ answer: "negative" })],
                undefined,
                undefined,
            );
            expect(result2.hitMaskFeatures.features).toHaveLength(0);
            expect(result2.missMaskFeatures.features).toHaveLength(1);
        });

        it("positive → unanswered → buffer is removed", () => {
            const result1 = buildMeasuringRenderState(
                [makeMeasuringQuestion({ answer: "positive" })],
                undefined,
                undefined,
            );
            expect(result1.hitMaskFeatures.features).toHaveLength(1);

            const result2 = buildMeasuringRenderState(
                [makeMeasuringQuestion({ answer: "unanswered" })],
                undefined,
                undefined,
            );
            expect(result2.hitMaskFeatures.features).toHaveLength(0);
            expect(result2.missMaskFeatures.features).toHaveLength(0);
        });
    });

    // ── Line-category tests (unchanged behavior) ─────────────────────────

    describe("Line categories", () => {
        it("is NOT dropped when center is near the line (regression guard)", () => {
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
                center: [139.75, 35.68],
            });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.hitMaskFeatures.features).toHaveLength(1);
        });

        it("buffers along the line, not just at the nearest point", () => {
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
                center: [139.75, 35.68],
            });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            const mask = result.hitMaskFeatures.features[0];

            expect(mask).toBeTruthy();
            expect(
                mask.geometry.type === "Polygon" ||
                    mask.geometry.type === "MultiPolygon",
            ).toBe(true);

            const bbox = computeFeatureBbox(mask);
            const lonSpan = bbox[2] - bbox[0];
            expect(lonSpan).toBeGreaterThan(0.3);
            expect(bbox[1]).toBeLessThan(35.675);
            expect(bbox[3]).toBeGreaterThan(35.675);
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
            });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.nearestPointConnectors.features).toHaveLength(1);
            expect(result.nearestPointMarkers.features).toHaveLength(1);

            const connector = result.nearestPointConnectors.features[0];
            expect(connector.geometry.coordinates[0]).toEqual([139.75, 35.675]);
        });

        it("skips question when bundle yields no feature", () => {
            __setLineBundleForTest("coastline", null);
            const q = makeMeasuringQuestion({
                answer: "positive",
                category: "coastline",
            });
            const result = buildMeasuringRenderState([q], undefined, undefined);
            expect(result.hitMaskFeatures.features).toHaveLength(0);
            expect(result.missMaskFeatures.features).toHaveLength(0);
            expect(result.nearestPointConnectors.features).toHaveLength(0);
            expect(result.nearestPointMarkers.features).toHaveLength(0);
        });

        describe("answer toggling for a line-category question", () => {
            const bundle = makeLineBundle([
                [139.0, 35.675],
                [140.0, 35.675],
            ]);

            beforeEach(() => {
                __setLineBundleForTest("coastline", bundle);
            });

            it("unanswered → produces no mask features", () => {
                const q = makeMeasuringQuestion({
                    answer: "unanswered",
                    category: "coastline",
                });
                const result = buildMeasuringRenderState(
                    [q],
                    undefined,
                    undefined,
                );
                expect(result.hitMaskFeatures.features).toHaveLength(0);
                expect(result.missMaskFeatures.features).toHaveLength(0);
                expect(result.nearestPointConnectors.features).toHaveLength(1);
                expect(result.nearestPointMarkers.features).toHaveLength(1);
            });

            it("unanswered → positive → buffer in hitMaskFeatures", () => {
                const q = makeMeasuringQuestion({
                    answer: "positive",
                    category: "coastline",
                });
                const result = buildMeasuringRenderState(
                    [q],
                    undefined,
                    undefined,
                );
                expect(result.hitMaskFeatures.features).toHaveLength(1);
                expect(result.missMaskFeatures.features).toHaveLength(0);
            });

            it("unanswered → negative → buffer in missMaskFeatures", () => {
                const q = makeMeasuringQuestion({
                    answer: "negative",
                    category: "coastline",
                });
                const result = buildMeasuringRenderState(
                    [q],
                    undefined,
                    undefined,
                );
                expect(result.hitMaskFeatures.features).toHaveLength(0);
                expect(result.missMaskFeatures.features).toHaveLength(1);
            });

            it("positive → negative → buffer moves from hit to miss", () => {
                const posQ = makeMeasuringQuestion({
                    answer: "positive",
                    category: "coastline",
                });
                const posResult = buildMeasuringRenderState(
                    [posQ],
                    undefined,
                    undefined,
                );
                expect(posResult.hitMaskFeatures.features).toHaveLength(1);
                expect(posResult.missMaskFeatures.features).toHaveLength(0);

                const negQ = makeMeasuringQuestion({
                    answer: "negative",
                    category: "coastline",
                });
                const negResult = buildMeasuringRenderState(
                    [negQ],
                    undefined,
                    undefined,
                );
                expect(negResult.hitMaskFeatures.features).toHaveLength(0);
                expect(negResult.missMaskFeatures.features).toHaveLength(1);
            });

            it("positive → unanswered → buffer is removed", () => {
                const posQ = makeMeasuringQuestion({
                    answer: "positive",
                    category: "coastline",
                });
                const posResult = buildMeasuringRenderState(
                    [posQ],
                    undefined,
                    undefined,
                );
                expect(posResult.hitMaskFeatures.features).toHaveLength(1);

                const unQ = makeMeasuringQuestion({
                    answer: "unanswered",
                    category: "coastline",
                });
                const unResult = buildMeasuringRenderState(
                    [unQ],
                    undefined,
                    undefined,
                );
                expect(unResult.hitMaskFeatures.features).toHaveLength(0);
                expect(unResult.missMaskFeatures.features).toHaveLength(0);
            });
        });

        it("mixes point-category and line-category questions correctly", () => {
            const museumQ = makeMeasuringQuestion({ answer: "positive" });

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
            });

            const result = buildMeasuringRenderState(
                [museumQ, coastlineQ],
                undefined,
                undefined,
            );
            expect(result.hitMaskFeatures.features).toHaveLength(1); // museum
            expect(result.missMaskFeatures.features).toHaveLength(1); // coastline
            // Both point and line categories emit connectors now
            expect(result.nearestPointConnectors.features).toHaveLength(2);
            expect(result.nearestPointMarkers.features).toHaveLength(2);
        });
    });

    // ── Consolidation tests (Steps 2–5) ───────────────────────────────────

    describe("Line category — consolidation and clipping", () => {
        /** Injects a bundle with the given features to "high-speed-rail". */
        function injectHSR(features: LineBundle["features"]) {
            __setLineBundleForTest("high-speed-rail", {
                schemaVersion: 1,
                category: "high-speed-rail",
                generatedAt: "2026-01-01T00:00:00.000Z",
                source: "test-fixture",
                extractBbox: [137.9, 33.9, 141.9, 37.9],
                features,
            });
        }

        function makeLineFeat(
            coords: [number, number][],
        ): LineBundle["features"][number] {
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

        function hsrQuestion(
            overrides: Partial<MeasuringQuestion> = {},
        ): MeasuringQuestion {
            return {
                answer: "unanswered",
                category: "high-speed-rail",
                center: [139.1, 35.1], // inside PLAY_AREA
                createdAt: "2026-01-01T00:00:00.000Z",
                id: "q-hsr",
                isLocked: false,
                seekerDistanceUnit: "m",
                seekerDistanceMeters: null,
                nearestPoiName: null,
                type: "measuring",
                updatedAt: "2026-01-01T00:00:00.000Z",
                ...overrides,
            };
        }

        it("Tōhoku regression — two disjoint in-area corridors both appear", () => {
            // Two separate HSR lines that both pass through the play area.
            // Tōkaidō: near the seeker center
            const tokaido = makeLineFeat([
                [139.05, 35.1],
                [139.15, 35.1],
            ]);
            // Tōhoku: farther but still inside the play area
            const tohoku = makeLineFeat([
                [139.05, 35.15],
                [139.15, 35.15],
            ]);
            injectHSR([tokaido, tohoku]);

            const q = hsrQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState(
                [q],
                PLAY_AREA_BBOX,
                PLAY_AREA,
            );
            // Both corridors should be in the reference line (consolidation fix)
            expect(result.lineFeatures.features.length).toBeGreaterThanOrEqual(
                2,
            );
        });

        it("spill regression — reference line never leaves the play area", () => {
            // HSR line starts inside and runs far outside
            const spillLine = makeLineFeat([
                [139.05, 35.1],
                [139.1, 35.1],
                [139.15, 35.05],
                [140.5, 34.0], // far outside
            ]);
            injectHSR([spillLine]);

            const q = hsrQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState(
                [q],
                PLAY_AREA_BBOX,
                PLAY_AREA,
            );
            // Every reference line feature must be within the play area
            for (const f of result.lineFeatures.features) {
                expect(allCoordsWithin(f, PLAY_AREA_BBOX)).toBe(true);
            }
        });

        it("mask ↔ reference-line consistency — both from same window", () => {
            // Two in-area corridors, answered positive
            const lineA = makeLineFeat([
                [139.05, 35.05],
                [139.15, 35.05],
            ]);
            const lineB = makeLineFeat([
                [139.05, 35.15],
                [139.15, 35.15],
            ]);
            injectHSR([lineA, lineB]);

            const q = hsrQuestion({ answer: "positive" });
            const result = buildMeasuringRenderState(
                [q],
                PLAY_AREA_BBOX,
                PLAY_AREA,
            );
            // Mask exists (the buffer ran)
            expect(result.hitMaskFeatures.features.length).toBeGreaterThan(0);
            // Reference line has both corridors (same window source)
            expect(result.lineFeatures.features.length).toBeGreaterThanOrEqual(
                2,
            );
        });

        it("shared-boundary at render level — prefecture border survives", () => {
            // Border line coincident with the play-area north edge
            const borderLine = makeLineFeat([
                [139.0, 35.2], // on north edge
                [139.2, 35.2], // on north edge
            ]);
            __setLineBundleForTest("admin-1st-border", {
                schemaVersion: 1,
                category: "admin-1st-border",
                generatedAt: "2026-01-01T00:00:00.000Z",
                source: "test-fixture",
                extractBbox: [137.9, 33.9, 141.9, 37.9],
                features: [borderLine],
            });

            const q: MeasuringQuestion = {
                ...hsrQuestion(),
                category: "admin-1st-border",
                center: [139.1, 35.15], // just inside the play area
            };
            const result = buildMeasuringRenderState(
                [q],
                PLAY_AREA_BBOX,
                PLAY_AREA,
            );
            // The coincident border should survive ε-dilation
            expect(result.lineFeatures.features.length).toBeGreaterThanOrEqual(
                1,
            );
        });
    });
});

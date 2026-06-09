import {
    buildCombinedEligibilityMask,
    clearMaskResultCache,
    signedRingArea,
} from "../maskBuilder";
import type { GeoJsonFeatureCollection, Position } from "../geojsonTypes";
import {
    initGeosWasm,
    bufferWKB as geosWasmBufferWKB,
    unaryUnionWKB as geosWasmUnaryUnionWKB,
    differenceWKB as geosWasmDifferenceWKB,
    unionWKB as geosWasmUnionWKB,
    intersectionWKB as geosWasmIntersectionWKB,
} from "@/shared/geometry/__tests__/helpers/geosWasmShim";
import { geosGeometryBackend } from "@/shared/geometry/geosGeometryBackend";
import { jsGeometryBackend } from "@/shared/geometry/jsGeometryBackend";
import { sampleGridParity } from "@/shared/geometry/__tests__/helpers/parityGrid";
import { __setGeometryBackendForTest } from "@/shared/geometry/geometryBackend";

function makeSquareFC(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): GeoJsonFeatureCollection {
    return {
        features: [makeSquareFeature(minX, minY, maxX, maxY)],
        type: "FeatureCollection",
    };
}

function makeSquareFeature(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): GeoJsonFeatureCollection["features"][number] {
    return {
        geometry: {
            coordinates: [
                [
                    [minX, minY],
                    [maxX, minY],
                    [maxX, maxY],
                    [minX, maxY],
                    [minX, minY],
                ],
            ],
            type: "Polygon",
        },
        properties: {},
        type: "Feature",
    };
}

function makeRingWithHoleFC(): GeoJsonFeatureCollection {
    return {
        features: [
            {
                geometry: {
                    coordinates: [
                        [
                            [2, 2],
                            [8, 2],
                            [8, 8],
                            [2, 8],
                            [2, 2],
                        ],
                        [
                            [4, 4],
                            [4, 6],
                            [6, 6],
                            [6, 4],
                            [4, 4],
                        ],
                    ],
                    type: "Polygon",
                },
                properties: {},
                type: "Feature",
            },
        ],
        type: "FeatureCollection",
    };
}

function polygonArea(coords: Position[][][]): number {
    let total = 0;
    for (const polygon of coords) {
        for (const ring of polygon) {
            total += signedRingArea(ring);
        }
    }
    return Math.abs(total);
}

function maskToCoords(maskFC: GeoJsonFeatureCollection): Position[][][] {
    const out: Position[][][] = [];
    for (const feature of maskFC.features) {
        if (feature.geometry.type === "Polygon") {
            out.push(feature.geometry.coordinates as Position[][]);
        } else if (feature.geometry.type === "MultiPolygon") {
            for (const polygon of feature.geometry
                .coordinates as Position[][][]) {
                out.push(polygon);
            }
        }
    }
    return out;
}

const PLAY_AREA = makeSquareFC(0, 0, 10, 10);
const PLAY_AREA_BBOX: [number, number, number, number] = [0, 0, 10, 10];

interface Scenario {
    name: string;
    required: () => GeoJsonFeatureCollection[];
    excluded: () => GeoJsonFeatureCollection[];
    expectedMaskArea: number;
}

const SCENARIOS: Scenario[] = [
    {
        name: "required-only, single constraint fully inside",
        required: () => [makeSquareFC(3, 3, 7, 7)],
        excluded: () => [],
        expectedMaskArea: 84,
    },
    {
        name: "excluded-only, single constraint",
        required: () => [],
        excluded: () => [makeSquareFC(3, 3, 7, 7)],
        expectedMaskArea: 16,
    },
    {
        name: "band that splits the play area",
        required: () => [makeSquareFC(4, 0, 6, 10)],
        excluded: () => [],
        expectedMaskArea: 80,
    },
    {
        name: "constraint with a hole",
        required: () => [],
        excluded: () => [makeRingWithHoleFC()],
        expectedMaskArea: 32,
    },
    {
        name: "multi-required intersection path",
        required: () => [makeSquareFC(1, 1, 7, 7), makeSquareFC(3, 3, 9, 9)],
        excluded: () => [],
        expectedMaskArea: 84,
    },
    {
        name: "multi-excluded union path",
        required: () => [],
        excluded: () => [makeSquareFC(1, 1, 5, 5), makeSquareFC(5, 5, 9, 9)],
        expectedMaskArea: 32,
    },
];

describe("buildCombinedEligibilityMask GEOS parity vs JS oracle", () => {
    beforeAll(async () => {
        await initGeosWasm();
        const native = require("native-geometry");
        native.bufferWKB = geosWasmBufferWKB;
        native.unaryUnionWKB = geosWasmUnaryUnionWKB;
        native.differenceWKB = geosWasmDifferenceWKB;
        native.unionWKB = geosWasmUnionWKB;
        native.intersectionWKB = geosWasmIntersectionWKB;
    });

    afterAll(() => {
        __setGeometryBackendForTest(null);
    });

    beforeEach(() => {
        clearMaskResultCache();
    });

    SCENARIOS.forEach((scenario) => {
        it(scenario.name, () => {
            // Use fresh feature-collection objects for each backend so
            // maskBuilder's identity-based caches do not reuse the JS result
            // when the GEOS backend runs.
            const jsRequired = scenario.required();
            const jsExcluded = scenario.excluded();

            __setGeometryBackendForTest(jsGeometryBackend);
            const jsResult = buildCombinedEligibilityMask(
                PLAY_AREA,
                jsRequired,
                jsExcluded,
            );

            const geosRequired = scenario.required();
            const geosExcluded = scenario.excluded();

            __setGeometryBackendForTest(geosGeometryBackend);
            const geosResult = buildCombinedEligibilityMask(
                PLAY_AREA,
                geosRequired,
                geosExcluded,
            );

            const jsCoords = maskToCoords(jsResult);
            const geosCoords = maskToCoords(geosResult);
            const jsArea = polygonArea(jsCoords);
            const geosArea = polygonArea(geosCoords);

            if (jsArea > 0) {
                expect(Math.abs(geosArea - jsArea) / jsArea).toBeLessThan(0.01);
            } else {
                expect(geosArea).toBe(0);
            }

            const parity = sampleGridParity(
                jsResult,
                geosResult,
                PLAY_AREA_BBOX,
                11,
            );
            expect(parity).toBeGreaterThanOrEqual(0.95);

            expect(jsArea).toBeCloseTo(scenario.expectedMaskArea, 1);
        });
    });
});

/**
 * GEOS-vs-JS parity guard for the body-of-water measuring pipeline (W3).
 *
 * This is the exact case that broke during the G5 blank-mask incident: the
 * `body-of-water` line category computes a windowed buffer via
 * `computeLineCategory` → `computeLineBuffer` (GEOS `unaryUnion` dissolve +
 * `bufferMeters`) and then feeds the result into `buildCombinedEligibilityMask`
 * (GEOS `difference`). The test runs that full pipeline under both the JS and
 * GEOS backends and asserts ≥95% point-containment parity over a dense grid,
 * so a future divergence in either stage is caught.
 *
 * Runs only under `pnpm test:geos` (`.geos.test.` exclusion); the real GEOS
 * engine is provided by `geos-wasm`.
 */

import type { Feature, Polygon, MultiPolygon } from "geojson";
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
import {
    buildCombinedEligibilityMask,
    clearMaskResultCache,
} from "@/features/map/maskBuilder";
import type {
    GeoJsonFeature,
    GeoJsonFeatureCollection,
} from "@/features/map/geojsonTypes";
import {
    clearLineCategoryCache,
    clearLineDistanceCache,
    clearLineBufferCache,
    computeLineCategory,
    computeLineBuffer,
} from "@/features/questions/measuring/lineMeasuringGeometry";
import {
    __setLineBundleForTest,
    __clearLineBundlesForTest,
    type LineBundle,
} from "@/features/questions/measuring/lineBundleLoader";

// Known regression coordinate: central Tokyo near the Imperial Palace moat,
// which was the repro location for the body-of-water blank-mask incident.
const CENTER: [number, number] = [139.658499, 35.68783];

// 1°×1° window around central Tokyo — large enough to contain the 50 km
// body-of-water buffer window used by the measuring category.
const PLAY_AREA_BBOX: [number, number, number, number] = [
    139.0, 35.0, 140.0, 36.0,
];

// Grid density for parity sampling. 21 steps across 1° gives ~0.05° spacing,
// which is fine enough to catch hole/winding inversions (~441 sample points).
const GRID_STEPS = 21;

// Parity threshold. The backends use different geometry engines (polyclip-JS
// vs GEOS 3.14) so vertex layouts differ near boundaries; 95% agreement on a
// dense grid catches structural regressions without flaking on edge pixels.
const PARITY_THRESHOLD = 0.95;

describe("body-of-water mask parity GEOS vs JS", () => {
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
        clearLineCategoryCache();
        clearLineDistanceCache();
        clearLineBufferCache();
        clearMaskResultCache();
        __clearLineBundlesForTest();
    });

    it("produces equivalent containment under GEOS and JS backends", () => {
        const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
        __setLineBundleForTest("body-of-water", bundle);

        // --- JS path ---
        __setGeometryBackendForTest(jsGeometryBackend);
        const jsCat = computeLineCategory(
            CENTER,
            "body-of-water",
            PLAY_AREA_BBOX,
        );
        expect(jsCat).not.toBeNull();
        const jsBuf = computeLineBuffer(
            jsCat!.windowFeatures,
            jsCat!.distanceMeters,
        );
        expect(jsBuf).not.toBeNull();
        const jsEligibleFC = featureToFC(jsBuf!);
        const jsMask = buildCombinedEligibilityMask(
            makePlayAreaBoundaryFC(PLAY_AREA_BBOX),
            [jsEligibleFC],
            [],
        );

        expect(jsMask.features.length).toBeGreaterThan(0);

        // Clear caches that are keyed by backend-agnostic data
        clearLineBufferCache();
        clearLineCategoryCache();
        clearMaskResultCache();

        // --- GEOS path ---
        __setGeometryBackendForTest(geosGeometryBackend);
        const geosCat = computeLineCategory(
            CENTER,
            "body-of-water",
            PLAY_AREA_BBOX,
        );
        expect(geosCat).not.toBeNull();
        const geosBuf = computeLineBuffer(
            geosCat!.windowFeatures,
            geosCat!.distanceMeters,
        );
        expect(geosBuf).not.toBeNull();
        const geosEligibleFC = featureToFC(geosBuf!);
        const geosMask = buildCombinedEligibilityMask(
            makePlayAreaBoundaryFC(PLAY_AREA_BBOX),
            [geosEligibleFC],
            [],
        );

        expect(geosMask.features.length).toBeGreaterThan(0);

        // --- Containment parity over play-area bbox ---
        const parity = sampleGridParity(
            jsMask,
            geosMask,
            PLAY_AREA_BBOX,
            GRID_STEPS,
        );
        expect(parity).toBeGreaterThanOrEqual(PARITY_THRESHOLD);
    });
});

function makePlayAreaBoundaryFC(
    bbox: [number, number, number, number],
): GeoJsonFeatureCollection {
    const [w, s, e, n] = bbox;
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
                            [w, s],
                            [e, s],
                            [e, n],
                            [w, n],
                            [w, s],
                        ],
                    ],
                },
            },
        ],
    };
}

function featureToFC(
    f: Feature<Polygon | MultiPolygon>,
): GeoJsonFeatureCollection {
    return {
        type: "FeatureCollection",
        features: [f as unknown as GeoJsonFeature],
    };
}

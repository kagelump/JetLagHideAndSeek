/**
 * GEOS-path guard for the body-of-water buffer dissolve (geos-wasm in Jest).
 *
 * `computeLineBuffer` combines many overlapping buffer pieces (dissolved water
 * polygons + river lines) into the measuring eligibility area. Those pieces
 * must be dissolved into clean, non-overlapping geometry before they reach the
 * polyclip-JS play-area mask — otherwise polyclip's sweepline chokes on the
 * mutual overlaps and the render thread hard-locks (the exact bug this guards).
 *
 * The dissolve is a GEOS-native 0-radius buffer; the pure-JS oracle is far too
 * slow on this input (~25 s), so the production path is GEOS. This suite drives
 * the **real** geosGeometryBackend via geos-wasm against the shipped bundle and
 * asserts the dissolve (a) returns, (b) is bounded in time, and (c) spans the
 * whole window — i.e. the union of every piece survived, not one stray buffer.
 *
 * Runs only under `pnpm test:geos` (ESM/`import.meta`); excluded from the
 * default `pnpm test` by the `.geos.test.` ignore pattern.
 */

import type { Feature, MultiPolygon, Polygon } from "geojson";

import {
    initGeosWasm,
    bufferWKB as geosWasmBufferWKB,
    unaryUnionWKB as geosWasmUnaryUnionWKB,
} from "@/shared/geometry/__tests__/helpers/geosWasmShim";
import { geosGeometryBackend } from "@/shared/geometry/geosGeometryBackend";
import { __setGeometryBackendForTest } from "@/shared/geometry/geometryBackend";
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

// Skipped: bundled Japan assets removed; needs pack-based test fixtures.
describe.skip("body-of-water buffer dissolve under GEOS (geos-wasm)", () => {
    beforeAll(async () => {
        await initGeosWasm();
        // Point the native dependency at the wasm shim and force the real
        // GEOS backend. The dissolve path now uses unaryUnionWKB (G5);
        // bufferWKB is still needed for the polygon/line buffering path.
        const native = require("native-geometry");
        native.bufferWKB = geosWasmBufferWKB;
        native.unaryUnionWKB = geosWasmUnaryUnionWKB;
        __setGeometryBackendForTest(geosGeometryBackend);
    });

    afterAll(() => {
        __setGeometryBackendForTest(null);
    });

    beforeEach(() => {
        clearLineCategoryCache();
        clearLineDistanceCache();
        clearLineBufferCache();
        __clearLineBundlesForTest();
    });

    it("dissolves the real body-of-water window into one clean union, bounded", () => {
        const bundle: LineBundle = require("../../../../../assets/measuring/body-of-water.json");
        __setLineBundleForTest("body-of-water", bundle);

        const center: [number, number] = [139.658499, 35.68783];
        const cat = computeLineCategory(
            center,
            "body-of-water",
            [139.0, 35.0, 140.0, 36.0],
        );
        expect(cat).not.toBeNull();

        const t0 = performance.now();
        const buf = computeLineBuffer(cat!.windowFeatures, cat!.distanceMeters);
        const ms = performance.now() - t0;

        expect(buf).not.toBeNull();
        expect(buf!.geometry.type).toMatch(/Polygon/);

        // Boundedness guard: GEOS dissolves this in well under a second on
        // device. The generous ceiling catches a regression to the polyclip /
        // JSTS softlock without flaking on a slower wasm/CI host.
        expect(ms).toBeLessThan(8000);

        // The merged union must span the whole window — water sits across the
        // entire 50 km buffer window, so a correct union covers a broad extent.
        // The original drop-all-but-one bug returned a single stray water
        // body's buffer, spanning a tiny fraction of a degree. Assert the
        // result's bbox spans a large extent in both axes to distinguish them.
        const result = buf as Feature<Polygon | MultiPolygon>;
        const [w, s, e, n] = geomBbox(result.geometry);
        expect(e - w).toBeGreaterThan(0.5); // » a single water body (< 0.1°)
        expect(n - s).toBeGreaterThan(0.5);
    });
});

/** Bounding box [w, s, e, n] of a Polygon/MultiPolygon. */
function geomBbox(
    geom: Polygon | MultiPolygon,
): [number, number, number, number] {
    let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
    const visit = (rings: number[][][]) => {
        for (const ring of rings)
            for (const [x, y] of ring) {
                if (x < w) w = x;
                if (x > e) e = x;
                if (y < s) s = y;
                if (y > n) n = y;
            }
    };
    if (geom.type === "Polygon") visit(geom.coordinates);
    else for (const poly of geom.coordinates) visit(poly);
    return [w, s, e, n];
}

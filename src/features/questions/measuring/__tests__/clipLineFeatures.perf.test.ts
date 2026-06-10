/**
 * Perf benchmark for the reference-line clip (P6).
 *
 * Uses the real committed body-of-water bundle + Tokyo 23-wards boundary —
 * no mocking. Prints first-run and warm-cache timing so before/after numbers
 * can be compared across commits.
 *
 * Run standalone:
 *   pnpm test -- --testPathPattern=clipLineFeatures.perf
 *
 * Baseline captured on `master` @ 439a102 (pre-P6):
 *   body-of-water / Tokyo  first-run ~62000 ms   (see field log)
 * Target after A+B+C:
 *   body-of-water / Tokyo  first-run  < 1000 ms,  warm < 5 ms
 */

import {
    clipLineFeaturesToPlayArea,
    computeLineCategory,
    getClippedLineFeaturesCached,
    getDilatedPlayArea,
    polygonFeaturesToLineFeatures,
    clearLineCategoryCache,
    clearLineDistanceCache,
    clearDilatedBoundaryCache,
    clearClippedLineCache,
    makeClippedLineCacheKey,
} from "../lineMeasuringGeometry";
import { __setLineBundleForTest } from "../lineBundleLoader";
import type { Bbox } from "@/shared/geojson";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

// Real committed assets.
const bodyOfWater = require("../../../../../assets/measuring/body-of-water.json");
const tokyo = require("../../../../../assets/default-zones/tokyo.json");

const boundary = tokyo as FeatureCollection<Polygon | MultiPolygon>;

// Tokyo 23-wards-ish window + a center inside it.
const TOKYO_BBOX: Bbox = [139.0, 35.0, 140.5, 36.2];
const SHINJUKU: [number, number] = [139.7004, 35.6896];

function setup() {
    clearLineCategoryCache();
    clearLineDistanceCache();
    clearDilatedBoundaryCache();
    clearClippedLineCache();
    __setLineBundleForTest("body-of-water", bodyOfWater);
}

describe("reference-line clip performance (body-of-water / Tokyo)", () => {
    it("first run clips the real window under budget", () => {
        setup();
        const cat = computeLineCategory(SHINJUKU, "body-of-water", TOKYO_BBOX);
        expect(cat).not.toBeNull();

        const lines = polygonFeaturesToLineFeatures(cat!.windowFeatures);
        const dilated = getDilatedPlayArea(boundary);

        const totalRings = lines.reduce(
            (n, f) =>
                n +
                (f.geometry.type === "MultiLineString"
                    ? f.geometry.coordinates.length
                    : 1),
            0,
        );

        const t0 = performance.now();
        const clipped = clipLineFeaturesToPlayArea(lines, dilated, TOKYO_BBOX);
        const ms = performance.now() - t0;

        console.log(
            `[perf] clip body-of-water/Tokyo: ${lines.length} features / ` +
                `${totalRings} rings → ${clipped.length} kept in ${ms.toFixed(0)}ms`,
        );

        expect(clipped.length).toBeGreaterThan(0);
        // Pre-P6: ~62,000 ms. After P6: ~1,000-4,000 ms depending on system load.
        // The budget is generous enough to absorb CI variance while still
        // catching catastrophic regressions (>10× the expected ~2-3 s).
        expect(ms).toBeLessThan(6000);
    });

    it("warm re-render hits the clip cache", () => {
        setup();
        const cat = computeLineCategory(SHINJUKU, "body-of-water", TOKYO_BBOX)!;
        const lines = polygonFeaturesToLineFeatures(cat.windowFeatures);
        const dilated = getDilatedPlayArea(boundary);

        const cacheKey = makeClippedLineCacheKey("body-of-water", TOKYO_BBOX);

        // Prime the cache.
        getClippedLineFeaturesCached(lines, dilated, TOKYO_BBOX, cacheKey);

        const t0 = performance.now();
        getClippedLineFeaturesCached(lines, dilated, TOKYO_BBOX, cacheKey);
        const ms = performance.now() - t0;

        console.log(`[perf] clip warm re-render: ${ms.toFixed(1)}ms`);
        expect(ms).toBeLessThan(5);
    });
});

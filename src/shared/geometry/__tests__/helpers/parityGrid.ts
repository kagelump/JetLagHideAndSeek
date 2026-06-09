/**
 * Shared parity-grid helpers for GEOS-vs-JS geometry tests.
 *
 * Samples a regular grid over a bbox and compares point-in-mask containment
 * between two GeoJSON FeatureCollections. Used by `maskBuilder.geos.test.ts`
 * and `bodyWaterMask.geos.test.ts` to catch structural regressions (winding
 * inversions, hole handling, disjoint-member mismatches) that absolute area
 * parity can miss.
 */

import type {
    GeoJsonFeatureCollection,
    Position,
} from "@/features/map/geojsonTypes";

/**
 * Even-odd point-in-polygon test that respects GeoJSON ring order:
 * - Ring 0 is the exterior ring (points inside are in the polygon).
 * - Rings 1+ are interior rings / holes (points inside are outside).
 *
 * For a MultiPolygon member, each polygon's rings are evaluated independently
 * and the polygon contains the point only if the point is inside the exterior
 * ring and outside every hole.
 */
export function pointInPolygon(point: Position, rings: Position[][]): boolean {
    const [x, y] = point;
    let insideExterior = false;
    for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        let insideRing = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if (
                yi > y !== yj > y &&
                x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
            ) {
                insideRing = !insideRing;
            }
        }
        if (r === 0) {
            insideExterior = insideRing;
        } else if (insideRing) {
            // Point is inside a hole → not in the polygon.
            return false;
        }
    }
    return insideExterior;
}

/**
 * Test whether `point` lies inside any polygon/multi-polygon of `maskFC`,
 * treating interior rings as holes.
 */
export function pointInMask(
    point: Position,
    maskFC: GeoJsonFeatureCollection,
): boolean {
    for (const feature of maskFC.features) {
        const { type, coordinates } = feature.geometry;
        if (type === "Polygon") {
            if (pointInPolygon(point, coordinates as Position[][])) {
                return true;
            }
        } else if (type === "MultiPolygon") {
            for (const polygon of coordinates as Position[][][]) {
                if (pointInPolygon(point, polygon)) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Sample a regular `steps`×`steps` grid over `bbox` and return the fraction of
 * points where `pointInMask` agrees between `jsMask` and `geosMask`.
 */
export function sampleGridParity(
    jsMask: GeoJsonFeatureCollection,
    geosMask: GeoJsonFeatureCollection,
    bbox: [number, number, number, number],
    steps: number,
): number {
    if (steps < 2) {
        throw new Error("sampleGridParity requires steps >= 2");
    }
    const [w, s, e, n] = bbox;
    let matched = 0;
    const total = steps * steps;
    for (let ix = 0; ix < steps; ix++) {
        const x = w + ((e - w) * ix) / (steps - 1);
        for (let iy = 0; iy < steps; iy++) {
            const y = s + ((n - s) * iy) / (steps - 1);
            const jsInside = pointInMask([x, y], jsMask);
            const geosInside = pointInMask([x, y], geosMask);
            if (jsInside === geosInside) {
                matched++;
            }
        }
    }
    return matched / total;
}

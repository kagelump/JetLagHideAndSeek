/**
 * Point-in-polygon utilities using the ray-crossing (even-odd) algorithm.
 *
 * These are pure-math, zero-dependency functions suitable for both the JS
 * thread and worklet contexts.  For GeoJSON Feature-based checks at higher
 * call sites, use `@turf/boolean-point-in-polygon` which handles edge cases
 * around the antimeridian — this module is for the tight inner loop of the
 * admin-boundary spatial index where we already have raw coordinate arrays.
 */

/** A coordinate pair as [longitude, latitude]. */
type Position = [number, number];

/**
 * Ray-crossing test for a single polygon ring.
 * Returns true when a horizontal ray from `(px, py)` crosses the ring an
 * odd number of times.
 */
function pointInRing(px: number, py: number, ring: Position[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        ) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * Point-in-polygon with hole support.
 *
 * `rings[0]` is the exterior ring; `rings[1..]` are holes.  A point is
 * inside the polygon when it is inside the exterior ring AND outside every
 * hole.
 */
export function pointInPolygon(
    px: number,
    py: number,
    rings: Position[][],
): boolean {
    if (!pointInRing(px, py, rings[0])) return false;
    for (let h = 1; h < rings.length; h++) {
        if (pointInRing(px, py, rings[h])) return false;
    }
    return true;
}

/**
 * Point-in-multipolygon.
 *
 * The point is inside the MultiPolygon when it is inside any of its
 * constituent polygons (respecting holes).
 */
export function pointInMultiPolygon(
    px: number,
    py: number,
    polygons: Position[][][],
): boolean {
    for (const rings of polygons) {
        if (pointInPolygon(px, py, rings)) return true;
    }
    return false;
}

/**
 * GeoJSON-aware wrapper: accepts a Polygon or MultiPolygon `coordinates`
 * array and returns whether the point falls inside the geometry.
 *
 * ```ts
 * // Polygon
 * pointInGeometry(lon, lat, { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] })
 * // MultiPolygon
 * pointInGeometry(lon, lat, { type: "MultiPolygon", coordinates: [[[[0,0],[1,0],[1,1],[0,1],[0,0]]]] })
 * ```
 */
export function pointInGeometry(
    px: number,
    py: number,
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: any },
): boolean {
    if (geometry.type === "Polygon") {
        return pointInPolygon(px, py, geometry.coordinates as Position[][]);
    }
    if (geometry.type === "MultiPolygon") {
        return pointInMultiPolygon(
            px,
            py,
            geometry.coordinates as Position[][][],
        );
    }
    return false;
}

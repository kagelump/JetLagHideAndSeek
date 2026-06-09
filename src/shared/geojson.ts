import type {
    Feature,
    GeoJsonProperties,
    MultiPolygon,
    Polygon,
} from "geojson";

import { getGeometryBackend } from "@/shared/geometry/geometryBackend";
import { EARTH_RADIUS_METERS } from "@/shared/geometry/earthRadius";

export type Position = [number, number];

export type Bbox = [number, number, number, number];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Union an array of Polygon features using the active geometry backend.
 *
 * Returns null when the union produces an empty result (e.g. identical input
 * polygons that cancel out).
 */
export function unionPolygons<P extends GeoJsonProperties = GeoJsonProperties>(
    polygons: Feature<Polygon, P>[],
    properties?: P,
): Feature<Polygon | MultiPolygon, P> | null {
    if (polygons.length === 0) return null;

    const backend = getGeometryBackend();

    // Reduce: union(a, union(b, union(c, ...)))
    let result = polygons[0] as Feature<Polygon | MultiPolygon, P>;
    for (let i = 1; i < polygons.length; i++) {
        const next = backend.union(
            result as Feature<Polygon | MultiPolygon>,
            polygons[i] as Feature<Polygon | MultiPolygon>,
        );
        if (!next) return null; // empty result midway
        result = next as Feature<Polygon | MultiPolygon, P>;
    }

    // Apply caller's properties (preserving the geometry from the union).
    if (properties !== undefined) {
        result = { ...result, properties: { ...properties } as P };
    }

    return result;
}

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
    const [aWest, aSouth, aEast, aNorth] = a;
    const [bWest, bSouth, bEast, bNorth] = b;
    return !(
        aEast < bWest ||
        bEast < aWest ||
        aNorth < bSouth ||
        bNorth < aSouth
    );
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/**
 * Mean Earth radius in meters (WGS-84 / IUGG). Defined in a leaf module and
 * re-exported here so existing `@/shared/geojson` importers are unaffected,
 * while `bufferProjection` imports it from the leaf to avoid a require cycle
 * (see `earthRadius.ts`).
 */
export { EARTH_RADIUS_METERS };

/**
 * Haversine great-circle distance between two lat/lon points (in meters).
 * Coordinates are (lon, lat) to match GeoJSON order.
 */
export function haversineDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
): number {
    const phi1 = toRadians(lat1);
    const phi2 = toRadians(lat2);
    const deltaPhi = toRadians(lat2 - lat1);
    const deltaLambda = toRadians(lon2 - lon1);
    const haversine =
        Math.sin(deltaPhi / 2) ** 2 +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
    return (
        2 *
        EARTH_RADIUS_METERS *
        Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
}

function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

/**
 * Exact equality of two positions. Use for detecting pin-drag movement
 * (not for proximity — see {@link haversineDistanceMeters}).
 */
export function positionsEqual(a: Position, b: Position): boolean {
    return a[0] === b[0] && a[1] === b[1];
}

// ---------------------------------------------------------------------------
// Position offset
// ---------------------------------------------------------------------------

/**
 * Offset a WGS-84 position by a distance and bearing using the haversine formula.
 * @param position — [longitude, latitude]
 * @param distanceMeters — distance to travel
 * @param bearingDegrees — bearing in degrees clockwise from north
 * @returns new [longitude, latitude]
 */
export function offsetPosition(
    position: Position,
    distanceMeters: number,
    bearingDegrees: number,
): Position {
    const [lon, lat] = position;
    const R = 6371000; // Earth's radius in meters
    const d = distanceMeters / R;
    const bearing = (bearingDegrees * Math.PI) / 180;

    const lat1 = (lat * Math.PI) / 180;
    const lon1 = (lon * Math.PI) / 180;

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) +
            Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const lon2 =
        lon1 +
        Math.atan2(
            Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
            Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
        );

    return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

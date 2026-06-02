import { union as polyUnion, type Geom } from "polyclip-ts";
import type {
    Feature,
    GeoJsonProperties,
    MultiPolygon,
    Polygon,
} from "geojson";

export type Position = [number, number];

export type Bbox = [number, number, number, number];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Union an array of Polygon features using polyclip-ts directly.
 *
 * This replaces the pattern of constructing a temporary FeatureCollection and
 * calling @turf/union (which internally just extracts coordinates, calls
 * polyclip-ts, and wraps the result back into GeoJSON).
 *
 * Returns null when the union produces an empty result (e.g. identical input
 * polygons that cancel out).
 */
export function unionPolygons<P extends GeoJsonProperties = GeoJsonProperties>(
    polygons: Feature<Polygon, P>[],
    properties?: P,
): Feature<Polygon | MultiPolygon, P> | null {
    const coords: Geom[] = polygons.map((p) => p.geometry.coordinates as Geom);
    const result = polyUnion(coords[0], ...coords.slice(1));
    if (result.length === 0) return null;
    if (result.length === 1) {
        return {
            type: "Feature",
            properties: (properties ?? {}) as P,
            geometry: { type: "Polygon", coordinates: result[0] },
        };
    }
    return {
        type: "Feature",
        properties: (properties ?? {}) as P,
        geometry: { type: "MultiPolygon", coordinates: result },
    };
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

/** Mean Earth radius in meters (WGS-84 / IUGG). */
export const EARTH_RADIUS_METERS = 6_371_008.8;

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

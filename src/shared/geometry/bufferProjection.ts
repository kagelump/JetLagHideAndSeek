/**
 * Per-feature azimuthal-equidistant projection adapter.
 *
 * Replicates `@turf/buffer`'s internal projection exactly so the GEOS backend
 * produces buffers indistinguishable from the JS oracle. Turf v7.3.5 uses:
 *
 *   geoAzimuthalEquidistant()
 *     .rotate([-cx, -cy])       // center on feature centroid
 *     .scale(earthRadius)        // 6371008.8 m
 *
 * The native `bufferWKB` operates in input units, so we project WGS84
 * coordinates to planar meters before encoding, and unproject the GEOS
 * result back to WGS84 after decoding.
 */

import { geoAzimuthalEquidistant } from "d3-geo";
import turfCenter from "@turf/center";
import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPoint,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";
import type { GeoProjection } from "d3-geo";

import { EARTH_RADIUS_METERS } from "@/shared/geojson";

// ---- Constants -------------------------------------------------------------

/** Mean Earth radius in meters — matches @turf/buffer exactly. */
export const EARTH_RADIUS = EARTH_RADIUS_METERS;

// ---- Projection factory ----------------------------------------------------

/**
 * Build an AEQD projection centered on the given geometry's centroid,
 * matching turf's internal projection parameters exactly.
 */
export function projectionFor(
    geom: Feature | { type: string; coordinates: unknown },
): GeoProjection {
    // @turf/center accepts any GeoJSON and returns Feature<Point>.
    const center: Feature<Point> = turfCenter(geom as any);
    const [cx, cy] = center.geometry.coordinates; // [lon, lat]

    return geoAzimuthalEquidistant().rotate([-cx, -cy]).scale(EARTH_RADIUS);
}

// ---- Coordinate projection -------------------------------------------------

/** Project a single [lon, lat] pair through the AEQD projection. */
function projectCoord(
    coord: [number, number],
    proj: GeoProjection,
): [number, number] {
    const result = proj(coord);
    if (!result) {
        throw new Error(
            `[bufferProjection] projection returned null for ${coord}`,
        );
    }
    return result;
}

/** Unproject a single [x, y] pair back to [lon, lat]. */
function unprojectCoord(
    coord: [number, number],
    proj: GeoProjection,
): [number, number] {
    const result = proj.invert?.(coord);
    if (!result) {
        throw new Error(`[bufferProjection] invert returned null for ${coord}`);
    }
    return result;
}

// ---- Public helpers --------------------------------------------------------

/**
 * Deep-clone a GeoJSON geometry with all coordinates projected through the
 * AEQD projection (WGS84 → planar meters).
 *
 * Accepts all geometry types that the GEOS buffer path may encounter:
 * LineString, MultiLineString, Polygon, MultiPolygon, MultiPoint.
 */
export function projectGeometry<
    G extends
        | LineString
        | MultiLineString
        | Polygon
        | MultiPolygon
        | MultiPoint,
>(geometry: G, proj: GeoProjection): G {
    const projCoord = (c: [number, number]) => projectCoord(c, proj);

    switch (geometry.type) {
        case "MultiPoint":
        case "LineString":
            return {
                ...geometry,
                coordinates: (geometry.coordinates as [number, number][]).map(
                    projCoord,
                ),
            } as G;

        case "MultiLineString":
        case "Polygon":
            return {
                ...geometry,
                coordinates: (geometry.coordinates as [number, number][][]).map(
                    (ring) => ring.map(projCoord),
                ),
            } as G;

        case "MultiPolygon":
            return {
                ...geometry,
                coordinates: (
                    geometry.coordinates as [number, number][][][]
                ).map((polygon) => polygon.map((ring) => ring.map(projCoord))),
            } as G;

        default:
            throw new Error(
                `[bufferProjection] unsupported geometry type for projection: ${(geometry as { type: string }).type}`,
            );
    }
}

/**
 * Deep-clone a GeoJSON geometry with all coordinates unprojected from planar
 * meters back to WGS84.
 */
export function unprojectGeometry<G extends Polygon | MultiPolygon>(
    geometry: G,
    proj: GeoProjection,
): G {
    if (geometry.type === "Polygon") {
        return {
            ...geometry,
            coordinates: geometry.coordinates.map((ring) =>
                ring.map((c) => unprojectCoord(c as [number, number], proj)),
            ),
        } as G;
    }

    // MultiPolygon
    return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) =>
            polygon.map((ring) =>
                ring.map((c) => unprojectCoord(c as [number, number], proj)),
            ),
        ),
    } as G;
}

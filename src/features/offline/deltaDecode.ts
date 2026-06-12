/**
 * TypeScript port of the delta-encoded boundary polygon decoder.
 *
 * Format (length-prefixed rings, per the T6 design resolution):
 *   MultiPolygon = [polyCount, ...Polygon]
 *   Polygon = [ringCount, ...Ring]
 *   Ring = [ringLen, x0, y0, dx1, dy1, ...]
 *
 * All coordinates are on a 1e-5 degree integer grid.
 *
 * Must match the pipeline reference encoder in
 * data/packs/scripts/lib/deltaEncode.mjs byte-for-byte.
 */

const SCALE = 100_000; // 1e-5 degree integer grid

/** GeoJSON Position type. */
type Position = [number, number];

/** Decoded ring = array of [lon, lat] positions. */
type Ring = Position[];

/** Decoded polygon = array of rings (first is outer). */
type Polygon = Ring[];

/** Decoded multipolygon = array of polygons. */
export type MultiPolygonCoords = Polygon[];

/**
 * Decode a delta-encoded ring to GeoJSON coordinates.
 * Consumes `ringLen` values from `arr` starting at `offset`.
 * Returns the decoded ring and the next offset.
 */
function decodeRing(
    arr: number[],
    offset: number,
): { ring: Ring; next: number } {
    const ringLen = arr[offset];
    const half = (ringLen - 2) / 2;
    const ring: Ring = [];

    let x = arr[offset + 1];
    let y = arr[offset + 2];
    ring.push([x / SCALE, y / SCALE]);

    for (let i = 0; i < half; i++) {
        x += arr[offset + 3 + i * 2];
        y += arr[offset + 4 + i * 2];
        ring.push([x / SCALE, y / SCALE]);
    }

    return { ring, next: offset + 1 + ringLen };
}

/**
 * Decode a delta-encoded multi-polygon flat array to GeoJSON
 * MultiPolygon coordinates.
 *
 * The flat array structure:
 *   [polyCount, ...Polygon] where each Polygon is [ringCount, ...Ring]
 */
export function decodeDeltaPolygon(encoded: number[]): MultiPolygonCoords {
    if (!encoded || encoded.length === 0) {
        return [];
    }

    let offset = 0;
    const polyCount = encoded[offset++];

    const result: MultiPolygonCoords = [];

    for (let pi = 0; pi < polyCount; pi++) {
        const ringCount = encoded[offset++];
        const polygon: Polygon = [];

        for (let ri = 0; ri < ringCount; ri++) {
            const { ring, next } = decodeRing(encoded, offset);
            polygon.push(ring);
            offset = next;
        }

        result.push(polygon);
    }

    return result;
}

/**
 * Convert decoded MultiPolygon coordinates to a GeoJSON
 * MultiPolygon geometry object.
 */
export function multiPolygonCoordsToGeoJSON(coords: MultiPolygonCoords): {
    type: "MultiPolygon";
    coordinates: Position[][][];
} {
    return {
        type: "MultiPolygon" as const,
        coordinates: coords as Position[][][],
    };
}

/**
 * Compute a GeoJSON bbox from MultiPolygon coordinates.
 */
export function computeMultiPolygonBbox(
    coords: MultiPolygonCoords,
): [number, number, number, number] {
    let west = Infinity,
        south = Infinity,
        east = -Infinity,
        north = -Infinity;
    for (const poly of coords) {
        for (const ring of poly) {
            for (const [lon, lat] of ring) {
                if (lon < west) west = lon;
                if (lon > east) east = lon;
                if (lat < south) south = lat;
                if (lat > north) north = lat;
            }
        }
    }
    return [west, south, east, north];
}

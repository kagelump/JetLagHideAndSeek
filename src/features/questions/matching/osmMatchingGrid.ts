/**
 * Deterministic bbox grid system for OSM matching spatial cache.
 *
 * The world is divided into fixed-size cells (CELL_DEGREES on each side).
 * Each lat/lon point maps to exactly one cell via a stable string index.
 * A circular search region maps to the set of cells whose bboxes intersect
 * the search disk's bounding square.
 *
 * @module
 */

/** Cell size in degrees (~11 km at equator, ~9.5 km at 35°N). */
export const CELL_DEGREES = 0.1;

/** Approximate meters per degree of latitude. */
const METERS_PER_DEG_LAT = 111_320;

/**
 * Converts a (lat, lon) coordinate pair to a deterministic cell index string.
 *
 * The index is stable across runs and platforms so that the same location
 * always produces the same cache key.
 */
export function cellIndex(lat: number, lon: number): string {
    const x = Math.floor(lon / CELL_DEGREES);
    const y = Math.floor(lat / CELL_DEGREES);
    return `${x}:${y}`;
}

export type CellBbox = {
    south: number;
    west: number;
    north: number;
    east: number;
};

/**
 * Returns the geographic bounding box for a cell index string (e.g. "1397:356").
 * Throws if the index is malformed.
 */
export function cellBbox(cellId: string): CellBbox {
    const sep = cellId.indexOf(":");
    if (sep === -1) {
        throw new Error(`Invalid cell index: "${cellId}"`);
    }
    const x = Number.parseInt(cellId.slice(0, sep), 10);
    const y = Number.parseInt(cellId.slice(sep + 1), 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Invalid cell index: "${cellId}"`);
    }
    const west = x * CELL_DEGREES;
    const south = y * CELL_DEGREES;
    return {
        south,
        west,
        north: south + CELL_DEGREES,
        east: west + CELL_DEGREES,
    };
}

/** Converts a CellBbox to a numeric tuple [west, south, east, north]. */
export function cellBboxToTuple(
    bbox: CellBbox,
): [number, number, number, number] {
    return [bbox.west, bbox.south, bbox.east, bbox.north];
}

/** Converts a distance in meters to an approximate span in degrees of latitude. */
export function metersToDegreesLat(meters: number): number {
    return meters / METERS_PER_DEG_LAT;
}

/**
 * Converts a distance in meters to an approximate span in degrees of longitude
 * at the given latitude (accounts for the meridian convergence).
 */
export function metersToDegreesLon(lat: number, meters: number): number {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    // Guard against division by near-zero at extremely high latitudes.
    const effective = Math.max(cosLat, 0.01);
    return meters / (METERS_PER_DEG_LAT * effective);
}

/**
 * Returns all cell indices that intersect the bounding square of a search
 * circle centered at (lat, lon) with the given radius in meters.
 *
 * The union of the returned cells' bboxes is guaranteed to cover the entire
 * search disk (plus some overshoot at the edges). After merging, a local
 * distance filter ensures correctness.
 */
export function cellsForSearch(
    lat: number,
    lon: number,
    radiusMeters: number,
): string[] {
    const dLat = metersToDegreesLat(radiusMeters);
    const dLon = metersToDegreesLon(lat, radiusMeters);

    const minLat = lat - dLat;
    const maxLat = lat + dLat;
    const minLon = lon - dLon;
    const maxLon = lon + dLon;

    const minX = Math.floor(minLon / CELL_DEGREES);
    const maxX = Math.floor(maxLon / CELL_DEGREES);
    const minY = Math.floor(minLat / CELL_DEGREES);
    const maxY = Math.floor(maxLat / CELL_DEGREES);

    const cells: string[] = [];
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            cells.push(`${x}:${y}`);
        }
    }
    return cells;
}

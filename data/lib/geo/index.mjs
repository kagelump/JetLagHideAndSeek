/**
 * Shared geometry primitives for data pipeline ESM modules.
 *
 * These are the canonical implementations. Pipeline-specific modules
 * should import from here rather than defining their own copies.
 *
 * @module geo
 */

/**
 * Great-circle distance in kilometers between two [lon, lat] points.
 * Uses the Haversine formula.
 *
 * @param {[number, number]} a - [longitude, latitude] of point A
 * @param {[number, number]} b - [longitude, latitude] of point B
 * @returns {number} distance in kilometers
 */
export function haversineKm(a, b) {
    const R = 6371; // Earth's mean radius in km
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h =
        sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Compute a bounding box `[west, south, east, north]` from a coordinate array.
 * Handles nested arrays (e.g., MultiLineString, Polygon rings).
 *
 * @param {number[][] | number[][][]} coords - array of [lon, lat] pairs
 * @returns {[number, number, number, number]} bbox
 */
export function computeBbox(coords) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walk = (c) => {
        if (typeof c[0] === "number") {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
        } else c.forEach(walk);
    };
    walk(coords);
    return [minX, minY, maxX, maxY];
}

/**
 * Returns true when two bboxes intersect (inclusive).
 * Bboxes are [west, south, east, north].
 *
 * @param {[number, number, number, number]} a
 * @param {[number, number, number, number]} b
 * @returns {boolean}
 */
export function bboxesIntersect(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Expand a bbox by `deg` degrees on each side.
 *
 * @param {[number, number, number, number]} bbox - [west, south, east, north]
 * @param {number} deg - degrees to add on each side
 * @returns {[number, number, number, number]} padded bbox
 */
export function padBbox(bbox, deg) {
    return [bbox[0] - deg, bbox[1] - deg, bbox[2] + deg, bbox[3] + deg];
}

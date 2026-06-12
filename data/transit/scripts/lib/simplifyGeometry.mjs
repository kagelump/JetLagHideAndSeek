/**
 * Planar Douglas–Peucker simplification for GeoJSON MultiLineString
 * geometries.  Tolerance is given in meters and converted to an
 * approximate degree value using the standard 111320 m/deg.
 */

const METERS_PER_DEGREE = 111320;

/**
 * Compute the perpendicular distance (in degrees) from point p to the
 * segment a-b in planar lon/lat space.
 *
 * @param {number[]} p - [lon, lat]
 * @param {number[]} a - [lon, lat]
 * @param {number[]} b - [lon, lat]
 * @returns {number}
 */
function perpendicularDistanceDegrees(p, a, b) {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
        const d0 = px - ax;
        const d1 = py - ay;
        return Math.sqrt(d0 * d0 + d1 * d1);
    }

    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = ax + t * dx;
    const projY = ay + t * dy;

    const dx0 = px - projX;
    const dy0 = py - projY;
    return Math.sqrt(dx0 * dx0 + dy0 * dy0);
}

/**
 * Douglas–Peucker recursive simplification.
 *
 * @param {number[][]} coords - ordered [lon, lat] points
 * @param {number} toleranceDegrees
 * @returns {number[][]}
 */
function rdpSimplify(coords, toleranceDegrees) {
    if (coords.length <= 2) return coords;

    const first = coords[0];
    const last = coords[coords.length - 1];

    let maxDist = -1;
    let index = -1;
    for (let i = 1; i < coords.length - 1; i++) {
        const d = perpendicularDistanceDegrees(coords[i], first, last);
        if (d > maxDist) {
            maxDist = d;
            index = i;
        }
    }

    if (maxDist > toleranceDegrees) {
        const left = rdpSimplify(coords.slice(0, index + 1), toleranceDegrees);
        const right = rdpSimplify(coords.slice(index), toleranceDegrees);
        // Avoid duplicating the shared peak point.
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
}

/**
 * Simplify a GeoJSON MultiLineString geometry with a planar RDP pass.
 *
 * - Tolerance is supplied in meters.
 * - Each LineString segment is simplified independently.
 * - Segments that collapse to fewer than two points are dropped.
 *
 * @param {{type: "MultiLineString", coordinates: number[][][]}} geometry
 * @param {number} meters - tolerance in meters; <=0 returns the geometry unchanged
 * @returns {{type: "MultiLineString", coordinates: number[][][]}}
 */
export function simplifyGeometry(geometry, meters) {
    if (!geometry || geometry.type !== "MultiLineString" || !Array.isArray(geometry.coordinates)) {
        return geometry;
    }
    if (!Number.isFinite(meters) || meters <= 0) {
        return geometry;
    }

    const toleranceDegrees = meters / METERS_PER_DEGREE;
    const simplified = [];
    for (const segment of geometry.coordinates) {
        if (!Array.isArray(segment) || segment.length < 2) continue;
        const reduced = rdpSimplify(segment, toleranceDegrees);
        if (reduced.length >= 2) {
            simplified.push(reduced);
        }
    }

    return { type: "MultiLineString", coordinates: simplified };
}

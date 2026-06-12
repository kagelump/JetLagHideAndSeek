/**
 * Geometry cleanup and simplification helpers for measuring bundles.
 *
 * Coordinates: clean consecutive duplicates, simplify with RDP,
 * convert polygons to outer-ring LineStrings, compute bboxes.
 *
 * @module geometryCleanup
 */

import { haversineMeters } from "./lineStitching.mjs";

// ─── Coordinate cleaning ────────────────────────────────────────────────────

/**
 * Strips consecutive duplicate coordinates from an array. Zero-length segments
 * cause a division-by-zero inside @turf/nearest-point-on-line's
 * nearestPointOnSegment → NaN → point([NaN, NaN]) throws.
 */
export function cleanCoordsInline(coords) {
    if (coords.length < 2) return coords;
    const out = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        if (prev[0] !== curr[0] || prev[1] !== curr[1]) out.push(curr);
    }
    return out;
}

/** Counts consecutive duplicate coordinate pairs across all features. */
export function countDupPairs(features) {
    let count = 0;
    const check = (coords) => {
        for (let i = 0; i < coords.length - 1; i++) {
            if (
                coords[i][0] === coords[i + 1][0] &&
                coords[i][1] === coords[i + 1][1]
            ) {
                count++;
            }
        }
    };
    for (const f of features) {
        const g = f.geometry;
        if (g.type === "LineString") {
            check(g.coordinates);
        } else if (g.type === "MultiLineString") {
            for (const seg of g.coordinates) check(seg);
        }
    }
    return count;
}

// ─── Geometry conversion (polygon → outer-ring LineString) ──────────────────

export function featureToLineStrings(feature) {
    const { type, coordinates } = feature.geometry;
    if (type === "LineString" || type === "MultiLineString") return [feature];

    // Extract OSM relation ID (osmium exports it as properties["@id"] when
    // -a type,id is used). Pass it through so bundle features carry a stable
    // relationId that can be used for per-prefecture filtering at runtime.
    const relationId =
        feature.properties?.["@id"] != null
            ? Number(feature.properties["@id"])
            : undefined;

    const props = relationId !== undefined ? { relationId } : {};

    const lines = [];
    const pushRing = (ring) => {
        if (ring.length < 4) return; // skip degenerate rings
        lines.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: ring },
            properties: { ...props },
        });
    };

    // Outer ring is coordinates[0]; holes (coordinates[1..]) are skipped.
    if (type === "Polygon") {
        pushRing(coordinates[0]);
    } else if (type === "MultiPolygon") {
        for (const poly of coordinates) pushRing(poly[0]);
    }
    return lines;
}

// ─── Bbox computation ────────────────────────────────────────────────────────

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

// ─── Polygon helpers (for polygon-dissolve mode) ────────────────────────────

/**
 * Computes a bbox for Polygon / MultiPolygon geometry, walking all rings.
 */
export function computePolygonBbox(geom) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walkRing = (ring) => {
        for (const c of ring) {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
        }
    };
    if (geom.type === "Polygon") {
        for (const ring of geom.coordinates) walkRing(ring);
    } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
            for (const ring of poly) walkRing(ring);
        }
    }
    return [minX, minY, maxX, maxY];
}

/**
 * Great-circle perimeter of a polygon ring in meters.
 */
function ringPerimeterMeters(ring) {
    let total = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        total += haversineMeters(ring[i], ring[i + 1]);
    }
    return total;
}

/**
 * Total perimeter of a Polygon or MultiPolygon (outer ring + holes) in meters.
 * Used for the min-feature-length filter before dissolve.
 */
export function polygonPerimeterMeters(geom) {
    let total = 0;
    if (geom.type === "Polygon") {
        for (const ring of geom.coordinates) {
            total += ringPerimeterMeters(ring);
        }
    } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
            for (const ring of poly) total += ringPerimeterMeters(ring);
        }
    }
    return total;
}

/**
 * Strips consecutive duplicate coordinates from a single ring. Returns the
 * cleaned ring (may be shorter). Rings that collapse to < 3 coords are
 * returned as-is (caller should filter them out).
 */
export function cleanRingCoords(ring) {
    if (ring.length < 3) return ring;
    const out = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
        const prev = ring[i - 1];
        const curr = ring[i];
        if (prev[0] !== curr[0] || prev[1] !== curr[1]) out.push(curr);
    }
    return out;
}

/**
 * Cleans consecutive duplicate coordinates from all rings of a Polygon or
 * MultiPolygon. Drops rings that collapse to < 3 coords. Returns null if
 * the geometry degenerates (all rings collapsed).
 */
export function cleanPolygonFeature(feature) {
    const geom = feature.geometry;
    if (geom.type === "Polygon") {
        const cleaned = geom.coordinates.map(cleanRingCoords).filter(
            (r) =>
                r.length >= 4 &&
                r[0][0] === r[r.length - 1][0] &&
                r[0][1] === r[r.length - 1][1]
                    ? r
                    : r.length >= 3, // non-closed rings are valid in some OSM data
        );
        if (cleaned.length === 0) return null;
        return {
            ...feature,
            geometry: { type: "Polygon", coordinates: cleaned },
        };
    } else if (geom.type === "MultiPolygon") {
        const cleaned = geom.coordinates
            .map((poly) =>
                poly.map(cleanRingCoords).filter((r) => r.length >= 3),
            )
            .filter((poly) => poly.length > 0 && poly[0].length >= 3);
        if (cleaned.length === 0) return null;
        return {
            ...feature,
            geometry: { type: "MultiPolygon", coordinates: cleaned },
        };
    }
    return feature;
}

/**
 * Simplifies each ring of a Polygon or MultiPolygon using RDP with a
 * collapse-fallback so thin polygons are never silently dropped.
 *
 * For each ring:
 * 1. Simplify at `tolerance`. If the result has ≥ 4 coords, keep it.
 * 2. If it collapsed, retry at `tolerance / 4`.
 * 3. If still collapsed, return the cleaned (de-duped) unsimplified ring.
 * 4. Only drop rings whose *source* genuinely has < 4 unique coords.
 *
 * Returns null when every ring degenerates.
 */
export function simplifyPolygonFeature(feature, tolerance) {
    const simplifyRing = (ring, tol) => {
        const simplified = simplifyCoords(ring, tol);
        if (simplified.length >= 4) return simplified;
        // Retry at finer tolerance.
        const finer = simplifyCoords(ring, tol / 4);
        if (finer.length >= 4) return finer;
        // Fallback: keep the cleaned (de-duped) unsimplified ring.
        const cleaned = cleanRingCoords(ring);
        return cleaned.length >= 4 ? cleaned : null;
    };

    const geom = feature.geometry;
    if (geom.type === "Polygon") {
        const simplified = geom.coordinates
            .map((ring) => simplifyRing(ring, tolerance))
            .filter((ring) => ring !== null);
        if (simplified.length === 0) return null;
        return {
            ...feature,
            geometry: { type: "Polygon", coordinates: simplified },
        };
    } else if (geom.type === "MultiPolygon") {
        const simplified = geom.coordinates
            .map((poly) =>
                poly
                    .map((ring) => simplifyRing(ring, tolerance))
                    .filter((ring) => ring !== null),
            )
            .filter((poly) => poly.length > 0);
        if (simplified.length === 0) return null;
        return {
            ...feature,
            geometry: { type: "MultiPolygon", coordinates: simplified },
        };
    }
    return feature;
}

/**
 * Returns true when two bboxes intersect (inclusive).
 */
export function bboxesIntersect(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

// ─── Simplification ──────────────────────────────────────────────────────────

/**
 * Ramer-Douglas-Peucker simplification.
 */
export function simplifyCoords(coords, tolerance) {
    if (coords.length <= 2) return coords;

    const sqTolerance = tolerance * tolerance;

    function findFarthest(points) {
        let maxDist = 0;
        let maxIdx = 0;
        const first = points[0];
        const last = points[points.length - 1];
        const dx = last[0] - first[0];
        const dy = last[1] - first[1];
        const lenSq = dx * dx + dy * dy;

        for (let i = 1; i < points.length - 1; i++) {
            let dist;
            if (lenSq === 0) {
                const dxi = points[i][0] - first[0];
                const dyi = points[i][1] - first[1];
                dist = dxi * dxi + dyi * dyi;
            } else {
                let t =
                    ((points[i][0] - first[0]) * dx +
                        (points[i][1] - first[1]) * dy) /
                    lenSq;
                if (t < 0) t = 0;
                if (t > 1) t = 1;
                const px = first[0] + t * dx;
                const py = first[1] + t * dy;
                const dxi = points[i][0] - px;
                const dyi = points[i][1] - py;
                dist = dxi * dxi + dyi * dyi;
            }
            if (dist > maxDist) {
                maxDist = dist;
                maxIdx = i;
            }
        }
        return { index: maxIdx, dist: maxDist };
    }

    function simplify(points) {
        const { index, dist } = findFarthest(points);
        if (dist > sqTolerance) {
            const left = simplify(points.slice(0, index + 1));
            const right = simplify(points.slice(index));
            return left.slice(0, -1).concat(right);
        }
        return [points[0], points[points.length - 1]];
    }

    return simplify(coords);
}

/**
 * Simplify a LineString or MultiLineString feature in-place.
 */
export function simplifyFeature(feature, tolerance) {
    const simplified = { ...feature, geometry: { ...feature.geometry } };
    if (feature.geometry.type === "LineString") {
        simplified.geometry.coordinates = simplifyCoords(
            feature.geometry.coordinates,
            tolerance,
        );
    } else if (feature.geometry.type === "MultiLineString") {
        simplified.geometry.coordinates = feature.geometry.coordinates.map(
            (seg) => simplifyCoords(seg, tolerance),
        );
    }
    return simplified;
}

/**
 * Pure, dependency-free metric helpers for geometry parity comparison.
 *
 * Moved here from `geosParity.test.ts` so they can be reused by the on-device
 * parity harness without pulling in test-only code. The spherical-area
 * algorithm matches `@mapbox/geojson-area` (the same algorithm `@turf/area`
 * uses), so area comparisons against turf-buffered reference geometry are
 * apples-to-apples.
 *
 * No React / Expo / feature dependencies — safe to import from anywhere.
 */

import type { MultiPolygon, Polygon } from "geojson";

// ─── Constants ───────────────────────────────────────────────────────────

/** WGS84 semi-major axis, as used by @turf/area and @mapbox/geojson-area. */
const AREA_RADIUS = 6_378_137;

const rad = (deg: number) => (deg * Math.PI) / 180;

// ─── Spherical area (dependency-free) ────────────────────────────────────

/**
 * Signed spherical area of a single ring, in m².
 *
 * Uses the @mapbox/geojson-area algorithm — the same one `@turf/area` wraps.
 * Positive for counter-clockwise (outer) rings, negative for clockwise (holes).
 */
export function ringArea(coords: number[][]): number {
    const n = coords.length;
    if (n <= 2) return 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
        const lower = coords[i];
        const middle = coords[(i + 1) % n];
        const upper = coords[(i + 2) % n];
        total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]));
    }
    return (total * AREA_RADIUS * AREA_RADIUS) / 2;
}

/**
 * Absolute spherical area of a polygon (outer ring area minus hole areas), in m².
 */
export function polygonAreaM2(rings: number[][][]): number {
    if (rings.length === 0) return 0;
    let area = Math.abs(ringArea(rings[0]));
    for (let i = 1; i < rings.length; i++) area -= Math.abs(ringArea(rings[i]));
    return area;
}

/**
 * Absolute spherical area of a Polygon or MultiPolygon, in m².
 *
 * Accepts any structurally compatible geometry with `coordinates: unknown` so
 * callers can pass local `PolygonGeometry` types without unsafe casts.
 */
export function geomAreaM2(geom: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
}): number {
    if (geom.type === "Polygon") {
        return polygonAreaM2(geom.coordinates as number[][][]);
    }
    return (geom.coordinates as number[][][][]).reduce(
        (sum, poly) => sum + polygonAreaM2(poly as number[][][]),
        0,
    );
}

// ─── Bbox ────────────────────────────────────────────────────────────────

export type Bbox = [number, number, number, number]; // [w, s, e, n]

/** Compute the 2D bounding box of a Polygon or MultiPolygon. */
export function geomBbox(geom: Polygon | MultiPolygon): Bbox {
    let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
    const visit = (rings: number[][][]) => {
        for (const ring of rings)
            for (const [x, y] of ring) {
                if (x < w) w = x;
                if (x > e) e = x;
                if (y < s) s = y;
                if (y > n) n = y;
            }
    };
    if (geom.type === "Polygon") visit(geom.coordinates);
    else for (const poly of geom.coordinates) visit(poly);
    return [w, s, e, n];
}

/**
 * Max edge displacement between two bboxes, in meters (approximate).
 *
 * Uses a simple lat-lon → meters conversion at `atLat`. Accurate enough to
 * catch gross translation bugs (hundreds of meters) while tolerating the
 * sub-meter jitter from arc-discretisation differences.
 */
export function bboxEdgeDeltaMeters(a: Bbox, b: Bbox, atLat: number): number {
    const mPerDegLat = 111_320;
    const mPerDegLon = 111_320 * Math.cos(rad(atLat));
    return Math.max(
        Math.abs(a[0] - b[0]) * mPerDegLon,
        Math.abs(a[2] - b[2]) * mPerDegLon,
        Math.abs(a[1] - b[1]) * mPerDegLat,
        Math.abs(a[3] - b[3]) * mPerDegLat,
    );
}

// ─── Parity gates ────────────────────────────────────────────────────────

/**
 * Bbox edge-delta tolerance for a given buffer radius.
 *
 * Formula: `radius * 0.02 + 5` meters — deliberately looser than the
 * geos-wasm host test (which hits 0.00 m at QS=8) to absorb JSTS-vs-GEOS
 * arc-discretisation noise.
 */
export function bboxToleranceM(radiusMeters: number): number {
    return radiusMeters * 0.02 + 5;
}

/** Area ratio bounds for parity (both backends agree within ±1%). */
export const AREA_RATIO_MIN = 0.99;
export const AREA_RATIO_MAX = 1.01;

/** Symmetric-difference area ratio gate: must be < 1%. */
export const SYM_DIFF_RATIO_MAX = 0.01;

/**
 * Pure, dependency-free metric helpers for **planar** (projected-meter) geometry.
 *
 * Companion to {@link ./parityMetrics} — that module measures spherical lon/lat
 * geometry, this one measures geometry already in a planar metric CRS (the
 * AEQD-projected coordinates the GEOS backend feeds into buffer/overlay ops, and
 * the synthetic meter-space fixtures the golden suite uses). Areas and bboxes are
 * therefore plain Euclidean — no Earth radius involved.
 *
 * Used by the golden-fixture generator
 * (`modules/native-geometry/scripts/gen-golden-fixtures.mjs`) and the host
 * golden-parity test so the device XCTest / instrumented suites can assert the
 * exact same engine-independent invariants.
 *
 * No React / Expo / feature dependencies — safe to import from anywhere.
 */

import type { MultiPolygon, Polygon } from "geojson";

export type Bbox = [number, number, number, number]; // [w, s, e, n]

// ─── Planar area ───────────────────────────────────────────────────────────

/** Absolute planar (shoelace) area of a single ring, in input units². */
export function planarRingArea(ring: number[][]): number {
    const n = ring.length;
    if (n < 3) return 0;
    let s = 0;
    for (let i = 0; i < n - 1; i++) {
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(s) / 2;
}

/** Planar area of a polygon (outer ring minus holes), in input units². */
export function planarPolygonArea(rings: number[][][]): number {
    if (rings.length === 0) return 0;
    let area = planarRingArea(rings[0]);
    for (let i = 1; i < rings.length; i++) area -= planarRingArea(rings[i]);
    return area;
}

/** Planar area of a Polygon or MultiPolygon, in input units². */
export function planarGeomArea(geom: Polygon | MultiPolygon): number {
    return geom.type === "Polygon"
        ? planarPolygonArea(geom.coordinates)
        : geom.coordinates.reduce((sum, p) => sum + planarPolygonArea(p), 0);
}

// ─── Bbox ──────────────────────────────────────────────────────────────────

/**
 * Bounding box of any geometry's coordinates, walking nested arrays. Works for
 * Polygon / MultiPolygon as well as LineString / MultiPoint inputs (used by the
 * parse fixtures).
 */
export function coordsBbox(coordinates: unknown): Bbox {
    let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
    const walk = (c: unknown): void => {
        if (
            Array.isArray(c) &&
            typeof c[0] === "number" &&
            typeof c[1] === "number"
        ) {
            const [x, y] = c as number[];
            if (x < w) w = x;
            if (x > e) e = x;
            if (y < s) s = y;
            if (y > n) n = y;
        } else if (Array.isArray(c)) {
            for (const child of c) walk(child);
        }
    };
    walk(coordinates);
    return [w, s, e, n];
}

/** Bbox of a Polygon or MultiPolygon. */
export function planarBbox(geom: Polygon | MultiPolygon): Bbox {
    return coordsBbox(geom.coordinates);
}

/**
 * Max edge displacement between two planar bboxes, in input units (meters for
 * projected geometry — no lat-scaling needed since both are already metric).
 */
export function bboxMaxDelta(a: Bbox, b: Bbox): number {
    return Math.max(
        Math.abs(a[0] - b[0]),
        Math.abs(a[1] - b[1]),
        Math.abs(a[2] - b[2]),
        Math.abs(a[3] - b[3]),
    );
}

// ─── Ring vertices ───────────────────────────────────────────────────────────

/** Count of coordinate pairs in the largest ring of a Polygon/MultiPolygon. */
export function maxRingVertices(geom: Polygon | MultiPolygon): number {
    const rings =
        geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
    return rings.reduce((max, ring) => Math.max(max, ring.length), 0);
}

/** Total count of coordinate pairs across all nested rings/parts. */
export function countCoords(coordinates: unknown): number {
    let count = 0;
    const walk = (c: unknown): void => {
        if (
            Array.isArray(c) &&
            typeof c[0] === "number" &&
            typeof c[1] === "number"
        ) {
            count++;
        } else if (Array.isArray(c)) {
            for (const child of c) walk(child);
        }
    };
    walk(coordinates);
    return count;
}

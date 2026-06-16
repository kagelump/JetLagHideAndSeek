import nearestPointOnLine from "@turf/nearest-point-on-line";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { multiLineString, point } from "@turf/helpers";

import {
    bboxIntersects,
    haversineDistanceMeters,
    type Bbox,
    type Position,
} from "@/shared/geojson";
import { getLineBundleSources } from "./lineBundleLoader";
import { APP_CONFIG, MEASURING_LINE } from "@/config/appConfig";
import type { Feature, MultiLineString, Polygon, MultiPolygon } from "geojson";
import type { MeasuringCategory } from "./measuringTypes";
import type { LineOrPolygonFeature } from "./lineMeasuringGeometry";

// ─── Types ─────────────────────────────────────────────────────────────────

export type NearestPointResult = {
    /** Nearest point on the line/edge (GeoJSON [lon, lat]). */
    nearestPoint: Position;
    /** Haversine distance in meters from `center` to `nearestPoint`. */
    distanceMeters: number;
};

// ─── Geo constants ─────────────────────────────────────────────────────────

const { degPerMeter: DEG_PER_METER } = APP_CONFIG.measuring;
export { DEG_PER_METER };

/** Convert meters to degrees longitude at a given latitude. */
export function metersToDegLon(meters: number, lat: number): number {
    return meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

/** Convert meters to degrees latitude (constant). */
export function metersToDegLat(meters: number): number {
    return meters * DEG_PER_METER;
}

/** Approximate great-circle length of a LineString in meters. */
export function lineLengthMeters(coords: Position[]): number {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += haversineDistanceMeters(
            coords[i][1],
            coords[i][0],
            coords[i + 1][1],
            coords[i + 1][0],
        );
    }
    return total;
}

// ─── Coordinate validation ─────────────────────────────────────────────────

/**
 * Returns true when `c` is a safe coordinate pair [lon, lat] with finite
 * numeric values.  Guards against NaN, Infinity, null, and undefined entries
 * that can appear when Metro/Hermes bundles large JSON assets.
 */
export function isValidCoord(c: unknown): c is Position {
    return (
        c != null &&
        Array.isArray(c) &&
        typeof c[0] === "number" &&
        isFinite(c[0]) &&
        typeof c[1] === "number" &&
        isFinite(c[1])
    );
}

// ─── Line simplification ───────────────────────────────────────────────────

/**
 * Douglas-Peucker simplification operating on `[lon, lat]` arrays.
 *
 * The tolerance is in meters; segments are planar-approximated using a
 * latitude-aware metre-to-degree conversion.  This is accurate enough for
 * the short intra-segment distances that simplification operates on.
 *
 * Returns a new array — never mutates the input.
 */
export function simplifyCoords(
    coords: Position[],
    toleranceM: number,
): Position[] {
    if (coords.length <= 2) return [...coords];

    // Approximate degrees per metre at the midpoint latitude.
    const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const kx = 111_320 * Math.cos((midLat * Math.PI) / 180);
    const ky = 111_320;

    // sqDistToSegment returns metre² distances, so compare against tolerance².
    const sqTol = toleranceM * toleranceM;

    function sqDistToSegment(p: Position, a: Position, b: Position): number {
        const dx = (b[0] - a[0]) * kx;
        const dy = (b[1] - a[1]) * ky;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) {
            const dxi = (p[0] - a[0]) * kx;
            const dyi = (p[1] - a[1]) * ky;
            return dxi * dxi + dyi * dyi;
        }
        let t = ((p[0] - a[0]) * kx * dx + (p[1] - a[1]) * ky * dy) / lenSq;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        const projX = a[0] + t * (b[0] - a[0]);
        const projY = a[1] + t * (b[1] - a[1]);
        const dxi = (p[0] - projX) * kx;
        const dyi = (p[1] - projY) * ky;
        return dxi * dxi + dyi * dyi;
    }

    function findFarthest(
        pts: Position[],
        first: number,
        last: number,
    ): { index: number; dist: number } {
        let maxDist = 0;
        let maxIdx = first + 1;
        const a = pts[first];
        const b = pts[last];
        for (let i = first + 1; i < last; i++) {
            const d = sqDistToSegment(pts[i], a, b);
            if (d > maxDist) {
                maxDist = d;
                maxIdx = i;
            }
        }
        return { index: maxIdx, dist: maxDist };
    }

    function simplifyRange(
        pts: Position[],
        first: number,
        last: number,
        out: Position[],
    ): void {
        const { index, dist } = findFarthest(pts, first, last);
        if (dist > sqTol) {
            simplifyRange(pts, first, index, out);
            out.push(pts[index]);
            simplifyRange(pts, index, last, out);
        }
    }

    const result: Position[] = [coords[0]];
    simplifyRange(coords, 0, coords.length - 1, result);
    result.push(coords[coords.length - 1]);
    return result;
}

/**
 * Simplifies each ring of a Polygon or MultiPolygon geometry using
 * Douglas-Peucker. Returns null if the geometry degenerates (all rings
 * collapse to < 3 coords).
 */
export function simplifyPolygonCoords(
    geom: Polygon | MultiPolygon,
    toleranceM: number,
): Polygon | MultiPolygon | null {
    if (geom.type === "Polygon") {
        const simplified = geom.coordinates
            .map((ring) => simplifyCoords(ring as Position[], toleranceM))
            .filter((ring) => ring.length >= 4);
        if (simplified.length === 0) return null;
        return { type: "Polygon", coordinates: simplified };
    }
    // MultiPolygon
    const simplified = geom.coordinates
        .map((poly) =>
            poly
                .map((ring) => simplifyCoords(ring as Position[], toleranceM))
                .filter((ring) => ring.length >= 4),
        )
        .filter((poly) => poly.length > 0);
    if (simplified.length === 0) return null;
    return { type: "MultiPolygon", coordinates: simplified };
}

// ─── Bbox helpers ──────────────────────────────────────────────────────────

export function featureBbox(f: Feature): Bbox {
    if (f.bbox) return f.bbox as Bbox;
    return computeBboxFromCoords(f.geometry);
}

/** Fallback bbox computation for features without a pre-computed bbox. */
export function computeBboxFromCoords(geometry: Feature["geometry"]): Bbox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const walk = (c: unknown) => {
        if (typeof (c as number[])?.[0] === "number") {
            const arr = c as number[];
            if (arr[0] < minX) minX = arr[0];
            if (arr[0] > maxX) maxX = arr[0];
            if (arr[1] < minY) minY = arr[1];
            if (arr[1] > maxY) maxY = arr[1];
        } else if (Array.isArray(c)) {
            for (const item of c) walk(item);
        }
    };
    // All bundle features are LineString or MultiLineString, which have coords.
    const coords = (geometry as { coordinates: unknown }).coordinates;
    walk(coords);
    return [minX, minY, maxX, maxY];
}

// ─── Polygon → boundary rings converter ────────────────────────────────────

/**
 * Extracts boundary ring(s) from a Polygon or MultiPolygon feature as an
 * array of `Position[][]` suitable for nearest-point-on-line queries.
 *
 * For Polygon: returns [outer ring, ...hole rings].
 * For MultiPolygon: returns all rings from all component polygons.
 * For line geometry: returns a single-element array wrapping the coordinates.
 *
 * Holes are included so that a seeker inside a lake-with-island measures
 * distance to the nearest shoreline edge, not the outer boundary.
 */
export function featureToRings(feature: LineOrPolygonFeature): Position[][] {
    const geom = feature.geometry;
    if (geom.type === "Polygon") {
        return geom.coordinates as Position[][];
    }
    if (geom.type === "MultiPolygon") {
        return geom.coordinates.flatMap((poly) => poly) as Position[][];
    }
    if (geom.type === "LineString") {
        return [geom.coordinates as Position[]];
    }
    // MultiLineString
    return geom.coordinates as Position[][];
}

// ─── Distance cache ────────────────────────────────────────────────────────

/** Increment to invalidate all cached results when the algorithm changes. */
const LINE_DISTANCE_CACHE_VERSION = 2;

/**
 * LRU cache keyed on (version, category, center). Two questions with the same
 * center share a hit -- the result depends solely on center + category.
 */
const distanceCache = new Map<string, NearestPointResult | null>();

function cacheKey(category: MeasuringCategory, center: Position): string {
    return [
        LINE_DISTANCE_CACHE_VERSION,
        category,
        center[0].toFixed(7),
        center[1].toFixed(7),
    ].join(":");
}

/** Clears the in-memory line-distance cache. Call in tests to reset state. */
export function clearLineDistanceCache(): void {
    distanceCache.clear();
}

// ─── Main distance algorithm ───────────────────────────────────────────────

/**
 * Nearest point on bundled line/polygon geometry for a center + category.
 * Bbox-pre-filters features around the center, then runs
 * `@turf/nearest-point-on-line` on the merged MultiLineString. LRU-cached
 * on (category, center). Returns null for empty bundles or no surviving features.
 */
export function computeLineDistance(
    center: Position,
    category: MeasuringCategory,
): NearestPointResult | null {
    const key = cacheKey(category, center);
    if (distanceCache.has(key)) {
        const cached = distanceCache.get(key)!;
        // Promote to most-recently-used.
        distanceCache.delete(key);
        distanceCache.set(key, cached);
        console.log(
            `[lineDistance] cache hit for ${category} @ ${center[0].toFixed(6)},${center[1].toFixed(6)}`,
        );
        return cached;
    }

    const tLoad0 = performance.now();
    const bundles = getLineBundleSources(category);
    const tLoadMs = performance.now() - tLoad0;
    if (bundles.length === 0) {
        distanceCache.set(key, null);
        return null;
    }
    const totalFeatures = bundles.reduce((s, b) => s + b.features.length, 0);
    console.log(
        `[lineDistance] bundle load: ${totalFeatures} features in ${tLoadMs.toFixed(0)}ms`,
    );

    const marginDeg = MEASURING_LINE.queryMarginM * DEG_PER_METER;
    const queryBbox: Bbox = [
        center[0] - marginDeg,
        center[1] - marginDeg,
        center[0] + marginDeg,
        center[1] + marginDeg,
    ];

    // Collect surviving LineString coordinate arrays.
    // For polygon features: if the center is inside → distance = 0.
    // Otherwise, extract boundary rings and treat as line segments.
    const tFilter0 = performance.now();
    const lines: Position[][] = [];
    let bboxHits = 0;
    let bboxMisses = 0;
    for (const fc of bundles) {
        for (const f of fc.features) {
            if (!bboxIntersects(featureBbox(f), queryBbox)) {
                bboxMisses++;
                continue;
            }
            bboxHits++;
            const geom = f.geometry;
            if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
                // Check if the seeker is inside the water body.
                if (
                    booleanPointInPolygon(
                        center,
                        f as Feature<Polygon | MultiPolygon>,
                    )
                ) {
                    const result: NearestPointResult = {
                        nearestPoint: center,
                        distanceMeters: 0,
                    };
                    distanceCache.set(key, result);
                    return result;
                }
                // Outside — extract boundary rings for nearest-point search.
                for (const ring of featureToRings(f)) {
                    lines.push(ring);
                }
            } else if (geom.type === "LineString") {
                lines.push(geom.coordinates as Position[]);
            } else {
                // MultiLineString
                for (const seg of (geom as MultiLineString).coordinates) {
                    lines.push(seg as Position[]);
                }
            }
        }
    }
    const tFilterMs = performance.now() - tFilter0;
    console.log(
        `[lineDistance] bbox filter: ${bboxHits} hits, ${bboxMisses} misses ` +
            `→ ${lines.length} rings in ${tFilterMs.toFixed(0)}ms`,
    );

    // Defensive: filter out any line that contains a non-numeric / non-finite
    // coordinate.  Hermes/Metro bundling of large JSON assets can occasionally
    // produce NaN, Infinity, null, or undefined values that pass JSON.parse but
    // fail inside @turf/nearest-point-on-line (which calls point() on every
    // vertex).
    const tClean0 = performance.now();
    let cleanLines = lines.filter(
        (coords) => coords.length >= 2 && coords.every((c) => isValidCoord(c)),
    );

    // Remove consecutive duplicate coordinates (zero-length segments) from
    // each line.  Zero-length segments cause a division-by-zero inside
    // nearestPointOnSegment → NaN result → point([NaN, NaN]) throws.
    cleanLines = cleanLines
        .map((coords) => {
            const deduped: Position[] = [coords[0]];
            for (let i = 1; i < coords.length; i++) {
                const prev = coords[i - 1];
                const curr = coords[i];
                if (prev[0] !== curr[0] || prev[1] !== curr[1]) {
                    deduped.push(curr);
                }
            }
            return deduped.length >= 2 ? deduped : null;
        })
        .filter((coords): coords is Position[] => coords !== null);

    if (cleanLines.length === 0) {
        distanceCache.set(key, null);
        return null;
    }
    const tCleanMs = performance.now() - tClean0;

    // Simplify with a small tolerance — fast path for nearestPointOnLine
    // without measurably changing the result.
    const tSimplify0 = performance.now();
    const simplifiedLines = cleanLines.map((coords) =>
        simplifyCoords(coords, MEASURING_LINE.nearestPointSimplifyM),
    );
    const tSimplifyMs = performance.now() - tSimplify0;
    const preSimplifyCoords = cleanLines.reduce((s, l) => s + l.length, 0);
    const postSimplifyCoords = simplifiedLines.reduce(
        (s, l) => s + l.length,
        0,
    );

    console.log(
        `[lineDistance] clean: ${lines.length}→${cleanLines.length} rings ` +
            `(${tCleanMs.toFixed(0)}ms), ` +
            `simplify: ${preSimplifyCoords}→${postSimplifyCoords} coords ` +
            `(${tSimplifyMs.toFixed(0)}ms)`,
    );

    const t0 = performance.now();
    let snapped;
    try {
        snapped = nearestPointOnLine(
            multiLineString(simplifiedLines),
            point(center),
        );
    } catch (err) {
        console.warn(
            `[lineDistance] nearestPointOnLine failed for category=${category} center=${center}:`,
            err,
        );
        distanceCache.set(key, null);
        return null;
    }
    const turfMs = performance.now() - t0;

    console.log(
        `[lineDistance] ${preSimplifyCoords} coords → simplify(${MEASURING_LINE.nearestPointSimplifyM}m): ` +
            `${postSimplifyCoords} coords, turf in ${turfMs.toFixed(0)}ms`,
    );
    const nearestPoint = snapped.geometry.coordinates as Position;
    const distanceMeters = haversineDistanceMeters(
        center[1],
        center[0],
        nearestPoint[1],
        nearestPoint[0],
    );

    const result: NearestPointResult = { nearestPoint, distanceMeters };

    // Evict oldest entry when cache exceeds max size.
    if (distanceCache.size >= MEASURING_LINE.distanceCacheMax) {
        const oldest = distanceCache.keys().next().value;
        if (oldest !== undefined) distanceCache.delete(oldest);
    }
    distanceCache.set(key, result);

    return result;
}

import nearestPointOnLine from "@turf/nearest-point-on-line";
import buffer from "@turf/buffer";
import lineSplit from "@turf/line-split";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { multiLineString, point } from "@turf/helpers";

import {
    bboxIntersects,
    haversineDistanceMeters,
    type Bbox,
    type Position,
} from "@/shared/geojson";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    Polygon,
    MultiPolygon,
} from "geojson";
import type { MeasuringCategory } from "./measuringTypes";
import { getLineBundle } from "./lineBundleLoader";

export type NearestPointResult = {
    /** Nearest point on the line/edge (GeoJSON [lon, lat]). */
    nearestPoint: Position;
    /** Haversine distance in meters from `center` to `nearestPoint`. */
    distanceMeters: number;
};

// ─── Central line computation ──────────────────────────────────────────

/** Minimum query window (50 km) even when the seeker is on the line
 *  (distance ≈ 0). Ensures windowFeatures always returns the bundle
 *  features near the play area. */
const MIN_WINDOW_MARGIN_M = 50_000;

/**
 * Result of one central line-category computation. `windowFeatures` is
 * the single source from which both the mask buffer and the visible
 * reference line are derived.
 */
export type LineCategoryComputation = {
    nearestPoint: Position;
    distanceMeters: number;
    /** Bundle features intersecting the play-area ± max(distance, MIN_MARGIN)
     *  window. The single source for both mask and reference line. */
    windowFeatures: Feature<LineString | MultiLineString>[];
};

// ─── Window feature selection ──────────────────────────────────────────

/**
 * Returns bundle features whose bbox intersects the play-area bbox expanded
 * by `marginM` metres. Falls back to center ± 25 km when no play area.
 */
export function selectWindowFeatures(
    category: MeasuringCategory,
    playAreaBbox: Bbox | undefined,
    center: Position,
    marginM: number,
): Feature<LineString | MultiLineString>[] {
    const fc = getLineBundle(category);
    if (!fc || fc.features.length === 0) return [];

    let queryBbox: Bbox;

    if (playAreaBbox) {
        const midLat = (playAreaBbox[1] + playAreaBbox[3]) / 2;
        queryBbox = [
            playAreaBbox[0] - metersToDegLon(marginM, midLat),
            playAreaBbox[1] - metersToDegLat(marginM),
            playAreaBbox[2] + metersToDegLon(marginM, midLat),
            playAreaBbox[3] + metersToDegLat(marginM),
        ];
    } else {
        const marginDeg = marginM * DEG_PER_METER;
        queryBbox = [
            center[0] - marginDeg,
            center[1] - marginDeg,
            center[0] + marginDeg,
            center[1] + marginDeg,
        ];
    }

    const result: Feature<LineString | MultiLineString>[] = [];
    for (const f of fc.features) {
        if (bboxIntersects(featureBbox(f as Feature), queryBbox)) {
            result.push(f as Feature<LineString | MultiLineString>);
        }
    }
    return result;
}

// ─── computeLineCategory cache ─────────────────────────────────────────

/** Increment to invalidate all cached line-category results. */
const LINE_CATEGORY_CACHE_VERSION = 1;

/** Maximum number of cached line-category results. */
const LINE_CATEGORY_CACHE_MAX = 50;

const categoryCache = new Map<string, LineCategoryComputation | null>();

function categoryCacheKey(
    category: MeasuringCategory,
    center: Position,
    bbox: Bbox | undefined,
): string {
    return [
        LINE_CATEGORY_CACHE_VERSION,
        category,
        center[0].toFixed(6),
        center[1].toFixed(6),
        bbox ? bbox.map((v) => v.toFixed(4)).join(",") : "no-bbox",
    ].join(":");
}

/** Clears the in-memory line-category cache. Call in tests to reset state. */
export function clearLineCategoryCache(): void {
    categoryCache.clear();
}

// ─── Central function ──────────────────────────────────────────────────

/**
 * Computes the nearest point, distance, and windowed feature set for a
 * line-category measuring question in one call. The returned
 * `windowFeatures` are the single source for both `computeLineBuffer` and
 * the clipped reference line.
 *
 * Cached on (category, center, playAreaBbox).
 */
export function computeLineCategory(
    center: Position,
    category: MeasuringCategory,
    playAreaBbox: Bbox | undefined,
): LineCategoryComputation | null {
    const key = categoryCacheKey(category, center, playAreaBbox);
    if (categoryCache.has(key)) {
        const cached = categoryCache.get(key)!;
        // Promote to most-recently-used.
        categoryCache.delete(key);
        categoryCache.set(key, cached);
        return cached;
    }

    const distance = computeLineDistance(center, category);
    if (!distance || distance.distanceMeters <= 0) {
        categoryCache.set(key, null);
        return null;
    }

    const marginM = Math.max(distance.distanceMeters, MIN_WINDOW_MARGIN_M);
    const windowFeatures = selectWindowFeatures(
        category,
        playAreaBbox,
        center,
        marginM,
    );

    const result: LineCategoryComputation = {
        nearestPoint: distance.nearestPoint,
        distanceMeters: distance.distanceMeters,
        windowFeatures,
    };

    // Evict oldest entry when cache exceeds max size.
    if (categoryCache.size >= LINE_CATEGORY_CACHE_MAX) {
        const oldest = categoryCache.keys().next().value;
        if (oldest !== undefined) categoryCache.delete(oldest);
    }
    categoryCache.set(key, result);

    return result;
}

// --- LRU cache ----------------------------------------------------------------

/** Increment to invalidate all cached results when the algorithm changes. */
const LINE_DISTANCE_CACHE_VERSION = 1;

/** Maximum number of cached nearest-point results. */
const LINE_DISTANCE_CACHE_MAX = 100;

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

// --- Query margin -------------------------------------------------------------

/** 50 km query window covers any plausible seeker distance. */
const MARGIN_METERS = 50_000;

/** Approximate degrees per meter at mid-latitudes (1 deg ~ 111,320 m). */
const DEG_PER_METER = 1 / 111_320;

/** Convert meters to degrees longitude at a given latitude. */
function metersToDegLon(meters: number, lat: number): number {
    return meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

/** Convert meters to degrees latitude (constant). */
function metersToDegLat(meters: number): number {
    return meters * DEG_PER_METER;
}

/** Approximate great-circle length of a LineString in meters. */
function lineLengthMeters(coords: Position[]): number {
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

// --- Coordinate validation ----------------------------------------------------

/**
 * Returns true when `c` is a safe coordinate pair [lon, lat] with finite
 * numeric values.  Guards against NaN, Infinity, null, and undefined entries
 * that can appear when Metro/Hermes bundles large JSON assets.
 */
function isValidCoord(c: unknown): c is Position {
    return (
        c != null &&
        Array.isArray(c) &&
        typeof c[0] === "number" &&
        isFinite(c[0]) &&
        typeof c[1] === "number" &&
        isFinite(c[1])
    );
}

// --- Line simplification --------------------------------------------------------

/**
 * Douglas-Peucker simplification operating on `[lon, lat]` arrays.
 *
 * The tolerance is in meters; segments are planar-approximated using a
 * latitude-aware metre-to-degree conversion.  This is accurate enough for
 * the short intra-segment distances that simplification operates on.
 *
 * Returns a new array — never mutates the input.
 */
function simplifyCoords(coords: Position[], toleranceM: number): Position[] {
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

// --- Line buffer cache --------------------------------------------------------

/** Increment to invalidate all cached buffer results when the algorithm changes. */
const LINE_BUFFER_CACHE_VERSION = 3;

/** Maximum number of cached buffer results. */
const LINE_BUFFER_CACHE_MAX = 50;

/**
 * LRU cache keyed on (version, category, center, radiusMeters). The
 * windowFeatures are already selected upstream by `computeLineCategory`,
 * so the cache key only needs (category, center, radius).
 */
const bufferCache = new Map<string, Feature<Polygon | MultiPolygon> | null>();

function bufferCacheKey(
    category: MeasuringCategory,
    center: Position,
    radiusMeters: number,
): string {
    return [
        LINE_BUFFER_CACHE_VERSION,
        category,
        center[0].toFixed(5),
        center[1].toFixed(5),
        Math.round(radiusMeters / 10) * 10, // 10 m granularity
    ].join(":");
}

/** Clears the in-memory line-buffer cache. Call in tests to reset state. */
export function clearLineBufferCache(): void {
    bufferCache.clear();
}

// --- Line buffer --------------------------------------------------------------

/**
 * Builds a buffer polygon around the provided window features.
 *
 * Pipeline:
 * 1. Drop features shorter than a threshold relative to the buffer radius.
 * 2. Clean (dedup coords, filter NaN), simplify, merge, and buffer with
 *    @turf/buffer (JSTS). The mask builder clips the result to the play
 *    area, so no pre-clipping or simplification is needed.
 *
 * This is a pure function — window selection is now done upstream by
 * `computeLineCategory`. Use `computeLineBufferCached` for the cached
 * variant.
 */
export function computeLineBuffer(
    windowFeatures: Feature<LineString | MultiLineString>[],
    radiusMeters: number,
): Feature<Polygon | MultiPolygon> | null {
    if (radiusMeters <= 0) return null;
    if (windowFeatures.length === 0) return null;

    // -- 1. Collect coordinates, drop short features ----------------------------

    const minFeatureLenM = Math.min(radiusMeters * 0.1, 500);

    const lines: Position[][] = [];
    let droppedShort = 0;
    for (const f of windowFeatures) {
        if (f.geometry.type === "LineString") {
            const coords = f.geometry.coordinates as Position[];
            if (lineLengthMeters(coords) < minFeatureLenM) {
                droppedShort++;
                continue;
            }
            lines.push(coords);
        } else {
            const mlCoords = (f.geometry as MultiLineString).coordinates;
            let totalLen = 0;
            for (const line of mlCoords) {
                totalLen += lineLengthMeters(line as Position[]);
            }
            if (totalLen < minFeatureLenM) {
                droppedShort++;
                continue;
            }
            for (const line of mlCoords) {
                if ((line as Position[]).length >= 2) {
                    lines.push(line as Position[]);
                }
            }
        }
    }

    if (droppedShort > 0) {
        console.log(
            `[lineBuffer] dropped ${droppedShort} short features (< ${minFeatureLenM.toFixed(0)}m)`,
        );
    }

    const totalCoords = lines.reduce((sum, l) => sum + l.length, 0);

    console.log(
        `[lineBuffer] ${windowFeatures.length} features in window, ` +
            `${lines.length} segments, ${totalCoords} total coords`,
    );

    if (lines.length === 0) return null;

    // Defensive: filter out lines with non-numeric / non-finite coordinates.
    let cleanBufLines = lines.filter(
        (coords) => coords.length >= 2 && coords.every((c) => isValidCoord(c)),
    );

    // Remove consecutive duplicate coordinates — zero-length segments can
    // cause degenerate behaviour inside the buffer pipeline.
    cleanBufLines = cleanBufLines
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

    if (cleanBufLines.length === 0) return null;

    const cleanCoords = cleanBufLines.reduce((sum, l) => sum + l.length, 0);

    // Simplify lines before buffering.  Tolerance is 5% of the buffer
    // radius (min 10 m) — invisible on the map mask (<1 px at typical
    // zoom) but reduces JSTS vertex count ~10–20×.
    const simplifyTol = Math.max(radiusMeters * 0.05, 10);
    const simplifiedLines = cleanBufLines.map((coords) =>
        simplifyCoords(coords, simplifyTol),
    );
    const simpleCoords = simplifiedLines.reduce((sum, l) => sum + l.length, 0);

    console.log(
        `[lineBuffer] after dedup: ${cleanBufLines.length} segs, ` +
            `${cleanCoords} coords → simplify(${simplifyTol.toFixed(0)}m): ` +
            `${simpleCoords} coords`,
    );

    // -- 2. Buffer ---------------------------------------------------------------

    let merged;
    try {
        merged = multiLineString(simplifiedLines);
    } catch (err) {
        console.warn(`[lineBuffer] multiLineString failed:`, err);
        return null;
    }

    const t0 = performance.now();
    let result;
    try {
        result = buffer(merged, radiusMeters, {
            units: "meters",
        }) as Feature<Polygon | MultiPolygon>;
    } catch (err) {
        console.warn(`[lineBuffer] buffer failed:`, err);
        return null;
    }
    const bufferMs = performance.now() - t0;

    if (!result) {
        console.log(`[lineBuffer] buffer returned undefined`);
        return null;
    }

    console.log(
        `[lineBuffer] buffer done: ${result.geometry.type} ` +
            `in ${bufferMs.toFixed(0)}ms`,
    );

    return result;
}

/**
 * Cached wrapper around `computeLineBuffer`. Keyed on
 * (category, center, radiusMeters). Call this from render-state builders
 * to avoid re-buffering the same window on every render.
 */
export function computeLineBufferCached(
    category: MeasuringCategory,
    center: Position,
    radiusMeters: number,
    windowFeatures: Feature<LineString | MultiLineString>[],
): Feature<Polygon | MultiPolygon> | null {
    if (radiusMeters <= 0) return null;

    const key = bufferCacheKey(category, center, radiusMeters);
    if (bufferCache.has(key)) {
        const cached = bufferCache.get(key)!;
        // Promote to most-recently-used.
        bufferCache.delete(key);
        bufferCache.set(key, cached);
        return cached;
    }

    const result = computeLineBuffer(windowFeatures, radiusMeters);

    // Evict oldest entry when cache exceeds max size.
    if (bufferCache.size >= LINE_BUFFER_CACHE_MAX) {
        const oldest = bufferCache.keys().next().value;
        if (oldest !== undefined) bufferCache.delete(oldest);
    }
    bufferCache.set(key, result);

    return result;
}

// --- Bbox helpers -------------------------------------------------------------

function featureBbox(f: Feature): Bbox {
    if (f.bbox) return f.bbox as Bbox;
    return computeBboxFromCoords(f.geometry);
}

/** Fallback bbox computation for features without a pre-computed bbox. */
function computeBboxFromCoords(geometry: Feature["geometry"]): Bbox {
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

// --- Main algorithm -----------------------------------------------------------

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
        return cached;
    }

    const fc = getLineBundle(category);
    if (!fc || fc.features.length === 0) {
        distanceCache.set(key, null);
        return null;
    }

    const marginDeg = MARGIN_METERS * DEG_PER_METER;
    const queryBbox: Bbox = [
        center[0] - marginDeg,
        center[1] - marginDeg,
        center[0] + marginDeg,
        center[1] + marginDeg,
    ];

    // Collect surviving LineString coordinate arrays.
    const lines: Position[][] = [];
    for (const f of fc.features) {
        if (!bboxIntersects(featureBbox(f), queryBbox)) continue;
        if (f.geometry.type === "LineString") {
            lines.push(f.geometry.coordinates as Position[]);
        } else {
            // MultiLineString
            for (const seg of (f.geometry as MultiLineString).coordinates) {
                lines.push(seg as Position[]);
            }
        }
    }

    // Defensive: filter out any line that contains a non-numeric / non-finite
    // coordinate.  Hermes/Metro bundling of large JSON assets can occasionally
    // produce NaN, Infinity, null, or undefined values that pass JSON.parse but
    // fail inside @turf/nearest-point-on-line (which calls point() on every
    // vertex).
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

    // Simplify with 10 m tolerance — fast path for nearestPointOnLine
    // without measurably changing the result.
    const simplifiedLines = cleanLines.map((coords) =>
        simplifyCoords(coords, 10),
    );
    const preSimplifyCoords = cleanLines.reduce((s, l) => s + l.length, 0);
    const postSimplifyCoords = simplifiedLines.reduce(
        (s, l) => s + l.length,
        0,
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
        `[lineDistance] ${preSimplifyCoords} coords → simplify(10m): ` +
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
    if (distanceCache.size >= LINE_DISTANCE_CACHE_MAX) {
        const oldest = distanceCache.keys().next().value;
        if (oldest !== undefined) distanceCache.delete(oldest);
    }
    distanceCache.set(key, result);

    return result;
}

// ─── ε-dilated clip polygon ────────────────────────────────────────────

/** Small outward dilation (~30 m) for the play-area boundary so that
 *  coincident borders (e.g. a prefecture boundary on the play-area edge)
 *  are strictly inside and always survive the clip. */
const CLIP_DILATION_M = 30;

/**
 * Cache keyed by a stable identity of the boundary features array.
 * The boundary object is stable across renders, so the dilation runs
 * once per play area. Uses a plain Map so tests can clear it.
 */
const dilatedBoundaryCache = new Map<
    Feature<Polygon | MultiPolygon>[],
    Feature<Polygon | MultiPolygon>
>();

/**
 * Returns the play-area boundary dilated outward by `CLIP_DILATION_M`
 * (30 m). Cached by boundary identity — reuses the same result across
 * renders for a stable play area.
 */
export function getDilatedPlayArea(
    boundary: FeatureCollection<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> {
    const features = boundary.features;
    const cached = dilatedBoundaryCache.get(features);
    if (cached) return cached;

    // @turf/buffer v7 overloads: Feature→Feature or FeatureCollection→FeatureCollection.
    // Buffer the boundary FeatureCollection to get an ε-dilated polygon.
    // The `as FeatureCollection` cast picks the FeatureCollection overload,
    // which returns a FeatureCollection result with .features.
    const dilatedFc = buffer(
        boundary as FeatureCollection<Polygon | MultiPolygon>,
        CLIP_DILATION_M,
        { units: "meters" },
    );
    const dilated: Feature<Polygon | MultiPolygon> =
        (dilatedFc?.features?.[0] as Feature<Polygon | MultiPolygon>) ??
        boundary.features[0];

    if (!dilated || !dilated.geometry) {
        // Fallback: return the first feature as-is (should never happen).
        console.warn(
            "[dilatedPlayArea] buffer returned empty; using raw boundary",
        );
        const fallback = features[0] as Feature<Polygon | MultiPolygon>;
        if (fallback) return fallback;
        // Absolute last resort: a tiny square around origin.
        return {
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [0.01, 0],
                        [0.01, 0.01],
                        [0, 0.01],
                        [0, 0],
                    ],
                ],
            },
        };
    }

    dilatedBoundaryCache.set(features, dilated);
    return dilated;
}

/** Test seam: clear the dilated-boundary cache. */
export function clearDilatedBoundaryCache(): void {
    dilatedBoundaryCache.clear();
}

// ─── Line–polygon clip ─────────────────────────────────────────────────

/**
 * Clips each feature to the dilated play-area boundary.
 *
 * Implementation uses `@turf/line-split` + `@turf/boolean-point-in-polygon`:
 * split each line by the polygon, keep pieces whose midpoint is inside.
 * MultiLineString features are decomposed, clipped per component, and
 * recombined.
 */
export function clipLineFeaturesToPlayArea(
    features: Feature<LineString | MultiLineString>[],
    dilatedPlayArea: Feature<Polygon | MultiPolygon>,
): Feature<LineString | MultiLineString>[] {
    const result: Feature<LineString | MultiLineString>[] = [];

    for (const f of features) {
        if (f.geometry.type === "LineString") {
            const clipped = clipLineString(
                f as Feature<LineString>,
                dilatedPlayArea,
            );
            if (clipped) result.push(clipped);
        } else {
            const clipped = clipMultiLineString(
                f as Feature<MultiLineString>,
                dilatedPlayArea,
            );
            if (clipped) result.push(clipped);
        }
    }

    return result;
}

function clipLineString(
    feature: Feature<LineString>,
    polygon: Feature<Polygon | MultiPolygon>,
): Feature<LineString | MultiLineString> | null {
    const coords = feature.geometry.coordinates as Position[];

    // Quick check: if all coords are already inside, skip the split.
    if (isFullyInside(coords, polygon)) return feature;

    // Split the line by the polygon boundary.
    let splitFc;
    try {
        splitFc = lineSplit(feature, polygon);
    } catch {
        // lineSplit can throw on degenerate input — retain the feature as-is
        // if it has any inside points.
        return clipLineStringFallback(feature, polygon);
    }

    if (!splitFc || splitFc.features.length === 0) {
        return clipLineStringFallback(feature, polygon);
    }

    // Keep pieces whose midpoint is inside the dilated polygon.
    const insidePieces: Position[][] = [];
    for (const piece of splitFc.features) {
        const pieceCoords = piece.geometry.coordinates as Position[];
        if (pieceCoords.length < 2) continue;
        const midIdx = Math.floor(pieceCoords.length / 2);
        const mid = pieceCoords[midIdx];
        if (booleanPointInPolygon(mid, polygon)) {
            insidePieces.push(pieceCoords);
        }
    }

    if (insidePieces.length === 0) return null;

    if (insidePieces.length === 1) {
        return {
            type: "Feature",
            properties: { ...feature.properties },
            geometry: { type: "LineString", coordinates: insidePieces[0] },
        };
    }

    // Recombine into MultiLineString
    return {
        type: "Feature",
        properties: { ...feature.properties },
        geometry: {
            type: "MultiLineString",
            coordinates: insidePieces,
        },
    };
}

function clipMultiLineString(
    feature: Feature<MultiLineString>,
    polygon: Feature<Polygon | MultiPolygon>,
): Feature<LineString | MultiLineString> | null {
    const allPieces: Position[][] = [];
    for (const line of feature.geometry.coordinates) {
        const coords = line as Position[];
        if (coords.length < 2) continue;

        // Quick check: fully inside → keep as-is.
        if (isFullyInside(coords, polygon)) {
            allPieces.push(coords);
            continue;
        }

        let splitFc;
        const lineFeat: Feature<LineString> = {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: coords },
        };
        try {
            splitFc = lineSplit(lineFeat, polygon);
        } catch {
            // Keep any inside segments via fallback.
            const fallback = clipCoordsToPolygon(coords, polygon);
            if (fallback.length > 0) allPieces.push(...fallback);
            continue;
        }
        if (!splitFc || splitFc.features.length === 0) {
            const fallback = clipCoordsToPolygon(coords, polygon);
            if (fallback.length > 0) allPieces.push(...fallback);
            continue;
        }
        for (const piece of splitFc.features) {
            const pieceCoords = piece.geometry.coordinates as Position[];
            if (pieceCoords.length < 2) continue;
            const midIdx = Math.floor(pieceCoords.length / 2);
            if (booleanPointInPolygon(pieceCoords[midIdx], polygon)) {
                allPieces.push(pieceCoords);
            }
        }
    }

    if (allPieces.length === 0) return null;

    if (allPieces.length === 1) {
        return {
            type: "Feature",
            properties: { ...feature.properties },
            geometry: { type: "LineString", coordinates: allPieces[0] },
        };
    }

    return {
        type: "Feature",
        properties: { ...feature.properties },
        geometry: { type: "MultiLineString", coordinates: allPieces },
    };
}

// ─── Clip helpers ──────────────────────────────────────────────────────

/** True when every coord is inside the polygon. */
function isFullyInside(
    coords: Position[],
    polygon: Feature<Polygon | MultiPolygon>,
): boolean {
    return coords.every((c) => booleanPointInPolygon(c, polygon));
}

/**
 * Fallback clip: runs of consecutive inside vertices emitted as separate
 * LineStrings. Used when `lineSplit` fails on degenerate input.
 */
function clipCoordsToPolygon(
    coords: Position[],
    polygon: Feature<Polygon | MultiPolygon>,
): Position[][] {
    const result: Position[][] = [];
    let run: Position[] = [];
    for (const c of coords) {
        if (booleanPointInPolygon(c, polygon)) {
            run.push(c);
        } else {
            if (run.length >= 2) result.push(run);
            run = [];
        }
    }
    if (run.length >= 2) result.push(run);
    return result;
}

/**
 * Fallback for a single LineString feature: keeps the portion with inside
 * vertices. Used when `lineSplit` throws.
 */
function clipLineStringFallback(
    feature: Feature<LineString>,
    polygon: Feature<Polygon | MultiPolygon>,
): Feature<LineString | MultiLineString> | null {
    const coords = feature.geometry.coordinates as Position[];
    const pieces = clipCoordsToPolygon(coords, polygon);
    if (pieces.length === 0) return null;
    if (pieces.length === 1) {
        return {
            type: "Feature",
            properties: { ...feature.properties },
            geometry: { type: "LineString", coordinates: pieces[0] },
        };
    }
    return {
        type: "Feature",
        properties: { ...feature.properties },
        geometry: { type: "MultiLineString", coordinates: pieces },
    };
}

import nearestPointOnLine from "@turf/nearest-point-on-line";
import buffer from "@turf/buffer";
import simplify from "@turf/simplify";
import { multiLineString, point } from "@turf/helpers";

import {
    bboxIntersects,
    haversineDistanceMeters,
    type Bbox,
    type Position,
} from "@/shared/geojson";
import type { Feature, MultiLineString, Polygon, MultiPolygon } from "geojson";
import type { MeasuringCategory } from "./measuringTypes";
import { getLineBundle } from "./lineBundleLoader";

export type NearestPointResult = {
    /** Nearest point on the line/edge (GeoJSON [lon, lat]). */
    nearestPoint: Position;
    /** Haversine distance in meters from `center` to `nearestPoint`. */
    distanceMeters: number;
};

// ─── LRU cache ───────────────────────────────────────────────────────────────

/** Increment to invalidate all cached results when the algorithm changes. */
const LINE_DISTANCE_CACHE_VERSION = 1;

/** Maximum number of cached nearest-point results. */
const LINE_DISTANCE_CACHE_MAX = 100;

/**
 * LRU cache keyed on (version, category, center). Two questions with the same
 * center share a hit — the result depends solely on center + category.
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

// ─── Query margin ────────────────────────────────────────────────────────────

/** 50 km query window covers any plausible seeker distance. */
const MARGIN_METERS = 50_000;

/** Approximate degrees per meter at mid-latitudes (1° ≈ 111,320 m). */
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

// ─── Line buffer cache ───────────────────────────────────────────────────────

/** Increment to invalidate all cached buffer results when the algorithm changes. */
const LINE_BUFFER_CACHE_VERSION = 1;

/** Maximum number of cached buffer results. */
const LINE_BUFFER_CACHE_MAX = 50;

/**
 * LRU cache keyed on (version, category, center, radiusMeters).
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

// ─── Bbox line clipping ──────────────────────────────────────────────────────

/**
 * Clip a single line segment to an axis-aligned bbox using Liang-Barsky.
 * Returns the clipped [p0, p1] segment, or null if the segment lies entirely
 * outside the bbox.
 */
function clipSegment(
    a: Position,
    b: Position,
    bbox: Bbox,
): [Position, Position] | null {
    const [minX, minY, maxX, maxY] = bbox;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];

    let t0 = 0;
    let t1 = 1;

    const p = [-dx, dx, -dy, dy];
    const q = [a[0] - minX, maxX - a[0], a[1] - minY, maxY - a[1]];

    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            // Parallel to this edge — if outside, reject.
            if (q[i] < 0) return null;
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) {
                t0 = Math.max(t0, t);
            } else {
                t1 = Math.min(t1, t);
            }
        }
    }

    if (t0 > t1) return null;

    return [
        [a[0] + t0 * dx, a[1] + t0 * dy],
        [a[0] + t1 * dx, a[1] + t1 * dy],
    ];
}

/**
 * Clip a polyline (LineString coordinate array) to a bbox. Returns zero or
 * more clipped LineStrings — a line can enter, exit, and re-enter the bbox.
 */
function clipLineToBbox(line: Position[], bbox: Bbox): Position[][] {
    const result: Position[][] = [];
    let current: Position[] = [];

    function inside(p: Position): boolean {
        return (
            p[0] >= bbox[0] &&
            p[0] <= bbox[2] &&
            p[1] >= bbox[1] &&
            p[1] <= bbox[3]
        );
    }

    for (let i = 0; i < line.length; i++) {
        const pt = line[i];
        const ptInside = inside(pt);

        if (i === 0) {
            if (ptInside) current.push(pt);
            continue;
        }

        const prev = line[i - 1];
        const prevInside = inside(prev);

        if (prevInside && ptInside) {
            // Both inside — continue current segment.
            current.push(pt);
        } else if (prevInside && !ptInside) {
            // Exiting.
            const clipped = clipSegment(prev, pt, bbox);
            if (clipped) current.push(clipped[1]);
            result.push(current);
            current = [];
        } else if (!prevInside && ptInside) {
            // Entering.
            const clipped = clipSegment(prev, pt, bbox);
            if (clipped) current.push(clipped[0]);
            current.push(pt);
        } else {
            // Both outside — segment may still cross the bbox.
            const clipped = clipSegment(prev, pt, bbox);
            if (clipped) {
                result.push([clipped[0], clipped[1]]);
            }
        }
    }

    if (current.length > 0) result.push(current);

    return result;
}

// ─── Line buffer ─────────────────────────────────────────────────────────────

/** Fallback margin (25 km) when no play-area bbox is available. */
const FALLBACK_MARGIN_DEG = 25_000 * DEG_PER_METER;

/** Simplify tolerance — enough to collapse redundant vertices (~50 m). */
const SIMPLIFY_TOLERANCE_DEG = 0.0005;

/**
 * Builds a buffer polygon around line features near the play area.
 *
 * Pipeline:
 * 1. Expand playAreaBbox by radiusMeters → query window (or fall back to
 *    center ± 25 km if no play area).
 * 2. Filter line features to those intersecting the query window.
 * 3. Clip each feature's geometry to the query window (removes irrelevant
 *    portions of long segments).
 * 4. Simplify clipped lines to reduce vertex count.
 * 5. Merge into a MultiLineString and buffer with @turf/buffer (JSTS).
 */
export function computeLineBuffer(
    center: Position,
    category: MeasuringCategory,
    radiusMeters: number,
    playAreaBbox: Bbox | undefined,
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

    const fc = getLineBundle(category);
    if (!fc || fc.features.length === 0) {
        bufferCache.set(key, null);
        return null;
    }

    // ── 1. Build query window ────────────────────────────────────────────

    let queryBbox: Bbox;

    if (playAreaBbox) {
        // Use the play-area midpoint latitude for longitude scaling so
        // the east-west expansion is correct regardless of latitude.
        const midLat = (playAreaBbox[1] + playAreaBbox[3]) / 2;
        queryBbox = [
            playAreaBbox[0] - metersToDegLon(radiusMeters, midLat),
            playAreaBbox[1] - metersToDegLat(radiusMeters),
            playAreaBbox[2] + metersToDegLon(radiusMeters, midLat),
            playAreaBbox[3] + metersToDegLat(radiusMeters),
        ];
    } else {
        // Fallback: center ± fixed margin.
        queryBbox = [
            center[0] - FALLBACK_MARGIN_DEG,
            center[1] - FALLBACK_MARGIN_DEG,
            center[0] + FALLBACK_MARGIN_DEG,
            center[1] + FALLBACK_MARGIN_DEG,
        ];
    }

    // ── 2. Filter features by bbox intersection ──────────────────────────

    const surviving: Feature[] = [];
    for (const f of fc.features) {
        if (!bboxIntersects(featureBbox(f), queryBbox)) continue;
        surviving.push(f);
    }

    if (surviving.length === 0) {
        bufferCache.set(key, null);
        return null;
    }

    // ── 3. Clip each feature to the query window ─────────────────────────

    // Drop features whose total extent is tiny relative to the buffer
    // radius.  A 200 m spur buffered at 4 km creates a large circular
    // artifact that doesn't represent a real rail corridor.
    const minFeatureLenM = Math.min(radiusMeters * 0.1, 500);

    const clippedSegments: Position[][] = [];
    let droppedShort = 0;
    for (const f of surviving) {
        if (f.geometry.type === "LineString") {
            const coords = f.geometry.coordinates as Position[];
            if (lineLengthMeters(coords) < minFeatureLenM) {
                droppedShort++;
                continue;
            }
            for (const seg of clipLineToBbox(coords, queryBbox)) {
                if (seg.length >= 2) clippedSegments.push(seg);
            }
        } else {
            const mlCoords = (f.geometry as MultiLineString).coordinates;
            // Compute total length across all parts.
            let totalLen = 0;
            for (const line of mlCoords) {
                totalLen += lineLengthMeters(line as Position[]);
            }
            if (totalLen < minFeatureLenM) {
                droppedShort++;
                continue;
            }
            for (const line of mlCoords) {
                for (const seg of clipLineToBbox(
                    line as Position[],
                    queryBbox,
                )) {
                    if (seg.length >= 2) clippedSegments.push(seg);
                }
            }
        }
    }

    if (droppedShort > 0) {
        console.log(
            `[lineBuffer] dropped ${droppedShort} short features (< ${minFeatureLenM.toFixed(0)}m)`,
        );
    }

    console.log(
        `[lineBuffer] ${surviving.length} features in query window, ` +
            `${clippedSegments.length} clipped segments`,
    );

    if (clippedSegments.length === 0) {
        bufferCache.set(key, null);
        return null;
    }

    // ── 4. Simplify clipped segments ─────────────────────────────────────

    const simplifiedFc = simplify(
        {
            type: "FeatureCollection",
            features: clippedSegments.map((coords) => ({
                type: "Feature" as const,
                properties: {},
                geometry: { type: "LineString" as const, coordinates: coords },
            })),
        },
        {
            tolerance: SIMPLIFY_TOLERANCE_DEG,
            highQuality: false,
            mutate: false,
        },
    );

    // Extract simplified coordinates.
    const simplified: Position[][] = [];
    for (const f of simplifiedFc.features) {
        if (f.geometry.type !== "LineString") continue;
        const coords = f.geometry.coordinates as Position[];
        if (coords.length >= 2) simplified.push(coords);
    }

    if (simplified.length === 0) {
        bufferCache.set(key, null);
        return null;
    }

    let simpVerts = 0;
    for (const seg of simplified) simpVerts += seg.length;
    console.log(
        `[lineBuffer] simplified: ${simplified.length} segments, ${simpVerts} vertices`,
    );

    // ── 5. Buffer ────────────────────────────────────────────────────────

    const merged = multiLineString(simplified);
    const result = buffer(merged, radiusMeters, {
        units: "meters",
    }) as Feature<Polygon | MultiPolygon>;

    if (!result) {
        console.log(`[lineBuffer] buffer returned undefined`);
        bufferCache.set(key, null);
        return null;
    }

    console.log(`[lineBuffer] done — ${result.geometry.type}`);

    // Evict oldest entry when cache exceeds max size.
    if (bufferCache.size >= LINE_BUFFER_CACHE_MAX) {
        const oldest = bufferCache.keys().next().value;
        if (oldest !== undefined) bufferCache.delete(oldest);
    }
    bufferCache.set(key, result);

    return result;
}

// ─── Bbox helpers ────────────────────────────────────────────────────────────

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

// ─── Main algorithm ──────────────────────────────────────────────────────────

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

    if (lines.length === 0) {
        distanceCache.set(key, null);
        return null;
    }

    const snapped = nearestPointOnLine(multiLineString(lines), point(center));
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

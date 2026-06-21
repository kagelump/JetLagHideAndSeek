import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import { bboxIntersects, type Bbox, type Position } from "@/shared/geojson";
import { getGeometryBackend } from "@/shared/geometry/geometryBackend";
import { MEASURING_LINE } from "@/config/appConfig";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    Polygon,
    MultiPolygon,
} from "geojson";
import { featureBbox, computeBboxFromCoords } from "./lineDistanceComputation";
import { createLogger } from "@/shared/logger";

const log = createLogger("lineClipping");

// ─── ε-dilated clip polygon ────────────────────────────────────────────────

const CLIP_DILATION_M = MEASURING_LINE.clipDilationM;

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

    // Buffer the boundary FeatureCollection to get an ε-dilated polygon.
    // 8 quadrantSegments matches @turf/buffer's default steps (turf defaults
    // to 8, which is fine for a tiny 30 m dilation).
    const dilated: Feature<Polygon | MultiPolygon> =
        getGeometryBackend().bufferMeters(
            boundary as FeatureCollection<Polygon | MultiPolygon>,
            CLIP_DILATION_M,
            8,
        ) ?? boundary.features[0];

    if (!dilated || !dilated.geometry) {
        // Fallback: return the first feature as-is (should never happen).
        log.warn("[dilatedPlayArea] buffer returned empty; using raw boundary");
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

// ─── Clipped line cache ────────────────────────────────────────────────────

/** Increment to invalidate all cached clipped-line results. */
const CLIPPED_LINE_CACHE_VERSION = 1;

const CLIPPED_LINE_CACHE_MAX = MEASURING_LINE.clippedLineCacheMax;

const clippedLineCache = new Map<
    string,
    Feature<LineString | MultiLineString>[]
>();

/**
 * Returns a stable cache key for the clipped-line cache, keyed on
 * (version, category, play-area bbox). The bbox uniquely identifies the
 * play area for practical purposes; it is stable across renders.
 */
export function makeClippedLineCacheKey(category: string, bbox: Bbox): string {
    return [
        CLIPPED_LINE_CACHE_VERSION,
        category,
        ...bbox.map((v) => v.toFixed(4)),
    ].join(":");
}

/**
 * Cached wrapper around `clipLineFeaturesToPlayArea`. On cache miss
 * delegates to the pure clip function; on hit returns the cached array.
 * Evicts the oldest entry when the cache exceeds the max size.
 */
export function getClippedLineFeaturesCached(
    features: Feature<LineString | MultiLineString>[],
    dilatedPlayArea: Feature<Polygon | MultiPolygon>,
    playAreaBbox: Bbox,
    cacheKey: string,
): Feature<LineString | MultiLineString>[] {
    const cached = clippedLineCache.get(cacheKey);
    if (cached) return cached;

    const result = clipLineFeaturesToPlayArea(
        features,
        dilatedPlayArea,
        playAreaBbox,
    );

    // Evict oldest entry when cache exceeds max size.
    if (clippedLineCache.size >= CLIPPED_LINE_CACHE_MAX) {
        const oldest = clippedLineCache.keys().next().value;
        if (oldest !== undefined) clippedLineCache.delete(oldest);
    }
    clippedLineCache.set(cacheKey, result);

    return result;
}

/** Test seam: clear the clipped-line cache. */
export function clearClippedLineCache(): void {
    clippedLineCache.clear();
}

// ─── Line–polygon clip ─────────────────────────────────────────────────────

/**
 * Clips each feature to the dilated play-area boundary.
 *
 * Uses a vertex-based clip (O(n) per ring): runs of consecutive inside
 * vertices are emitted as separate LineStrings. An `isFullyInside`
 * fast-path short-circuits rings entirely inside the polygon.
 *
 * Bbox pre-filter (P6-A): features and individual rings whose bbox does
 * not intersect the play-area bbox are rejected before any
 * point-in-polygon tests, eliminating the dominant cost for the large
 * fraction of features that lie entirely outside the play area.
 *
 * @param playAreaBbox Optional pre-computed bbox of the play area. When
 *   omitted, computed from `dilatedPlayArea.geometry`.
 */
export function clipLineFeaturesToPlayArea(
    features: Feature<LineString | MultiLineString>[],
    dilatedPlayArea: Feature<Polygon | MultiPolygon>,
    playAreaBbox?: Bbox,
): Feature<LineString | MultiLineString>[] {
    const result: Feature<LineString | MultiLineString>[] = [];
    const tStart = performance.now();

    // Compute dilated bbox once (A).
    const clipBbox =
        playAreaBbox ?? computeBboxFromCoords(dilatedPlayArea.geometry);

    let totalLines = 0;
    for (const f of features) {
        if (f.geometry.type === "MultiLineString") {
            totalLines += (f.geometry as MultiLineString).coordinates.length;
        } else {
            totalLines += 1;
        }
    }

    for (const f of features) {
        // A: Per-feature bbox pre-filter — drop features entirely outside
        // the play-area bbox before any ring-level work.
        if (!bboxIntersects(featureBbox(f), clipBbox)) continue;

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
                clipBbox,
            );
            if (clipped) result.push(clipped);
        }
    }

    const tTotalMs = performance.now() - tStart;
    log.debug(
        `[clipLineFeatures] done: ${features.length} → ${result.length} features ` +
            `(${totalLines} lines) in ${tTotalMs.toFixed(0)}ms`,
    );

    return result;
}

/**
 * B: Vertex-based clip for a single LineString. Runs of consecutive
 * inside vertices are emitted as separate pieces. Fully-inside lines
 * are returned unchanged (fast path).
 */
function clipLineString(
    feature: Feature<LineString>,
    polygon: Feature<Polygon | MultiPolygon>,
): Feature<LineString | MultiLineString> | null {
    const coords = feature.geometry.coordinates as Position[];

    // Fast path: all vertices inside → return unchanged.
    if (isFullyInside(coords, polygon)) return feature;

    // B: Vertex-based clip — O(n) single pass.
    const pieces = clipCoordsToPolygon(coords, polygon);
    if (pieces.length === 0) return null;

    if (pieces.length === 1) {
        return {
            type: "Feature",
            properties: { ...feature.properties },
            geometry: {
                type: "LineString",
                coordinates: pieces[0],
            },
        };
    }

    return {
        type: "Feature",
        properties: { ...feature.properties },
        geometry: {
            type: "MultiLineString",
            coordinates: pieces,
        },
    };
}

/**
 * B: Vertex-based clip for a MultiLineString. Each ring is independently
 * clipped; the surviving pieces are recombined. Rings whose bbox does
 * not intersect `playAreaBbox` are skipped entirely (P6-A).
 */
function clipMultiLineString(
    feature: Feature<MultiLineString>,
    polygon: Feature<Polygon | MultiPolygon>,
    playAreaBbox?: Bbox,
): Feature<LineString | MultiLineString> | null {
    const lines = feature.geometry.coordinates;
    const allPieces: Position[][] = [];
    for (let li = 0; li < lines.length; li++) {
        const coords = lines[li] as Position[];
        if (coords.length < 2) continue;

        // A: Per-ring bbox pre-filter.
        if (playAreaBbox) {
            const ringBbox = computeRingBbox(coords);
            if (!bboxIntersects(ringBbox, playAreaBbox)) continue;
        }

        // Fast path: fully inside → keep as-is.
        if (isFullyInside(coords, polygon)) {
            allPieces.push(coords);
            continue;
        }

        // B: Vertex-based clip.
        const pieces = clipCoordsToPolygon(coords, polygon);
        if (pieces.length > 0) allPieces.push(...pieces);
    }

    if (allPieces.length === 0) return null;

    if (allPieces.length === 1) {
        return {
            type: "Feature",
            properties: { ...feature.properties },
            geometry: {
                type: "LineString",
                coordinates: allPieces[0],
            },
        };
    }

    return {
        type: "Feature",
        properties: { ...feature.properties },
        geometry: {
            type: "MultiLineString",
            coordinates: allPieces,
        },
    };
}

// ─── Clip helpers ──────────────────────────────────────────────────────────

/** Bbox of a single coordinate array (lightweight, no recursion). */
function computeRingBbox(coords: Position[]): Bbox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of coords) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
}

/** True when every coord is inside the polygon. */
function isFullyInside(
    coords: Position[],
    polygon: Feature<Polygon | MultiPolygon>,
): boolean {
    return coords.every((c) => booleanPointInPolygon(c, polygon));
}

/**
 * Vertex-based clip: runs of consecutive inside vertices emitted as
 * separate LineStrings. O(n) per ring — one point-in-polygon test per
 * vertex. This is the primary clip path (P6-B).
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

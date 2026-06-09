import nearestPointOnLine from "@turf/nearest-point-on-line";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { multiLineString, point } from "@turf/helpers";

import {
    bboxIntersects,
    haversineDistanceMeters,
    type Bbox,
    type Position,
} from "@/shared/geojson";
import { getGeometryBackend } from "@/shared/geometry/geometryBackend";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    Polygon,
    MultiPolygon,
} from "geojson";
import type { MeasuringCategory } from "./measuringTypes";
import { getLineBundleSources } from "./lineBundleLoader";
import {
    APP_CONFIG,
    MEASURING_LINE,
    simplifyTolerance,
    polySimplifyTolerance,
    minFeatureLength,
} from "@/config/appConfig";

/** Feature type that includes both line and polygon geometry. */
type LineOrPolygonFeature = Feature<
    LineString | MultiLineString | Polygon | MultiPolygon
>;

export type NearestPointResult = {
    /** Nearest point on the line/edge (GeoJSON [lon, lat]). */
    nearestPoint: Position;
    /** Haversine distance in meters from `center` to `nearestPoint`. */
    distanceMeters: number;
};

// ─── Central line computation ──────────────────────────────────────────

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
    windowFeatures: LineOrPolygonFeature[];
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
): LineOrPolygonFeature[] {
    const tLoad0 = performance.now();
    const bundles = getLineBundleSources(category);
    const tLoadMs = performance.now() - tLoad0;
    if (bundles.length === 0) return [];

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

    const tIter0 = performance.now();
    const result: LineOrPolygonFeature[] = [];
    let totalFeatures = 0;
    for (const fc of bundles) {
        totalFeatures += fc.features.length;
        for (const f of fc.features) {
            if (bboxIntersects(featureBbox(f as Feature), queryBbox)) {
                result.push(f as LineOrPolygonFeature);
            }
        }
    }
    const tIterMs = performance.now() - tIter0;
    console.log(
        `[selectWindow] bundle load: ${tLoadMs.toFixed(0)}ms, ` +
            `bbox scan ${totalFeatures} features → ${result.length} hits ` +
            `in ${tIterMs.toFixed(0)}ms`,
    );
    return result;
}

// ─── computeLineCategory cache ─────────────────────────────────────────

/** Increment to invalidate all cached line-category results. */
const LINE_CATEGORY_CACHE_VERSION = 2;

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

    const marginM = Math.max(
        distance.distanceMeters,
        MEASURING_LINE.minWindowMarginM,
    );
    const tWindow0 = performance.now();
    const windowFeatures = selectWindowFeatures(
        category,
        playAreaBbox,
        center,
        marginM,
    );
    const tWindowMs = performance.now() - tWindow0;
    console.log(
        `[lineCategory] selectWindowFeatures: ${windowFeatures.length} features ` +
            `in window (margin=${marginM.toFixed(0)}m) in ${tWindowMs.toFixed(0)}ms`,
    );

    const result: LineCategoryComputation = {
        nearestPoint: distance.nearestPoint,
        distanceMeters: distance.distanceMeters,
        windowFeatures,
    };

    // Evict oldest entry when cache exceeds max size.
    if (categoryCache.size >= MEASURING_LINE.categoryCacheMax) {
        const oldest = categoryCache.keys().next().value;
        if (oldest !== undefined) categoryCache.delete(oldest);
    }
    categoryCache.set(key, result);

    return result;
}

// --- LRU cache ----------------------------------------------------------------

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

// --- Query margin -------------------------------------------------------------

const { degPerMeter: DEG_PER_METER } = APP_CONFIG.measuring;

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

/**
 * Simplifies each ring of a Polygon or MultiPolygon geometry using
 * Douglas-Peucker. Returns null if the geometry degenerates (all rings
 * collapse to < 3 coords).
 */
function simplifyPolygonCoords(
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

// --- Line buffer cache --------------------------------------------------------

/** Increment to invalidate all cached buffer results when the algorithm changes. */
const LINE_BUFFER_CACHE_VERSION = 5;

// ─── Buffer input budget ─────────────────────────────────────────────────

const {
    maxBufferSegments: MAX_BUFFER_SEGMENTS,
    maxBufferCoords: MAX_BUFFER_COORDS,
    bufferSteps: BUFFER_STEPS,
    bufferCacheMax: LINE_BUFFER_CACHE_MAX,
} = MEASURING_LINE;

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

// --- Line buffer input budget ------------------------------------------------

/**
 * Applies a bounded escalation loop to drop/simplify line segments until
 * they fit within `MAX_BUFFER_SEGMENTS` and `MAX_BUFFER_COORDS`.
 *
 * Exported for direct unit-testing so tests can assert budget enforcement
 * without also exercising the full `@turf/buffer` path.
 *
 * @returns the budget-constrained set of coordinate arrays (may be empty).
 */
export function applyBufferBudget(
    lines: Position[][],
    radiusMeters: number,
): Position[][] {
    let working = lines;
    let tol = simplifyTolerance(radiusMeters);

    for (let round = 0; round < MEASURING_LINE.budgetMaxRounds; round++) {
        const segs = working.length;
        const coords = working.reduce((s, l) => s + l.length, 0);
        if (segs <= MAX_BUFFER_SEGMENTS && coords <= MAX_BUFFER_COORDS) {
            if (round > 0) {
                console.log(
                    `[lineBuffer] budget met after ${round} escalation round(s): ` +
                        `${segs} segs, ${coords} coords`,
                );
            }
            return working;
        }
        tol *= 2;
        const lenFloor = tol * 4; // drop features shorter than the new tolerance band
        working = working
            .filter((l) => lineLengthMeters(l) >= lenFloor)
            .map((l) => simplifyCoords(l, tol));
    }

    // Final round: enforce hard caps by keeping the largest features.
    console.log(
        `[lineBuffer] budget escalation exhausted (6 rounds), ` +
            `enforcing hard cap: ${working.length} → ${MAX_BUFFER_SEGMENTS} segs`,
    );
    // Sort by coordinate count descending (longest features first).
    working.sort((a, b) => b.length - a.length);
    working = working.slice(0, MAX_BUFFER_SEGMENTS);
    // Re-simplify at a high tolerance for the survivors.
    working = working.map((l) => simplifyCoords(l, tol));
    // If still over coord budget, truncate each line.
    const coords = working.reduce((s, l) => s + l.length, 0);
    if (coords > MAX_BUFFER_COORDS) {
        const ratio = MAX_BUFFER_COORDS / coords;
        working = working.map((l) =>
            l.slice(0, Math.max(2, Math.floor(l.length * ratio))),
        );
    }

    return working;
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
    windowFeatures: LineOrPolygonFeature[],
    radiusMeters: number,
): Feature<Polygon | MultiPolygon> | null {
    if (radiusMeters <= 0) return null;
    if (windowFeatures.length === 0) return null;

    // -- Separate polygon features from line features. -------------------------
    // Polygon categories (e.g. body-of-water) ship dissolved polygons that
    // can be buffered directly — no line assembly needed.

    const polyFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const lineFeatures: Feature<LineString | MultiLineString>[] = [];
    for (const f of windowFeatures) {
        const g = f.geometry;
        if (g.type === "Polygon" || g.type === "MultiPolygon") {
            polyFeatures.push(f as Feature<Polygon | MultiPolygon>);
        } else {
            lineFeatures.push(f as Feature<LineString | MultiLineString>);
        }
    }

    // -- 1. Polygon buffer path -------------------------------------------------

    const polygonBuffers: Feature<Polygon | MultiPolygon>[] = [];

    if (polyFeatures.length > 0) {
        // Simplify polygons before buffering (same tolerance as line path).
        const simplifyTol = simplifyTolerance(radiusMeters);

        // Count total coords for budget check.
        let totalPolyCoords = 0;
        const walkCoords = (c: unknown) => {
            if (Array.isArray(c) && typeof c[0] === "number") {
                totalPolyCoords++;
            } else if (Array.isArray(c)) {
                for (const item of c) walkCoords(item);
            }
        };
        for (const pf of polyFeatures) {
            walkCoords(pf.geometry.coordinates);
        }

        // If polygon coords exceed budget, simplify more aggressively.
        let polyTol = simplifyTol;
        if (totalPolyCoords > MAX_BUFFER_COORDS) {
            polyTol = polySimplifyTolerance(radiusMeters);
            console.log(
                `[lineBuffer] polygon budget: ${totalPolyCoords} coords → ` +
                    `simplify at ${polyTol.toFixed(0)}m`,
            );
        }

        for (const pf of polyFeatures) {
            // Simplify polygon rings.
            let geom = pf.geometry;
            if (polyTol > 0) {
                const simplified = simplifyPolygonCoords(geom, polyTol);
                if (!simplified) continue;
                geom = simplified;
            }

            // Buffer the dissolved polygon directly.
            try {
                const buf = getGeometryBackend().bufferMeters(
                    { type: "Feature", properties: {}, geometry: geom },
                    radiusMeters,
                    BUFFER_STEPS,
                );
                if (buf) polygonBuffers.push(buf);
            } catch (err) {
                console.warn(
                    `[lineBuffer] [${getGeometryBackend().name}] polygon buffer failed:`,
                    err,
                );
            }
        }

        console.log(
            `[lineBuffer] [${getGeometryBackend().name}] polygon path: ${polyFeatures.length} polys, ` +
                `${totalPolyCoords} coords → ${polygonBuffers.length} buffers`,
        );
    }

    // -- 2. Line buffer path (existing logic) -----------------------------------

    let lineBufferResult: Feature<Polygon | MultiPolygon> | null = null;

    if (lineFeatures.length > 0) {
        const minFeatureLenM = minFeatureLength(radiusMeters);

        const lines: Position[][] = [];
        let droppedShort = 0;
        for (const f of lineFeatures) {
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
            `[lineBuffer] ${lineFeatures.length} features in window, ` +
                `${lines.length} segments, ${totalCoords} total coords`,
        );

        if (lines.length > 0) {
            // Defensive: filter out lines with non-numeric / non-finite coordinates.
            let cleanBufLines = lines.filter(
                (coords) =>
                    coords.length >= 2 && coords.every((c) => isValidCoord(c)),
            );

            // Remove consecutive duplicate coordinates.
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

            if (cleanBufLines.length > 0) {
                const cleanCoords = cleanBufLines.reduce(
                    (sum, l) => sum + l.length,
                    0,
                );

                const simplifyTol = simplifyTolerance(radiusMeters);
                const simplifiedLines = cleanBufLines.map((coords) =>
                    simplifyCoords(coords, simplifyTol),
                );
                const simpleCoords = simplifiedLines.reduce(
                    (sum, l) => sum + l.length,
                    0,
                );

                console.log(
                    `[lineBuffer] after dedup: ${cleanBufLines.length} segs, ` +
                        `${cleanCoords} coords → simplify(${simplifyTol.toFixed(0)}m): ` +
                        `${simpleCoords} coords`,
                );

                const budgetedLines = applyBufferBudget(
                    simplifiedLines,
                    radiusMeters,
                );

                if (budgetedLines.length > 0) {
                    let merged;
                    try {
                        merged = multiLineString(budgetedLines);
                    } catch (err) {
                        console.warn(
                            `[lineBuffer] multiLineString failed:`,
                            err,
                        );
                    }

                    if (merged) {
                        const t0 = performance.now();
                        try {
                            lineBufferResult =
                                getGeometryBackend().bufferMeters(
                                    merged,
                                    radiusMeters,
                                    BUFFER_STEPS,
                                );
                        } catch (err) {
                            console.warn(
                                `[lineBuffer] [${getGeometryBackend().name}] buffer failed:`,
                                err,
                            );
                        }
                        const bufferMs = performance.now() - t0;
                        if (lineBufferResult) {
                            console.log(
                                `[lineBuffer] [${getGeometryBackend().name}] line buffer done: ` +
                                    `${lineBufferResult.geometry.type} in ${bufferMs.toFixed(0)}ms`,
                            );
                        }
                    }
                }
            }
        }
    }

    // -- 3. Combine line and polygon buffer results -----------------------------

    if (polygonBuffers.length === 0 && !lineBufferResult) return null;
    if (polygonBuffers.length === 0) return lineBufferResult;
    if (!lineBufferResult && polygonBuffers.length === 1) {
        return polygonBuffers[0];
    }

    // Combine all buffer results into one MultiPolygon.
    const allBuffers: Feature<Polygon | MultiPolygon>[] =
        polygonBuffers.slice();
    if (lineBufferResult) allBuffers.push(lineBufferResult);

    // No combine needed for a single result.
    if (allBuffers.length === 1) return allBuffers[0];

    // Merge every buffer piece into one MultiPolygon feature.
    //
    // A multi-piece category like body-of-water yields ~40 heavily-overlapping
    // buffer pieces (dissolved water polygons + river lines). The merge is a
    // cheap concatenation and is geometrically a union, but its members
    // overlap. The downstream play-area mask runs polyclip
    // `difference(playArea, eligibleArea)` — and polyclip's sweepline cost
    // explodes on the mutual intersections of dozens of overlapping ribbons,
    // hard-locking the render. So we dissolve the merge into clean,
    // non-overlapping geometry that polyclip differences in ~ms.
    const merged = mergeBuffersToMultiPolygon(allBuffers);

    // The dissolve uses a 0-radius buffer — the standard union/clean idiom
    // (GEOS and JSTS both unary-union a self-overlapping MultiPolygon at
    // distance 0). Pass a single Feature, NOT a FeatureCollection:
    // `bufferMeters(fc, 0)` does not union — the backend buffers each feature
    // independently and returns only the first result (see geometryBackend).
    //
    // Only the native GEOS backend can dissolve this pathological input
    // cheaply; the pure-JS (JSTS) oracle takes ~25 s on the real body-of-water
    // window. GEOS is the production backend (the mask itself is polyclip-JS
    // and relies on this dissolve to stay responsive), so when GEOS is
    // unavailable we return the un-dissolved merge — still correct, just
    // heavier for the mask — rather than block the render thread here.
    const backend = getGeometryBackend();
    if (backend.name !== "geos") return merged;

    try {
        const dissolved = backend.bufferMeters(merged, 0, BUFFER_STEPS);
        if (dissolved) return dissolved;
    } catch (err) {
        console.warn(`[lineBuffer] dissolve(merged buffers) failed:`, err);
    }

    return merged;
}

/**
 * Flattens a set of Polygon/MultiPolygon buffer features into a single
 * MultiPolygon feature by concatenating their polygon coordinate arrays.
 * Members may overlap — callers dissolve the result before use.
 */
function mergeBuffersToMultiPolygon(
    buffers: Feature<Polygon | MultiPolygon>[],
): Feature<MultiPolygon> {
    const polygons: Position[][][] = [];
    for (const f of buffers) {
        const g = f.geometry;
        if (g.type === "Polygon") {
            polygons.push(g.coordinates as Position[][]);
        } else {
            for (const poly of g.coordinates) {
                polygons.push(poly as Position[][]);
            }
        }
    }
    return {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: polygons },
    };
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
    windowFeatures: LineOrPolygonFeature[],
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

// --- Polygon → boundary rings converter -------------------------------------

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

/**
 * Converts polygon features in a mixed array to their boundary LineString
 * features for reference-line rendering. Line features pass through unchanged.
 */
export function polygonFeaturesToLineFeatures(
    features: LineOrPolygonFeature[],
): Feature<LineString | MultiLineString>[] {
    const result: Feature<LineString | MultiLineString>[] = [];
    for (const f of features) {
        const geom = f.geometry;
        if (geom.type === "LineString" || geom.type === "MultiLineString") {
            result.push(f as Feature<LineString | MultiLineString>);
            continue;
        }
        // Polygon → boundary LineString(s).
        const rings = featureToRings(f);
        if (rings.length === 1) {
            result.push({
                type: "Feature",
                properties: { ...f.properties },
                geometry: {
                    type: "LineString",
                    coordinates: rings[0],
                },
            });
        } else if (rings.length > 1) {
            result.push({
                type: "Feature",
                properties: { ...f.properties },
                geometry: {
                    type: "MultiLineString",
                    coordinates: rings,
                },
            });
        }
    }
    return result;
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

// ─── ε-dilated clip polygon ────────────────────────────────────────────

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

// ─── Clipped line cache (P6-C) ──────────────────────────────────────────

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

// ─── Line–polygon clip ─────────────────────────────────────────────────

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
    console.log(
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
            geometry: { type: "LineString", coordinates: pieces[0] },
        };
    }

    return {
        type: "Feature",
        properties: { ...feature.properties },
        geometry: { type: "MultiLineString", coordinates: pieces },
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

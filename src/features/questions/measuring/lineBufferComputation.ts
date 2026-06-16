import { multiLineString } from "@turf/helpers";

import { type Position } from "@/shared/geojson";
import { getGeometryBackend } from "@/shared/geometry/geometryBackend";
import {
    MEASURING_LINE,
    simplifyTolerance,
    polySimplifyTolerance,
    minFeatureLength,
} from "@/config/appConfig";
import type {
    Feature,
    LineString,
    MultiLineString,
    Polygon,
    MultiPolygon,
} from "geojson";
import type { MeasuringCategory } from "./measuringTypes";
import type { LineOrPolygonFeature } from "./lineMeasuringGeometry";
import {
    isValidCoord,
    simplifyCoords,
    simplifyPolygonCoords,
    lineLengthMeters,
} from "./lineDistanceComputation";

// ─── Buffer cache ──────────────────────────────────────────────────────────

/** Increment to invalidate all cached buffer results when the algorithm changes. */
const LINE_BUFFER_CACHE_VERSION = 5;

// ─── Buffer input budget ───────────────────────────────────────────────────

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

// ─── Uniform subsampling ───────────────────────────────────────────────────

/**
 * Uniform subsampling: selects `target` evenly-spaced points along the
 * coordinate array. Always preserves first and last vertex so the shape
 * stays anchored. When `target >= l.length` returns a shallow copy.
 *
 * This is the shape-preserving hard-cap fallback in `applyBufferBudget` —
 * it degrades resolution uniformly across the whole polyline instead of
 * slicing to a prefix, which would collapse the shape to a straight capsule.
 */
function uniformlySubsample(l: Position[], target: number): Position[] {
    if (target >= l.length) return [...l];
    const result: Position[] = [];
    const step = (l.length - 1) / (target - 1);
    for (let i = 0; i < target; i++) {
        result.push(l[Math.round(i * step)]);
    }
    return result;
}

// ─── Buffer budget ─────────────────────────────────────────────────────────

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
    // If still over coord budget, uniformly subsample each line so the
    // shape degrades in resolution rather than collapsing to a straight
    // capsule from a prefix slice.
    const coords = working.reduce((s, l) => s + l.length, 0);
    if (coords > MAX_BUFFER_COORDS) {
        const ratio = MAX_BUFFER_COORDS / coords;
        working = working.map((l) =>
            uniformlySubsample(l, Math.max(2, Math.floor(l.length * ratio))),
        );
    }

    return working;
}

// ─── Line buffer ───────────────────────────────────────────────────────────

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
                    {
                        type: "Feature",
                        properties: {},
                        geometry: geom,
                    },
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

    // Dissolve the self-overlapping MultiPolygon into clean geometry via
    // unaryUnion (G5). The 0-radius buffer trick (`bufferMeters(merged, 0)`)
    // was a stand-in for GEOSUnaryUnion — `unaryUnion` is the correct
    // semantic and doesn't need a misleading `bufferSteps` argument.
    //
    // Only the native GEOS backend can dissolve this pathological input
    // cheaply; the pure-JS (polyclip-ts) oracle takes ~25 s on the real
    // body-of-water window. GEOS is the production backend, so when GEOS is
    // unavailable we return the un-dissolved merge — still correct, just
    // heavier for the mask — rather than block the render thread here.
    const backend = getGeometryBackend();
    if (backend.name !== "geos") return merged;

    try {
        const dissolved = backend.unaryUnion(merged);
        if (dissolved) return dissolved;
    } catch (err) {
        console.warn(`[lineBuffer] dissolve(merged buffers) failed:`, err);
    }

    return merged;
}

// ─── Buffer merge ──────────────────────────────────────────────────────────

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
        geometry: {
            type: "MultiPolygon",
            coordinates: polygons,
        },
    };
}

// ─── Cached buffer ─────────────────────────────────────────────────────────

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

import { multiLineString } from "@turf/helpers";

import { type Position } from "@/shared/geojson";
import { createLogger } from "@/shared/logger";
import {
    getGeometryBackend,
    type GeometryBackend,
} from "@/shared/geometry/geometryBackend";
import { polygonAreaM2 } from "@/shared/geometry/parityMetrics";
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

const log = createLogger("lineBuffer");

// ─── Buffer cache ──────────────────────────────────────────────────────────

/** Increment to invalidate all cached buffer results when the algorithm changes. */
const LINE_BUFFER_CACHE_VERSION = 8;

// ─── Buffer input budget ───────────────────────────────────────────────────

const {
    maxBufferSegments: MAX_BUFFER_SEGMENTS,
    maxBufferCoords: MAX_BUFFER_COORDS,
    bufferSteps: BUFFER_STEPS,
    bufferCacheMax: LINE_BUFFER_CACHE_MAX,
    polyMemberSimplifyCoordLimit: POLY_MEMBER_SIMPLIFY_COORD_LIMIT,
    degenerateWaterPolygonAreaM2: DEGENERATE_WATER_POLYGON_AREA_M2,
} = MEASURING_LINE;

/** Coord count of one member polygon (outer ring + holes). */
function memberCoordCount(poly: Position[][]): number {
    let n = 0;
    for (const ring of poly) n += ring.length;
    return n;
}

/**
 * Simplifies polygon buffer-input features with a **per-member** tolerance.
 *
 * The previous logic picked one tolerance for every member from the *total*
 * coord count: a dissolved water bundle ships a few continent-scale
 * MultiPolygons, so the total always blew the budget and *every* member —
 * including small, narrow water bodies like a river mouth — was simplified at
 * the aggressive `polySimplifyTolerance` (~50 m). Per-ring Douglas–Peucker at
 * 50 m sharpens narrow inlets, and a buffer wider than the inlet then self-
 * intersects into a concave notch on the land side (the body-of-water masking
 * artifact; see docs/water-bundle-notes-handoff1.md).
 *
 * Deciding tolerance per member keeps small/narrow members gentle (so inlets
 * survive) while still simplifying genuinely huge coastlines aggressively to
 * bound the buffer op. Combined with member-level bbox windowing upstream
 * (`filterPolygonMembersByBbox`), the buffered geometry stays small.
 */
export function simplifyPolygonBufferFeatures(
    polyFeatures: Feature<Polygon | MultiPolygon>[],
    radiusMeters: number,
): Feature<Polygon | MultiPolygon>[] {
    if (polyFeatures.length === 0) return [];
    const gentleTol = simplifyTolerance(radiusMeters);
    const aggressiveTol = polySimplifyTolerance(radiusMeters);

    const simplifyMember = (poly: Position[][]): Position[][] | null => {
        const tol =
            memberCoordCount(poly) > POLY_MEMBER_SIMPLIFY_COORD_LIMIT
                ? aggressiveTol
                : gentleTol;
        const simplified = simplifyPolygonCoords(
            { type: "Polygon", coordinates: poly },
            tol,
        );
        if (!simplified) return null;
        const coords = simplified.coordinates as Position[][];
        // Drop degenerate slivers: a near-zero-area member buffers (via GEOS
        // MakeValid) into a spurious circular blob in the mask. Defends against
        // already-shipped bundles; the pack pipeline also filters these.
        if (polygonAreaM2(coords) < DEGENERATE_WATER_POLYGON_AREA_M2) {
            return null;
        }
        return coords;
    };

    const out: Feature<Polygon | MultiPolygon>[] = [];
    for (const pf of polyFeatures) {
        const g = pf.geometry;
        if (g.type === "Polygon") {
            const simplified = simplifyMember(g.coordinates as Position[][]);
            if (!simplified) continue;
            out.push({
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: simplified },
            });
            continue;
        }
        const members: Position[][][] = [];
        for (const poly of g.coordinates as Position[][][]) {
            const simplified = simplifyMember(poly);
            if (simplified) members.push(simplified);
        }
        if (members.length === 0) continue;
        out.push({
            type: "Feature",
            properties: {},
            geometry: { type: "MultiPolygon", coordinates: members },
        });
    }
    return out;
}

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
                log.debug(
                    `budget met after ${round} escalation round(s): ` +
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
    log.debug(
        `budget escalation exhausted (6 rounds), ` +
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
        // Simplify each polygon member by its own size (small/narrow members
        // stay gentle so inlets survive; only huge coastlines are simplified
        // aggressively). A single global tolerance over a giant dissolved
        // water MultiPolygon notched narrow river mouths — see
        // simplifyPolygonBufferFeatures.
        const prepared = simplifyPolygonBufferFeatures(
            polyFeatures,
            radiusMeters,
        );

        for (const geomFeat of prepared) {
            // Buffer the dissolved polygon directly.
            try {
                const buf = getGeometryBackend().bufferMeters(
                    geomFeat,
                    radiusMeters,
                    BUFFER_STEPS,
                );
                if (buf) polygonBuffers.push(buf);
            } catch (err) {
                log.warn(
                    `[${getGeometryBackend().name}] polygon buffer failed:`,
                    err,
                );
            }
        }

        log.debug(
            `[${getGeometryBackend().name}] polygon path: ` +
                `${polyFeatures.length} input polys → ${prepared.length} ` +
                `prepared → ${polygonBuffers.length} buffers`,
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
            log.debug(
                `dropped ${droppedShort} short features (< ${minFeatureLenM.toFixed(0)}m)`,
            );
        }

        const totalCoords = lines.reduce((sum, l) => sum + l.length, 0);

        log.debug(
            `${lineFeatures.length} features in window, ` +
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

                log.debug(
                    `after dedup: ${cleanBufLines.length} segs, ` +
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
                        log.warn(`multiLineString failed:`, err);
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
                            log.warn(
                                `[${getGeometryBackend().name}] buffer failed:`,
                                err,
                            );
                        }
                        const bufferMs = performance.now() - t0;
                        if (lineBufferResult) {
                            log.debug(
                                `[${getGeometryBackend().name}] line buffer done: ` +
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

    // Combine all buffer results into one feature.
    const allBuffers: Feature<Polygon | MultiPolygon>[] =
        polygonBuffers.slice();
    if (lineBufferResult) allBuffers.push(lineBufferResult);

    // No combine needed for a single result.
    if (allBuffers.length === 1) return allBuffers[0];

    // A multi-piece category like body-of-water yields ~40 heavily-overlapping
    // buffer pieces (dissolved water polygons + river lines). We must dissolve
    // them into clean, non-overlapping geometry: the downstream play-area mask
    // runs `difference(playArea, eligibleArea)`, and an overlapping eligible
    // geometry both blows up the polyclip sweepline (JS oracle) and trips the
    // GEOS op core's MakeValid (see below).
    const backend = getGeometryBackend();

    // Non-GEOS (JS oracle): polyclip union of dozens of overlapping ribbons is
    // ~25 s on the real body-of-water window. Keep the historical behavior and
    // return the un-dissolved merge — still correct coverage, just heavier for
    // the mask — rather than block the render thread here.
    if (backend.name !== "geos") {
        return mergeBuffersToMultiPolygon(allBuffers);
    }

    // GEOS: dissolve by folding **binary** GEOSUnion over the individually-valid
    // buffer pieces.
    //
    // Do NOT concatenate the pieces into one MultiPolygon and `unaryUnion` that:
    // overlapping members make the MultiPolygon invalid, so the op core's
    // `parse → validate → MakeValid → op` pipeline runs `GEOSMakeValid` first,
    // and its even-odd *linework* reconstruction turns doubly-covered overlaps
    // (e.g. a water-area buffer overlapping the river-line buffer at a junction)
    // into HOLES — punching the body-of-water "dark circle" notch into the mask.
    // Binary union over inputs that are each individually valid never triggers
    // MakeValid, so it stays a true OR. See docs/water-bundle-notes-handoff2.md.
    try {
        const dissolved = dissolveBuffersByBinaryUnion(allBuffers, backend);
        if (dissolved) return dissolved;
    } catch (err) {
        log.warn(`binary-union dissolve failed:`, err);
    }

    // Fallback: un-dissolved merge. Correct coverage; heavier downstream, and
    // (on GEOS) re-exposed to the MakeValid notch in the mask difference — but
    // only reached if every binary union failed, which is not expected.
    return mergeBuffersToMultiPolygon(allBuffers);
}

/**
 * Dissolve a set of buffer pieces into one clean (valid, non-overlapping)
 * feature by folding **binary** `GeometryBackend.union` over them in a balanced
 * pairwise tree.
 *
 * Each input piece is an individually-valid GEOS buffer result, and binary
 * `union` of two valid geometries yields a valid result — so the op core never
 * runs `MakeValid`. This avoids the even-odd hole punched when an *overlapping*
 * MultiPolygon is `unaryUnion`'d (the MakeValid pre-step reinterprets
 * doubly-covered overlaps as holes). See docs/water-bundle-notes-handoff2.md.
 *
 * The balanced tree keeps intermediate accumulators small (≈ log₂N union
 * depth) instead of repeatedly re-unioning one growing accumulator.
 *
 * Returns `null` if any union fails (caller falls back to the un-dissolved
 * merge) or the input is empty.
 *
 * @internal Exported for tests.
 */
export function dissolveBuffersByBinaryUnion(
    buffers: Feature<Polygon | MultiPolygon>[],
    backend: GeometryBackend,
): Feature<Polygon | MultiPolygon> | null {
    if (buffers.length === 0) return null;
    let layer = buffers;
    while (layer.length > 1) {
        const next: Feature<Polygon | MultiPolygon>[] = [];
        for (let i = 0; i < layer.length; i += 2) {
            if (i + 1 >= layer.length) {
                next.push(layer[i]);
                continue;
            }
            const u = backend.union(layer[i], layer[i + 1]);
            if (!u) return null;
            next.push(u);
        }
        layer = next;
    }
    return layer[0] ?? null;
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

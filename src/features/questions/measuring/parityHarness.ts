/**
 * On-device parity harness for GEOS vs JS buffer comparison.
 *
 * Replicates the production measuring pipeline up to (but not including) the
 * buffer: window the bundle, split polygon vs line features, simplify, then
 * feed the **identical** prepared geometry to both `jsGeometryBackend` and
 * `geosGeometryBackend`. The GEOS-only dissolve post-step is intentionally
 * skipped — we're testing the `bufferMeters` primitive, not the full render.
 *
 * Also includes a GEOS-only crash/perf sweep and a degenerate-WKB crash fuzz.
 *
 * All public sweep/fuzz functions are **async** — they yield to the UI between
 * cases so the progress counter updates and the app doesn't appear frozen.
 * Console logging is included so results are visible in Metro / Xcode logs
 * even if the UI never renders.
 */

import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
} from "geojson";
import { multiLineString } from "@turf/helpers";

import type { Bbox, Position } from "@/shared/geojson";
import { jsGeometryBackend } from "@/shared/geometry/jsGeometryBackend";
import { geosGeometryBackend } from "@/shared/geometry/geosGeometryBackend";
import {
    geomAreaM2,
    geomBbox,
    bboxEdgeDeltaMeters,
    bboxToleranceM,
    SYM_DIFF_RATIO_MAX,
} from "@/shared/geometry/parityMetrics";
import {
    MEASURING_LINE,
    simplifyTolerance,
    minFeatureLength,
} from "@/config/appConfig";

import type { MeasuringCategory } from "./measuringTypes";
import { LINE_MEASURING_CATEGORIES } from "./measuringCategories";
import { selectWindowFeatures } from "./lineMeasuringGeometry";
import { simplifyPolygonBufferFeatures } from "./lineBufferComputation";

// ─── Async helpers ────────────────────────────────────────────────────────

/** Yield to the UI event loop so React can process setState calls. */
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

function harnessLog(...args: unknown[]): void {
    console.log(`[parityHarness]`, ...args);
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface ParityCase {
    /** Human-readable label (e.g. "admin-1st-border / on-border / 2km"). */
    label: string;
    category: MeasuringCategory;
    /** WGS84 center [lon, lat] for windowing the bundle. */
    center: Position;
    radiusMeters: number;
    quadrantSegments: number;
}

export interface ParityResult {
    kase: ParityCase;
    /** JS backend buffer result (null on failure). */
    jsGeom: Polygon | MultiPolygon | null;
    /** GEOS backend buffer result (null on failure). */
    geosGeom: Polygon | MultiPolygon | null;
    /** area(geos) / area(js) — null if either backend returned null. */
    areaRatio: number | null;
    /** area(A△B) / area(A∪B) via polyclip-ts — null if either null. */
    symDiffRatio: number | null;
    /** Max bbox edge displacement in meters — null if either null. */
    bboxDeltaM: number | null;
    /** Wall-clock ms for the JS oracle call. */
    jsTimeMs: number;
    /** Wall-clock ms for the GEOS native call. */
    geosTimeMs: number;
}

export interface ParityReport {
    passed: boolean;
    results: ParityResult[];
    maxAreaRatio: number;
    maxSymDiffRatio: number;
    maxBboxDeltaM: number;
    failures: ParityResult[];
    /** Total wall-clock time spent in the JS oracle. */
    jsOracleTotalMs: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

const {
    maxBufferSegments: MAX_BUFFER_SEGMENTS,
    maxBufferCoords: MAX_BUFFER_COORDS,
} = MEASURING_LINE;

/** Meters-to-degrees conversions (same as lineMeasuringGeometry). */
const DEG_PER_METER = 1 / 111_320;

function metersToDegLon(meters: number, lat: number): number {
    return meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

function metersToDegLat(meters: number): number {
    return meters * DEG_PER_METER;
}

/** Check if a coordinate pair is valid (finite numbers). */
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

/** Approximate length of a LineString in meters. */
function lineLengthMeters(coords: Position[]): number {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i];
        const [lng2, lat2] = coords[i + 1];
        total += haversineDistanceMeters(lat1, lng1, lat2, lng2);
    }
    return total;
}

/** Quick haversine in meters (avoids circular dependency on shared/geojson). */
function haversineDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
): number {
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Douglas-Peucker simplification (same algo as lineMeasuringGeometry) ───

function simplifyCoords(coords: Position[], toleranceM: number): Position[] {
    if (coords.length <= 2) return [...coords];

    const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const kx = 111_320 * Math.cos((midLat * Math.PI) / 180);
    const ky = 111_320;
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

// ─── Input preparation (replicates production pipeline up to buffer) ──────

/**
 * Replicates the production pipeline from `computeLineBuffer` up to (but not
 * including) the `bufferMeters` call:
 *
 * 1. Window the bundle around `center` with margin = max(radius, 50km).
 * 2. Separate polygon vs line features.
 * 3. Simplify polygons; drop degenerate.
 * 4. Clean, dedup, simplify lines; apply budget.
 * 5. Return the prepared pieces plus a merged MultiLineString for the line path.
 *
 * Returns null when there are no features to buffer (vacuous case).
 */
function prepareBufferInput(
    category: MeasuringCategory,
    center: Position,
    radiusMeters: number,
    playAreaBbox: Bbox,
): {
    polyFeatures: Feature<Polygon | MultiPolygon>[];
    lineMerged: Feature<MultiLineString> | null;
} | null {
    const marginM = Math.max(radiusMeters, 50_000);
    const windowFeatures = selectWindowFeatures(
        category,
        playAreaBbox,
        center,
        marginM,
    );

    if (windowFeatures.length === 0) return null;

    // Separate polygon vs line features.
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

    // Simplify polygons with the same per-member tolerance as production
    // (`computeLineBuffer`) so the harness reflects the real buffer input.
    const preparedPolys = simplifyPolygonBufferFeatures(
        polyFeatures,
        radiusMeters,
    );

    // Prepare lines.
    let lineMerged: Feature<MultiLineString> | null = null;

    if (lineFeatures.length > 0) {
        const minFeatureLenM = minFeatureLength(radiusMeters);
        const lines: Position[][] = [];
        for (const f of lineFeatures) {
            if (f.geometry.type === "LineString") {
                const coords = f.geometry.coordinates as Position[];
                if (lineLengthMeters(coords) < minFeatureLenM) continue;
                lines.push(coords);
            } else {
                const mlCoords = (f.geometry as MultiLineString).coordinates;
                let totalLen = 0;
                for (const line of mlCoords)
                    totalLen += lineLengthMeters(line as Position[]);
                if (totalLen < minFeatureLenM) continue;
                for (const line of mlCoords) {
                    if ((line as Position[]).length >= 2)
                        lines.push(line as Position[]);
                }
            }
        }

        if (lines.length > 0) {
            // Clean: filter invalid coords, dedup consecutive duplicates.
            let cleanLines = lines.filter(
                (coords) =>
                    coords.length >= 2 && coords.every((c) => isValidCoord(c)),
            );
            cleanLines = cleanLines
                .map((coords) => {
                    const deduped: Position[] = [coords[0]];
                    for (let i = 1; i < coords.length; i++) {
                        const prev = coords[i - 1];
                        const curr = coords[i];
                        if (prev[0] !== curr[0] || prev[1] !== curr[1])
                            deduped.push(curr);
                    }
                    return deduped.length >= 2 ? deduped : null;
                })
                .filter((coords): coords is Position[] => coords !== null);

            if (cleanLines.length > 0) {
                const lineSimplifyTol = simplifyTolerance(radiusMeters);
                const simplifiedLines = cleanLines.map((coords) =>
                    simplifyCoords(coords, lineSimplifyTol),
                );

                // Apply buffer budget.
                let budgetedLines = simplifiedLines;
                let tol = lineSimplifyTol;
                for (
                    let round = 0;
                    round < MEASURING_LINE.budgetMaxRounds;
                    round++
                ) {
                    const segs = budgetedLines.length;
                    const coords = budgetedLines.reduce(
                        (s, l) => s + l.length,
                        0,
                    );
                    if (
                        segs <= MAX_BUFFER_SEGMENTS &&
                        coords <= MAX_BUFFER_COORDS
                    )
                        break;
                    tol *= 2;
                    const lenFloor = tol * 4;
                    budgetedLines = budgetedLines
                        .filter((l) => lineLengthMeters(l) >= lenFloor)
                        .map((l) => simplifyCoords(l, tol));
                }

                if (budgetedLines.length > 0) {
                    try {
                        lineMerged = multiLineString(
                            budgetedLines,
                        ) as Feature<MultiLineString>;
                    } catch {
                        lineMerged = null;
                    }
                }
            }
        }
    }

    if (preparedPolys.length === 0 && !lineMerged) return null;

    return { polyFeatures: preparedPolys, lineMerged };
}

// ─── Symmetric difference via polyclip-ts ────────────────────────────────

let _polyclip: typeof import("polyclip-ts") | null = null;

function getPolyclip(): typeof import("polyclip-ts") {
    if (!_polyclip) {
        _polyclip = require("polyclip-ts") as typeof import("polyclip-ts");
    }
    return _polyclip;
}

/**
 * Compute symmetric-difference area ratio = area(A△B) / area(A∪B).
 *
 * Uses polyclip-ts for exact polygon boolean ops. Only called for the parity
 * pass (~46 cases), not the crash/perf sweep.
 *
 * Returns NaN if polyclip-ts rejects either geometry (e.g. GEOS-produced
 * rings that aren't strictly closed or have < 3 distinct coords after
 * unprojection). The caller treats NaN as "metric unavailable" — the case
 * still passes/fails on area ratio + bbox delta.
 */
function computeSymDiffRatio(
    a: Polygon | MultiPolygon,
    b: Polygon | MultiPolygon,
): number {
    // Validate rings before handing off to polyclip-ts. GEOS WKB output can
    // produce rings where the closing coordinate differs from the start by
    // floating-point epsilon after unprojection; polyclip-ts treats those as
    // invalid. Also filter rings with < 3 distinct coords.
    if (!isValidPolyClipInput(a) || !isValidPolyClipInput(b)) {
        console.warn(
            "[parityHarness] symDiff skipped: geometry invalid for polyclip-ts",
        );
        return NaN;
    }

    try {
        const { union, intersection } = getPolyclip();
        const aGeom = a as unknown as import("polyclip-ts").Geom;
        const bGeom = b as unknown as import("polyclip-ts").Geom;

        const u = union(aGeom, bGeom);
        const i = intersection(aGeom, bGeom);

        const unionArea = geomAreaM2(u as unknown as Polygon | MultiPolygon);
        if (unionArea === 0) return 0;

        const interArea = geomAreaM2(i as unknown as Polygon | MultiPolygon);
        return (unionArea - interArea) / unionArea;
    } catch (err) {
        console.warn("[parityHarness] symDiff polyclip-ts failed:", err);
        return NaN;
    }
}

/**
 * Returns true if every ring in the geometry is closed (first === last
 * coordinate) and has ≥ 3 distinct vertices — the minimum polyclip-ts
 * expects.
 */
function isValidPolyClipInput(geom: Polygon | MultiPolygon): boolean {
    const checkRing = (ring: number[][]): boolean => {
        if (ring.length < 4) return false;
        const first = ring[0];
        const last = ring[ring.length - 1];
        // Ring must be closed (first == last), within fp tolerance.
        if (first[0] !== last[0] || first[1] !== last[1]) return false;
        // Must have at least 3 distinct vertices (excluding the closing dup).
        const distinct = new Set(
            ring.slice(0, -1).map((c) => `${c[0]},${c[1]}`),
        );
        return distinct.size >= 3;
    };

    if (geom.type === "Polygon") {
        return geom.coordinates.every(checkRing);
    }
    return geom.coordinates.every((poly) => poly.every(checkRing));
}

// ─── Run one parity case ──────────────────────────────────────────────────

/**
 * Run a single parity case: prepare input, buffer with both backends, compare.
 *
 * Calls `jsGeometryBackend.bufferMeters` and `geosGeometryBackend.bufferMeters`
 * directly (not via `getGeometryBackend()`) so the input geometry is
 * byte-identical and the only measured difference is the buffer engine.
 */
export function runParityCase(kase: ParityCase): ParityResult {
    // ── Prepare the identical input geometry ─────────────────────
    // Use the Tokyo play-area bbox (hard-coded for reproducibility).
    const prepared = prepareBufferInput(
        kase.category,
        kase.center,
        kase.radiusMeters,
        TOKYO_PLAY_AREA_BBOX,
    );

    const nullResult = (): ParityResult => ({
        kase,
        jsGeom: null,
        geosGeom: null,
        areaRatio: null,
        symDiffRatio: null,
        bboxDeltaM: null,
        jsTimeMs: 0,
        geosTimeMs: 0,
    });

    if (!prepared) return nullResult();

    // ── Build the input Feature for bufferMeters ─────────────────
    // Match production: polygon features are buffered individually
    // and combined; line features are merged into a MultiLineString
    // and buffered as one.
    const { polyFeatures, lineMerged } = prepared;

    // ── JS oracle ────────────────────────────────────────────────
    const jsT0 = performance.now();
    const jsBuffers: Feature<Polygon | MultiPolygon>[] = [];

    for (const pf of polyFeatures) {
        const buf = jsGeometryBackend.bufferMeters(
            pf,
            kase.radiusMeters,
            kase.quadrantSegments,
        );
        if (buf) jsBuffers.push(buf);
    }
    if (lineMerged) {
        const buf = jsGeometryBackend.bufferMeters(
            lineMerged,
            kase.radiusMeters,
            kase.quadrantSegments,
        );
        if (buf) jsBuffers.push(buf);
    }
    const jsTimeMs = performance.now() - jsT0;

    // ── GEOS native ──────────────────────────────────────────────
    const geosT0 = performance.now();
    const geosBuffers: Feature<Polygon | MultiPolygon>[] = [];

    for (const pf of polyFeatures) {
        const buf = geosGeometryBackend.bufferMeters(
            pf,
            kase.radiusMeters,
            kase.quadrantSegments,
        );
        if (buf) geosBuffers.push(buf);
    }
    if (lineMerged) {
        const buf = geosGeometryBackend.bufferMeters(
            lineMerged,
            kase.radiusMeters,
            kase.quadrantSegments,
        );
        if (buf) geosBuffers.push(buf);
    }
    const geosTimeMs = performance.now() - geosT0;

    // ── Merge buffers for comparison ─────────────────────────────
    const jsGeom = mergeBuffers(jsBuffers);
    const geosGeom = mergeBuffers(geosBuffers);

    if (!jsGeom || !geosGeom) {
        return {
            kase,
            jsGeom,
            geosGeom,
            areaRatio: null,
            symDiffRatio: null,
            bboxDeltaM: null,
            jsTimeMs,
            geosTimeMs,
        };
    }

    // ── Metrics ─────────────────────────────────────────────────
    const jsArea = geomAreaM2(jsGeom);
    const geosArea = geomAreaM2(geosGeom);
    const areaRatio = jsArea > 0 ? geosArea / jsArea : null;

    const symDiffRatio = computeSymDiffRatio(jsGeom, geosGeom);

    const jsBbox = geomBbox(jsGeom);
    const geosBbox = geomBbox(geosGeom);
    const midLat = (jsBbox[1] + jsBbox[3]) / 2;
    const bboxDeltaM = bboxEdgeDeltaMeters(jsBbox, geosBbox, midLat);

    return {
        kase,
        jsGeom,
        geosGeom,
        areaRatio,
        symDiffRatio,
        bboxDeltaM,
        jsTimeMs,
        geosTimeMs,
    };
}

// ─── Merge buffers ────────────────────────────────────────────────────────

function mergeBuffers(
    buffers: Feature<Polygon | MultiPolygon>[],
): Polygon | MultiPolygon | null {
    if (buffers.length === 0) return null;
    if (buffers.length === 1) return buffers[0].geometry;

    const polygons: Position[][][] = [];
    for (const f of buffers) {
        const g = f.geometry;
        if (g.type === "Polygon") {
            polygons.push(g.coordinates as Position[][]);
        } else {
            for (const poly of g.coordinates)
                polygons.push(poly as Position[][]);
        }
    }
    return { type: "MultiPolygon", coordinates: polygons };
}

// ─── Run full sweep ──────────────────────────────────────────────────────

/**
 * Run the parity sweep over a curated case list.
 *
 * Pass/fail rules (per the G3 plan):
 * - One backend returns polygon, other returns null → hard failure.
 * - Both return null → vacuous agreement (not a failure, but logged).
 * - Both return polygons → apply numeric gates.
 */
export async function runParitySweep(
    cases: ParityCase[],
    onProgress?: (done: number, total: number, label: string) => void,
): Promise<ParityReport> {
    const results: ParityResult[] = [];
    const failures: ParityResult[] = [];
    let maxAreaRatio = 1;
    let maxSymDiffRatio = 0;
    let maxBboxDeltaM = 0;
    let jsOracleTotalMs = 0;
    let passed = true;
    const total = cases.length;

    harnessLog(`Parity sweep starting: ${total} cases`);
    const sweepT0 = performance.now();

    for (let i = 0; i < cases.length; i++) {
        const kase = cases[i];
        const result = runParityCase(kase);
        results.push(result);
        jsOracleTotalMs += result.jsTimeMs;

        // ── Console log per case ─────────────────────────────────
        const symDiffStr =
            result.symDiffRatio !== null && !isNaN(result.symDiffRatio)
                ? `${(result.symDiffRatio * 100).toFixed(3)}%`
                : "N/A";
        const bboxStr =
            result.bboxDeltaM !== null && !isNaN(result.bboxDeltaM)
                ? `${result.bboxDeltaM.toFixed(1)}m`
                : "N/A";
        harnessLog(
            `[${i + 1}/${total}] ${kase.label}`,
            `js=${result.jsTimeMs.toFixed(0)}ms`,
            `geos=${result.geosTimeMs.toFixed(0)}ms`,
            `symDiff=${symDiffStr}`,
            `bboxΔ=${bboxStr}`,
        );

        // Both null → vacuous, not a failure.
        if (!result.jsGeom && !result.geosGeom) {
            harnessLog(`  ↳ vacuous (no geometry for either backend)`);
            onProgress?.(i + 1, total, kase.label);
            await yieldToUI();
            continue;
        }

        // One null, one polygon → hard failure.
        if (!result.jsGeom || !result.geosGeom) {
            passed = false;
            failures.push(result);
            harnessLog(
                `  ↳ HARD FAIL: ${!result.jsGeom ? "JS" : "GEOS"} returned null, other returned polygon`,
            );
            onProgress?.(i + 1, total, kase.label);
            await yieldToUI();
            continue;
        }

        // Both polygons — apply numeric gates.
        if (result.areaRatio !== null && !isNaN(result.areaRatio)) {
            maxAreaRatio = Math.max(maxAreaRatio, result.areaRatio);
        }
        if (result.symDiffRatio !== null && !isNaN(result.symDiffRatio)) {
            maxSymDiffRatio = Math.max(maxSymDiffRatio, result.symDiffRatio);
        }
        if (result.bboxDeltaM !== null && !isNaN(result.bboxDeltaM)) {
            maxBboxDeltaM = Math.max(maxBboxDeltaM, result.bboxDeltaM);
        }

        const gateSymDiff =
            result.symDiffRatio !== null &&
            !isNaN(result.symDiffRatio) &&
            result.symDiffRatio > SYM_DIFF_RATIO_MAX;
        const gateBbox =
            result.bboxDeltaM !== null &&
            !isNaN(result.bboxDeltaM) &&
            result.bboxDeltaM > bboxToleranceM(kase.radiusMeters);

        if (gateSymDiff || gateBbox) {
            passed = false;
            failures.push(result);
            harnessLog(
                `  ↳ FAIL: ${gateSymDiff ? `symDiff ${(result.symDiffRatio! * 100).toFixed(2)}% > ${(SYM_DIFF_RATIO_MAX * 100).toFixed(0)}%` : ""}${gateSymDiff && gateBbox ? ", " : ""}${gateBbox ? `bboxΔ ${result.bboxDeltaM!.toFixed(1)}m > ${bboxToleranceM(kase.radiusMeters).toFixed(1)}m` : ""}`,
            );
        } else {
            harnessLog(`  ↳ pass`);
        }

        onProgress?.(i + 1, total, kase.label);
        await yieldToUI();
    }

    const sweepMs = performance.now() - sweepT0;
    harnessLog(
        `Sweep complete: ${passed ? "PARITY PASS" : "PARITY FAIL"}`,
        `in ${(sweepMs / 1000).toFixed(1)}s`,
        `(${(jsOracleTotalMs / 1000).toFixed(1)}s JS oracle)`,
    );
    harnessLog(
        `  max symDiff=${(maxSymDiffRatio * 100).toFixed(3)}%`,
        `max bboxΔ=${maxBboxDeltaM.toFixed(1)}m`,
        `failures=${failures.length}`,
    );

    return {
        passed,
        results,
        maxAreaRatio,
        maxSymDiffRatio,
        maxBboxDeltaM,
        failures,
        jsOracleTotalMs,
    };
}

// ─── GEOS-only crash/perf sweep ───────────────────────────────────────────

export interface SweepResult {
    /** Total cases run. */
    total: number;
    /** Cases where GEOS returned a polygon. */
    buffered: number;
    /** Cases where GEOS returned null. */
    nulls: number;
    /** Total wall-clock ms. */
    totalMs: number;
    /** Max ms for a single case. */
    maxMs: number;
    /** Per-category null counts for diagnosis. */
    nullsByCategory: Partial<Record<MeasuringCategory, number>>;
}

/**
 * Run a denser, GEOS-only sweep over a uniform grid for crash/perf coverage.
 *
 * Uses the real bundled geometries; calls only `geosGeometryBackend` (no JS
 * oracle — too slow). Rotates the category by grid point to keep all five
 * exercised without exploding the case count.
 *
 * @returns SweepResult, or null if the app crashed before returning.
 */
export async function runGeosSweep(
    playAreaBbox: Bbox,
    gridSpacingM: number,
    radiiMeters: number[],
    quadrantSegments: number,
    onProgress?: (done: number, total: number) => void,
): Promise<SweepResult> {
    const categories = [...LINE_MEASURING_CATEGORIES];

    harnessLog(
        `Crash/perf sweep starting: grid ${gridSpacingM}m spacing, ` +
            `${radiiMeters.length} radii × ~${Math.round(
                ((playAreaBbox[2] - playAreaBbox[0]) /
                    metersToDegLon(
                        gridSpacingM,
                        (playAreaBbox[1] + playAreaBbox[3]) / 2,
                    )) *
                    ((playAreaBbox[3] - playAreaBbox[1]) /
                        metersToDegLat(gridSpacingM)),
            )} pts`,
    );

    // Build grid points over the play-area bbox.
    const midLat = (playAreaBbox[1] + playAreaBbox[3]) / 2;
    const stepLon = metersToDegLon(gridSpacingM, midLat);
    const stepLat = metersToDegLat(gridSpacingM);

    const centers: Position[] = [];
    for (
        let lat = playAreaBbox[1] + stepLat / 2;
        lat <= playAreaBbox[3];
        lat += stepLat
    ) {
        for (
            let lon = playAreaBbox[0] + stepLon / 2;
            lon <= playAreaBbox[2];
            lon += stepLon
        ) {
            centers.push([lon, lat]);
        }
    }

    const total = centers.length * radiiMeters.length;
    let done = 0;
    let buffered = 0;
    let nulls = 0;
    let maxMs = 0;
    const tStart = performance.now();
    const nullsByCategory: Partial<Record<MeasuringCategory, number>> = {};

    for (const center of centers) {
        // Rotate category by grid point.
        const catIdx = done % categories.length;
        const category = categories[catIdx];

        for (const radius of radiiMeters) {
            const prepared = prepareBufferInput(
                category,
                center,
                radius,
                playAreaBbox,
            );

            const t0 = performance.now();
            let gotPolygon = false;

            if (prepared) {
                const { polyFeatures, lineMerged } = prepared;

                for (const pf of polyFeatures) {
                    const buf = geosGeometryBackend.bufferMeters(
                        pf,
                        radius,
                        quadrantSegments,
                    );
                    if (buf) gotPolygon = true;
                }
                if (lineMerged) {
                    const buf = geosGeometryBackend.bufferMeters(
                        lineMerged,
                        radius,
                        quadrantSegments,
                    );
                    if (buf) gotPolygon = true;
                }
            }

            const elapsed = performance.now() - t0;
            if (elapsed > maxMs) maxMs = elapsed;

            if (gotPolygon) {
                buffered++;
            } else {
                nulls++;
                nullsByCategory[category] =
                    (nullsByCategory[category] ?? 0) + 1;
            }

            done++;
            if (done % 25 === 0 || done === total) {
                onProgress?.(done, total);
                await yieldToUI();
            }
        }
    }

    harnessLog(
        `Crash/perf sweep done: ${buffered} buffered, ${nulls} nulls ` +
            `in ${((performance.now() - tStart) / 1000).toFixed(1)}s`,
    );

    return {
        total,
        buffered,
        nulls,
        totalMs: performance.now() - tStart,
        maxMs,
        nullsByCategory,
    };
}

// ─── Degenerate-WKB crash fuzz ────────────────────────────────────────────

export interface FuzzResult {
    passed: boolean;
    /** Cases that must return null (malformed WKB). */
    nullCases: { label: string; iterations: number; allNull: boolean }[];
    /** Cases where any return (null or polygon) is fine — just don't crash. */
    surviveCases: { label: string; iterations: number; survived: boolean }[];
}

/**
 * Feed degenerate WKB inputs to the native `bufferWKB` and confirm:
 * - **Malformed WKB** (empty, truncated): must return null for all iterations.
 * - **Degenerate-but-valid WKB** (bowtie, large coords): just confirm the
 *   native call returns without crashing — any return value (null or polygon)
 *   is fine. GEOS MakeValid fixes the bowtie, and large coords may be valid.
 *
 * Each case runs 1,000 iterations. Returns `passed: true` if all malformed
 * cases returned null and all survive cases survived without crashing.
 * A crash kills the app before this function can return — that's why Maestro
 * (W5) also guards this.
 */
export async function runCrashFuzz(
    onProgress?: (done: number, total: number, label: string) => void,
): Promise<FuzzResult> {
    // Dynamically require so Jest can mock the native module.
    const { bufferWKB } = require("native-geometry") as {
        bufferWKB: (
            wkb: Uint8Array,
            distance: number,
            qs: number,
        ) => Uint8Array | null;
    };

    const ITERATIONS = 1_000;
    const QS = 8;
    const DIST = 100;

    // ── Must return null (malformed WKB) ──────────────────────────
    const nullCases: {
        label: string;
        wkb: Uint8Array;
    }[] = [
        { label: "empty (0 bytes)", wkb: new Uint8Array(0) },
        { label: "truncated WKB", wkb: makeTruncatedWkb() },
    ];

    // ── Degenerate but valid WKB (just don't crash) ──────────────
    // GEOS MakeValid fixes the bowtie into a valid polygon, and the
    // buffer succeeds — that's a non-null return, not a failure.
    const surviveCases: {
        label: string;
        wkb: Uint8Array;
    }[] = [
        {
            label: "1-point LineString",
            wkb: makeOnePointLineStringWkb(),
        },
        {
            label: "zero-length segment",
            wkb: makeZeroLengthSegmentWkb(),
        },
        {
            label: "self-intersecting polygon (bowtie)",
            wkb: makeBowtieWkb(),
        },
        {
            label: "large coordinates (1e6)",
            wkb: makeLargeCoordWkb(1e6),
        },
        {
            label: "large coordinates (1e9)",
            wkb: makeLargeCoordWkb(1e9),
        },
    ];

    const total = nullCases.length + surviveCases.length;
    harnessLog(
        `Crash fuzz starting: ${total} cases × ${ITERATIONS} iterations`,
    );
    const fuzzT0 = performance.now();

    const nullResults: FuzzResult["nullCases"] = [];
    const surviveResults: FuzzResult["surviveCases"] = [];
    let passed = true;
    let done = 0;

    // ── Null-expected cases ──────────────────────────────────────
    for (const { label, wkb } of nullCases) {
        let allNull = true;
        for (let i = 0; i < ITERATIONS; i++) {
            const result = bufferWKB(wkb, DIST, QS);
            if (result !== null) {
                allNull = false;
                break;
            }
        }
        nullResults.push({ label, iterations: ITERATIONS, allNull });
        done++;
        onProgress?.(done, total, label);
        if (!allNull) {
            passed = false;
            harnessLog(`  ${label}: NON-NULL ✗ (should be null)`);
        } else {
            harnessLog(`  ${label}: all null ✓`);
        }
        await yieldToUI();
    }

    // ── Survive cases (any return is fine, just don't crash) ─────
    for (const { label, wkb } of surviveCases) {
        let survived = true;
        try {
            for (let i = 0; i < ITERATIONS; i++) {
                bufferWKB(wkb, DIST, QS);
            }
        } catch {
            survived = false;
        }
        surviveResults.push({ label, iterations: ITERATIONS, survived });
        done++;
        onProgress?.(done, total, label);
        if (!survived) {
            passed = false;
            harnessLog(`  ${label}: CRASHED ✗`);
        } else {
            harnessLog(`  ${label}: survived ✓`);
        }
        await yieldToUI();
    }

    const fuzzMs = performance.now() - fuzzT0;
    harnessLog(
        `Crash fuzz complete: ${passed ? "CRASH FUZZ PASS" : "CRASH FUZZ FAIL"}`,
        `in ${(fuzzMs / 1000).toFixed(1)}s`,
    );

    return { passed, nullCases: nullResults, surviveCases: surviveResults };
}

// ─── Memory stress test (W3 — Instruments/ASan allocation check) ─────────

export interface StressTestResult {
    iterations: number;
    totalMs: number;
    /** True if every iteration returned a polygon (no nulls). */
    allBuffered: boolean;
}

/**
 * Run `bufferMeters` over a body-of-water window at `radiusMeters` for
 * `iterations` repetitions. Designed for use with Instruments → Allocations
 * (iOS) or Android Studio Memory Profiler: start recording, trigger this
 * function, and confirm the count of live GEOS allocations returns to
 * baseline after the batch.
 *
 * Logs progress every 10k iterations so you can correlate allocation spikes
 * with iteration count in the profiler trace.
 */
export async function runMemoryStressTest(
    iterations: number,
    radiusMeters: number,
    quadrantSegments: number,
    onProgress?: (done: number) => void,
): Promise<StressTestResult> {
    // Prepare the body-of-water window once — the geometry fed to bufferMeters
    // is the same every iteration (we're testing alloc stability, not geometry
    // variety).
    const prepared = prepareBufferInput(
        "body-of-water",
        [139.78, 35.62], // Central Tokyo Bay
        radiusMeters,
        TOKYO_PLAY_AREA_BBOX,
    );

    if (!prepared) {
        harnessLog("Memory stress test: no prepared geometry (vacuous)");
        return { iterations: 0, totalMs: 0, allBuffered: false };
    }

    harnessLog(
        `Memory stress test starting: ${iterations} iterations ` +
            `over body-of-water at ${radiusMeters}m`,
    );

    const { polyFeatures, lineMerged } = prepared;
    const tStart = performance.now();
    let allBuffered = true;

    for (let i = 0; i < iterations; i++) {
        let gotPolygon = false;

        for (const pf of polyFeatures) {
            const buf = geosGeometryBackend.bufferMeters(
                pf,
                radiusMeters,
                quadrantSegments,
            );
            if (buf) gotPolygon = true;
        }
        if (lineMerged) {
            const buf = geosGeometryBackend.bufferMeters(
                lineMerged,
                radiusMeters,
                quadrantSegments,
            );
            if (buf) gotPolygon = true;
        }

        if (!gotPolygon) allBuffered = false;

        if (i > 0 && i % 10_000 === 0) {
            harnessLog(
                `[memStress] ${i}/${iterations} iterations, ` +
                    `${(performance.now() - tStart).toFixed(0)}ms elapsed`,
            );
            await yieldToUI();
        }

        onProgress?.(i + 1);
    }

    const totalMs = performance.now() - tStart;
    harnessLog(
        `Memory stress test done: ${iterations} iterations ` +
            `in ${(totalMs / 1000).toFixed(1)}s, ` +
            `allBuffered=${allBuffered}`,
    );

    return {
        iterations,
        totalMs,
        allBuffered,
    };
}

// ─── Degenerate WKB constructors ─────────────────────────────────────────

/** WKB header (little-endian) + type code, then truncated mid-coordinate. */
function makeTruncatedWkb(): Uint8Array {
    // LE LineString (type=2), 5 points, but only 1.5 coords of data.
    const buf = new ArrayBuffer(1 + 4 + 4 + 3 * 8); // partial
    const v = new DataView(buf);
    v.setUint8(0, 0x01); // LE
    v.setUint32(1, 2, true); // LineString
    v.setUint32(5, 5, true); // 5 points
    v.setFloat64(9, 139.7, true); // x0
    v.setFloat64(17, 35.6, true); // y0
    v.setFloat64(25, 139.8, true); // x1 — partial y1 missing
    return new Uint8Array(buf);
}

/** 1-point LineString — geometrically degenerate. */
function makeOnePointLineStringWkb(): Uint8Array {
    const buf = new ArrayBuffer(1 + 4 + 4 + 1 * 16);
    const v = new DataView(buf);
    v.setUint8(0, 0x01);
    v.setUint32(1, 2, true); // LineString
    v.setUint32(5, 1, true); // 1 point
    v.setFloat64(9, 139.7, true);
    v.setFloat64(17, 35.6, true);
    return new Uint8Array(buf);
}

/** 2 identical consecutive points — zero-length segment. */
function makeZeroLengthSegmentWkb(): Uint8Array {
    const buf = new ArrayBuffer(1 + 4 + 4 + 2 * 16);
    const v = new DataView(buf);
    v.setUint8(0, 0x01);
    v.setUint32(1, 2, true);
    v.setUint32(5, 2, true);
    v.setFloat64(9, 139.7, true);
    v.setFloat64(17, 35.6, true);
    v.setFloat64(25, 139.7, true); // same
    v.setFloat64(33, 35.6, true); // same
    return new Uint8Array(buf);
}

/** Self-intersecting polygon (bowtie) — exercises GEOSMakeValid. */
function makeBowtieWkb(): Uint8Array {
    const buf = new ArrayBuffer(1 + 4 + 4 + 4 + 5 * 16);
    const v = new DataView(buf);
    v.setUint8(0, 0x01);
    v.setUint32(1, 3, true); // Polygon
    v.setUint32(5, 1, true); // 1 ring
    v.setUint32(9, 5, true); // 5 points (closed)
    // Bowtie: (0,0) → (2,2) → (0,2) → (2,0) → (0,0)
    v.setFloat64(13, 0, true);
    v.setFloat64(21, 0, true);
    v.setFloat64(29, 2, true);
    v.setFloat64(37, 2, true);
    v.setFloat64(45, 0, true);
    v.setFloat64(53, 2, true);
    v.setFloat64(61, 2, true);
    v.setFloat64(69, 0, true);
    v.setFloat64(77, 0, true);
    v.setFloat64(85, 0, true);
    return new Uint8Array(buf);
}

/** LineString with very large coordinate values. */
function makeLargeCoordWkb(magnitude: number): Uint8Array {
    const buf = new ArrayBuffer(1 + 4 + 4 + 3 * 16);
    const v = new DataView(buf);
    v.setUint8(0, 0x01);
    v.setUint32(1, 2, true);
    v.setUint32(5, 3, true);
    v.setFloat64(9, magnitude, true);
    v.setFloat64(17, magnitude, true);
    v.setFloat64(25, magnitude + 1, true);
    v.setFloat64(33, magnitude + 1, true);
    v.setFloat64(41, magnitude + 2, true);
    v.setFloat64(49, magnitude + 2, true);
    return new Uint8Array(buf);
}

// ─── Hard-coded fixtures ─────────────────────────────────────────────────

/**
 * Tokyo play-area bbox (from the default Tokyo 23 Wards relation).
 * Hard-coded for deterministic, reproducible windowing across runs —
 * independent of whatever play area the user happens to have loaded.
 */
export const TOKYO_PLAY_AREA_BBOX: Bbox = [139.563, 35.523, 139.919, 35.818];

const QS = 8; // BUFFER_STEPS — matches every app buffer call site.

/**
 * Curated parity-pass fixture centers.
 *
 * Per category, 3 centers chosen by geometric role × 3 radii (500 m, 2 km,
 * 5 km), with 1 extra large-radius case for body-of-water (10 km).
 *
 * Coordinates are hard-coded (not randomized) so every run is reproducible.
 */
export const PARITY_CASES: ParityCase[] = buildParityCases();

function buildParityCases(): ParityCase[] {
    const radii = [500, 2000, 5000];
    const cases: ParityCase[] = [];

    // ── admin-1st-border ──────────────────────────────────────────
    const admin1Centers: { label: string; center: Position }[] = [
        {
            label: "on Tokyo/Saitama border",
            center: [139.615, 35.785], // Near the northern prefectural boundary
        },
        {
            label: "~2 km inside Tokyo",
            center: [139.691, 35.689], // Shinjuku area
        },
        {
            label: "~5 km outside in Saitama",
            center: [139.655, 35.861], // Well into Saitama
        },
    ];
    for (const { label, center } of admin1Centers) {
        for (const r of radii) {
            cases.push({
                label: `admin-1st-border / ${label} / ${r}m`,
                category: "admin-1st-border",
                center,
                radiusMeters: r,
                quadrantSegments: QS,
            });
        }
    }

    // ── admin-2nd-border ──────────────────────────────────────────
    const admin2Centers: { label: string; center: Position }[] = [
        {
            label: "on ward boundary",
            center: [139.731, 35.658], // Near Minato/Shibuya border
        },
        {
            label: "~2 km inside a ward",
            center: [139.715, 35.685], // Shinjuku ward interior
        },
        {
            label: "~5 km from ward boundaries",
            center: [139.78, 35.71], // Ueno/Asakusa area
        },
    ];
    for (const { label, center } of admin2Centers) {
        for (const r of radii) {
            cases.push({
                label: `admin-2nd-border / ${label} / ${r}m`,
                category: "admin-2nd-border",
                center,
                radiusMeters: r,
                quadrantSegments: QS,
            });
        }
    }

    // ── body-of-water ─────────────────────────────────────────────
    const waterCenters: { label: string; center: Position }[] = [
        {
            label: "inside Tokyo Bay",
            center: [139.78, 35.62], // Central Tokyo Bay
        },
        {
            label: "on the Sumida River",
            center: [139.797, 35.711], // Near Asakusa, on the Sumida
        },
        {
            label: "~2 km from water on land",
            center: [139.691, 35.689], // Shinjuku — well inland
        },
    ];
    for (const { label, center } of waterCenters) {
        for (const r of radii) {
            cases.push({
                label: `body-of-water / ${label} / ${r}m`,
                category: "body-of-water",
                center,
                radiusMeters: r,
                quadrantSegments: QS,
            });
        }
    }
    // Large-radius case covering the whole bay (historic softlock).
    cases.push({
        label: "body-of-water / whole Tokyo Bay / 10km",
        category: "body-of-water",
        center: [139.76, 35.56], // Center of Tokyo Bay
        radiusMeters: 10_000,
        quadrantSegments: QS,
    });

    // ── coastline ─────────────────────────────────────────────────
    const coastCenters: { label: string; center: Position }[] = [
        {
            label: "on the coast (Odaiba)",
            center: [139.775, 35.63], // Odaiba waterfront
        },
        {
            label: "2 km inland",
            center: [139.745, 35.658], // Roppongi
        },
        {
            label: "2 km offshore",
            center: [139.8, 35.6], // Offshore in Tokyo Bay
        },
    ];
    for (const { label, center } of coastCenters) {
        for (const r of radii) {
            cases.push({
                label: `coastline / ${label} / ${r}m`,
                category: "coastline",
                center,
                radiusMeters: r,
                quadrantSegments: QS,
            });
        }
    }

    // ── high-speed-rail ───────────────────────────────────────────
    const railCenters: { label: string; center: Position }[] = [
        {
            label: "on the Tōkaidō corridor",
            center: [139.745, 35.63], // Shinagawa station area
        },
        {
            label: "on the Tōhoku corridor",
            center: [139.78, 35.71], // Ueno station area
        },
        {
            label: "between corridors",
            center: [139.715, 35.685], // Shinjuku — between Tōkaidō and Tōhoku
        },
    ];
    for (const { label, center } of railCenters) {
        for (const r of radii) {
            cases.push({
                label: `high-speed-rail / ${label} / ${r}m`,
                category: "high-speed-rail",
                center,
                radiusMeters: r,
                quadrantSegments: QS,
            });
        }
    }

    return cases;
}

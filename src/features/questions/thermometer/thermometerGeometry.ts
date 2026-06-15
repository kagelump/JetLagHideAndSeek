import circle from "@turf/circle";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiPolygon,
    Polygon,
} from "geojson";

import { EARTH_RADIUS_METERS, haversineDistanceMeters } from "@/shared/geojson";
import type { Bbox, Position } from "@/shared/geojson";

import { clipCellsToPlayArea } from "@/features/questions/clipVoronoiCells";
import type { QuestionState } from "@/features/questions/questionTypes";
import type {
    ThermometerQuestion,
    ThermometerRenderState,
} from "./thermometerTypes";
import { THERMOMETER } from "@/config/appConfig";

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_TRAVEL_METERS = THERMOMETER.minTravelM;
const MAX_CACHE_SIZE = THERMOMETER.maxCacheSize;

// ─── LRU cache ───────────────────────────────────────────────────────────────

/** Increment to invalidate all cached state when the algorithm changes. */
const GEOMETRY_CACHE_VERSION = 1;

/**
 * Full render-state cache for single-question calls (the common case).
 * Keyed on (p1, p2, answer, boundary identity).
 */
const stateCache = new Map<string, ThermometerRenderState>();

/**
 * Per-component caches so the multi-question path can still reuse
 * individual half-planes and preview collections computed for earlier
 * single-question calls.
 */
const halfPlaneCache = new Map<
    string,
    FeatureCollection<Polygon | MultiPolygon>
>();
const previewCache = new Map<string, FeatureCollection<LineString | Polygon>>();

const boundaryIds = new WeakMap<object, number>();
let nextBoundaryId = 1;

function getBoundaryId(boundary: object): number {
    let id = boundaryIds.get(boundary);
    if (id === undefined) {
        id = nextBoundaryId++;
        boundaryIds.set(boundary, id);
    }
    return id;
}

/** Round to 7 decimal places to prevent floating-point drift in cache keys. */
function round7(n: number): number {
    return Math.round(n * 1e7) / 1e7;
}

function questionStateCacheKey(
    p1: Position,
    p2: Position,
    answer: "positive" | "negative" | "unanswered",
    boundaryId: number,
): string {
    return [
        GEOMETRY_CACHE_VERSION,
        round7(p1[0]),
        round7(p1[1]),
        round7(p2[0]),
        round7(p2[1]),
        answer,
        boundaryId,
    ].join(":");
}

function halfPlaneCacheKey(
    p1: Position,
    p2: Position,
    answer: "positive" | "negative",
    boundaryId: number,
): string {
    return [
        GEOMETRY_CACHE_VERSION,
        round7(p1[0]),
        round7(p1[1]),
        round7(p2[0]),
        round7(p2[1]),
        answer,
        boundaryId,
    ].join(":");
}

function previewCacheKey(p1: Position, p2: Position): string {
    return [
        GEOMETRY_CACHE_VERSION,
        round7(p1[0]),
        round7(p1[1]),
        round7(p2[0]),
        round7(p2[1]),
    ].join(":");
}

/** Clears the in-memory caches. Call in tests to reset state. */
export function clearThermometerGeometryCache(): void {
    stateCache.clear();
    halfPlaneCache.clear();
    previewCache.clear();
}

// ─── Bbox helpers ────────────────────────────────────────────────────────────

function computeBoundaryBbox(
    boundary: FeatureCollection<Polygon | MultiPolygon>,
): Bbox {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const feature of boundary.features) {
        const geom = feature.geometry;
        const polys =
            geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
            for (const ring of poly) {
                for (const [lon, lat] of ring) {
                    if (lon < west) west = lon;
                    if (lat < south) south = lat;
                    if (lon > east) east = lon;
                    if (lat > north) north = lat;
                }
            }
        }
    }
    return [west, south, east, north];
}

/** Approximate bbox diagonal length in meters. */
function bboxDiagonalMeters([west, south, east, north]: Bbox): number {
    const midLat = ((south + north) / 2) * (Math.PI / 180);
    const mPerDegLat = EARTH_RADIUS_METERS * (Math.PI / 180);
    const mPerDegLon = Math.cos(midLat) * mPerDegLat;
    const widthM = (east - west) * mPerDegLon;
    const heightM = (north - south) * mPerDegLat;
    return Math.sqrt(widthM * widthM + heightM * heightM);
}

// ─── Half-plane construction ─────────────────────────────────────────────────

/**
 * Build a single-cell FeatureCollection wrapping the half-plane rectangle,
 * then clip to the play area boundary.
 *
 * The half-plane is a large rectangle on the valid side of the perpendicular
 * bisector of segment P1→P2, computed in a local equirectangular projection
 * centered on the midpoint.
 */
export function buildHalfPlane(
    p1: Position,
    p2: Position,
    answer: "positive" | "negative",
    boundary: FeatureCollection<Polygon | MultiPolygon>,
    boundaryBbox: Bbox,
): FeatureCollection<Polygon | MultiPolygon> {
    // 1. Midpoint in lon/lat.
    const M: Position = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];

    // 2. Projection constants (equirectangular centered on M).
    const cosLat = Math.cos((M[1] * Math.PI) / 180);
    const mPerDegLat = EARTH_RADIUS_METERS * (Math.PI / 180);
    const mPerDegLon = cosLat * mPerDegLat;

    function project(p: Position): [number, number] {
        return [(p[0] - M[0]) * mPerDegLon, (p[1] - M[1]) * mPerDegLat];
    }

    function unproject([x, y]: [number, number]): Position {
        return [M[0] + x / mPerDegLon, M[1] + y / mPerDegLat];
    }

    // 3. Travel direction in projected meters.
    const [p1x, p1y] = project(p1);
    const [p2x, p2y] = project(p2);
    const dx = p2x - p1x;
    const dy = p2y - p1y;
    const len = Math.sqrt(dx * dx + dy * dy);

    // Degenerate — should not reach here (filtered upstream), but guard.
    if (len === 0) {
        return { type: "FeatureCollection", features: [] };
    }

    const ndx = dx / len;
    const ndy = dy / len;

    // 4. Perpendicular direction (90° CCW from d).
    const nx = -ndy;
    const ny = ndx;

    // 5. Rectangle half-extent L = 2 × bbox diagonal (in meters).
    const diagonalM = bboxDiagonalMeters(boundaryBbox);
    const L = 2 * Math.max(diagonalM, 1000);

    // 6. Build rectangle corners in projected space.
    //    Rectangle extends ±L along the perpendicular (the bisector), and
    //    from the bisector by +L along the travel direction for Hotter
    //    or -L for Colder.
    const sign = answer === "positive" ? 1 : -1;

    // Corners along the bisector (perpendicular).
    const A: [number, number] = [L * nx, L * ny];
    const B: [number, number] = [-L * nx, -L * ny];

    // Extend along travel direction.
    const C: [number, number] = [B[0] + sign * L * ndx, B[1] + sign * L * ndy];
    const D: [number, number] = [A[0] + sign * L * ndx, A[1] + sign * L * ndy];

    // 7. Dev assertion: verify the rectangle contains the correct anchor point.
    if (__DEV__) {
        const anchor = answer === "positive" ? p2 : p1;
        const [ax, ay] = project(anchor);
        // Express anchor in the (n, d) basis.
        const anchorD = ax * ndx + ay * ndy;
        const dMin = sign === 1 ? -1 : -L; // allow slop on the bisector edge
        const dMax = sign === 1 ? L : 1;
        if (anchorD < dMin || anchorD > dMax) {
            console.warn(
                `[thermometerGeometry] half-plane side verification failed: ` +
                    `anchorD=${anchorD.toFixed(1)} not in [${dMin.toFixed(1)}, ${dMax.toFixed(1)}] ` +
                    `(answer=${answer})`,
            );
        }
    }

    // 8. Inverse-project corners back to lon/lat.
    const cornerA = unproject(A);
    const cornerB = unproject(B);
    const cornerC = unproject(C);
    const cornerD = unproject(D);

    // 9. Build Polygon feature and clip.
    const halfPlaneCell: Feature<Polygon> = {
        type: "Feature",
        properties: {},
        geometry: {
            type: "Polygon",
            coordinates: [[cornerA, cornerB, cornerC, cornerD, cornerA]],
        },
    };

    const cells: FeatureCollection<Polygon> = {
        type: "FeatureCollection",
        features: [halfPlaneCell],
    };

    return clipCellsToPlayArea(cells, boundary);
}

// ─── Bisector line ───────────────────────────────────────────────────────────

/**
 * Build the perpendicular bisector line between P1 and P2, clipped to the
 * play area bbox. Always computable when both pins are set, regardless of
 * answer state.
 */
export function buildBisectorLine(
    p1: Position,
    p2: Position,
    boundaryBbox: Bbox,
): Feature<LineString> | null {
    const M: Position = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const cosLat = Math.cos((M[1] * Math.PI) / 180);
    const mPerDegLat = EARTH_RADIUS_METERS * (Math.PI / 180);
    const mPerDegLon = cosLat * mPerDegLat;

    const [p1x, p1y] = [
        (p1[0] - M[0]) * mPerDegLon,
        (p1[1] - M[1]) * mPerDegLat,
    ];
    const [p2x, p2y] = [
        (p2[0] - M[0]) * mPerDegLon,
        (p2[1] - M[1]) * mPerDegLat,
    ];
    const dx = p2x - p1x;
    const dy = p2y - p1y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return null;

    // Perpendicular direction (90° CCW).
    const nx = -dy / len;
    const ny = dx / len;

    const diagonalM = bboxDiagonalMeters(boundaryBbox);
    const L = Math.max(diagonalM, 1000);

    const unproject = ([x, y]: [number, number]): Position => [
        M[0] + x / mPerDegLon,
        M[1] + y / mPerDegLat,
    ];

    // Bisector endpoints in lon/lat (far outside the play area).
    const start = unproject([L * nx, L * ny]);
    const end = unproject([-L * nx, -L * ny]);

    // Clip the bisector line segment to the play area bbox using
    // Cohen-Sutherland line clipping.
    const [west, south, east, north] = boundaryBbox;
    const clipped = clipLineToBbox(
        start[0],
        start[1],
        end[0],
        end[1],
        west,
        south,
        east,
        north,
    );
    if (!clipped) return null;

    return {
        type: "Feature",
        properties: {},
        geometry: {
            type: "LineString",
            coordinates: [
                [clipped.x0, clipped.y0],
                [clipped.x1, clipped.y1],
            ],
        },
    };
}

const INSIDE = 0;
const LEFT = 1;
const RIGHT = 2;
const BOTTOM = 4;
const TOP = 8;

function computeOutCode(
    x: number,
    y: number,
    xmin: number,
    ymin: number,
    xmax: number,
    ymax: number,
): number {
    let code = INSIDE;
    if (x < xmin) code |= LEFT;
    else if (x > xmax) code |= RIGHT;
    if (y < ymin) code |= BOTTOM;
    else if (y > ymax) code |= TOP;
    return code;
}

function clipLineToBbox(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    xmin: number,
    ymin: number,
    xmax: number,
    ymax: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
    let out0 = computeOutCode(x0, y0, xmin, ymin, xmax, ymax);
    let out1 = computeOutCode(x1, y1, xmin, ymin, xmax, ymax);

    while (true) {
        if (!(out0 | out1)) {
            return { x0, y0, x1, y1 };
        }
        if (out0 & out1) {
            return null;
        }
        const out = out0 || out1;
        let x: number;
        let y: number;
        if (out & TOP) {
            x = x0 + ((x1 - x0) * (ymax - y0)) / (y1 - y0);
            y = ymax;
        } else if (out & BOTTOM) {
            x = x0 + ((x1 - x0) * (ymin - y0)) / (y1 - y0);
            y = ymin;
        } else if (out & RIGHT) {
            y = y0 + ((y1 - y0) * (xmax - x0)) / (x1 - x0);
            x = xmax;
        } else {
            y = y0 + ((y1 - y0) * (xmin - x0)) / (x1 - x0);
            x = xmin;
        }
        if (out === out0) {
            x0 = x;
            y0 = y;
            out0 = computeOutCode(x0, y0, xmin, ymin, xmax, ymax);
        } else {
            x1 = x;
            y1 = y;
            out1 = computeOutCode(x1, y1, xmin, ymin, xmax, ymax);
        }
    }
}

// ─── Preview features ────────────────────────────────────────────────────────

/**
 * Build preview features: travel-segment line from P1 to P2, plus three
 * range-ring circles centered on P1 at 1 km, 5 km, and 15 km.
 *
 * Each feature carries a `role` property that Task 09's ThermometerPreviewLayer
 * uses for rendering:
 *   - `"travel-line"` — the P1→P2 segment
 *   - `"ring-1km"`, `"ring-5km"`, `"ring-15km"` — concentric rings from P1
 */
export function buildThermometerPreviewFeatures(
    p1: Position,
    p2: Position,
): FeatureCollection<LineString | Polygon> {
    const travelLine: Feature<LineString> = {
        type: "Feature",
        properties: { role: "travel-line" },
        geometry: {
            type: "LineString",
            coordinates: [p1, p2],
        },
    };

    const ring1km = circle(p1, 1, {
        units: "kilometers",
        properties: { role: "ring-1km" },
    }) as Feature<Polygon>;

    const ring5km = circle(p1, 5, {
        units: "kilometers",
        properties: { role: "ring-5km" },
    }) as Feature<Polygon>;

    const ring15km = circle(p1, 15, {
        units: "kilometers",
        properties: { role: "ring-15km" },
    }) as Feature<Polygon>;

    return {
        type: "FeatureCollection",
        features: [travelLine, ring1km, ring5km, ring15km],
    };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function buildThermometerRenderState(
    questions: QuestionState[],
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): ThermometerRenderState {
    const thermometerQuestions = questions.filter(
        (q): q is ThermometerQuestion => q.type === "thermometer",
    );

    // Fast path: single question — cache the full render state.
    if (thermometerQuestions.length === 1) {
        return buildSingleThermometerRenderState(
            thermometerQuestions[0],
            playAreaBoundary,
        );
    }

    // Multi-question path: aggregate from per-component caches.
    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const previewFeatures: Feature<LineString | Polygon>[] = [];
    let bisectorLine: Feature<LineString> | null = null;

    for (const q of thermometerQuestions) {
        if (!q.previousPosition || !q.currentPosition) continue;

        const dist = haversineDistanceMeters(
            q.previousPosition[1],
            q.previousPosition[0],
            q.currentPosition[1],
            q.currentPosition[0],
        );
        if (dist < MIN_TRAVEL_METERS) continue;

        // Reuse the single-question path for each — it populates the
        // component caches so we can pull the pieces without recomputing.
        const single = buildSingleThermometerRenderState(q, playAreaBoundary);
        previewFeatures.push(...single.previewFeatures.features);
        hitFeatures.push(...single.hitMaskFeatures.features);
        if (!bisectorLine && single.bisectorLine) {
            bisectorLine = single.bisectorLine;
        }
    }

    return {
        bisectorLine,
        hitMaskFeatures: {
            type: "FeatureCollection",
            features: hitFeatures,
        },
        previewFeatures: {
            type: "FeatureCollection",
            features: previewFeatures,
        },
    };
}

/**
 * Build render state (preview, bisector, and half-plane mask) for a single
 * thermometer question, with full-state LRU caching. Populates the per-component
 * caches as a side effect so multi-question callers can compose without
 * re-computation.
 *
 * Exported so the map can render the preview/bisector for the *active* question
 * only — the multi-question aggregate (`buildThermometerRenderState`) is for the
 * combined mask and must not drive the single-line preview.
 */
export function buildSingleThermometerRenderState(
    q: ThermometerQuestion,
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): ThermometerRenderState {
    const p1 = q.previousPosition;
    const p2 = q.currentPosition;

    // Missing both pins — nothing to render.
    if (!p1 && !p2) {
        return {
            bisectorLine: null,
            hitMaskFeatures: { type: "FeatureCollection", features: [] },
            previewFeatures: { type: "FeatureCollection", features: [] },
        };
    }

    // Only one pin set — emit a dotted degenerate line from that pin to itself
    // (zero-length; the layer will still render it as a dot marker).
    if (!p1 || !p2) {
        const p = p1 ?? p2!;
        const degenerateLine: Feature<LineString> = {
            type: "Feature",
            properties: { role: "travel-line", degenerate: true },
            geometry: { type: "LineString", coordinates: [p, p] },
        };
        return {
            bisectorLine: null,
            hitMaskFeatures: { type: "FeatureCollection", features: [] },
            previewFeatures: {
                type: "FeatureCollection",
                features: [degenerateLine],
            },
        };
    }

    // Both pins set — check travel distance.
    const dist = haversineDistanceMeters(p1[1], p1[0], p2[1], p2[0]);
    const isDegenerate = dist < MIN_TRAVEL_METERS;

    // Degenerate (pins too close) — emit a dotted line but no mask.
    if (isDegenerate) {
        const travelLine: Feature<LineString> = {
            type: "Feature",
            properties: { role: "travel-line", degenerate: true },
            geometry: {
                type: "LineString",
                coordinates: [p1, p2],
            },
        };
        return {
            bisectorLine: null,
            hitMaskFeatures: { type: "FeatureCollection", features: [] },
            previewFeatures: {
                type: "FeatureCollection",
                features: [travelLine],
            },
        };
    }

    const boundaryId = getBoundaryId(playAreaBoundary);
    const answer =
        q.answer === "positive" || q.answer === "negative"
            ? q.answer
            : "unanswered";

    // ── Check full-state cache ─────────────────────────────────────
    const stateKey = questionStateCacheKey(p1, p2, answer, boundaryId);
    const cached = stateCache.get(stateKey);
    if (cached) {
        // Promote to most-recently-used.
        stateCache.delete(stateKey);
        stateCache.set(stateKey, cached);
        return cached;
    }

    // ── Bisector line: always when both positions set ──────────────
    const boundaryBbox = computeBoundaryBbox(playAreaBoundary);
    const bisector = buildBisectorLine(p1, p2, boundaryBbox);

    // ── Preview: always when both positions set ────────────────────
    let pv: FeatureCollection<LineString | Polygon>;
    const pvKey = previewCacheKey(p1, p2);
    const cachedPv = previewCache.get(pvKey);
    if (cachedPv) {
        previewCache.delete(pvKey);
        previewCache.set(pvKey, cachedPv);
        pv = cachedPv;
    } else {
        pv = buildThermometerPreviewFeatures(p1, p2);
        if (previewCache.size >= MAX_CACHE_SIZE) {
            const oldest = previewCache.keys().next().value;
            if (oldest !== undefined) previewCache.delete(oldest);
        }
        previewCache.set(pvKey, pv);
    }

    // ── Mask: only for answered questions ─────────────────────────
    let hitMask: FeatureCollection<Polygon | MultiPolygon>;
    if (answer === "positive" || answer === "negative") {
        const hpKey = halfPlaneCacheKey(p1, p2, answer, boundaryId);
        const cachedHp = halfPlaneCache.get(hpKey);
        if (cachedHp) {
            halfPlaneCache.delete(hpKey);
            halfPlaneCache.set(hpKey, cachedHp);
            hitMask = cachedHp;
        } else {
            hitMask = buildHalfPlane(
                p1,
                p2,
                answer,
                playAreaBoundary,
                boundaryBbox,
            );
            if (halfPlaneCache.size >= MAX_CACHE_SIZE) {
                const oldest = halfPlaneCache.keys().next().value;
                if (oldest !== undefined) halfPlaneCache.delete(oldest);
            }
            halfPlaneCache.set(hpKey, hitMask);
        }
    } else {
        hitMask = { type: "FeatureCollection", features: [] };
    }

    // ── Store in full-state cache ──────────────────────────────────
    const result: ThermometerRenderState = {
        bisectorLine: bisector,
        hitMaskFeatures: hitMask,
        previewFeatures: pv,
    };

    if (stateCache.size >= MAX_CACHE_SIZE) {
        const oldest = stateCache.keys().next().value;
        if (oldest !== undefined) stateCache.delete(oldest);
    }
    stateCache.set(stateKey, result);

    return result;
}

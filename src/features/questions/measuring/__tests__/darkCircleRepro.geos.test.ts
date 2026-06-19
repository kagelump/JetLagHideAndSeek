/**
 * Repro: the "dark circle" notch in the body-of-water hit mask near the
 * Meguro river junction (Nakameguro), reported at ~[139.701994, 35.642352].
 *
 * Unlike the standalone `tools/repro-dark-circle.mjs` — which re-implements the
 * buffer pipeline inline and (a) buffers each polygon in its own per-feature
 * AEQD projection and (b) NEVER runs the GEOS `unaryUnion` dissolve — this test
 * drives the **real shipped code path**:
 *
 *   buildMeasuringRenderState
 *     → computeLineCategory (window selection + nearest distance)
 *     → filterFeaturesByBboxMargin → filterPolygonMembersByBbox
 *     → computeLineBufferCached → computeLineBuffer
 *         → simplifyPolygonBufferFeatures
 *         → geosGeometryBackend.bufferMeters (per feature)
 *         → mergeBuffersToMultiPolygon
 *         → geosGeometryBackend.unaryUnion(merged)   ← the dissolve the
 *                                                        inline repro skips
 *
 * The geometry backend is the genuine `geosGeometryBackend`, with the native
 * WKB ops swapped for the geos-wasm node oracle (same trick as
 * geosParity.test.ts). So the only fidelity gap vs the device is geos-wasm 3.x
 * vs native GEOS 3.14 — the algorithm, projection, simplification, dissolve and
 * merge are byte-for-byte the production code.
 *
 * Features come from the on-disk pack artifact, which (verified by sha256 of
 * the decompressed payload == catalog `sha256`) is exactly what the device
 * downloads.
 *
 * Run: `pnpm test:geos darkCircleRepro`
 */

import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

import { initGeosWasm } from "@/shared/geometry/__tests__/helpers/geosWasmShim";
import {
    bufferWKB as wasmBufferWKB,
    unaryUnionWKB as wasmUnaryUnionWKB,
    differenceWKB as wasmDifferenceWKB,
    unionWKB as wasmUnionWKB,
    intersectionWKB as wasmIntersectionWKB,
} from "@/shared/geometry/__tests__/helpers/geosWasmShim";
import { geosGeometryBackend } from "@/shared/geometry/geosGeometryBackend";
import { __setGeometryBackendForTest } from "@/shared/geometry/geometryBackend";
import type { Bbox } from "@/shared/geojson";
import type { QuestionState } from "@/features/questions/questionTypes";

import {
    __setLineBundleForTest,
    __clearLineBundlesForTest,
    type LineBundle,
} from "../lineBundleLoader";
import {
    computeLineCategory,
    computeLineBuffer,
    clearLineCategoryCache,
    clearLineBufferCache,
    clearLineDistanceCache,
    filterFeaturesByBboxMargin,
    filterPolygonMembersByBbox,
    simplifyPolygonBufferFeatures,
    dissolveBuffersByBinaryUnion,
    type LineOrPolygonFeature,
} from "../lineMeasuringGeometry";
import { buildMeasuringRenderState } from "../measuringGeometry";

// ─── Repro coordinates (from the device report + screenshot) ───────────────

/** Seeker pin shown in the Measuring sheet ("35.64628, 139.69480"). */
const SEEKER_CENTER: [number, number] = [139.6948, 35.64628];
/** The reported dark-circle location. */
const NOTCH: [number, number] = [139.701994, 35.642352];
/** Tokyo 23-Wards play-area bbox (the device default). */
const TOKYO_BBOX: Bbox = [139.563, 35.523, 139.919, 35.818];

// ─── Geometry helpers (test-only; not part of the runtime under test) ──────

function pipRing(px: number, py: number, ring: Position[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0],
            yi = ring[i][1];
        const xj = ring[j][0],
            yj = ring[j][1];
        if (
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        ) {
            inside = !inside;
        }
    }
    return inside;
}

/** Point-in-MultiPolygon honoring holes. */
function pointInBuffer(
    px: number,
    py: number,
    geom: Polygon | MultiPolygon,
): boolean {
    const polys: Position[][][] =
        geom.type === "Polygon"
            ? [geom.coordinates as Position[][]]
            : (geom.coordinates as Position[][][]);
    for (const poly of polys) {
        if (!pipRing(px, py, poly[0])) continue;
        let inHole = false;
        for (let h = 1; h < poly.length; h++) {
            if (pipRing(px, py, poly[h])) {
                inHole = true;
                break;
            }
        }
        if (!inHole) return true;
    }
    return false;
}

const cosLat = Math.cos((NOTCH[1] * Math.PI) / 180);
const KX = 111_320 * cosLat;
const KY = 111_320;
const mDegLon = (m: number) => m / KX;
const mDegLat = (m: number) => m / KY;

function sqDistMToSeg(p: Position, a: Position, b: Position): number {
    const ax = a[0] * KX,
        ay = a[1] * KY;
    const bx = b[0] * KX,
        by = b[1] * KY;
    const px = p[0] * KX,
        py = p[1] * KY;
    const dx = bx - ax,
        dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx,
        cy = ay + t * dy;
    return (px - cx) ** 2 + (py - cy) ** 2;
}

/** Flatten every water segment (line + polygon ring) near a point. */
function collectLocalWaterSegments(
    bundle: LineBundle,
    near: Position,
    radiusM: number,
): [Position, Position][] {
    const segs: [Position, Position][] = [];
    const padLon = mDegLon(radiusM);
    const padLat = mDegLat(radiusM);
    const box: Bbox = [
        near[0] - padLon,
        near[1] - padLat,
        near[0] + padLon,
        near[1] + padLat,
    ];
    const inBox = (c: Position) =>
        c[0] >= box[0] && c[0] <= box[2] && c[1] >= box[1] && c[1] <= box[3];
    const pushRing = (ring: Position[]) => {
        // Keep a ring if any vertex is near the box.
        if (!ring.some(inBox)) return;
        for (let i = 1; i < ring.length; i++) segs.push([ring[i - 1], ring[i]]);
    };
    for (const f of bundle.features) {
        const g = f.geometry;
        if (g.type === "LineString") pushRing(g.coordinates as Position[]);
        else if (g.type === "MultiLineString")
            for (const l of g.coordinates) pushRing(l as Position[]);
        else if (g.type === "Polygon")
            for (const r of g.coordinates) pushRing(r as Position[]);
        else if (g.type === "MultiPolygon")
            for (const poly of g.coordinates)
                for (const r of poly) pushRing(r as Position[]);
    }
    return segs;
}

function minDistToWaterM(p: Position, segs: [Position, Position][]): number {
    let min = Infinity;
    for (const [a, b] of segs) {
        const d = sqDistMToSeg(p, a, b);
        if (d < min) min = d;
    }
    return Math.sqrt(min);
}

// ─── Bundle loading ─────────────────────────────────────────────────────────

function loadBundle(file: string): LineBundle {
    const path = resolve(
        process.cwd(),
        "data/packs/dist/asia-japan-kanto",
        file,
    );
    return JSON.parse(gunzipSync(readFileSync(path)).toString()) as LineBundle;
}

// ─── Test ─────────────────────────────────────────────────────────────────

describe("body-of-water dark-circle notch (Nakameguro / Meguro river)", () => {
    let water: LineBundle;
    let coastline: LineBundle;

    beforeAll(async () => {
        await initGeosWasm();
        // Swap the native-geometry WKB ops for the geos-wasm oracle so the
        // genuine geosGeometryBackend (name === "geos") runs end-to-end —
        // including the unaryUnion dissolve.
        const native = require("native-geometry");
        native.bufferWKB = wasmBufferWKB;
        native.unaryUnionWKB = wasmUnaryUnionWKB;
        native.differenceWKB = wasmDifferenceWKB;
        native.unionWKB = wasmUnionWKB;
        native.intersectionWKB = wasmIntersectionWKB;
        __setGeometryBackendForTest(geosGeometryBackend);

        water = loadBundle("measuring-body-of-water.json.gz");
        coastline = loadBundle("measuring-coastline.json.gz");
    }, 120_000);

    afterAll(() => {
        __setGeometryBackendForTest(null);
        __clearLineBundlesForTest();
    });

    beforeEach(() => {
        clearLineCategoryCache();
        clearLineBufferCache();
        clearLineDistanceCache();
        __clearLineBundlesForTest();
        __setLineBundleForTest("body-of-water", water);
        __setLineBundleForTest("coastline", coastline);
    });

    it("covers the river junction point in the Closer hit mask", () => {
        // Resolve the radius the runtime will use (distance seeker→nearest water).
        const lineCat = computeLineCategory(
            SEEKER_CENTER,
            "body-of-water",
            TOKYO_BBOX,
        );
        expect(lineCat).not.toBeNull();
        const radiusM = lineCat!.distanceMeters;
        console.log(
            `[repro] seeker=${JSON.stringify(SEEKER_CENTER)} ` +
                `nearestWater=${JSON.stringify(
                    lineCat!.nearestPoint.map((v) => +v.toFixed(6)),
                )} radius=${radiusM.toFixed(1)}m ` +
                `windowFeatures=${lineCat!.windowFeatures.length}`,
        );

        const question: QuestionState = {
            id: "repro-water",
            type: "measuring",
            category: "body-of-water",
            center: SEEKER_CENTER,
            answer: "positive", // "Closer"
            createdAt: "2026-06-19T00:00:00.000Z",
            updatedAt: "2026-06-19T00:00:00.000Z",
            isLocked: false,
            distance: null,
            nearestName: null,
        } as unknown as QuestionState;

        const render = buildMeasuringRenderState(
            [question],
            TOKYO_BBOX,
            undefined,
        );

        const hit = render.hitMaskFeatures.features[0] as
            | Feature<Polygon | MultiPolygon>
            | undefined;
        expect(hit).toBeDefined();
        const geom = hit!.geometry;

        // ── Diagnostics: characterize the hit geometry near the notch ──
        const polys: Position[][][] =
            geom.type === "Polygon"
                ? [geom.coordinates as Position[][]]
                : (geom.coordinates as Position[][][]);
        let nearestVtxM = Infinity;
        let bMinX = Infinity,
            bMinY = Infinity,
            bMaxX = -Infinity,
            bMaxY = -Infinity;
        for (const poly of polys) {
            for (const ring of poly) {
                for (const [x, y] of ring) {
                    if (x < bMinX) bMinX = x;
                    if (y < bMinY) bMinY = y;
                    if (x > bMaxX) bMaxX = x;
                    if (y > bMaxY) bMaxY = y;
                    const dxm = (x - NOTCH[0]) * KX;
                    const dym = (y - NOTCH[1]) * KY;
                    const d = Math.hypot(dxm, dym);
                    if (d < nearestVtxM) nearestVtxM = d;
                }
            }
        }
        console.log(
            `[repro] hit geom: ${polys.length} polygon(s), ` +
                `bbox=[${bMinX.toFixed(4)},${bMinY.toFixed(4)}]→` +
                `[${bMaxX.toFixed(4)},${bMaxY.toFixed(4)}], ` +
                `nearestRingVertexToNotch=${nearestVtxM.toFixed(1)}m, ` +
                `notchInBufferBbox=${NOTCH[0] >= bMinX && NOTCH[0] <= bMaxX && NOTCH[1] >= bMinY && NOTCH[1] <= bMaxY}`,
        );
        try {
            require("node:fs").writeFileSync(
                "/tmp/repro-hit-geom.json",
                JSON.stringify({
                    type: "FeatureCollection",
                    features: [
                        hit,
                        {
                            type: "Feature",
                            properties: { name: "notch" },
                            geometry: { type: "Point", coordinates: NOTCH },
                        },
                        {
                            type: "Feature",
                            properties: { name: "seeker" },
                            geometry: {
                                type: "Point",
                                coordinates: SEEKER_CENTER,
                            },
                        },
                    ],
                }),
            );
        } catch {
            /* ignore */
        }

        // How far is the reported notch from real water? (must be << radius
        // for it to legitimately be inside the "Closer" hit mask)
        const segs = collectLocalWaterSegments(water, NOTCH, 600);
        const notchDistToWater = minDistToWaterM(NOTCH, segs);
        const notchInside = pointInBuffer(NOTCH[0], NOTCH[1], geom);

        // Identify the single nearest water FEATURE to the notch: line vs
        // polygon, its size, and length — this is the feature that was dropped
        // from the buffer input.
        {
            let best = { dist: Infinity, type: "", info: "" };
            const segLenM = (a: Position, b: Position) =>
                Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY);
            const featSegs = (f: Feature): [Position, Position][] => {
                const out: [Position, Position][] = [];
                const g = f.geometry;
                const ring = (r: Position[]) => {
                    for (let i = 1; i < r.length; i++)
                        out.push([r[i - 1], r[i]]);
                };
                if (g.type === "LineString") ring(g.coordinates as Position[]);
                else if (g.type === "MultiLineString")
                    for (const l of g.coordinates) ring(l as Position[]);
                else if (g.type === "Polygon")
                    for (const r of g.coordinates) ring(r as Position[]);
                else if (g.type === "MultiPolygon")
                    for (const poly of g.coordinates)
                        for (const r of poly) ring(r as Position[]);
                return out;
            };
            for (const f of water.features) {
                const fs = featSegs(f as Feature);
                if (fs.length === 0) continue;
                // cheap bbox reject
                let near = false;
                for (const [a] of fs) {
                    if (
                        Math.abs((a[0] - NOTCH[0]) * KX) < 400 &&
                        Math.abs((a[1] - NOTCH[1]) * KY) < 400
                    ) {
                        near = true;
                        break;
                    }
                }
                if (!near) continue;
                let d = Infinity;
                for (const [a, b] of fs)
                    d = Math.min(d, Math.sqrt(sqDistMToSeg(NOTCH, a, b)));
                if (d < best.dist) {
                    const g = f.geometry;
                    const len = fs.reduce((s, [a, b]) => s + segLenM(a, b), 0);
                    best = {
                        dist: d,
                        type: g.type,
                        info:
                            g.type === "LineString" ||
                            g.type === "MultiLineString"
                                ? `lengthM=${len.toFixed(1)}`
                                : `ringPerimeterM=${len.toFixed(1)}`,
                    };
                }
            }
            console.log(
                `[repro] nearest water FEATURE to notch: type=${best.type} ` +
                    `dist=${best.dist.toFixed(1)}m ${best.info}`,
            );
        }

        // ── Fine grid scan around the notch: count "gap" cells (within the
        //    radius of water but NOT inside the hit mask). ──
        const HALF = 150,
            STEP = 5;
        let gapCount = 0,
            nearWaterCount = 0;
        let gMinX = Infinity,
            gMinY = Infinity,
            gMaxX = -Infinity,
            gMaxY = -Infinity;
        for (let dx = -HALF; dx <= HALF; dx += STEP) {
            for (let dy = -HALF; dy <= HALF; dy += STEP) {
                const px = NOTCH[0] + mDegLon(dx);
                const py = NOTCH[1] + mDegLat(dy);
                const dw = minDistToWaterM([px, py], segs);
                if (dw > radiusM) continue; // not eligible regardless
                nearWaterCount++;
                if (!pointInBuffer(px, py, geom)) {
                    gapCount++;
                    if (dx < gMinX) gMinX = dx;
                    if (dy < gMinY) gMinY = dy;
                    if (dx > gMaxX) gMaxX = dx;
                    if (dy > gMaxY) gMaxY = dy;
                }
            }
        }

        console.log(
            `[repro] geom=${geom.type} ` +
                `notchDistToWater=${notchDistToWater.toFixed(1)}m ` +
                `radius=${radiusM.toFixed(1)}m notchInsideMask=${notchInside}\n` +
                `[repro] grid(±${HALF}m@${STEP}m): nearWater=${nearWaterCount} ` +
                `gapCells=${gapCount}` +
                (gapCount > 0
                    ? ` bbox=[${gMinX},${gMinY}]→[${gMaxX},${gMaxY}]m`
                    : ""),
        );

        // The notch sits right on the river — it must be inside the hit mask.
        // If this fails, the dark-circle notch is reproduced in the real path.
        expect(notchDistToWater).toBeLessThan(radiusM);
        expect(notchInside).toBe(true);
        expect(gapCount).toBe(0);
    }, 120_000);

    it("tracks the near-notch river-channel member through buffer-input prep", () => {
        const lineCat = computeLineCategory(
            SEEKER_CENTER,
            "body-of-water",
            TOKYO_BBOX,
        )!;
        const radiusM = lineCat.distanceMeters;

        // Min distance (m) from the notch to any ring of a poly feature set,
        // restricted to polygon members (lines ignored).
        const minMemberDistToNotch = (
            feats: Feature<Polygon | MultiPolygon>[],
        ): number => {
            let min = Infinity;
            const ring = (r: Position[]) => {
                for (let i = 1; i < r.length; i++) {
                    const d = Math.sqrt(sqDistMToSeg(NOTCH, r[i - 1], r[i]));
                    if (d < min) min = d;
                }
            };
            for (const f of feats) {
                const g = f.geometry;
                if (g.type === "Polygon")
                    for (const r of g.coordinates) ring(r as Position[]);
                else
                    for (const poly of g.coordinates)
                        for (const r of poly) ring(r as Position[]);
            }
            return min;
        };

        const polyOnly = (
            feats: { geometry: { type: string } }[],
        ): Feature<Polygon | MultiPolygon>[] =>
            feats.filter(
                (f) =>
                    f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon",
            ) as Feature<Polygon | MultiPolygon>[];

        const win = lineCat.windowFeatures;
        const afterFeat = filterFeaturesByBboxMargin(win, TOKYO_BBOX, radiusM);
        const afterMember = filterPolygonMembersByBbox(
            afterFeat,
            TOKYO_BBOX,
            radiusM,
        );
        const afterSimplify = simplifyPolygonBufferFeatures(
            polyOnly(afterMember),
            radiusM,
        );

        const dWin = minMemberDistToNotch(polyOnly(win));
        const dFeat = minMemberDistToNotch(polyOnly(afterFeat));
        const dMember = minMemberDistToNotch(polyOnly(afterMember));
        const dSimplify = minMemberDistToNotch(afterSimplify);

        console.log(
            `[repro2] nearest polygon-member edge to notch through prep:\n` +
                `  window:                 ${dWin.toFixed(1)}m\n` +
                `  +filterFeaturesByBbox:  ${dFeat.toFixed(1)}m\n` +
                `  +filterMembersByBbox:   ${dMember.toFixed(1)}m\n` +
                `  +simplify/degenerate:   ${dSimplify.toFixed(1)}m  (radius=${radiusM.toFixed(0)}m)`,
        );

        // The river channel is in the raw window right next to the notch.
        expect(dWin).toBeLessThan(radiusM);
        // After prep it should still be within the radius (so its buffer
        // covers the notch). If prep pushes it past the radius, prep dropped /
        // collapsed the channel → reproduces the notch.
        expect(dSimplify).toBeLessThan(radiusM);
    }, 120_000);

    it("buffers the near-notch channel member alone (isolates buffer vs dissolve)", () => {
        const lineCat = computeLineCategory(
            SEEKER_CENTER,
            "body-of-water",
            TOKYO_BBOX,
        )!;
        const radiusM = lineCat.distanceMeters;

        const afterMember = filterPolygonMembersByBbox(
            filterFeaturesByBboxMargin(
                lineCat.windowFeatures,
                TOKYO_BBOX,
                radiusM,
            ),
            TOKYO_BBOX,
            radiusM,
        );
        const prepared = simplifyPolygonBufferFeatures(
            afterMember.filter(
                (f) =>
                    f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon",
            ) as Feature<Polygon | MultiPolygon>[],
            radiusM,
        );

        // Find the single member polygon (one Polygon coords) whose edge is
        // nearest the notch.
        let best: { coords: Position[][]; dist: number } | null = null;
        const consider = (coords: Position[][]) => {
            let d = Infinity;
            for (const ring of coords)
                for (let i = 1; i < ring.length; i++)
                    d = Math.min(
                        d,
                        Math.sqrt(sqDistMToSeg(NOTCH, ring[i - 1], ring[i])),
                    );
            if (!best || d < best.dist) best = { coords, dist: d };
        };
        for (const f of prepared) {
            const g = f.geometry;
            if (g.type === "Polygon") consider(g.coordinates as Position[][]);
            else
                for (const poly of g.coordinates)
                    consider(poly as Position[][]);
        }
        expect(best).not.toBeNull();
        const member = best!;

        const singleBuf = geosGeometryBackend.bufferMeters(
            {
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: member.coords },
            },
            radiusM,
            8,
        );
        expect(singleBuf).not.toBeNull();
        const insideSingle = pointInBuffer(
            NOTCH[0],
            NOTCH[1],
            singleBuf!.geometry,
        );

        console.log(
            `[repro3] nearest channel member: edgeDistToNotch=${member.dist.toFixed(1)}m ` +
                `ringCount=${member.coords.length} outerVerts=${member.coords[0].length}; ` +
                `single-member buffer (r=${radiusM.toFixed(0)}m) covers notch=${insideSingle} ` +
                `(${singleBuf!.geometry.type})`,
        );

        // The member edge is 2.4 m away; buffering it at ~172 m MUST cover the
        // notch. If this single, pre-dissolve buffer already misses it, the
        // GEOS buffer of the narrow channel self-intersected into a notch
        // (root cause). If it covers it here but the merged hit mask doesn't,
        // the dissolve is the culprit.
        expect(insideSingle).toBe(true);
    }, 120_000);

    it("replicates computeLineBuffer's polygon loop to pinpoint the lossy stage", () => {
        const lineCat = computeLineCategory(
            SEEKER_CENTER,
            "body-of-water",
            TOKYO_BBOX,
        )!;
        const radiusM = lineCat.distanceMeters;

        const prepared = simplifyPolygonBufferFeatures(
            filterPolygonMembersByBbox(
                filterFeaturesByBboxMargin(
                    lineCat.windowFeatures,
                    TOKYO_BBOX,
                    radiusM,
                ),
                TOKYO_BBOX,
                radiusM,
            ).filter(
                (f) =>
                    f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon",
            ) as Feature<Polygon | MultiPolygon>[],
            radiusM,
        );

        // Stage 1: buffer each prepared FEATURE whole (exactly as
        // computeLineBuffer does — projection centered on the WHOLE feature).
        const pieces: Feature<Polygon | MultiPolygon>[] = [];
        let anyFeatureCovers = false;
        let coveringFeatureType = "";
        for (const f of prepared) {
            const buf = geosGeometryBackend.bufferMeters(f, radiusM, 8);
            if (!buf) continue;
            pieces.push(buf);
            if (pointInBuffer(NOTCH[0], NOTCH[1], buf.geometry)) {
                anyFeatureCovers = true;
                coveringFeatureType = f.geometry.type;
            }
        }

        // Stage 2: merge (concatenate members) — what computeLineBuffer feeds
        // to unaryUnion.
        const mergedCoords: Position[][][] = [];
        for (const f of pieces) {
            const g = f.geometry;
            if (g.type === "Polygon")
                mergedCoords.push(g.coordinates as Position[][]);
            else
                for (const poly of g.coordinates)
                    mergedCoords.push(poly as Position[][]);
        }
        const merged: Feature<MultiPolygon> = {
            type: "Feature",
            properties: {},
            geometry: { type: "MultiPolygon", coordinates: mergedCoords },
        };
        const coveredByMerge = pointInBuffer(
            NOTCH[0],
            NOTCH[1],
            merged.geometry,
        );

        // Stage 3: unaryUnion dissolve (GEOS) — the production final step.
        const dissolved = geosGeometryBackend.unaryUnion(merged);
        const coveredByDissolve = dissolved
            ? pointInBuffer(NOTCH[0], NOTCH[1], dissolved.geometry)
            : false;

        console.log(
            `[repro4] stages (notch coverage): ` +
                `perFeatureBufferCovers=${anyFeatureCovers}` +
                (anyFeatureCovers ? `(${coveringFeatureType})` : "") +
                ` → mergedCovers=${coveredByMerge}` +
                ` → unaryUnionCovers=${coveredByDissolve} ` +
                `(${pieces.length} buffer pieces, dissolved=${dissolved?.geometry.type})`,
        );

        // Whichever of these is the first `false` is the lossy stage.
        expect(coveredByDissolve).toBe(true);
    }, 120_000);

    it("combines polygon pieces + line buffer to isolate the unaryUnion notch", () => {
        const lineCat = computeLineCategory(
            SEEKER_CENTER,
            "body-of-water",
            TOKYO_BBOX,
        )!;
        const radiusM = lineCat.distanceMeters;

        const scoped = filterPolygonMembersByBbox(
            filterFeaturesByBboxMargin(
                lineCat.windowFeatures,
                TOKYO_BBOX,
                radiusM,
            ),
            TOKYO_BBOX,
            radiusM,
        );

        const prepared = simplifyPolygonBufferFeatures(
            scoped.filter(
                (f) =>
                    f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon",
            ) as Feature<Polygon | MultiPolygon>[],
            radiusM,
        );
        const polyPieces: Feature<Polygon | MultiPolygon>[] = [];
        for (const f of prepared) {
            const buf = geosGeometryBackend.bufferMeters(f, radiusM, 8);
            if (buf) polyPieces.push(buf);
        }

        // Pure line buffer: computeLineBuffer with ONLY line features returns
        // the dissolved line buffer directly (no problematic poly+line combine).
        const lineOnly = scoped.filter(
            (f) =>
                f.geometry.type === "LineString" ||
                f.geometry.type === "MultiLineString",
        ) as LineOrPolygonFeature[];
        const lineBuf = computeLineBuffer(lineOnly, radiusM);

        const lineCovers = lineBuf
            ? pointInBuffer(NOTCH[0], NOTCH[1], lineBuf.geometry)
            : false;

        // Combine exactly as computeLineBuffer's final step: all polygon
        // pieces + the line buffer → merge → unaryUnion.
        const all = lineBuf ? [...polyPieces, lineBuf] : polyPieces;
        const mergedCoords: Position[][][] = [];
        for (const f of all) {
            const g = f.geometry;
            if (g.type === "Polygon")
                mergedCoords.push(g.coordinates as Position[][]);
            else
                for (const poly of g.coordinates)
                    mergedCoords.push(poly as Position[][]);
        }
        const merged: Feature<MultiPolygon> = {
            type: "Feature",
            properties: {},
            geometry: { type: "MultiPolygon", coordinates: mergedCoords },
        };
        const mergedCovers = pointInBuffer(NOTCH[0], NOTCH[1], merged.geometry);
        const dissolved = geosGeometryBackend.unaryUnion(merged);
        const dissolvedCovers = dissolved
            ? pointInBuffer(NOTCH[0], NOTCH[1], dissolved.geometry)
            : false;

        // Quantify how much area the dissolve drops: grid cells covered by the
        // merged set-union but NOT by the unaryUnion result.
        let mergedOnly = 0,
            both = 0;
        if (dissolved) {
            const HALF = 150,
                STEP = 5;
            for (let dx = -HALF; dx <= HALF; dx += STEP) {
                for (let dy = -HALF; dy <= HALF; dy += STEP) {
                    const px = NOTCH[0] + mDegLon(dx);
                    const py = NOTCH[1] + mDegLat(dy);
                    const inMerged = pointInBuffer(px, py, merged.geometry);
                    if (!inMerged) continue;
                    if (pointInBuffer(px, py, dissolved.geometry)) both++;
                    else mergedOnly++;
                }
            }
        }

        // The shipped fix (A1): dissolve the SAME pieces via binary-union fold.
        const fixed = dissolveBuffersByBinaryUnion(all, geosGeometryBackend);
        const fixedCovers = fixed
            ? pointInBuffer(NOTCH[0], NOTCH[1], fixed.geometry)
            : false;

        console.log(
            `[repro5] poly+line combine (notch coverage): ` +
                `lineBufferAlone=${lineCovers} ` +
                `polyPieces=${polyPieces.length} ` +
                `merged(poly+line)=${mergedCovers} | ` +
                `OLD unaryUnion(merged)=${dissolvedCovers} (lossy) → ` +
                `FIX binaryUnionFold=${fixedCovers}\n` +
                `[repro5] OLD unaryUnion drop over ±150m grid: ` +
                `coveredByMerged=${both + mergedOnly} ` +
                `keptByUnaryUnion=${both} droppedByUnaryUnion=${mergedOnly}`,
        );

        // Documents the root cause: the merged set-union covers the notch and
        // the shipped binary-union fold restores it. The OLD unaryUnion(merged)
        // result is logged (it drops the notch via MakeValid's even-odd hole)
        // but NOT asserted — that's a raw-GEOS quirk and could shift across
        // geos-wasm versions; we assert the behavior we control.
        expect(mergedCovers).toBe(true);
        expect(fixedCovers).toBe(true); // the fix
    }, 120_000);

    it("FIX HYPOTHESIS: pairwise binary union (no MakeValid) keeps the notch", () => {
        const lineCat = computeLineCategory(
            SEEKER_CENTER,
            "body-of-water",
            TOKYO_BBOX,
        )!;
        const radiusM = lineCat.distanceMeters;

        const scoped = filterPolygonMembersByBbox(
            filterFeaturesByBboxMargin(
                lineCat.windowFeatures,
                TOKYO_BBOX,
                radiusM,
            ),
            TOKYO_BBOX,
            radiusM,
        );
        const prepared = simplifyPolygonBufferFeatures(
            scoped.filter(
                (f) =>
                    f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon",
            ) as Feature<Polygon | MultiPolygon>[],
            radiusM,
        );
        const pieces: Feature<Polygon | MultiPolygon>[] = [];
        for (const f of prepared) {
            const buf = geosGeometryBackend.bufferMeters(f, radiusM, 8);
            if (buf) pieces.push(buf);
        }
        const lineOnly = scoped.filter(
            (f) =>
                f.geometry.type === "LineString" ||
                f.geometry.type === "MultiLineString",
        ) as LineOrPolygonFeature[];
        const lineBuf = computeLineBuffer(lineOnly, radiusM);
        if (lineBuf) pieces.push(lineBuf);

        // Accumulate via binary GEOSUnion. Each input (running accumulator and
        // next piece) is individually valid, so parseAndValidate never triggers
        // MakeValid — the union stays a true OR with no even-odd holes.
        let acc: Feature<Polygon | MultiPolygon> | null = null;
        for (const p of pieces) {
            acc = acc ? geosGeometryBackend.union(acc, p) : p;
        }
        const accCovers = acc
            ? pointInBuffer(NOTCH[0], NOTCH[1], acc.geometry)
            : false;

        console.log(
            `[repro6] pairwise binary union (no MakeValid): pieces=${pieces.length} ` +
                `notchCovered=${accCovers} (${acc?.geometry.type})`,
        );

        expect(accCovers).toBe(true);
    }, 180_000);
});

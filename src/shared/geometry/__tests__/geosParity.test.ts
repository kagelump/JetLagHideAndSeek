/**
 * On-host GEOS parity gate (Option A — geos-wasm in Jest).
 *
 * Runs the **real** `geosGeometryBackend` pipeline (project → encodeWkb → GEOS
 * → decodeWkb → unproject) against the `jsGeometryBackend` turf oracle for a
 * curated set of Tokyo/Osaka fixtures, and asserts the two buffers agree within
 * tolerance. This closes the "GEOS math has never been compared to the oracle"
 * gap from the G2 review **without a device** — the native Expo module can't run
 * in Jest, but GEOS itself runs in Node via geos-wasm.
 *
 * Requires ESM dynamic import (geos-wasm is ESM-only), so this suite runs under
 * its own config + flag and is excluded from the default `pnpm test`:
 *
 *   pnpm test:geos        # NODE_OPTIONS=--experimental-vm-modules, jest.config.geos.js
 *
 * The bundled GEOS is 3.13.x, not the app's vendored 3.14.1 — parity is gated on
 * **tolerance** (area ratio + bbox proximity), which is stable across GEOS 3.x.
 * The matching params (round cap/join, qs) are identical on both paths, so any
 * difference is JSTS-vs-GEOS buffer internals only and should be sub-percent.
 */

import type {
    Feature,
    LineString,
    MultiPoint,
    MultiPolygon,
    Polygon,
} from "geojson";

import { jsGeometryBackend } from "../jsGeometryBackend";
import { geosGeometryBackend } from "../geosGeometryBackend";
import {
    initGeosWasm,
    geosWasmVersion,
    bufferWKB as geosWasmBufferWKB,
} from "./helpers/geosWasmShim";

// ── Geographic metric helpers (dependency-free; mirror @turf/area) ──────────

const AREA_RADIUS = 6_378_137; // WGS84 semi-major axis, as @turf/area uses.
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Signed spherical area of a ring (the @mapbox/geojson-area algorithm). */
function ringArea(coords: number[][]): number {
    const n = coords.length;
    if (n <= 2) return 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
        const lower = coords[i];
        const middle = coords[(i + 1) % n];
        const upper = coords[(i + 2) % n];
        total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]));
    }
    return (total * AREA_RADIUS * AREA_RADIUS) / 2;
}

function polygonAreaM2(rings: number[][][]): number {
    if (rings.length === 0) return 0;
    let area = Math.abs(ringArea(rings[0]));
    for (let i = 1; i < rings.length; i++) area -= Math.abs(ringArea(rings[i]));
    return area;
}

function geomAreaM2(geom: Polygon | MultiPolygon): number {
    if (geom.type === "Polygon") return polygonAreaM2(geom.coordinates);
    return geom.coordinates.reduce((sum, poly) => sum + polygonAreaM2(poly), 0);
}

type Bbox = [number, number, number, number]; // [w, s, e, n]

function geomBbox(geom: Polygon | MultiPolygon): Bbox {
    let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
    const visit = (rings: number[][][]) => {
        for (const ring of rings)
            for (const [x, y] of ring) {
                if (x < w) w = x;
                if (x > e) e = x;
                if (y < s) s = y;
                if (y > n) n = y;
            }
    };
    if (geom.type === "Polygon") visit(geom.coordinates);
    else for (const poly of geom.coordinates) visit(poly);
    return [w, s, e, n];
}

/** Max edge displacement between two bboxes, in meters (approx). */
function bboxEdgeDeltaMeters(a: Bbox, b: Bbox, atLat: number): number {
    const mPerDegLat = 111_320;
    const mPerDegLon = 111_320 * Math.cos(rad(atLat));
    return Math.max(
        Math.abs(a[0] - b[0]) * mPerDegLon,
        Math.abs(a[2] - b[2]) * mPerDegLon,
        Math.abs(a[1] - b[1]) * mPerDegLat,
        Math.abs(a[3] - b[3]) * mPerDegLat,
    );
}

// ── Fixtures (chosen by geometric role: corridor, area, scattered points) ───

const tokyoRailLine: Feature<LineString> = {
    type: "Feature",
    properties: {},
    geometry: {
        type: "LineString",
        coordinates: [
            [139.7006, 35.6896], // Shinjuku
            [139.7454, 35.6586], // Roppongi
            [139.7671, 35.6812], // Tokyo Station
            [139.7966, 35.7101], // Asakusa-ish
        ],
    },
};

const tokyoWardPolygon: Feature<Polygon> = {
    type: "Feature",
    properties: {},
    geometry: {
        type: "Polygon",
        coordinates: [
            [
                [139.74, 35.66],
                [139.79, 35.66],
                [139.79, 35.7],
                [139.74, 35.7],
                [139.74, 35.66],
            ],
        ],
    },
};

const osakaStations: Feature<MultiPoint> = {
    type: "Feature",
    properties: {},
    geometry: {
        type: "MultiPoint",
        coordinates: [
            [135.4959, 34.7024], // Osaka Station
            [135.5018, 34.6663], // Namba
            [135.5206, 34.6464], // Tennoji
        ],
    },
};

const fixtures: { name: string; feature: Feature }[] = [
    { name: "tokyo rail line (LineString)", feature: tokyoRailLine },
    { name: "tokyo ward (Polygon)", feature: tokyoWardPolygon },
    { name: "osaka stations (MultiPoint)", feature: osakaStations },
];

const radiiMeters = [500, 2000, 5000];
const QS = 8; // matches every app call site (BUFFER_STEPS / literal 8)

// Parity gates (G2 plan, Layer 5).
const AREA_RATIO_MIN = 0.99;
const AREA_RATIO_MAX = 1.01;
// bbox displacement allowance: arc-discretization jitter scales with radius;
// a gross translation bug shifts by hundreds of meters, far beyond this.
const bboxToleranceM = (radius: number) => radius * 0.02 + 5;

describe("GEOS ↔ turf buffer parity (geos-wasm)", () => {
    beforeAll(async () => {
        await initGeosWasm();
        // Drive the real geosGeometryBackend by pointing its native dependency
        // at the wasm shim (same bufferWKB(wkb, dist, qs) contract).
        const native = require("native-geometry");
        native.bufferWKB = geosWasmBufferWKB;
        console.log(`[geosParity] GEOS (wasm) version: ${geosWasmVersion()}`);
    });

    for (const { name, feature } of fixtures) {
        for (const radius of radiiMeters) {
            test(`${name} @ ${radius}m`, () => {
                const js = jsGeometryBackend.bufferMeters(
                    feature as never,
                    radius,
                    QS,
                );
                const geos = geosGeometryBackend.bufferMeters(
                    feature as never,
                    radius,
                    QS,
                );

                expect(js).not.toBeNull();
                expect(geos).not.toBeNull();

                const jsGeom = js!.geometry as Polygon | MultiPolygon;
                const geosGeom = geos!.geometry as Polygon | MultiPolygon;

                const jsArea = geomAreaM2(jsGeom);
                const geosArea = geomAreaM2(geosGeom);
                const ratio = geosArea / jsArea;

                const jsBbox = geomBbox(jsGeom);
                const geosBbox = geomBbox(geosGeom);
                const lat = (jsBbox[1] + jsBbox[3]) / 2;
                const edgeDeltaM = bboxEdgeDeltaMeters(jsBbox, geosBbox, lat);

                console.log(
                    `[geosParity] ${name} @ ${radius}m  ` +
                        `area ratio=${ratio.toFixed(5)}  ` +
                        `bbox Δ=${edgeDeltaM.toFixed(2)}m`,
                );

                expect(ratio).toBeGreaterThanOrEqual(AREA_RATIO_MIN);
                expect(ratio).toBeLessThanOrEqual(AREA_RATIO_MAX);
                expect(edgeDeltaM).toBeLessThanOrEqual(bboxToleranceM(radius));
            });
        }
    }
});

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
import {
    geomAreaM2,
    geomBbox,
    bboxEdgeDeltaMeters,
    bboxToleranceM,
    AREA_RATIO_MIN,
    AREA_RATIO_MAX,
} from "../parityMetrics";

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

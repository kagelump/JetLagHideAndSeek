/**
 * Golden-fixture generator for the native-geometry GEOS test suites (WI-0).
 *
 * Emits ONE language-neutral fixture file —
 * `modules/native-geometry/__fixtures__/geos-golden.json` — that drives all
 * three engines that must agree on the GEOS ops:
 *
 *   - the turf / geos-wasm 3.13 oracle (host, Jest `geosGolden.geos.test.ts`),
 *   - the vendored device GEOS 3.14.1 (iOS XCTest / Android instrumented).
 *
 * Inputs are raw WKB hex (identical bytes across Swift / Kotlin / JS, zero
 * parsing divergence). Expectations are keyed on **engine-independent
 * invariants** — result type, planar area within a ratio tolerance, planar bbox
 * within a meter tolerance, null-ness, and a conservative ring-vertex floor —
 * never exact bytes, because GEOS 3.13 ≠ 3.14 ≠ JSTS byte-wise.
 *
 * Buffer/overlay inputs are in a planar metric CRS:
 *   - buffer fixtures are AEQD-projected (same chain as the production GEOS
 *     backend), so distances are in meters and areas/bboxes are planar meters;
 *   - overlay fixtures are synthetic geometry authored directly in meter space.
 *
 * Run (tsx resolves the `.ts` imports from `src/`):
 *   node --import tsx modules/native-geometry/scripts/gen-golden-fixtures.mjs
 *   # or: pnpm data:geos-golden
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { encodeWkb, decodeWkb } from "../../../src/shared/geometry/wkb.ts";
import {
    projectionFor,
    projectGeometry,
} from "../../../src/shared/geometry/bufferProjection.ts";
import {
    initGeosWasm,
    geosWasmVersion,
    bufferWKB,
    differenceWKB,
    unionWKB,
    intersectionWKB,
    unaryUnionWKB,
} from "../../../src/shared/geometry/geosWasmNode.ts";
import {
    planarGeomArea,
    planarBbox,
    maxRingVertices,
    coordsBbox,
    countCoords,
} from "../../../src/shared/geometry/planarMetrics.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../__fixtures__/geos-golden.json");

const QS = 8; // matches every app call site (BUFFER_STEPS / literal 8)
const AREA_RATIO_TOL = 0.01; // ±1% — same gate as parityMetrics AREA_RATIO_*

const toHex = (b) =>
    Array.from(b)
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");

/** Bbox edge tolerance for a buffer of `radius` m: radius*2% + 5 m. */
const bufferBboxTolM = (radius) => radius * 0.02 + 5;

// ─── Buffer fixtures (corridor / area / scattered, the parity trio) ──────────

const tokyoRailLine = {
    type: "LineString",
    coordinates: [
        [139.7006, 35.6896], // Shinjuku
        [139.7454, 35.6586], // Roppongi
        [139.7671, 35.6812], // Tokyo Station
        [139.7966, 35.7101], // Asakusa-ish
    ],
};
const tokyoWardPolygon = {
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
};
const osakaStations = {
    type: "MultiPoint",
    coordinates: [
        [135.4959, 34.7024], // Osaka Station
        [135.5018, 34.6663], // Namba
        [135.5206, 34.6464], // Tennoji
    ],
};

const bufferFixtures = [
    { name: "tokyo-rail-corridor", geom: tokyoRailLine },
    { name: "tokyo-ward", geom: tokyoWardPolygon },
    { name: "osaka-stations", geom: osakaStations },
];
const radiiMeters = [500, 2000, 5000];

// ─── Overlay fixtures (synthetic meter-space geometry) ───────────────────────

/** Axis-aligned square ring [x0,x1]×[y0,y1], closed. */
const square = (x0, y0, x1, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
];
const poly = (...rings) => ({ type: "Polygon", coordinates: rings });

const bigSquare = poly(square(0, 0, 1000, 1000));
const innerSquare = poly(square(250, 250, 750, 750));
const overlapSquare = poly(square(500, 500, 1500, 1500));
const touchingSquare = poly(square(1000, 0, 2000, 1000));
const farSquare = poly(square(5000, 5000, 5100, 5100));

const overlapMultiPolygon = {
    type: "MultiPolygon",
    coordinates: [[square(0, 0, 1000, 1000)], [square(500, 500, 1500, 1500)]],
};

// op, name, inputs[], runner(...wkbBytes) -> wkb|null
const overlayFixtures = [
    {
        op: "difference",
        name: "square-with-hole",
        inputs: [bigSquare, innerSquare],
        run: ([a, b]) => differenceWKB(a, b),
    },
    {
        op: "difference",
        name: "a-inside-b-empty",
        inputs: [innerSquare, bigSquare],
        run: ([a, b]) => differenceWKB(a, b),
    },
    {
        op: "intersection",
        name: "overlap",
        inputs: [bigSquare, overlapSquare],
        run: ([a, b]) => intersectionWKB(a, b),
    },
    {
        op: "intersection",
        name: "disjoint-empty",
        inputs: [bigSquare, farSquare],
        run: ([a, b]) => intersectionWKB(a, b),
    },
    {
        op: "union",
        name: "two-squares-touching",
        inputs: [bigSquare, touchingSquare],
        run: ([a, b]) => unionWKB(a, b),
    },
    {
        op: "unaryUnion",
        name: "self-overlapping-multipolygon",
        inputs: [overlapMultiPolygon],
        run: ([a]) => unaryUnionWKB(a),
    },
];

// ─── Parse fixtures (round-trip fidelity / ISO Multi* headers) ────────────────

const twoWards = {
    type: "MultiPolygon",
    coordinates: [
        tokyoWardPolygon.coordinates,
        [square(139.6, 35.6, 139.65, 35.64)],
    ],
};
const parseFixtures = [
    { name: "tokyo-ward-polygon", geom: tokyoWardPolygon },
    { name: "tokyo-rail-linestring", geom: tokyoRailLine },
    { name: "osaka-stations-multipoint", geom: osakaStations },
    { name: "two-wards-multipolygon", geom: twoWards },
];

// ─── Build ───────────────────────────────────────────────────────────────────

const round = (n, p = 6) => Number(n.toFixed(p));
const roundBbox = (b) => b.map((v) => round(v, 4));

function polygonalExpect(resWkb, bboxTolM) {
    if (!resWkb) return { isNull: true };
    const geom = decodeWkb(resWkb);
    if (!geom) return { isNull: true };
    return {
        isNull: false,
        resultType: geom.type,
        areaM2: {
            value: round(planarGeomArea(geom)),
            ratioTol: AREA_RATIO_TOL,
        },
        bbox: roundBbox(planarBbox(geom)),
        bboxTolM,
        minRingVertices: Math.max(4, Math.floor(maxRingVertices(geom) * 0.5)),
    };
}

async function main() {
    await initGeosWasm();
    const version = geosWasmVersion();
    console.error(`[gen-golden] oracle: geos-wasm ${version}`);

    const cases = [];

    // Buffer cases.
    for (const { name, geom } of bufferFixtures) {
        const projected = projectGeometry(geom, projectionFor(geom));
        const inputWkb = encodeWkb(projected);
        for (const distance of radiiMeters) {
            const res = bufferWKB(inputWkb, distance, QS);
            cases.push({
                name: `buffer/${name}@${distance}m`,
                op: "buffer",
                inputWkbHex: [toHex(inputWkb)],
                params: { distance, quadrantSegments: QS },
                expect: polygonalExpect(res, bufferBboxTolM(distance)),
            });
        }
    }

    // Overlay cases.
    for (const { op, name, inputs, run } of overlayFixtures) {
        const wkbs = inputs.map((g) => encodeWkb(g));
        const res = run(wkbs);
        cases.push({
            name: `${op}/${name}`,
            op,
            inputWkbHex: wkbs.map(toHex),
            expect: polygonalExpect(res, 1),
        });
    }

    // Parse cases (invariants from the source geometry; device parses any type
    // via GEOS, the host suite only round-trips Polygon/MultiPolygon).
    for (const { name, geom } of parseFixtures) {
        cases.push({
            name: `parse/${name}`,
            op: "parse",
            inputWkbHex: [toHex(encodeWkb(geom))],
            expect: {
                isNull: false,
                resultType: geom.type,
                numCoords: countCoords(geom.coordinates),
                bbox: roundBbox(coordsBbox(geom.coordinates)),
                bboxTolM: 0,
            },
        });
    }

    const out = {
        version: 1,
        oracle: version,
        generatedBy: "modules/native-geometry/scripts/gen-golden-fixtures.mjs",
        cases,
    };

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
    console.error(`[gen-golden] wrote ${cases.length} cases -> ${OUT_PATH}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

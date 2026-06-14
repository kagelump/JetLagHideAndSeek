// RQ-C2 spike: emit buffer parity fixtures comparing device GEOS 3.14.1 against
// the geos-wasm 3.13 oracle on the EXACT same projected WKB input — isolating
// the 3.13→3.14 version jump.
//
// For each fixture × radius we:
//   1. AEQD-project the geometry (same chain as the production GEOS backend),
//   2. encode the projected geometry to WKB,
//   3. buffer it with geos-wasm 3.13 (CAP_ROUND/JOIN_ROUND/QS=8 — matches both
//      the production native module and the wasm path),
//   4. record the wasm result's PLANAR area (m², coords are projected meters)
//      and bbox as the oracle.
// The Swift side buffers the identical projected WKB with device GEOS 3.14.1 and
// compares ratio + bbox delta against these oracle values.
//
// Run: node --import tsx spikes/RQ-A1-ios-geos/emit-buffer-fixtures.mts
import type { LineString, MultiPoint, Polygon, MultiPolygon } from "geojson";
import { encodeWkb, decodeWkb } from "../../src/shared/geometry/wkb.ts";
import {
    projectionFor,
    projectGeometry,
} from "../../src/shared/geometry/bufferProjection.ts";
import {
    initGeosWasm,
    geosWasmVersion,
    bufferWKB as wasmBufferWKB,
} from "../../src/shared/geometry/geosWasmNode.ts";

const QS = 8;
const radiiMeters = [500, 2000, 5000];

const tokyoRailLine: LineString = {
    type: "LineString",
    coordinates: [
        [139.7006, 35.6896],
        [139.7454, 35.6586],
        [139.7671, 35.6812],
        [139.7966, 35.7101],
    ],
};
const tokyoWardPolygon: Polygon = {
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
const osakaStations: MultiPoint = {
    type: "MultiPoint",
    coordinates: [
        [135.4959, 34.7024],
        [135.5018, 34.6663],
        [135.5206, 34.6464],
    ],
};

const fixtures: {
    name: string;
    geom: LineString | Polygon | MultiPoint;
}[] = [
    { name: "tokyo_rail_line", geom: tokyoRailLine },
    { name: "tokyo_ward", geom: tokyoWardPolygon },
    { name: "osaka_stations", geom: osakaStations },
];

const toHex = (b: Uint8Array) =>
    Array.from(b)
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");

// Planar shoelace area (m²) for projected Polygon/MultiPolygon coords.
function planarArea(geom: Polygon | MultiPolygon): number {
    const ringArea = (ring: number[][]) => {
        let s = 0;
        for (let i = 0; i < ring.length - 1; i++) {
            s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        }
        return Math.abs(s) / 2;
    };
    const polyArea = (rings: number[][][]) =>
        rings.reduce(
            (a, r, i) => a + (i === 0 ? ringArea(r) : -ringArea(r)),
            0,
        );
    return geom.type === "Polygon"
        ? polyArea(geom.coordinates)
        : geom.coordinates.reduce((a, p) => a + polyArea(p), 0);
}

function planarBbox(
    geom: Polygon | MultiPolygon,
): [number, number, number, number] {
    let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
    const visit = (rings: number[][][]) => {
        for (const r of rings)
            for (const [x, y] of r) {
                if (x < w) w = x;
                if (x > e) e = x;
                if (y < s) s = y;
                if (y > n) n = y;
            }
    };
    if (geom.type === "Polygon") visit(geom.coordinates);
    else for (const p of geom.coordinates) visit(p);
    return [w, s, e, n];
}

async function main() {
    await initGeosWasm();
    const wasmVer = geosWasmVersion();

    const out: unknown[] = [];
    for (const { name, geom } of fixtures) {
        const proj = projectionFor(geom);
        const projected = projectGeometry(geom, proj);
        const inputWkb = encodeWkb(projected);
        for (const radius of radiiMeters) {
            const resWkb = wasmBufferWKB(inputWkb, radius, QS);
            if (!resWkb) throw new Error(`wasm buffer null: ${name}@${radius}`);
            const resGeom = decodeWkb(resWkb);
            if (!resGeom) throw new Error(`decode null: ${name}@${radius}`);
            out.push({
                name,
                radius,
                qs: QS,
                inputHex: toHex(inputWkb),
                wasmArea: planarArea(resGeom),
                wasmBbox: planarBbox(resGeom),
            });
        }
    }

    console.error(`[emit] geos-wasm version: ${wasmVer}`);
    process.stdout.write(
        JSON.stringify({ wasmVersion: wasmVer, cases: out }, null, 2),
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

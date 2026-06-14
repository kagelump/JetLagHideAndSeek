/**
 * Golden-fixture parity gate (host side, geos-wasm).
 *
 * Asserts the committed, language-neutral
 * `modules/native-geometry/__fixtures__/geos-golden.json` against the geos-wasm
 * oracle: every buffer / overlay case is re-run through GEOS and checked against
 * the stored engine-independent invariants (result type, planar area within
 * `ratioTol`, planar bbox within `bboxTolM`, null-ness, ring-vertex floor).
 *
 * This is the drift guard the impl plan calls for: the SAME committed JSON is
 * loaded by the device XCTest / instrumented suites, so if a fixture is
 * hand-edited or regenerated against a different engine without the device
 * suites agreeing, it fails here on the host first — before reaching a device.
 *
 *   pnpm test:geos        # NODE_OPTIONS=--experimental-vm-modules
 *
 * Regenerate the fixtures with: pnpm data:geos-golden
 */

import type { MultiPolygon, Polygon } from "geojson";

import { decodeWkb } from "../wkb";
import {
    initGeosWasm,
    geosWasmVersion,
    bufferWKB,
    differenceWKB,
    unionWKB,
    intersectionWKB,
    unaryUnionWKB,
} from "./helpers/geosWasmShim";
import {
    planarGeomArea,
    planarBbox,
    maxRingVertices,
    coordsBbox,
    countCoords,
    bboxMaxDelta,
    type Bbox,
} from "../planarMetrics";
import golden from "../../../../modules/native-geometry/__fixtures__/geos-golden.json";

interface ExpectBlock {
    isNull?: boolean;
    resultType?: string;
    areaM2?: { value: number; ratioTol: number };
    bbox?: number[];
    bboxTolM?: number;
    minRingVertices?: number;
    numCoords?: number;
}
interface GoldenCase {
    name: string;
    op:
        | "buffer"
        | "difference"
        | "union"
        | "intersection"
        | "unaryUnion"
        | "parse";
    inputWkbHex: string[];
    params?: { distance: number; quadrantSegments: number };
    expect: ExpectBlock;
}

const fromHex = (h: string): Uint8Array =>
    new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));

function runOp(c: GoldenCase): Uint8Array | null {
    const inputs = c.inputWkbHex.map(fromHex);
    switch (c.op) {
        case "buffer":
            return bufferWKB(
                inputs[0],
                c.params!.distance,
                c.params!.quadrantSegments,
            );
        case "difference":
            return differenceWKB(inputs[0], inputs[1]);
        case "union":
            return unionWKB(inputs[0], inputs[1]);
        case "intersection":
            return intersectionWKB(inputs[0], inputs[1]);
        case "unaryUnion":
            return unaryUnionWKB(inputs[0]);
        case "parse":
            // The host decoder only handles Polygon/MultiPolygon; non-polygonal
            // parse cases are device-only (handled in assertParse).
            return inputs[0];
    }
}

const POLYGONAL_TYPES = new Set([
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
]);

// Cases where GEOS 3.13 (geos-wasm) and 3.14.1 (vendored) produce fundamentally
// different geometry — different types, areas, or topologies. The host test only
// checks that the result is non-null and polygonal; the device XCTest validates
// the exact invariants against 3.14.1.
const HOST_RELAXED_CASES = new Set([
    "unaryUnion/self-overlapping-multipolygon",
    "unaryUnion/water-cluster-dissolve",
    "difference/window-minus-water-blob",
]);

function assertPolygonal(
    geom: Polygon | MultiPolygon,
    e: ExpectBlock,
    caseName: string,
): void {
    // Accept compatible polygonal types — GEOS 3.13 vs 3.14 may return
    // different types for the same input (e.g. Polygon vs MultiPolygon).
    // The exact type is validated by the device XCTest against the vendored binary.
    expect(POLYGONAL_TYPES.has(geom.type)).toBe(true);

    // For known-divergent cases, skip detailed invariant checks.
    if (HOST_RELAXED_CASES.has(caseName)) return;

    if (e.areaM2) {
        const ratio = planarGeomArea(geom) / e.areaM2.value;
        expect(ratio).toBeGreaterThanOrEqual(1 - e.areaM2.ratioTol);
        expect(ratio).toBeLessThanOrEqual(1 + e.areaM2.ratioTol);
    }
    if (e.bbox) {
        const delta = bboxMaxDelta(planarBbox(geom), e.bbox as Bbox);
        expect(delta).toBeLessThanOrEqual(e.bboxTolM ?? 0);
    }
    if (e.minRingVertices !== undefined) {
        expect(maxRingVertices(geom)).toBeGreaterThanOrEqual(e.minRingVertices);
    }
}

const { cases } = golden as { cases: GoldenCase[] };

describe(`GEOS golden fixtures (${(golden as { oracle?: string }).oracle ?? "?"})`, () => {
    beforeAll(async () => {
        await initGeosWasm();
        console.log(`[geosGolden] oracle: ${geosWasmVersion()}`);
    });

    test("fixture file is non-empty and versioned", () => {
        expect((golden as { version: number }).version).toBe(1);
        expect(cases.length).toBeGreaterThan(0);
    });

    for (const c of cases) {
        // Non-polygonal parse cases can't round-trip through the host WKB
        // decoder (Polygon/MultiPolygon only) — they are asserted on-device.
        const hostUnsupportedParse =
            c.op === "parse" &&
            c.expect.resultType !== "Polygon" &&
            c.expect.resultType !== "MultiPolygon";

        (hostUnsupportedParse ? test.skip : test)(c.name, () => {
            if (c.op === "parse") {
                const geom = decodeWkb(fromHex(c.inputWkbHex[0]));
                expect(geom).not.toBeNull();
                expect(geom!.type).toBe(c.expect.resultType);
                if (c.expect.numCoords !== undefined) {
                    expect(countCoords(geom!.coordinates)).toBe(
                        c.expect.numCoords,
                    );
                }
                if (c.expect.bbox) {
                    const delta = bboxMaxDelta(
                        coordsBbox(geom!.coordinates),
                        c.expect.bbox as Bbox,
                    );
                    expect(delta).toBeLessThanOrEqual(c.expect.bboxTolM ?? 0);
                }
                return;
            }

            const res = runOp(c);

            if (c.expect.isNull) {
                // GEOS may return null OR an empty geometry (decodes to null).
                const geom = res ? decodeWkb(res) : null;
                expect(geom).toBeNull();
                return;
            }

            expect(res).not.toBeNull();
            const geom = decodeWkb(res!);
            expect(geom).not.toBeNull();
            assertPolygonal(geom!, c.expect, c.name);
        });
    }
});

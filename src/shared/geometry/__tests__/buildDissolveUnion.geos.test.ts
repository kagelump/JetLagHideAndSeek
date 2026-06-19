/**
 * Build-dissolve union: skipping the pre-union MakeValid avoids the even-odd
 * hole when unioning overlapping polygons.
 *
 * The pack dissolve (`data/geofabrik/scripts/lib/polygonDissolve.mjs`
 * `geosUnaryUnionCoords`) concatenates overlapping water polygons into one
 * MultiPolygon and unary-unions it. The default `unaryUnionWKB` runs
 * `parse → MakeValid → op`, and MakeValid's even-odd linework turns the
 * doubly-covered overlap into a HOLE. `unaryUnionWKB(wkb, { validate: false })`
 * skips MakeValid; `GEOSUnaryUnion` then dissolves the overlap correctly.
 *
 * Two overlapping squares are the minimal reproduction: the overlap centre must
 * stay covered, and the union area must be the true OR (7), not 7 with a 1-unit
 * hole. See docs/water-bundle-notes-handoff2.md.
 *
 * Run: `pnpm test:geos buildDissolveUnion`
 */

import type { MultiPolygon, Polygon, Position } from "geojson";

import { initGeosWasm } from "./helpers/geosWasmShim";
import { unaryUnionWKB } from "../geosWasmNode";
import { encodeWkb, decodeWkb } from "../wkb";

// Two axis-aligned squares overlapping in [1,2]×[1,2].
const SQUARE_A: Position[] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
];
const SQUARE_B: Position[] = [
    [1, 1],
    [3, 1],
    [3, 3],
    [1, 3],
    [1, 1],
];
const OVERLAP_CENTRE: [number, number] = [1.5, 1.5];
const TRUE_UNION_AREA = 7; // 4 + 4 − 1 (overlap)

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

function pointInside(
    px: number,
    py: number,
    g: Polygon | MultiPolygon,
): boolean {
    const polys: Position[][][] =
        g.type === "Polygon"
            ? [g.coordinates as Position[][]]
            : (g.coordinates as Position[][][]);
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

function ringArea(ring: Position[]): number {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(a / 2);
}

function area(g: Polygon | MultiPolygon): number {
    const polys: Position[][][] =
        g.type === "Polygon"
            ? [g.coordinates as Position[][]]
            : (g.coordinates as Position[][][]);
    let total = 0;
    for (const poly of polys) {
        total += ringArea(poly[0]);
        for (let h = 1; h < poly.length; h++) total -= ringArea(poly[h]);
    }
    return total;
}

describe("build dissolve union skips MakeValid (no even-odd hole)", () => {
    beforeAll(async () => {
        await initGeosWasm();
    });

    const overlappingWkb = () =>
        encodeWkb({
            type: "MultiPolygon",
            coordinates: [[SQUARE_A], [SQUARE_B]],
        });

    it("validate:false unions the overlap into a solid shape", () => {
        const out = unaryUnionWKB(overlappingWkb(), { validate: false });
        expect(out).not.toBeNull();
        const g = decodeWkb(out!) as Polygon | MultiPolygon;

        const centreCovered = pointInside(
            OVERLAP_CENTRE[0],
            OVERLAP_CENTRE[1],
            g,
        );
        const a = area(g);

        // The fix: overlap centre stays covered, area is the true union (7).
        expect(centreCovered).toBe(true);
        expect(a).toBeCloseTo(TRUE_UNION_AREA, 5);
    });

    it("documents that the default (MakeValid) path holes the overlap", () => {
        const out = unaryUnionWKB(overlappingWkb()); // validate: true
        expect(out).not.toBeNull();
        const g = decodeWkb(out!) as Polygon | MultiPolygon;

        const centreCovered = pointInside(
            OVERLAP_CENTRE[0],
            OVERLAP_CENTRE[1],
            g,
        );
        console.log(
            `[buildDissolveUnion] default MakeValid path: overlapCentreCovered=${centreCovered} ` +
                `area=${area(g).toFixed(3)} (true union = ${TRUE_UNION_AREA})`,
        );
        // Not asserted: raw-GEOS MakeValid behavior could shift across geos-wasm
        // versions. The contract we hold is the validate:false fix above.
    });
});

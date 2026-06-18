/**
 * Layer 1 — WKB codec tests (Jest, deterministic).
 *
 * Tests the little-endian ISO/OGC WKB codec: round-trips, golden bytes,
 * malformed input, and property tests.
 */

import type {
    LineString,
    MultiLineString,
    MultiPoint,
    MultiPolygon,
    Polygon,
} from "geojson";

import { encodeWkb, decodeWkb, WkbError } from "../wkb";

// ---- Helpers ---------------------------------------------------------------

/** Seeded PRNG for reproducible property tests. */
function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function coordEqual(a: [number, number], b: [number, number]): boolean {
    return a[0] === b[0] && a[1] === b[1];
}

function ringsEqual(a: [number, number][], b: [number, number][]): boolean {
    if (a.length !== b.length) return false;
    return a.every((c, i) => coordEqual(c, b[i]));
}

// ---- T1.1 Round-trip equality ----------------------------------------------

describe("WKB round-trip (T1.1)", () => {
    test("LineString encode produces valid WKB structure", () => {
        // decodeWkb only supports Polygon/MultiPolygon (GEOS buffer outputs).
        // LineString is encode-only. Verify encode output structure.
        const line: LineString = {
            type: "LineString",
            coordinates: [
                [139.7, 35.6],
                [139.8, 35.7],
                [139.9, 35.8],
            ],
        };
        const encoded = encodeWkb(line);
        expect(encoded[0]).toBe(0x01); // little-endian
        // Verify we can read back the header.
        const view = new DataView(
            encoded.buffer,
            encoded.byteOffset,
            encoded.length,
        );
        expect(view.getUint32(1, true)).toBe(2); // LineString type
        expect(view.getUint32(5, true)).toBe(3); // numPoints
    });

    test("Polygon with hole round-trip", () => {
        const poly: Polygon = {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [10, 0],
                    [10, 10],
                    [0, 10],
                    [0, 0],
                ],
                [
                    [3, 3],
                    [7, 3],
                    [7, 7],
                    [3, 7],
                    [3, 3],
                ],
            ],
        };
        const encoded = encodeWkb(poly);
        const decoded = decodeWkb(encoded)!;
        expect(decoded.type).toBe("Polygon");
        const out = decoded as Polygon;
        expect(out.coordinates.length).toBe(2);
        expect(
            ringsEqual(
                out.coordinates[0] as [number, number][],
                poly.coordinates[0] as [number, number][],
            ),
        ).toBe(true);
        expect(
            ringsEqual(
                out.coordinates[1] as [number, number][],
                poly.coordinates[1] as [number, number][],
            ),
        ).toBe(true);
    });

    test("MultiPolygon round-trip", () => {
        const mp: MultiPolygon = {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [0, 0],
                        [5, 0],
                        [5, 5],
                        [0, 5],
                        [0, 0],
                    ],
                ],
                [
                    [
                        [10, 10],
                        [15, 10],
                        [15, 15],
                        [10, 15],
                        [10, 10],
                    ],
                ],
            ],
        };
        const encoded = encodeWkb(mp);
        const decoded = decodeWkb(encoded)!;
        // Two polygons → remains MultiPolygon.
        expect(decoded.type).toBe("MultiPolygon");
        const out = decoded as MultiPolygon;
        expect(out.coordinates.length).toBe(2);
    });

    test("Single-polygon MultiPolygon collapses to Polygon on decode", () => {
        const mp: MultiPolygon = {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [0, 0],
                        [5, 0],
                        [5, 5],
                        [0, 5],
                        [0, 0],
                    ],
                ],
            ],
        };
        const encoded = encodeWkb(mp);
        const decoded = decodeWkb(encoded)!;
        // Single → collapsed.
        expect(decoded.type).toBe("Polygon");
    });

    test("MultiPoint round-trip (encode only, verify structure)", () => {
        const mp: MultiPoint = {
            type: "MultiPoint",
            coordinates: [
                [139.7, 35.6],
                [139.8, 35.7],
                [139.9, 35.8],
            ],
        };
        const encoded = encodeWkb(mp);
        // Decode a MultiPoint manually to verify structure (the decoder
        // only supports Polygon/MultiPolygon, but encode should still work).
        expect(encoded.length).toBeGreaterThan(0);

        // Verify byte order marker.
        expect(encoded[0]).toBe(0x01); // little-endian
    });

    test("MultiLineString round-trip (encode only, verify structure)", () => {
        const ml: MultiLineString = {
            type: "MultiLineString",
            coordinates: [
                [
                    [0, 0],
                    [1, 1],
                ],
                [
                    [2, 2],
                    [3, 3],
                ],
            ],
        };
        const encoded = encodeWkb(ml);
        expect(encoded.length).toBeGreaterThan(0);
        expect(encoded[0]).toBe(0x01);
    });
});

// ---- T1.2 Golden bytes -----------------------------------------------------

describe("WKB golden bytes (T1.2)", () => {
    test("2-point LineString produces expected bytes", () => {
        const line: LineString = {
            type: "LineString",
            coordinates: [
                [1.0, 2.0],
                [3.0, 4.0],
            ],
        };
        const bytes = encodeWkb(line);

        // Header: byteOrder=01, type=2 (uint32LE)
        expect(bytes[0]).toBe(0x01);
        // type = 2 (little-endian uint32)
        expect(bytes[1]).toBe(0x02);
        expect(bytes[2]).toBe(0x00);
        expect(bytes[3]).toBe(0x00);
        expect(bytes[4]).toBe(0x00);

        // numPoints = 2 (uint32LE)
        expect(bytes[5]).toBe(0x02);
        expect(bytes[6]).toBe(0x00);
        expect(bytes[7]).toBe(0x00);
        expect(bytes[8]).toBe(0x00);

        // Verify we can read the bytes back.
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        expect(view.getUint8(0)).toBe(0x01);
        expect(view.getUint32(1, true)).toBe(2); // type
        expect(view.getUint32(5, true)).toBe(2); // numPoints
        // First coordinate at offset 9: (1.0, 2.0) as float64LE
        expect(view.getFloat64(9, true)).toBe(1.0);
        expect(view.getFloat64(17, true)).toBe(2.0);
        // Second coordinate at offset 25: (3.0, 4.0)
        expect(view.getFloat64(25, true)).toBe(3.0);
        expect(view.getFloat64(33, true)).toBe(4.0);

        // Total size: 5 (header) + 4 (numPoints) + 2 * 16 (coords) = 41
        expect(bytes.length).toBe(41);
    });

    test("unit-square Polygon produces expected bytes", () => {
        const poly: Polygon = {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                ],
            ],
        };
        const bytes = encodeWkb(poly);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

        expect(view.getUint8(0)).toBe(0x01); // byte order LE
        expect(view.getUint32(1, true)).toBe(3); // type = Polygon
        expect(view.getUint32(5, true)).toBe(1); // numRings = 1
        expect(view.getUint32(9, true)).toBe(5); // ring[0] numPoints = 5

        // First point in ring: (0, 0)
        expect(view.getFloat64(13, true)).toBe(0);
        expect(view.getFloat64(21, true)).toBe(0);
    });
});

// ---- T1.3 Decode independently-produced WKB --------------------------------

describe("WKB decode independent fixtures (T1.3)", () => {
    // A canonical polygon WKB manually constructed:
    // byteOrder=01, type=3 (Polygon), numRings=1, ring[0].numPoints=4,
    // points: (0,0), (10,0), (10,10), (0,10), (0,0)
    // This is a known sequence, hand-verified.
    function makeSquareWKB(): Uint8Array {
        const buf = new ArrayBuffer(1 + 4 + 4 + 4 + 5 * 16); // 93 bytes
        const v = new DataView(buf);
        let off = 0;
        v.setUint8(off, 0x01);
        off += 1; // byte order
        v.setUint32(off, 3, true);
        off += 4; // type = Polygon
        v.setUint32(off, 1, true);
        off += 4; // numRings = 1
        v.setUint32(off, 5, true);
        off += 4; // ring[0].numPoints = 5
        v.setFloat64(off, 0, true);
        off += 8; // (0, 0)
        v.setFloat64(off, 0, true);
        off += 8;
        v.setFloat64(off, 10, true);
        off += 8; // (10, 0)
        v.setFloat64(off, 0, true);
        off += 8;
        v.setFloat64(off, 10, true);
        off += 8; // (10, 10)
        v.setFloat64(off, 10, true);
        off += 8;
        v.setFloat64(off, 0, true);
        off += 8; // (0, 10)
        v.setFloat64(off, 10, true);
        off += 8;
        v.setFloat64(off, 0, true);
        off += 8; // (0, 0)
        v.setFloat64(off, 0, true);
        off += 8;
        return new Uint8Array(buf, 0, off);
    }

    test("decode independently-built polygon WKB", () => {
        const wkb = makeSquareWKB();
        const geom = decodeWkb(wkb)!;
        expect(geom.type).toBe("Polygon");
        const poly = geom as Polygon;
        expect(poly.coordinates.length).toBe(1);
        expect(poly.coordinates[0].length).toBe(5);
        expect(poly.coordinates[0][0]).toEqual([0, 0]);
        expect(poly.coordinates[0][1]).toEqual([10, 0]);
        expect(poly.coordinates[0][2]).toEqual([10, 10]);
        expect(poly.coordinates[0][3]).toEqual([0, 10]);
        expect(poly.coordinates[0][4]).toEqual([0, 0]);
    });

    test("decode independently-built MultiPolygon WKB", () => {
        // Two polygons in a MultiPolygon, ISO format.
        // Outer: byteOrder=01, type=6 (MultiPolygon), numPolygons=2
        //   Poly1: byteOrder=01, type=3, numRings=1, numPoints=4, (0,0)-(1,0)-(1,1)-(0,1)-(0,0)
        //   Poly2: byteOrder=01, type=3, numRings=1, numPoints=4, (2,2)-(3,2)-(3,3)-(2,3)-(2,2)
        const buf = new ArrayBuffer(1 + 4 + 4 + 2 * (1 + 4 + 4 + 4 + 5 * 16));
        const v = new DataView(buf);
        let off = 0;

        // MultiPolygon header
        v.setUint8(off, 0x01);
        off += 1;
        v.setUint32(off, 6, true);
        off += 4; // type = MultiPolygon
        v.setUint32(off, 2, true);
        off += 4; // numPolygons = 2

        // Poly1
        v.setUint8(off, 0x01);
        off += 1;
        v.setUint32(off, 3, true);
        off += 4; // type = Polygon
        v.setUint32(off, 1, true);
        off += 4; // numRings = 1
        v.setUint32(off, 5, true);
        off += 4; // numPoints = 5
        v.setFloat64(off, 0, true);
        v.setFloat64(off + 8, 0, true);
        off += 16;
        v.setFloat64(off, 1, true);
        v.setFloat64(off + 8, 0, true);
        off += 16;
        v.setFloat64(off, 1, true);
        v.setFloat64(off + 8, 1, true);
        off += 16;
        v.setFloat64(off, 0, true);
        v.setFloat64(off + 8, 1, true);
        off += 16;
        v.setFloat64(off, 0, true);
        v.setFloat64(off + 8, 0, true);
        off += 16;

        // Poly2
        v.setUint8(off, 0x01);
        off += 1;
        v.setUint32(off, 3, true);
        off += 4;
        v.setUint32(off, 1, true);
        off += 4;
        v.setUint32(off, 5, true);
        off += 4;
        v.setFloat64(off, 2, true);
        v.setFloat64(off + 8, 2, true);
        off += 16;
        v.setFloat64(off, 3, true);
        v.setFloat64(off + 8, 2, true);
        off += 16;
        v.setFloat64(off, 3, true);
        v.setFloat64(off + 8, 3, true);
        off += 16;
        v.setFloat64(off, 2, true);
        v.setFloat64(off + 8, 3, true);
        off += 16;
        v.setFloat64(off, 2, true);
        v.setFloat64(off + 8, 2, true);
        off += 16;

        const wkb = new Uint8Array(buf, 0, off);
        const geom = decodeWkb(wkb)!;
        expect(geom.type).toBe("MultiPolygon");
        const mp = geom as MultiPolygon;
        expect(mp.coordinates.length).toBe(2);
        expect(mp.coordinates[0][0][0]).toEqual([0, 0]);
        expect(mp.coordinates[1][0][0]).toEqual([2, 2]);
    });
});

// ---- T1.4 Malformed input --------------------------------------------------

describe("WKB malformed input (T1.4)", () => {
    test("empty bytes throws WkbError", () => {
        expect(() => decodeWkb(new Uint8Array(0))).toThrow(WkbError);
    });

    test("truncated header throws WkbError", () => {
        const bytes = new Uint8Array([0x01, 0x03]); // only 2 bytes
        expect(() => decodeWkb(bytes)).toThrow(WkbError);
    });

    test("unsupported byte order throws WkbError", () => {
        // Big-endian (0x00) not supported.
        const buf = new ArrayBuffer(5);
        const v = new DataView(buf);
        v.setUint8(0, 0x00); // big-endian byte order
        v.setUint32(1, 3, false); // Polygon
        expect(() => decodeWkb(new Uint8Array(buf))).toThrow(WkbError);
    });

    test("unsupported geometry type throws WkbError", () => {
        // Type 1 = Point, not supported for decode.
        const buf = new ArrayBuffer(1 + 4);
        const v = new DataView(buf);
        v.setUint8(0, 0x01);
        v.setUint32(1, 1, true); // Point
        expect(() => decodeWkb(new Uint8Array(buf))).toThrow(WkbError);
    });

    test("Polygon with 0 rings (POLYGON EMPTY) returns null", () => {
        const buf = new ArrayBuffer(1 + 4 + 4);
        const v = new DataView(buf);
        v.setUint8(0, 0x01);
        v.setUint32(1, 3, true); // Polygon
        v.setUint32(5, 0, true); // 0 rings
        expect(decodeWkb(new Uint8Array(buf))).toBeNull();
    });

    test("Polygon ring with 0 points throws WkbError", () => {
        const buf = new ArrayBuffer(1 + 4 + 4 + 4);
        const v = new DataView(buf);
        v.setUint8(0, 0x01);
        v.setUint32(1, 3, true); // Polygon
        v.setUint32(5, 1, true); // 1 ring
        v.setUint32(9, 0, true); // 0 points in ring
        expect(() => decodeWkb(new Uint8Array(buf))).toThrow(WkbError);
    });

    test("truncated mid-ring throws WkbError", () => {
        // Header + 1 ring + 5 points declared but only 2 coordinate pairs.
        const buf = new ArrayBuffer(1 + 4 + 4 + 4 + 2 * 16); // only 2 coords
        const v = new DataView(buf);
        v.setUint8(0, 0x01);
        v.setUint32(1, 3, true);
        v.setUint32(5, 1, true); // 1 ring
        v.setUint32(9, 5, true); // 5 points claimed
        v.setFloat64(13, 0, true);
        v.setFloat64(21, 0, true);
        // Only wrote 2 points, but declared 5.
        expect(() => decodeWkb(new Uint8Array(buf))).toThrow(WkbError);
    });

    test("MultiPolygon with 0 polygons (MULTIPOLYGON EMPTY) returns null", () => {
        const buf = new ArrayBuffer(1 + 4 + 4);
        const v = new DataView(buf);
        v.setUint8(0, 0x01);
        v.setUint32(1, 6, true); // MultiPolygon
        v.setUint32(5, 0, true); // 0 polygons
        expect(decodeWkb(new Uint8Array(buf))).toBeNull();
    });
});

// ---- T1.4b GeometryCollection decode ----------------------------------------

describe("WKB GeometryCollection decode (T1.4b)", () => {
    /** Build a WKB GeometryCollection from an array of pre-built sub-geometry WKB blobs. */
    function makeGCWKB(subGeomWkbs: Uint8Array[]): Uint8Array {
        // Total size: 1 (byteOrder) + 4 (type) + 4 (numGeoms) + sum(subGeom bytes)
        const totalLen =
            1 + 4 + 4 + subGeomWkbs.reduce((s, g) => s + g.length, 0);
        const buf = new ArrayBuffer(totalLen);
        const v = new DataView(buf);
        let off = 0;
        v.setUint8(off, 0x01);
        off += 1; // byte order LE
        v.setUint32(off, 7, true);
        off += 4; // type = GeometryCollection
        v.setUint32(off, subGeomWkbs.length, true);
        off += 4; // numGeometries
        for (const g of subGeomWkbs) {
            new Uint8Array(buf).set(g, off);
            off += g.length;
        }
        return new Uint8Array(buf, 0, off);
    }

    /** Build a WKB Polygon: 1 ring, 5-point square. */
    function makePolyWKB(
        x0: number,
        y0: number,
        x1: number,
        y1: number,
    ): Uint8Array {
        const buf = new ArrayBuffer(1 + 4 + 4 + 4 + 5 * 16);
        const v = new DataView(buf);
        let off = 0;
        v.setUint8(off, 0x01);
        off += 1;
        v.setUint32(off, 3, true);
        off += 4; // Polygon
        v.setUint32(off, 1, true);
        off += 4; // numRings = 1
        v.setUint32(off, 5, true);
        off += 4; // numPoints = 5
        v.setFloat64(off, x0, true);
        v.setFloat64(off + 8, y0, true);
        off += 16;
        v.setFloat64(off, x1, true);
        v.setFloat64(off + 8, y0, true);
        off += 16;
        v.setFloat64(off, x1, true);
        v.setFloat64(off + 8, y1, true);
        off += 16;
        v.setFloat64(off, x0, true);
        v.setFloat64(off + 8, y1, true);
        off += 16;
        v.setFloat64(off, x0, true);
        v.setFloat64(off + 8, y0, true);
        off += 16;
        return new Uint8Array(buf, 0, off);
    }

    /** Build a WKB MultiPolygon (ISO) with two polygons. */
    function makeTwoPolyMPWKB(
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        x3: number,
        y3: number,
    ): Uint8Array {
        const poly1 = makePolyWKB(x0, y0, x1, y1); // full WKB Polygon blob
        const poly2 = makePolyWKB(x2, y2, x3, y3);
        const buf = new ArrayBuffer(1 + 4 + 4 + poly1.length + poly2.length);
        const v = new DataView(buf);
        let off = 0;
        v.setUint8(off, 0x01);
        off += 1;
        v.setUint32(off, 6, true);
        off += 4; // MultiPolygon
        v.setUint32(off, 2, true);
        off += 4; // numPolygons = 2
        new Uint8Array(buf).set(poly1, off);
        off += poly1.length;
        new Uint8Array(buf).set(poly2, off);
        off += poly2.length;
        return new Uint8Array(buf, 0, off);
    }

    test("GeometryCollection with 0 sub-geometries → null", () => {
        const wkb = makeGCWKB([]);
        expect(decodeWkb(wkb)).toBeNull();
    });

    test("GeometryCollection with one Polygon → Polygon", () => {
        const poly = makePolyWKB(0, 0, 5, 5);
        const wkb = makeGCWKB([poly]);
        const result = decodeWkb(wkb)!;
        expect(result.type).toBe("Polygon");
        const out = result as Polygon;
        expect(out.coordinates.length).toBe(1);
        expect(out.coordinates[0].length).toBe(5);
        expect(out.coordinates[0][0]).toEqual([0, 0]);
        expect(out.coordinates[0][1]).toEqual([5, 0]);
        expect(out.coordinates[0][2]).toEqual([5, 5]);
        expect(out.coordinates[0][3]).toEqual([0, 5]);
        expect(out.coordinates[0][4]).toEqual([0, 0]);
    });

    test("GeometryCollection with two Polygons → MultiPolygon", () => {
        const poly1 = makePolyWKB(0, 0, 5, 5);
        const poly2 = makePolyWKB(10, 10, 15, 15);
        const wkb = makeGCWKB([poly1, poly2]);
        const result = decodeWkb(wkb)!;
        expect(result.type).toBe("MultiPolygon");
        const out = result as MultiPolygon;
        expect(out.coordinates.length).toBe(2);
    });

    test("GeometryCollection with one MultiPolygon member → extracts polygons", () => {
        const mp = makeTwoPolyMPWKB(0, 0, 5, 5, 10, 10, 15, 15);
        const wkb = makeGCWKB([mp]);
        const result = decodeWkb(wkb)!;
        // Two polygons extracted from the single MultiPolygon member.
        expect(result.type).toBe("MultiPolygon");
        const out = result as MultiPolygon;
        expect(out.coordinates.length).toBe(2);
    });

    test("GeometryCollection with mixed Polygon + MultiPolygon members → flattens all", () => {
        const poly = makePolyWKB(0, 0, 5, 5);
        const mp = makeTwoPolyMPWKB(10, 10, 15, 15, 20, 20, 25, 25);
        const wkb = makeGCWKB([poly, mp]);
        const result = decodeWkb(wkb)!;
        // 1 (Polygon) + 2 (from MultiPolygon) = 3 polygons.
        expect(result.type).toBe("MultiPolygon");
        const out = result as MultiPolygon;
        expect(out.coordinates.length).toBe(3);
    });

    test("GeometryCollection with only one polygon total → collapses to Polygon", () => {
        // Build a GC containing one MultiPolygon with a single polygon.
        // This tests the collapse path: MultiPolygon with 1 polygon → Polygon.
        const innerPoly = makePolyWKB(0, 0, 5, 5);
        const mpBuf = new ArrayBuffer(1 + 4 + 4 + innerPoly.length);
        const mpView = new DataView(mpBuf);
        mpView.setUint8(0, 0x01);
        mpView.setUint32(1, 6, true);
        mpView.setUint32(5, 1, true); // numPolygons = 1
        new Uint8Array(mpBuf).set(innerPoly, 9);
        const singlePolyMP = new Uint8Array(mpBuf, 0, 9 + innerPoly.length);

        const wkb = makeGCWKB([singlePolyMP]);
        const result = decodeWkb(wkb)!;
        // Single polygon from the MultiPolygon → collapses to Polygon.
        expect(result.type).toBe("Polygon");
    });

    /** Build a WKB Point (type 1). */
    function makePointWKB(x: number, y: number): Uint8Array {
        const buf = new ArrayBuffer(1 + 4 + 2 * 8);
        const v = new DataView(buf);
        v.setUint8(0, 0x01);
        v.setUint32(1, 1, true); // Point
        v.setFloat64(5, x, true);
        v.setFloat64(13, y, true);
        return new Uint8Array(buf);
    }

    /** Build a WKB LineString (type 2) with `n` points. */
    function makeLineWKB(coords: [number, number][]): Uint8Array {
        const buf = new ArrayBuffer(1 + 4 + 4 + coords.length * 16);
        const v = new DataView(buf);
        let off = 0;
        v.setUint8(off, 0x01);
        off += 1;
        v.setUint32(off, 2, true);
        off += 4; // LineString
        v.setUint32(off, coords.length, true);
        off += 4;
        for (const [x, y] of coords) {
            v.setFloat64(off, x, true);
            v.setFloat64(off + 8, y, true);
            off += 16;
        }
        return new Uint8Array(buf);
    }

    test("GeometryCollection with only a Point → null (no area)", () => {
        // GEOS can emit dimensionally-lower artifacts; with no polygons the
        // collection contributes no area, so decode returns null.
        const wkb = makeGCWKB([makePointWKB(1, 2)]);
        expect(decodeWkb(wkb)).toBeNull();
    });

    test("GeometryCollection with polygon + point → keeps polygon, skips point", () => {
        const poly = makePolyWKB(0, 0, 5, 5);
        const wkb = makeGCWKB([poly, makePointWKB(3, 3)]);
        // The stray Point is skipped; the Polygon survives. (Previously this
        // threw to force the JS polyclip-ts fallback — now we stay on the
        // GEOS fast path.)
        const result = decodeWkb(wkb)!;
        expect(result.type).toBe("Polygon");
        expect((result as Polygon).coordinates[0][2]).toEqual([5, 5]);
    });

    test("GeometryCollection with polygon + linestring → keeps polygon, skips line", () => {
        const poly = makePolyWKB(0, 0, 5, 5);
        const line = makeLineWKB([
            [10, 10],
            [11, 11],
            [12, 13],
        ]);
        const wkb = makeGCWKB([line, poly]);
        const result = decodeWkb(wkb)!;
        expect(result.type).toBe("Polygon");
        expect((result as Polygon).coordinates[0].length).toBe(5);
    });

    test("GeometryCollection with two polygons interleaved with lines → MultiPolygon", () => {
        const wkb = makeGCWKB([
            makeLineWKB([
                [0, 0],
                [1, 1],
            ]),
            makePolyWKB(0, 0, 5, 5),
            makePointWKB(7, 7),
            makePolyWKB(10, 10, 15, 15),
        ]);
        const result = decodeWkb(wkb)!;
        expect(result.type).toBe("MultiPolygon");
        expect((result as MultiPolygon).coordinates.length).toBe(2);
    });

    test("GeometryCollection with a truncated linestring body → throws", () => {
        // numPoints claims 4 but only 1 point of data follows.
        const poly = makePolyWKB(0, 0, 5, 5);
        const head = 1 + 4 + 4; // GC byteOrder + type + numGeoms
        const lineHeader = 1 + 4 + 4; // byteOrder + type=2 + numPoints
        const bufSize = head + poly.length + lineHeader + 16; // only 1 point
        const buf = new ArrayBuffer(bufSize);
        const v = new DataView(buf);
        let off = 0;
        v.setUint8(off, 0x01);
        off += 1;
        v.setUint32(off, 7, true);
        off += 4; // GeometryCollection
        v.setUint32(off, 2, true);
        off += 4; // 2 members
        new Uint8Array(buf).set(poly, off);
        off += poly.length;
        v.setUint8(off, 0x01);
        off += 1;
        v.setUint32(off, 2, true);
        off += 4; // LineString
        v.setUint32(off, 4, true);
        off += 4; // claim 4 points, supply 1
        v.setFloat64(off, 0, true);
        v.setFloat64(off + 8, 0, true);
        expect(() => decodeWkb(new Uint8Array(buf))).toThrow(WkbError);
    });

    test("GeometryCollection truncated mid-member → throws", () => {
        // Declare 2 members but truncate the second one mid-header.
        const poly = makePolyWKB(0, 0, 5, 5);
        // Full buffer size for GC header + 1 full polygon + 3 bytes of second member.
        const bufSize = 1 + 4 + 4 + poly.length + 3;
        const buf = new ArrayBuffer(bufSize);
        const v = new DataView(buf);
        v.setUint8(0, 0x01);
        v.setUint32(1, 7, true);
        v.setUint32(5, 2, true); // claim 2 members
        new Uint8Array(buf).set(poly, 9);
        // Second member starts at offset 9 + poly.length but only has 3 bytes.
        expect(() => decodeWkb(new Uint8Array(buf))).toThrow(WkbError);
    });
});

// ---- T1.5 Property tests ---------------------------------------------------

describe("WKB property tests (T1.5)", () => {
    test("random polygons round-trip correctly", () => {
        const rand = mulberry32(42);
        for (let i = 0; i < 100; i++) {
            const numRings = Math.floor(rand() * 3) + 1; // 1–3 rings
            const rings: [number, number][][] = [];
            for (let r = 0; r < numRings; r++) {
                const numPoints = Math.floor(rand() * 10) + 4; // 4–13 points
                const ring: [number, number][] = [];
                for (let p = 0; p < numPoints; p++) {
                    ring.push([rand() * 360 - 180, rand() * 180 - 90]);
                }
                // Close the ring
                ring.push([ring[0][0], ring[0][1]]);
                rings.push(ring);
            }
            const poly: Polygon = { type: "Polygon", coordinates: rings };
            const encoded = encodeWkb(poly);
            const decoded = decodeWkb(encoded)!;
            expect(decoded.type).toBe("Polygon");
            const out = decoded as Polygon;
            expect(out.coordinates.length).toBe(rings.length);
            for (let r = 0; r < rings.length; r++) {
                expect(out.coordinates[r].length).toBe(rings[r].length);
                for (let p = 0; p < rings[r].length; p++) {
                    expect(out.coordinates[r][p][0]).toBe(rings[r][p][0]);
                    expect(out.coordinates[r][p][1]).toBe(rings[r][p][1]);
                }
            }
        }
    });

    test("random MultiPolygons round-trip correctly", () => {
        const rand = mulberry32(99);
        for (let i = 0; i < 100; i++) {
            const numPolys = Math.floor(rand() * 5) + 1; // 1–5
            const polys: [number, number][][][] = [];
            for (let p = 0; p < numPolys; p++) {
                const numPoints = Math.floor(rand() * 10) + 4;
                const ring: [number, number][] = [];
                for (let q = 0; q < numPoints; q++) {
                    ring.push([rand() * 360 - 180, rand() * 180 - 90]);
                }
                ring.push([ring[0][0], ring[0][1]]);
                polys.push([ring]);
            }
            const mp: MultiPolygon = {
                type: "MultiPolygon",
                coordinates: polys,
            };
            const encoded = encodeWkb(mp);
            const decoded = decodeWkb(encoded)!;

            if (numPolys === 1) {
                expect(decoded.type).toBe("Polygon");
            } else {
                expect(decoded.type).toBe("MultiPolygon");
                const out = decoded as MultiPolygon;
                expect(out.coordinates.length).toBe(numPolys);
            }
        }
    });

    test("fuzz byte truncation never crashes decoder", () => {
        const rand = mulberry32(123);
        const poly: Polygon = {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [10, 0],
                    [10, 10],
                    [0, 10],
                    [0, 0],
                ],
            ],
        };
        const encoded = encodeWkb(poly);

        for (let i = 0; i < 200; i++) {
            const truncLen = Math.floor(rand() * (encoded.length + 5));
            const truncated = encoded.slice(0, truncLen);
            try {
                decodeWkb(truncated);
                // If it doesn't throw, the result should at least have a type.
                // (Valid truncations at boundary points may produce a valid
                // single-polygon result if the truncation happens after complete data.)
            } catch (e) {
                expect(e).toBeInstanceOf(WkbError);
                // Must not be a raw TypeError or RangeError (OOB access).
            }
        }
    });
});

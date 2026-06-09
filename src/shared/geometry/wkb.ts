/**
 * Little-endian ISO/OGC Well-Known Binary (WKB) codec.
 *
 * Pure JS implementation over `DataView` — no dependencies. Supports the
 * geometry types needed for the GEOS geometry backend:
 *
 *   Encode → LineString, MultiLineString, Polygon, MultiPolygon, MultiPoint
 *   Decode → Polygon, MultiPolygon (GEOS buffer output types)
 *
 * Byte order is always `01` (little-endian). ISO format is used for Multi*
 * geometries (each sub-geometry carries its own byte-order + type header),
 * matching GEOS's `GEOSGeomToWKB_buf_r` output.
 *
 * No Z, no M, no SRID.
 */

import type {
    LineString,
    MultiLineString,
    MultiPoint,
    MultiPolygon,
    Polygon,
} from "geojson";

// ---- WKB constants ---------------------------------------------------------

const WKB_BYTE_ORDER = 0x01; // little-endian

const WKB_POINT = 1;
const WKB_LINESTRING = 2;
const WKB_POLYGON = 3;
const WKB_MULTIPOINT = 4;
const WKB_MULTILINESTRING = 5;
const WKB_MULTIPOLYGON = 6;

// ---- Error type ------------------------------------------------------------

/** Thrown when WKB input is malformed or truncated. */
export class WkbError extends Error {
    constructor(message: string) {
        super(`[WKB] ${message}`);
        this.name = "WkbError";
    }
}

// ---- Helpers ---------------------------------------------------------------

type Coords = [number, number];

interface WkbView {
    readonly bytes: Uint8Array;
    readonly view: DataView;
    offset: number;
}

function createView(bytes: Uint8Array): WkbView {
    return {
        bytes,
        view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        offset: 0,
    };
}

function remaining(v: WkbView): number {
    return v.bytes.length - v.offset;
}

function readByte(v: WkbView): number {
    if (remaining(v) < 1) throw new WkbError("truncated: expected byte");
    return v.view.getUint8(v.offset++);
}

function readUint32(v: WkbView): number {
    if (remaining(v) < 4) throw new WkbError("truncated: expected uint32");
    const val = v.view.getUint32(v.offset, true); // little-endian
    v.offset += 4;
    return val;
}

function readFloat64(v: WkbView): number {
    if (remaining(v) < 8) throw new WkbError("truncated: expected float64");
    const val = v.view.getFloat64(v.offset, true);
    v.offset += 8;
    return val;
}

function readCoords(v: WkbView, count: number): Coords[] {
    const coords: Coords[] = [];
    for (let i = 0; i < count; i++) {
        const x = readFloat64(v);
        const y = readFloat64(v);
        coords.push([x, y]);
    }
    return coords;
}

function writeByte(v: WkbView, val: number): void {
    v.view.setUint8(v.offset++, val);
}

function writeUint32(v: WkbView, val: number): void {
    v.view.setUint32(v.offset, val, true);
    v.offset += 4;
}

function writeFloat64(v: WkbView, val: number): void {
    v.view.setFloat64(v.offset, val, true);
    v.offset += 8;
}

function writeCoords(v: WkbView, coords: Coords[]): void {
    for (const [x, y] of coords) {
        writeFloat64(v, x);
        writeFloat64(v, y);
    }
}

// ---- Growth buffer for encoding --------------------------------------------

function createWriteView(capacity: number): WkbView {
    const buf = new ArrayBuffer(capacity);
    return {
        bytes: new Uint8Array(buf),
        view: new DataView(buf),
        offset: 0,
    };
}

/**
 * Estimate the WKB byte size for a geometry. Tight enough for small features,
 * accepts some realloc for large ones.
 */
function estimateSize(
    geom: LineString | MultiLineString | Polygon | MultiPolygon | MultiPoint,
): number {
    const HEADER = 5; // byteOrder + type
    const PER_POINT = 16; // 2 × float64
    const PER_RING_HEADER = 4; // numPoints uint32
    const PER_MULTI_HEADER = 4; // numGeoms uint32

    switch (geom.type) {
        case "LineString":
            return HEADER + 4 + geom.coordinates.length * PER_POINT;
        case "MultiLineString":
            return (
                HEADER +
                PER_MULTI_HEADER +
                geom.coordinates.reduce(
                    (sum, c) => sum + HEADER + 4 + c.length * PER_POINT,
                    0,
                )
            );
        case "Polygon":
            return (
                HEADER +
                PER_MULTI_HEADER + // numRings
                geom.coordinates.reduce(
                    (sum, ring) =>
                        sum + PER_RING_HEADER + ring.length * PER_POINT,
                    0,
                )
            );
        case "MultiPolygon":
            return (
                HEADER +
                PER_MULTI_HEADER +
                geom.coordinates.reduce(
                    (sum, rings) =>
                        sum +
                        HEADER +
                        PER_MULTI_HEADER +
                        rings.reduce(
                            (s, ring) =>
                                s + PER_RING_HEADER + ring.length * PER_POINT,
                            0,
                        ),
                    0,
                )
            );
        case "MultiPoint":
            return (
                HEADER +
                PER_MULTI_HEADER +
                geom.coordinates.length * (HEADER + PER_POINT)
            );
    }
}

// ---- Encode ----------------------------------------------------------------

function encodeLineString(v: WkbView, coords: Coords[]): void {
    writeUint32(v, coords.length);
    writeCoords(v, coords);
}

function encodePolygon(v: WkbView, rings: Coords[][]): void {
    writeUint32(v, rings.length);
    for (const ring of rings) {
        writeUint32(v, ring.length);
        writeCoords(v, ring);
    }
}

function encodeMultiLineString(v: WkbView, lines: Coords[][]): void {
    writeUint32(v, lines.length);
    for (const line of lines) {
        // ISO WKB: each sub-LineString has byteOrder + type + data.
        writeByte(v, WKB_BYTE_ORDER);
        writeUint32(v, WKB_LINESTRING);
        encodeLineString(v, line);
    }
}

function encodeMultiPolygon(v: WkbView, polygons: Coords[][][]): void {
    writeUint32(v, polygons.length);
    for (const rings of polygons) {
        // ISO WKB: each sub-Polygon has byteOrder + type + data.
        writeByte(v, WKB_BYTE_ORDER);
        writeUint32(v, WKB_POLYGON);
        encodePolygon(v, rings);
    }
}

function encodeMultiPoint(v: WkbView, points: Coords[]): void {
    writeUint32(v, points.length);
    for (const [x, y] of points) {
        // ISO WKB: each sub-Point has byteOrder + type + data.
        writeByte(v, WKB_BYTE_ORDER);
        writeUint32(v, WKB_POINT);
        writeFloat64(v, x);
        writeFloat64(v, y);
    }
}

/**
 * Encode a geometry to little-endian WKB bytes.
 *
 * Supported input types: LineString, MultiLineString, Polygon, MultiPolygon,
 * MultiPoint.
 */
export function encodeWkb(
    geom: LineString | MultiLineString | Polygon | MultiPolygon | MultiPoint,
): Uint8Array {
    const est = estimateSize(geom);
    const v = createWriteView(Math.max(est, 64));

    writeByte(v, WKB_BYTE_ORDER);

    switch (geom.type) {
        case "LineString":
            writeUint32(v, WKB_LINESTRING);
            encodeLineString(v, geom.coordinates as Coords[]);
            break;
        case "MultiLineString":
            writeUint32(v, WKB_MULTILINESTRING);
            encodeMultiLineString(v, geom.coordinates as Coords[][]);
            break;
        case "Polygon":
            writeUint32(v, WKB_POLYGON);
            encodePolygon(v, geom.coordinates as Coords[][]);
            break;
        case "MultiPolygon":
            writeUint32(v, WKB_MULTIPOLYGON);
            encodeMultiPolygon(v, geom.coordinates as Coords[][][]);
            break;
        case "MultiPoint":
            writeUint32(v, WKB_MULTIPOINT);
            encodeMultiPoint(v, geom.coordinates as Coords[]);
            break;
        default:
            throw new WkbError(
                `unsupported encode type: ${(geom as { type: string }).type}`,
            );
    }

    return v.bytes.slice(0, v.offset);
}

// ---- Decode ----------------------------------------------------------------

function readWkbHeader(v: WkbView): { byteOrder: number; type: number } | null {
    if (remaining(v) < 5) return null;
    const byteOrder = readByte(v);
    if (byteOrder !== WKB_BYTE_ORDER) {
        throw new WkbError(
            `unsupported byte order: 0x${byteOrder.toString(16)} (expected 0x01)`,
        );
    }
    const type = readUint32(v);
    return { byteOrder, type };
}

function decodePolygonCoords(v: WkbView): Coords[][] | null {
    const numRings = readUint32(v);
    if (numRings === 0) return null; // POLYGON EMPTY
    const rings: Coords[][] = [];
    for (let i = 0; i < numRings; i++) {
        const numPoints = readUint32(v);
        if (numPoints === 0) throw new WkbError("ring with 0 points");
        rings.push(readCoords(v, numPoints));
    }
    return rings;
}

/**
 * Decode little-endian WKB bytes to a GeoJSON Polygon or MultiPolygon.
 *
 * Returns `null` for empty geometries (POLYGON EMPTY, MULTIPOLYGON EMPTY,
 * GEOMETRYCOLLECTION EMPTY) — these are legitimate GEOS outputs for
 * zero-distance buffers on degenerate input. The caller skips them.
 *
 * Throws `WkbError` on malformed / truncated / unsupported non-empty input.
 */
export function decodeWkb(bytes: Uint8Array): Polygon | MultiPolygon | null {
    const v = createView(bytes);

    // Read top-level header.
    const header = readWkbHeader(v);
    if (!header) {
        throw new WkbError("truncated: missing WKB header");
    }

    if (header.type === WKB_POLYGON) {
        const coords = decodePolygonCoords(v);
        if (!coords) return null; // POLYGON EMPTY
        return { type: "Polygon", coordinates: coords };
    }

    if (header.type === WKB_MULTIPOLYGON) {
        const numPolygons = readUint32(v);
        if (numPolygons === 0) return null; // MULTIPOLYGON EMPTY

        if (numPolygons === 1) {
            const subHeader = readWkbHeader(v);
            if (!subHeader || subHeader.type !== WKB_POLYGON) {
                throw new WkbError(
                    "expected Polygon sub-geometry in MultiPolygon",
                );
            }
            const coords = decodePolygonCoords(v);
            if (!coords) return null; // sub-Polygon is empty
            return { type: "Polygon", coordinates: coords };
        }

        const multiCoords: Coords[][][] = [];
        for (let i = 0; i < numPolygons; i++) {
            const subHeader = readWkbHeader(v);
            if (!subHeader || subHeader.type !== WKB_POLYGON) {
                throw new WkbError(
                    "expected Polygon sub-geometry in MultiPolygon",
                );
            }
            const rings = decodePolygonCoords(v);
            if (!rings) return null; // sub-Polygon is empty
            multiCoords.push(rings);
        }

        return { type: "MultiPolygon", coordinates: multiCoords };
    }

    // GEOMETRYCOLLECTION EMPTY (type 7) — legitimate empty output.
    if (header.type === 7) {
        const numGeoms = readUint32(v);
        if (numGeoms === 0) return null;
    }

    throw new WkbError(
        `unsupported geometry type for decode: ${header.type} (expected Polygon or MultiPolygon)`,
    );
}

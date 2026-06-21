/**
 * Integer delta encoding for admin boundary polygons.
 *
 * Format: 1e-5° integer grid. Each ring is length-prefixed:
 *   [ringLen, x0, y0, dx1, dy1, dx2, dy2, …]
 *
 * A MultiPolygon is encoded as [polyCount, ringCount, ringData…, ringCount, ringData…, …]
 * where ringCount is the number of rings in the first polygon, followed by those rings'
 * data, then ringCount for the next polygon, etc.
 *
 * @module deltaEncode
 */

const SCALE = 100_000; // 1e-5 degrees per unit

/**
 * Map a lon/lat pair to integer grid coordinates.
 * @param {number} lon
 * @param {number} lat
 * @returns {[number, number]}
 */
export function quantize(lon, lat) {
    return [Math.round(lon * SCALE), Math.round(lat * SCALE)];
}

/**
 * Map integer grid coordinates back to lon/lat.
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]}
 */
export function unquantize(x, y) {
    return [x / SCALE, y / SCALE];
}

/**
 * Encode a single ring directly into an existing output array.
 *
 * Appends `[ringLen, x0, y0, dx1, dy1, dx2, dy2, …]` to `out` in place. The
 * ringLen prefix is back-filled after the pairs are written, so no intermediate
 * array is allocated and no spread/`apply` is performed. This is the only
 * encoding path that touches per-point data, so large rings (tens of thousands
 * of points — complex coastlines like New York or Alaska) never build an
 * argument list and so cannot overflow the call stack. See
 * docs/bugs/deltaEncode-stack-overflow.md.
 *
 * @param {[number, number][]} ring - array of [lon, lat] pairs
 * @param {number[]} out - output array to append to
 */
export function encodeDeltaRingInto(ring, out) {
    if (ring.length < 3)
        throw new Error(`Ring too short: ${ring.length} points`);

    const ringLenIdx = out.length;
    out.push(0); // placeholder for ringLen, back-filled below
    let px, py;

    for (let i = 0; i < ring.length; i++) {
        const [x, y] = quantize(ring[i][0], ring[i][1]);
        if (i === 0) {
            out.push(x, y);
            px = x;
            py = y;
        } else {
            out.push(x - px, y - py);
            px = x;
            py = y;
        }
    }

    // ringLen includes the pair data but not the ringLen slot itself.
    out[ringLenIdx] = out.length - ringLenIdx - 1;
}

/**
 * Encode a single ring as a standalone length-prefixed delta array.
 *
 * Returns `[ringLen, x0, y0, dx1, dy1, dx2, dy2, …]`.
 * The length includes the first absolute pair but not the ringLen itself.
 *
 * @param {[number, number][]} ring - array of [lon, lat] pairs
 * @returns {number[]}
 */
export function encodeDeltaRing(ring) {
    const out = [];
    encodeDeltaRingInto(ring, out);
    return out;
}

/**
 * Decode a length-prefixed delta ring back to [lon, lat][].
 *
 * @param {number[]} encoded - [ringLen, x0, y0, dx1, dy1, …]
 * @returns {[number, number][]}
 */
export function decodeDeltaRing(encoded) {
    const ringLen = encoded[0];
    const ring = [];
    let px = 0,
        py = 0;

    for (let i = 1; i <= ringLen; i += 2) {
        if (i === 1) {
            // First pair is absolute
            const x = encoded[i];
            const y = encoded[i + 1];
            ring.push(unquantize(x, y));
            px = x;
            py = y;
        } else {
            const dx = encoded[i];
            const dy = encoded[i + 1];
            const x = px + dx;
            const y = py + dy;
            ring.push(unquantize(x, y));
            px = x;
            py = y;
        }
    }

    return ring;
}

/**
 * Encode a Polygon or MultiPolygon geometry to the artifact delta format.
 *
 * Polygon: [polyCount=1, ringCount, ringData…]
 * MultiPolygon: [polyCount=N, ringCount_p0, ringData_p0, ringCount_p1, ringData_p1, …]
 *
 * @param {object} geometry - GeoJSON geometry (Polygon | MultiPolygon)
 * @returns {number[]}
 */
export function encodeDeltaPolygon(geometry) {
    const polygons =
        geometry.type === "MultiPolygon"
            ? geometry.coordinates // [polygon[ring[], ring[]], polygon[ring[], ring[]], …]
            : [geometry.coordinates]; // wrap single Polygon

    const out = [polygons.length]; // polyCount

    for (const rings of polygons) {
        out.push(rings.length); // ringCount for this polygon
        for (const ring of rings) {
            encodeDeltaRingInto(ring, out); // appends in place — no spread
        }
    }

    return out;
}

/**
 * Decode a delta-encoded array back to GeoJSON MultiPolygon coordinates.
 *
 * @param {number[]} encoded - polyCount + ring data
 * @returns {[[number, number][][]]} MultiPolygon coordinates array
 */
export function decodeDeltaPolygon(encoded) {
    const polyCount = encoded[0];
    let offset = 1;
    const polygons = [];

    for (let p = 0; p < polyCount; p++) {
        const ringCount = encoded[offset++];
        const rings = [];
        for (let r = 0; r < ringCount; r++) {
            const ringLen = encoded[offset];
            const ringData = encoded.slice(offset, offset + 1 + ringLen); // include ringLen
            rings.push(decodeDeltaRing(ringData));
            offset += 1 + ringLen;
        }
        polygons.push(rings);
    }

    return polygons;
}

/**
 * Get the simplification tolerance used before delta encoding.
 * Matches the design doc: 0.0001 degrees = ~11 m.
 */
export function getSimplifyToleranceDegrees() {
    return 0.0001;
}

export { SCALE };

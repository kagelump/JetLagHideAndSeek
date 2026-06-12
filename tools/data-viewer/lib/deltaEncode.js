/**
 * CommonJS delta encoder/decoder for the data viewer.
 *
 * Matches data/packs/scripts/lib/deltaEncode.mjs exactly but as CJS
 * (createRequire can't load ESM modules directly).
 *
 * Format: 1e-5° integer grid. Each ring is length-prefixed:
 *   [ringLen, x0, y0, dx1, dy1, …]
 *
 * @module deltaEncode
 */

const SCALE = 100_000;

function unquantize(x, y) {
    return [x / SCALE, y / SCALE];
}

function decodeDeltaRing(encoded) {
    const ringLen = encoded[0];
    const ring = [];
    let px = 0,
        py = 0;

    for (let i = 1; i <= ringLen; i += 2) {
        if (i === 1) {
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

function decodeDeltaPolygon(encoded) {
    const polyCount = encoded[0];
    let offset = 1;
    const polygons = [];

    for (let p = 0; p < polyCount; p++) {
        const ringCount = encoded[offset++];
        const rings = [];
        for (let r = 0; r < ringCount; r++) {
            const ringLen = encoded[offset];
            const ringData = encoded.slice(offset, offset + 1 + ringLen);
            rings.push(decodeDeltaRing(ringData));
            offset += 1 + ringLen;
        }
        polygons.push(rings);
    }

    return polygons;
}

module.exports = { decodeDeltaPolygon, SCALE };

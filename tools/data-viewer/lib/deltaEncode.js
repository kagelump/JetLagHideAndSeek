/**
 * Delta encoder/decoder for the data viewer.
 *
 * Matches data/packs/scripts/lib/deltaEncode.mjs exactly but as CJS
 * (createRequire can't load ESM modules directly).
 *
 * Format: 1e-5 degree integer grid. Each ring is length-prefixed:
 *   [ringLen, x0, y0, dx1, dy1, ...]
 */
/* global window */
(function () {
    "use strict";

    var SCALE = 100000;

    function unquantize(x, y) {
        return [x / SCALE, y / SCALE];
    }

    function decodeDeltaRing(encoded) {
        var ringLen = encoded[0];
        var ring = [];
        var px = 0,
            py = 0;

        for (var i = 1; i <= ringLen; i += 2) {
            if (i === 1) {
                var x = encoded[i];
                var y = encoded[i + 1];
                ring.push(unquantize(x, y));
                px = x;
                py = y;
            } else {
                var dx = encoded[i];
                var dy = encoded[i + 1];
                var x = px + dx;
                var y = py + dy;
                ring.push(unquantize(x, y));
                px = x;
                py = y;
            }
        }

        return ring;
    }

    function decodeDeltaPolygon(encoded) {
        var polyCount = encoded[0];
        var offset = 1;
        var polygons = [];

        for (var p = 0; p < polyCount; p++) {
            var ringCount = encoded[offset++];
            var rings = [];
            for (var r = 0; r < ringCount; r++) {
                var ringLen = encoded[offset];
                var ringData = encoded.slice(offset, offset + 1 + ringLen);
                rings.push(decodeDeltaRing(ringData));
                offset += 1 + ringLen;
            }
            polygons.push(rings);
        }

        return polygons;
    }

    var api = { decodeDeltaPolygon: decodeDeltaPolygon, SCALE: SCALE };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (typeof window !== "undefined") {
        window.deltaEncode = api;
    }
})();

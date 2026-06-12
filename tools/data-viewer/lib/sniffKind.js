/**
 * Payload kind sniffing — determines the artifact type from a parsed JSON payload.
 *
 * Dual-environment module (Node.js CJS via module.exports, browser via window.*).
 */
/* global window */
(function () {
    "use strict";

    /**
     * Sniff the artifact kind from a parsed JSON payload based on its fields.
     *
     * @param {object} payload - parsed JSON
     * @returns {string|null} one of: "poi", "measuring", "boundaries", "transit", "meta", or null
     */
    function sniffKind(payload) {
        if (payload == null || typeof payload !== "object") return null;
        if (payload.categories && payload.totalCount !== undefined)
            return "poi";
        if (payload.category && Array.isArray(payload.features))
            return "measuring";
        if (payload.index && payload.polygons) return "boundaries";
        if (payload.presets && Array.isArray(payload.presets)) return "transit";
        if (payload.regionId && payload.adminLevels) return "meta";
        return null;
    }

    var api = { sniffKind: sniffKind };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (typeof window !== "undefined") {
        window.sniffKind = sniffKind;
    }
})();

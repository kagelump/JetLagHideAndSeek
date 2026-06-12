/**
 * Attach OSM route lines to presets.
 *
 * - Places each route line into the preset whose normalized operator matches
 *   the route's normalized operator.
 * - Adds the route's `routeId` to every member station copy in *every* preset
 *   that contains that station (by sourceId or mergeKey).
 *
 * @module attachRoutes
 */

/**
 * @typedef {object} TransitLine
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} sourceId
 * @property {string} [operator]
 * @property {string[]} memberStationIds
 * @property {object} geometry
 */

/**
 * @typedef {object} Preset
 * @property {string} id
 * @property {string} operator
 * @property {string} defaultColor
 * @property {object[]} routes
 * @property {object[]} stations
 */

/**
 * Attach lines to presets.
 *
 * @param {Preset[]} presets
 * @param {TransitLine[]} lines
 * @param {(raw: string|null|undefined) => string|null} normalizeOp
 * @returns {Preset[]}
 */
export function attachRoutesToPresets(presets, lines, normalizeOp) {
    // Index every station copy by sourceId and mergeKey across all presets.
    /** @type {Map<string, { preset: Preset, station: object }[]>} */
    const stationsByKey = new Map();

    for (const preset of presets) {
        for (const station of preset.stations) {
            const keys = new Set(
                [station.sourceId, station.mergeKey, station.id].filter(
                    Boolean,
                ),
            );
            for (const key of keys) {
                if (!stationsByKey.has(key)) stationsByKey.set(key, []);
                stationsByKey.get(key).push({ preset, station });
            }
        }
    }

    // Index presets by normalized operator for line placement.
    /** @type {Map<string, Preset>} */
    const presetByOperator = new Map();
    for (const preset of presets) {
        const op = normalizeOp(preset.operator);
        if (op) presetByOperator.set(op, preset);
    }

    // Fallback preset for routes whose operator has no dedicated preset
    // (small operators folded into an "Other" catch-all).
    const fallbackPreset =
        presets.find(
            (p) =>
                normalizeOp(p.operator) === "other" &&
                !p.id.toLowerCase().includes("coverage"),
        ) ??
        presets.find(
            (p) =>
                normalizeOp(p.operator) === "other" ||
                p.id.toLowerCase().includes("other"),
        );

    for (const line of lines) {
        const lineOp = normalizeOp(line.operator);
        let targetPreset = lineOp ? presetByOperator.get(lineOp) : null;
        if (!targetPreset && fallbackPreset) {
            targetPreset = fallbackPreset;
        }

        if (targetPreset) {
            targetPreset.routes.push({
                id: line.id,
                name: line.name,
                color: line.color || targetPreset.defaultColor,
                sourceId: line.sourceId,
                geometry: line.geometry,
            });
        }

        // Attach routeId to every copy of every member station.
        for (const memberId of line.memberStationIds) {
            const entries = stationsByKey.get(memberId);
            if (!entries) continue;
            for (const { station } of entries) {
                if (!station.routeIds.includes(line.id)) {
                    station.routeIds.push(line.id);
                }
            }
        }
    }

    return presets;
}

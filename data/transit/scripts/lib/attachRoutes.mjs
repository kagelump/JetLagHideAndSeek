/**
 * Attach OSM route lines to presets.
 *
 * - Places each route line into the preset whose normalized operator matches
 *   the route's normalized operator.
 * - Adds the route's `routeId` to every member station copy in *every* preset
 *   that contains that station (by sourceId or mergeKey).
 * - Two-pass attachment: non-fallback (single-operator) lines attach first.
 *   Fallback lines (originally multi-operator, now cleaned to first operator)
 *   only attach their routeIds to stations that still have zero routeIds
 *   after the first pass. This prevents through-service relations from
 *   inflating station route counts while preserving coverage for stations
 *   that lack single-operator data.
 *
 * @module attachRoutes
 */

/**
 * @typedef {object} TransitLine
 * @property {string} id
 * @property {string} name
 * @property {string} [nameEn]
 * @property {string} color
 * @property {string} sourceId
 * @property {string} [operator]
 * @property {boolean} [_fallback] True when the original operator was multi-value
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

    /**
     * Place a line into its preset (add to routes array) and attach its
     * routeId to every member station copy across all presets.
     *
     * @param {TransitLine} line
     * @param {boolean} onlyIfEmpty - if true, skip stations that already
     *   have ≥1 routeId (fallback gap-fill).
     */
    const placeAndAttach = (line, onlyIfEmpty) => {
        const lineOp = normalizeOp(line.operator);
        let targetPreset = lineOp ? presetByOperator.get(lineOp) : null;
        if (!targetPreset && fallbackPreset) {
            targetPreset = fallbackPreset;
        }

        if (targetPreset) {
            targetPreset.routes.push({
                id: line.id,
                name: line.name,
                nameEn: line.nameEn || undefined,
                color: line.color || targetPreset.defaultColor,
                sourceId: line.sourceId,
                geometry: line.geometry,
            });
        }

        for (const memberId of line.memberStationIds) {
            const entries = stationsByKey.get(memberId);
            if (!entries) continue;
            for (const { station } of entries) {
                if (onlyIfEmpty && station.routeIds.length > 0) continue;
                if (!station.routeIds.includes(line.id)) {
                    station.routeIds.push(line.id);
                }
            }
        }
    };

    // Pass 1: non-fallback lines. These are single-operator lines
    // (or lines whose multi-op operator was cleaned to the owning operator).
    // Their routeIds get attached to every member station unconditionally.
    for (const line of lines) {
        if (!line._fallback) {
            placeAndAttach(line, false);
        }
    }

    // Pass 2: fallback lines. Originally multi-operator relations (e.g.
    // through-services) whose operator has been cleaned. They still appear
    // in their preset's route list, but their routeIds only fill stations
    // that have no single-operator coverage — preventing inflated counts
    // at stations like 中目黒 while preserving data for stations that
    // lack single-operator route data.
    const fallbackLines = lines.filter((l) => l._fallback);
    if (fallbackLines.length > 0) {
        for (const line of fallbackLines) {
            placeAndAttach(line, true);
        }
        console.log(
            `[attachRoutes] ${fallbackLines.length} fallback line(s) attached (gap-fill mode)`,
        );
    }

    return presets;
}

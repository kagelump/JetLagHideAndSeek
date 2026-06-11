/**
 * Shared transit GeoJSON construction — extracted from
 * src/features/hidingZone/hidingZone.ts so the bundle viewer and the
 * React Native app use identical transform logic.
 *
 * Plain JS, no imports.  Works in Node.js (build step) and the browser
 * (loaded via <script> tag).
 */
/* global window */
(function () {
    "use strict";

    var STATION_FALLBACK_COLOR = "#1f6f78";

    /**
     * Priority for source-kind merge: lower = wins.
     * GTFS has richer data (lines, colors); OSM is the fallback.
     */
    function sourcePriority(source) {
        return source && source.kind === "gtfs" ? 0 : 1;
    }

    /**
     * Map a station's routeIds to an array of unique colors.
     */
    function getStationRouteColors(routeIds, routeColorById, fallbackColor) {
        var seen = {};
        var result = [];
        for (var i = 0; i < routeIds.length; i++) {
            var color =
                routeColorById.get(routeIds[i]) ||
                fallbackColor ||
                STATION_FALLBACK_COLOR;
            if (!seen[color]) {
                seen[color] = true;
                result.push(color);
            }
        }
        return result;
    }

    /**
     * Merge stations across presets by mergeKey, respecting source priority.
     * Returns an array of merged station objects with routeColors populated.
     */
    function getSelectedStations(presets) {
        var sorted = presets.slice().sort(function (a, b) {
            return sourcePriority(a.source) - sourcePriority(b.source);
        });

        var stations = new Map();
        for (var pi = 0; pi < sorted.length; pi++) {
            var preset = sorted[pi];
            var routeColorById = new Map();
            for (var ri = 0; ri < preset.routes.length; ri++) {
                var route = preset.routes[ri];
                routeColorById.set(
                    route.id,
                    route.color || preset.defaultColor,
                );
            }
            // Build routeId → route name lookup for this preset
            var routeNameById = new Map();
            for (var ri2 = 0; ri2 < preset.routes.length; ri2++) {
                var rt = preset.routes[ri2];
                routeNameById.set(rt.id, rt.name);
            }
            var presetLabel = preset.label || preset.operator || preset.id;
            for (var si = 0; si < preset.stations.length; si++) {
                var station = preset.stations[si];
                var routeColors = getStationRouteColors(
                    station.routeIds,
                    routeColorById,
                    preset.defaultColor,
                );
                // Collect route names for this station's routes
                var stationRouteNames = station.routeIds
                    .map(function (rid) {
                        return routeNameById.get(rid);
                    })
                    .filter(Boolean);
                var existing = stations.get(station.mergeKey);
                if (existing) {
                    existing.routeIds = [
                        ...new Set([...existing.routeIds, ...station.routeIds]),
                    ].sort();
                    existing.routeColors = [
                        ...new Set([
                            ...(existing.routeColors || []),
                            ...routeColors,
                        ]),
                    ];
                    existing.routeNames = [
                        ...new Set([
                            ...(existing.routeNames || []),
                            ...stationRouteNames,
                        ]),
                    ];
                    existing.operators = [
                        ...new Set([
                            ...(existing.operators || []),
                            presetLabel,
                        ]),
                    ];
                    existing.sourceStationIds = [
                        ...new Set([
                            ...(existing.sourceStationIds || []),
                            station.id,
                        ]),
                    ].sort();
                    if (!existing.nameEn && station.nameEn) {
                        existing.nameEn = station.nameEn;
                    }
                } else {
                    stations.set(station.mergeKey, {
                        id: station.id,
                        lat: station.lat,
                        lon: station.lon,
                        name: station.name,
                        nameEn: station.nameEn || undefined,
                        routeColors: routeColors,
                        routeIds: station.routeIds.slice().sort(),
                        routeNames: stationRouteNames.slice(),
                        operators: [presetLabel],
                        sourceStationIds: [station.id],
                    });
                }
            }
        }
        return [...stations.values()];
    }

    /**
     * Build a GeoJSON FeatureCollection of transit route lines.
     * One Feature per route across all presets.
     */
    function buildRouteFeatureCollection(presets) {
        var features = [];
        for (var pi = 0; pi < presets.length; pi++) {
            var preset = presets[pi];
            for (var ri = 0; ri < preset.routes.length; ri++) {
                var route = preset.routes[ri];
                features.push({
                    type: "Feature",
                    geometry: route.geometry,
                    properties: {
                        color: route.color || preset.defaultColor,
                        id: route.id,
                        name: route.name,
                        presetId: preset.id,
                    },
                });
            }
        }
        return { type: "FeatureCollection", features: features };
    }

    /**
     * Build a GeoJSON FeatureCollection of transit station dots.
     * Each station emits one Point Feature per route color (concentric
     * ring rendering), with ringIndex/ringCount/color properties.
     */
    function buildStationFeatureCollection(stations) {
        var features = [];
        for (var si = 0; si < stations.length; si++) {
            var station = stations[si];
            var routeColors =
                station.routeColors && station.routeColors.length > 0
                    ? station.routeColors
                    : [STATION_FALLBACK_COLOR];
            for (var ci = 0; ci < routeColors.length; ci++) {
                features.push({
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [station.lon, station.lat],
                    },
                    properties: {
                        color: routeColors[ci],
                        id: station.id,
                        name: station.name,
                        routeNames: (station.routeNames || []).join(", "),
                        operators: (station.operators || []).join(", "),
                        ringCount: routeColors.length,
                        ringIndex: ci,
                    },
                });
            }
        }
        return { type: "FeatureCollection", features: features };
    }

    // ── Exports ──────────────────────────────────────────────────────────
    var api = {
        STATION_FALLBACK_COLOR: STATION_FALLBACK_COLOR,
        sourcePriority: sourcePriority,
        getStationRouteColors: getStationRouteColors,
        getSelectedStations: getSelectedStations,
        buildRouteFeatureCollection: buildRouteFeatureCollection,
        buildStationFeatureCollection: buildStationFeatureCollection,
    };

    // Node.js / CommonJS
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    // Browser global
    if (typeof window !== "undefined") {
        window.transitGeojson = api;
    }
})();

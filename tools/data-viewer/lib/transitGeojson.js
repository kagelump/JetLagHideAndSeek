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

        // Build a global routeId → color map across every preset in the bundle
        // so interchange stations can resolve colors for routes owned by other
        // operators' presets.
        var routeColorById = new Map();
        for (var pxi = 0; pxi < presets.length; pxi++) {
            var px = presets[pxi];
            for (var ri = 0; ri < px.routes.length; ri++) {
                var route = px.routes[ri];
                if (!routeColorById.has(route.id)) {
                    routeColorById.set(
                        route.id,
                        route.color || px.defaultColor,
                    );
                } else if (route.color) {
                    routeColorById.set(route.id, route.color);
                }
            }
        }

        // Only routes from the selected presets should contribute rings.
        // attachRoutesToPresets attaches routes across all operators so
        // interchange hubs have full routeId lists on every station copy,
        // but unselected operators' routes must not produce rings.
        var selectedRouteIdSet = new Set();
        for (var si2 = 0; si2 < presets.length; si2++) {
            var sp = presets[si2];
            for (var ri3 = 0; ri3 < sp.routes.length; ri3++) {
                selectedRouteIdSet.add(sp.routes[ri3].id);
            }
        }

        var stations = new Map();
        for (var pi = 0; pi < sorted.length; pi++) {
            var preset = sorted[pi];
            // Build routeId → route name lookup for this preset
            var routeNameById = new Map();
            var routeNameEnById = new Map();
            for (var ri2 = 0; ri2 < preset.routes.length; ri2++) {
                var rt = preset.routes[ri2];
                routeNameById.set(rt.id, rt.name);
                if (rt.nameEn) routeNameEnById.set(rt.id, rt.nameEn);
            }
            var presetLabel = preset.label || preset.operator || preset.id;
            for (var si = 0; si < preset.stations.length; si++) {
                var station = preset.stations[si];
                var stationRouteIds = station.routeIds.filter(function (rid) {
                    return selectedRouteIdSet.has(rid);
                });
                var routeColors =
                    stationRouteIds.length > 0
                        ? getStationRouteColors(
                              stationRouteIds,
                              routeColorById,
                              preset.defaultColor,
                          )
                        : [preset.defaultColor || STATION_FALLBACK_COLOR];
                // Collect route names for this station's routes
                var stationRouteNames = stationRouteIds
                    .map(function (rid) {
                        return routeNameById.get(rid);
                    })
                    .filter(Boolean);
                var stationRouteNamesEn = stationRouteIds
                    .map(function (rid) {
                        return routeNameEnById.get(rid);
                    })
                    .filter(Boolean);
                var existing = stations.get(station.mergeKey);
                if (existing) {
                    existing.routeIds = [
                        ...new Set([...existing.routeIds, ...stationRouteIds]),
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
                    existing.routeNamesEn = [
                        ...new Set([
                            ...(existing.routeNamesEn || []),
                            ...stationRouteNamesEn,
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
                        routeIds: stationRouteIds.slice().sort(),
                        routeNames: stationRouteNames.slice(),
                        routeNamesEn: stationRouteNamesEn.slice(),
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
                        nameEn: route.nameEn || undefined,
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
                        nameEn: station.nameEn || undefined,
                        routeNames: (station.routeNames || []).join(", "),
                        routeNamesEn:
                            (station.routeNamesEn || []).length > 0
                                ? station.routeNamesEn.join(", ")
                                : undefined,
                        operators: (station.operators || []).join(", "),
                        ringCount: routeColors.length,
                        ringIndex: ci,
                    },
                });
            }
        }
        return { type: "FeatureCollection", features: features };
    }

    // ── Wedge radii (degrees) — sized per zoom tier ─────────────────
    var WEDGE_RADIUS_LARGE = 0.0008; // ~80 m — good at z11-z12
    var WEDGE_RADIUS_MEDIUM = 0.00035; // ~35 m — good at z13-z14
    var WEDGE_RADIUS_SMALL = 0.00015; // ~15 m — good at z15+

    /**
     * Build a GeoJSON FeatureCollection of wedge-shaped polygons — one per
     * route color per station.  Render with a fill layer to produce a
     * pie-chart effect.  Each wedge carries stationLon/stationLat so
     * callers can derive a simple dot FeatureCollection from wedgeIndex 0.
     *
     * @param {object[]} stations — merged station array from getSelectedStations
     * @param {number} [radiusDeg] — WEDGE_RADIUS_MEDIUM by default
     * @returns {{ type: "FeatureCollection", features: object[] }}
     */
    function buildStationWedgeFeatureCollection(stations, radiusDeg) {
        var radius = radiusDeg != null ? radiusDeg : WEDGE_RADIUS_MEDIUM;
        var features = [];

        for (var si = 0; si < stations.length; si++) {
            var station = stations[si];
            var routeColors =
                station.routeColors && station.routeColors.length > 0
                    ? station.routeColors
                    : [STATION_FALLBACK_COLOR];
            var wedgeAngle = 360 / routeColors.length;
            var cosLat = Math.cos((station.lat * Math.PI) / 180);

            for (var wi = 0; wi < routeColors.length; wi++) {
                var startDeg = wi * wedgeAngle;
                var endDeg = (wi + 1) * wedgeAngle;
                var arcPts = Math.max(
                    4,
                    Math.min(12, Math.ceil(wedgeAngle / 22.5)),
                );

                // Build a closed polygon ring: center → arc → center.
                var ring = [[station.lon, station.lat]];
                for (var ai = 0; ai <= arcPts; ai++) {
                    var angleRad =
                        ((startDeg + (endDeg - startDeg) * (ai / arcPts)) *
                            Math.PI) /
                        180;
                    var dLat = radius * Math.cos(angleRad);
                    var dLon = (radius * Math.sin(angleRad)) / cosLat;
                    ring.push([station.lon + dLon, station.lat + dLat]);
                }
                ring.push([station.lon, station.lat]);

                features.push({
                    type: "Feature",
                    geometry: { type: "Polygon", coordinates: [ring] },
                    properties: {
                        color: routeColors[wi],
                        id: station.id,
                        name: station.name,
                        nameEn: station.nameEn || undefined,
                        routeNames: (station.routeNames || []).join(", "),
                        routeNamesEn:
                            (station.routeNamesEn || []).length > 0
                                ? station.routeNamesEn.join(", ")
                                : undefined,
                        operators: (station.operators || []).join(", "),
                        wedgeCount: routeColors.length,
                        wedgeIndex: wi,
                        stationLon: station.lon,
                        stationLat: station.lat,
                    },
                });
            }
        }

        return { type: "FeatureCollection", features: features };
    }

    /**
     * Build all three wedge sizes at once so the client can layer them
     * with staggered minzoom/maxzoom for consistent on-screen sizing.
     *
     * @param {object[]} stations
     * @returns {{ large: FeatureCollection, medium: FeatureCollection,
     *             small: FeatureCollection }}
     */
    function buildAllWedgeFeatureCollections(stations) {
        return {
            large: buildStationWedgeFeatureCollection(
                stations,
                WEDGE_RADIUS_LARGE,
            ),
            medium: buildStationWedgeFeatureCollection(
                stations,
                WEDGE_RADIUS_MEDIUM,
            ),
            small: buildStationWedgeFeatureCollection(
                stations,
                WEDGE_RADIUS_SMALL,
            ),
        };
    }

    /**
     * Build a GeoJSON FeatureCollection of simple point dots — one per
     * station, using the first route color.  Intended for low-zoom use
     * where wedge polygons would be sub-pixel.
     *
     * @param {object[]} stations — merged station array from getSelectedStations
     * @returns {{ type: "FeatureCollection", features: object[] }}
     */
    function buildStationDotFeatureCollection(stations) {
        var features = [];

        for (var si = 0; si < stations.length; si++) {
            var station = stations[si];
            var color =
                station.routeColors && station.routeColors.length > 0
                    ? station.routeColors[0]
                    : STATION_FALLBACK_COLOR;

            features.push({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [station.lon, station.lat],
                },
                properties: {
                    color: color,
                    id: station.id,
                    name: station.name,
                    nameEn: station.nameEn || undefined,
                    routeNames: (station.routeNames || []).join(", "),
                    routeNamesEn:
                        (station.routeNamesEn || []).length > 0
                            ? station.routeNamesEn.join(", ")
                            : undefined,
                    operators: (station.operators || []).join(", "),
                    wedgeCount:
                        station.routeColors && station.routeColors.length > 0
                            ? station.routeColors.length
                            : 1,
                },
            });
        }

        return { type: "FeatureCollection", features: features };
    }

    // ── Exports ──────────────────────────────────────────────────────────
    var api = {
        STATION_FALLBACK_COLOR: STATION_FALLBACK_COLOR,
        WEDGE_RADIUS_LARGE: WEDGE_RADIUS_LARGE,
        WEDGE_RADIUS_MEDIUM: WEDGE_RADIUS_MEDIUM,
        WEDGE_RADIUS_SMALL: WEDGE_RADIUS_SMALL,
        sourcePriority: sourcePriority,
        getStationRouteColors: getStationRouteColors,
        getSelectedStations: getSelectedStations,
        buildRouteFeatureCollection: buildRouteFeatureCollection,
        buildStationFeatureCollection: buildStationFeatureCollection,
        buildStationWedgeFeatureCollection: buildStationWedgeFeatureCollection,
        buildAllWedgeFeatureCollections: buildAllWedgeFeatureCollections,
        buildStationDotFeatureCollection: buildStationDotFeatureCollection,
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

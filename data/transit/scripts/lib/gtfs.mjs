import { unzipSync, strFromU8 } from "fflate";

// Import transit identity helpers from the ODPT module so there is one
// canonical source of the id grammar.
import {
    createGtfsRouteId as _createGtfsRouteId,
    createGtfsStopId as _createGtfsStopId,
} from "../../../odpt/scripts/transit-identity.mjs";

// Re-export for consumers.
export const createGtfsRouteId = _createGtfsRouteId;
export const createGtfsStopId = _createGtfsStopId;

// ─── CSV parsing ────────────────────────────────────────────────────────────
// Extracted from data/odpt/scripts/fetch-odpt.mjs so both pipelines share one
// implementation.  Handles BOMs, quoted commas, and CRLF line endings.

/**
 * Parse a GTFS CSV table (string) into an array of row objects.
 * Handles BOMs, quoted commas, and CRLF line endings.
 *
 * @param {string} text - raw CSV content
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
    const rows = [];
    let field = "";
    let row = [];
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];
        if (quoted) {
            if (char === '"' && next === '"') {
                field += '"';
                index += 1;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') quoted = true;
        else if (char === ",") {
            row.push(field);
            field = "";
        } else if (char === "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else if (char !== "\r") {
            field += char;
        }
    }

    if (field || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    const [headers = [], ...records] = rows;
    return records
        .filter((record) => record.some((value) => value !== ""))
        .map((record) =>
            Object.fromEntries(
                headers.map((header, index) => [header, record[index] ?? ""]),
            ),
        );
}

// ─── Zip reading ────────────────────────────────────────────────────────────

/**
 * Read a GTFS table from an unzipped file map.
 *
 * @param {Record<string, Uint8Array>} files - fflate unzip output
 * @param {string} name - e.g. "routes.txt"
 * @returns {Record<string, string>[]}
 */
export function readGtfsTable(files, name) {
    const fileName = Object.keys(files).find((key) => key.endsWith(name));
    if (!fileName) return [];
    return parseCsv(strFromU8(files[fileName]));
}

/**
 * Unzip a GTFS feed and return its tables.
 *
 * @param {Uint8Array} zipBytes
 * @returns {{ routes: Record<string,string>[], shapes: Record<string,string>[],
 *   stops: Record<string,string>[], stopTimes: Record<string,string>[],
 *   trips: Record<string,string>[], translations?: Record<string,string>[] }}
 */
export function readGtfsZip(zipBytes) {
    const files = unzipSync(zipBytes);
    return {
        routes: readGtfsTable(files, "routes.txt"),
        shapes: readGtfsTable(files, "shapes.txt"),
        stops: readGtfsTable(files, "stops.txt"),
        stopTimes: readGtfsTable(files, "stop_times.txt"),
        trips: readGtfsTable(files, "trips.txt"),
        translations: readGtfsTable(files, "translations.txt"),
    };
}

// ─── 1. Parent-station collapsing ───────────────────────────────────────────

/**
 * Collapse child stops (location_type=0 or missing) with a parent_station
 * into their location_type=1 parent.
 *
 * @param {Record<string,string>[]} stops - raw stops.txt rows
 * @returns {{ stationStops: Map<string, object>, childToStation: Map<string, string> }}
 *   stationStops keyed by parent stop_id (or child's own id for stops without a parent).
 *   Each value is { stopId, name, lat, lon, childIds: string[], locationType }.
 */
export function collapseParentStations(stops) {
    const byId = new Map();
    for (const s of stops) {
        byId.set(s.stop_id, s);
    }

    const stationStops = new Map(); // stop_id -> { stopId, name, lat, lon, childIds }
    const childToStation = new Map(); // child stop_id -> parent stop_id

    for (const s of stops) {
        const lt = s.location_type || "0";
        const parentId = s.parent_station || "";

        if (lt === "1") {
            // This is a station (parent).
            if (!stationStops.has(s.stop_id)) {
                stationStops.set(s.stop_id, {
                    stopId: s.stop_id,
                    name: s.stop_name || s.stop_id,
                    lat: parseFloat(s.stop_lat),
                    lon: parseFloat(s.stop_lon),
                    childIds: [],
                    locationType: 1,
                });
            }
            // Even parents can have a parent_station (nested). Map it.
            if (parentId) {
                childToStation.set(s.stop_id, parentId);
            }
        } else if (parentId) {
            // Child with a parent. Map to parent.
            childToStation.set(s.stop_id, parentId);
            // Create parent entry if not seen yet.
            if (!stationStops.has(parentId)) {
                const parent = byId.get(parentId);
                if (parent) {
                    stationStops.set(parentId, {
                        stopId: parent.stop_id,
                        name: parent.stop_name || parent.stop_id,
                        lat: parseFloat(parent.stop_lat),
                        lon: parseFloat(parent.stop_lon),
                        childIds: [],
                        locationType: 1,
                    });
                }
            }
            const station = stationStops.get(parentId);
            if (station) {
                station.childIds.push(s.stop_id);
            }
        } else {
            // Standalone stop (no parent, not itself a station). Treat as its own station.
            if (!stationStops.has(s.stop_id)) {
                stationStops.set(s.stop_id, {
                    stopId: s.stop_id,
                    name: s.stop_name || s.stop_id,
                    lat: parseFloat(s.stop_lat),
                    lon: parseFloat(s.stop_lon),
                    childIds: [],
                    locationType: parseInt(lt, 10) || 0,
                });
            }
        }
    }

    // Resolve childToStation transitively (parent → grandparent chains).
    let changed = true;
    while (changed) {
        changed = false;
        for (const [child, parent] of childToStation) {
            const grandparent = childToStation.get(parent);
            if (grandparent && grandparent !== parent) {
                childToStation.set(child, grandparent);
                changed = true;
            }
        }
    }

    return { stationStops, childToStation };
}

// ─── 2. Route type filtering ────────────────────────────────────────────────

/**
 * Check if a route_type value (integer) is allowed by the configured allowlist.
 *
 * The allowlist is an array that may contain:
 *   - numbers (e.g. 1 = subway)
 *   - [min, max] range tuples (e.g. [100, 117] = all extended rail types)
 *
 * @param {number} routeType - integer route_type from GTFS
 * @param {(number | [number, number])[]} allowlist
 * @returns {boolean}
 */
export function isRouteTypeAllowed(routeType, allowlist) {
    for (const entry of allowlist) {
        if (Array.isArray(entry)) {
            const [min, max] = entry;
            if (routeType >= min && routeType <= max) return true;
        } else if (routeType === entry) {
            return true;
        }
    }
    return false;
}

/**
 * Filter routes to only those whose route_type is in the allowlist.
 *
 * @param {Record<string,string>[]} routes - routes.txt rows
 * @param {(number | [number, number])[]} allowlist
 * @returns {Record<string,string>[]}
 */
export function filterRoutesByType(routes, allowlist) {
    return routes.filter((r) => {
        const rt = parseInt(r.route_type, 10);
        if (!Number.isFinite(rt)) return false;
        return isRouteTypeAllowed(rt, allowlist);
    });
}

// ─── Normalize allowed list from config ─────────────────────────────────────

/**
 * Parse a config-level routeTypes array (which may contain ranges expressed
 * as arrays) into the canonical allowlist form.
 *
 * Config YAML example:
 *   routeTypes: [0, 1, 2, [100, 117], [400, 404]]
 *
 * @param {(number | number[])[]} raw - from feed config
 * @returns {(number | [number, number])[]}
 */
export function normalizeAllowlist(raw) {
    if (!raw || raw.length === 0) return [];
    return raw.map((entry) => {
        if (Array.isArray(entry)) {
            if (entry.length !== 2) {
                throw new Error(
                    `routeTypes range must have exactly 2 values, got ${JSON.stringify(entry)}`,
                );
            }
            return [entry[0], entry[1]];
        }
        return entry;
    });
}

// ─── 3. Line grouping ──────────────────────────────────────────────────────

/**
 * Group GTFS routes into lines for the line picker.
 *
 * @param {Record<string,string>[]} routes - filtered routes.txt rows
 * @param {"route_id" | "short_name"} lineGrouping
 * @returns {{ lines: object[], routeLineIndex: Map<string, object> }}
 *   lines: [{ id, name, color, routeIds: string[] }]
 *   routeLineIndex: route_id → line object
 */
export function groupRoutesIntoLines(routes, lineGrouping) {
    const lines = [];
    const routeLineIndex = new Map();

    if (lineGrouping === "route_id") {
        // ODPT behavior: every route is its own line.
        for (const route of routes) {
            const line = {
                id: route.lineId, // set by caller after constructing canonical id
                anchorRouteId: route.route_id,
                name:
                    route.route_long_name ||
                    route.route_short_name ||
                    route.route_desc ||
                    route.route_id,
                color: null, // filled later
                routeIds: [route.route_id],
            };
            lines.push(line);
            routeLineIndex.set(route.route_id, line);
        }
    } else {
        // short_name mode: group by (agency_id, route_short_name || route_long_name).
        const groups = new Map();

        for (const route of routes) {
            const agencyId = route.agency_id || "";
            const shortName = (route.route_short_name || "").trim();
            const longName = (route.route_long_name || "").trim();

            // Use short name; fall back to long name; fall back to route_id.
            let groupKeyName = shortName || longName;
            let groupKey;
            if (groupKeyName) {
                groupKey = `${agencyId}|||${groupKeyName}`;
            } else {
                // Empty-empty route: fall back to route_id grouping for this route.
                groupKey = `${agencyId}|||__route:${route.route_id}`;
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, {
                    key: groupKey,
                    agencyId,
                    name: groupKeyName || route.route_id,
                    routeIds: [],
                });
            }
            groups.get(groupKey).routeIds.push(route.route_id);
        }

        for (const group of groups.values()) {
            // Anchor = lexicographically smallest route_id (deterministic).
            const sorted = [...group.routeIds].sort();
            const anchorRouteId = sorted[0];

            lines.push({
                id: null, // set by caller
                anchorRouteId,
                name: group.name,
                color: null, // filled later
                routeIds: sorted,
            });
            for (const rid of group.routeIds) {
                routeLineIndex.set(rid, lines[lines.length - 1]);
            }
        }
    }

    return { lines, routeLineIndex };
}

// ─── 4. Agency split ───────────────────────────────────────────────────────

/**
 * When a feed config has a `presets:` list, partition lines/stations by
 * agency_id into one preset per entry.
 *
 * @param {object} feedConfig - the GTFS feed entry from config.yaml
 * @param {Map<string, string>} routeAgencyMap - route_id → agency_id
 * @param {object[]} lines - grouped lines
 * @param {object[]} stations - station records
 * @returns {object[]} array of preset definitions { presetId, label, lineIds, stationIds }
 */
export function splitByAgency(feedConfig, routeAgencyMap, lines, stations) {
    const presets = feedConfig.presets;
    if (!presets || presets.length === 0) {
        // One preset for the whole feed.
        return [
            {
                presetId: feedConfig.id,
                label: feedConfig.label,
                lineIds: lines.map((l) => l.id).filter(Boolean),
                stationIds: stations.map((s) => s.id),
            },
        ];
    }

    // Partition by agency.
    const presetByAgency = new Map();
    for (const p of presets) {
        presetByAgency.set(p.agency, {
            presetId: p.id || `${feedConfig.id}-${p.agency}`,
            label: p.label || p.agency,
            lineIds: [],
            stationIds: [],
        });
    }

    // Assign lines to presets by agency.
    const lineAgency = new Map(); // line.id → agency_id
    for (const line of lines) {
        // Find which agency this line belongs to from its route members.
        const agencies = new Set();
        for (const rid of line.routeIds) {
            const aid = routeAgencyMap.get(rid);
            if (aid) agencies.add(aid);
        }
        // If a line has routes from multiple agencies, assign to the first matched preset.
        let assigned = false;
        for (const aid of agencies) {
            const preset = presetByAgency.get(aid);
            if (preset) {
                preset.lineIds.push(line.id);
                lineAgency.set(line.id, aid);
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            // Line with no matching preset agency — assign to feed default.
            const defaultPreset = presetByAgency.values().next().value;
            if (defaultPreset) {
                defaultPreset.lineIds.push(line.id);
            }
        }
    }

    // Assign stations to presets based on which lines serve them.
    for (const station of stations) {
        const stationAgencies = new Set();
        for (const rid of station.routeIds) {
            const lid = lineAgency.get(rid) || routeAgencyMap.get(rid);
            if (lid) stationAgencies.add(lid);
        }
        for (const aid of stationAgencies) {
            const preset = presetByAgency.get(aid);
            if (preset) {
                if (!preset.stationIds.includes(station.id)) {
                    preset.stationIds.push(station.id);
                }
            }
        }
    }

    return [...presetByAgency.values()];
}

// ─── Route geometry ─────────────────────────────────────────────────────────

/**
 * Build route line coordinates from shapes.txt, falling back to ordered
 * stop_times when shapes are missing (load-bearing for Tokyo Metro).
 *
 * @param {Record<string,string>[]} shapes - shapes.txt rows
 * @param {Record<string,string>[]} stopTimes - stop_times.txt rows
 * @param {Record<string,string>[]} trips - trips.txt rows
 * @param {Record<string,string>[]} stops - stops.txt rows (for fallback coords)
 * @param {Record<string,string>[]} routes - filtered routes
 * @param {Map<string, string>} childToStation - from collapseParentStations
 * @returns {Map<string, number[][][]>} route_id → MultiLineString coordinates
 */
export function buildRouteGeometries(
    shapes,
    stopTimes,
    trips,
    stops,
    routes,
    childToStation,
) {
    const tripsById = new Map();
    const routeIds = new Set(routes.map((r) => r.route_id));
    for (const trip of trips) {
        if (!trip.trip_id || !trip.route_id) continue;
        if (!routeIds.has(trip.route_id)) continue;
        tripsById.set(trip.trip_id, trip);
    }

    const stopsById = new Map();
    for (const stop of stops) {
        if (!stop.stop_id || !stop.stop_lat || !stop.stop_lon) continue;
        stopsById.set(stop.stop_id, stop);
    }

    // Resolve child stops to their parent stations for geometry.
    const resolveStopId = (sid) => childToStation.get(sid) || sid;

    const stopTimesByTripId = new Map();
    for (const st of stopTimes) {
        const trip = tripsById.get(st.trip_id);
        if (!trip || !st.stop_id) continue;
        const resolvedId = resolveStopId(st.stop_id);
        if (!stopsById.has(resolvedId) && !stopsById.has(st.stop_id)) continue;
        getArray(stopTimesByTripId, st.trip_id).push({
            sequence: Number(st.stop_sequence ?? 0),
            stopId: resolvedId,
        });
    }

    // Build shape index.
    const shapesById = new Map();
    for (const shape of shapes) {
        if (!shape.shape_id || !shape.shape_pt_lat || !shape.shape_pt_lon)
            continue;
        const seq = Number(shape.shape_pt_sequence ?? 0);
        getArray(shapesById, shape.shape_id).push({
            coordinate: [
                Number(shape.shape_pt_lon),
                Number(shape.shape_pt_lat),
            ],
            sequence: seq,
        });
    }

    // Map route → set of shape_ids used by its trips.
    const shapeIdsByRoute = new Map();
    for (const trip of tripsById.values()) {
        if (!trip.shape_id || !shapesById.has(trip.shape_id)) continue;
        getSet(shapeIdsByRoute, trip.route_id).add(trip.shape_id);
    }

    // Build geometry per route.
    const geometries = new Map();

    for (const route of routes) {
        const rid = route.route_id;
        const shapeIds = [...(shapeIdsByRoute.get(rid) ?? [])];
        const coordinates = shapeIds
            .map((sid) =>
                [...shapesById.get(sid)]
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((pt) => pt.coordinate),
            )
            .filter((line) => line.length >= 2);

        if (coordinates.length > 0) {
            geometries.set(rid, coordinates);
        } else {
            // Fallback: build from stop_times.
            const fallback = buildRouteCoordsFromStops(
                rid,
                tripsById,
                stopTimesByTripId,
                stopsById,
            );
            if (fallback.length > 0) {
                geometries.set(rid, fallback);
            }
        }
    }

    return geometries;
}

function buildRouteCoordsFromStops(
    routeId,
    tripsById,
    stopTimesByTripId,
    stopsById,
) {
    const linesBySignature = new Map();

    for (const trip of tripsById.values()) {
        if (trip.route_id !== routeId) continue;

        const stopTimes = [...(stopTimesByTripId.get(trip.trip_id) ?? [])]
            .sort((a, b) => a.sequence - b.sequence)
            .filter((st) => stopsById.has(st.stopId));
        if (stopTimes.length < 2) continue;

        const signature = stopTimes.map((st) => st.stopId).join("|");
        if (linesBySignature.has(signature)) continue;

        linesBySignature.set(
            signature,
            stopTimes.map((st) => {
                const stop = stopsById.get(st.stopId);
                return [Number(stop.stop_lon), Number(stop.stop_lat)];
            }),
        );
    }

    return [...linesBySignature.values()];
}

// ─── Main GTFS processing ───────────────────────────────────────────────────

/**
 * Process one GTFS feed into a HidingZonePreset-shaped object (or objects,
 * when agency split produces multiple presets).
 *
 * @param {object} feedConfig - the feed entry from config.yaml
 * @param {Uint8Array} zipBytes - raw GTFS zip content
 * @param {object} opts
 * @param {Record<string,string>} [opts.env] - merged env for URL substitution
 * @returns {{ presets: object[], stats: object }}
 */
export function processGtfsFeed(feedConfig, zipBytes) {
    const tables = readGtfsZip(zipBytes);
    const stats = {};

    // 1. Parent-station collapsing.
    const { stationStops, childToStation } = collapseParentStations(
        tables.stops,
    );
    stats.stopsRaw = tables.stops.length;
    stats.stationStops = stationStops.size;

    // 2. Route type filtering.
    const allowlist = normalizeAllowlist(feedConfig.routeTypes || [1]);
    const keptRoutes = filterRoutesByType(tables.routes, allowlist);
    const filteredCount = tables.routes.length - keptRoutes.length;
    stats.routesRaw = tables.routes.length;
    stats.routesKept = keptRoutes.length;
    stats.routesFiltered = filteredCount;

    // Build lookup tables.
    const keptRouteIds = new Set(keptRoutes.map((r) => r.route_id));
    const routesById = new Map(keptRoutes.map((r) => [r.route_id, r]));

    // Translations for nameEn.
    const nameEnMap = new Map();
    if (tables.translations) {
        for (const t of tables.translations) {
            if (
                t.table_name === "stops" &&
                t.field_name === "stop_name" &&
                t.language === "en"
            ) {
                nameEnMap.set(t.record_id, t.translation);
            }
        }
    }
    stats.hasTranslations = tables.translations
        ? tables.translations.length
        : 0;

    // Agency lookup for agency split.
    const routeAgencyMap = new Map();
    for (const route of keptRoutes) {
        if (route.agency_id)
            routeAgencyMap.set(route.route_id, route.agency_id);
    }

    // 3. Line grouping.
    const { lines: rawLines } = groupRoutesIntoLines(
        keptRoutes,
        feedConfig.lineGrouping || "route_id",
    );

    // Assign canonical line ids and colors.
    for (const line of rawLines) {
        line.id = createGtfsRouteId(feedConfig.namespace, line.anchorRouteId);
        // Color: first non-empty route_color from member routes.
        let color = null;
        for (const rid of line.routeIds) {
            const route = routesById.get(rid);
            if (route && route.route_color) {
                color = normalizeColor(route.route_color);
                break;
            }
        }
        line.color =
            color || normalizeColor(feedConfig.defaultColor || "#888888");
    }

    // Map route_id → line for station routeIds.
    const routeToLine = new Map();
    for (const line of rawLines) {
        for (const rid of line.routeIds) {
            routeToLine.set(rid, line);
        }
    }

    // 4. Build station records.
    // Filter trips to kept routes.
    const keptTrips = tables.trips.filter((t) => keptRouteIds.has(t.route_id));

    // Build station → set of line ids.
    const stationLineIds = new Map(); // stationStopId → Set<lineId>
    const stationRealStopIds = new Map(); // stationStopId → Set<real stop_id>
    for (const st of tables.stopTimes) {
        // Resolve child stop to parent station.
        const resolvedId = childToStation.get(st.stop_id) || st.stop_id;
        const stationId = childToStation.get(resolvedId) || resolvedId;

        // Find which station-level stop this belongs to.
        let stationStopId = stationId;
        if (!stationStops.has(stationStopId)) {
            // Walk up the childToStation chain.
            let cur = stationStopId;
            while (childToStation.has(cur)) {
                cur = childToStation.get(cur);
            }
            stationStopId = cur;
        }

        if (!stationStops.has(stationStopId)) continue;

        // Find the trip, check route.
        const trip = keptTrips.find((t) => t.trip_id === st.trip_id);
        if (!trip) continue;

        const line = routeToLine.get(trip.route_id);
        if (!line) continue;

        if (!stationLineIds.has(stationStopId)) {
            stationLineIds.set(stationStopId, new Set());
            stationRealStopIds.set(stationStopId, new Set());
        }
        stationLineIds.get(stationStopId).add(line.id);
        stationRealStopIds.get(stationStopId).add(resolvedId);
    }

    // Build station records.
    const stations = [];
    for (const [stopId, station] of stationStops) {
        const lineIds = stationLineIds.get(stopId);
        if (!lineIds || lineIds.size === 0) continue;

        const canonicalId = createGtfsStopId(feedConfig.namespace, stopId);

        stations.push({
            id: canonicalId,
            lat: station.lat,
            lon: station.lon,
            mergeKey: canonicalId, // canonical id = mergeKey (no coord suffix)
            name: station.name,
            routeIds: [...lineIds].sort(),
            nameEn: nameEnMap.get(stopId) || undefined,
        });
    }
    stats.stationsWithLines = stations.length;

    // 5. Route geometries.
    const geometries = buildRouteGeometries(
        tables.shapes,
        tables.stopTimes,
        tables.trips,
        tables.stops,
        keptRoutes,
        childToStation,
    );

    // Build route objects.
    const routes = rawLines.map((line) => {
        // Collect geometry from all member routes.
        const allCoords = [];
        for (const rid of line.routeIds) {
            const geo = geometries.get(rid);
            if (geo) allCoords.push(...geo);
        }

        return {
            id: line.id,
            name: line.name,
            color: line.color,
            sourceId: line.anchorRouteId,
            geometry: {
                type: "MultiLineString",
                coordinates: allCoords.length > 0 ? allCoords : [],
            },
        };
    });

    // 6. Agency split.
    const presets = splitByAgency(feedConfig, routeAgencyMap, routes, stations);

    // Build full preset objects.
    const result = presets.map((p) => {
        const presetStations = stations.filter((s) =>
            p.stationIds.includes(s.id),
        );
        const presetRoutes = routes.filter((r) => p.lineIds.includes(r.id));

        const allCoords = [
            ...presetStations.map((s) => [s.lon, s.lat]),
            ...presetRoutes.flatMap((r) => r.geometry.coordinates.flat()),
        ];

        const bbox = calculateBbox(allCoords);

        return {
            id: p.presetId,
            label: p.label,
            bbox,
            defaultColor: feedConfig.defaultColor || "#888888",
            routes: presetRoutes,
            stations: presetStations,
            source: {
                kind: "gtfs",
                namespace: feedConfig.namespace,
            },
        };
    });

    return { presets: result, stats };
}

// ─── Color normalization ────────────────────────────────────────────────────

export function normalizeColor(value, fallback) {
    if (!value) return fallback || "#888888";
    return value.startsWith("#") ? value : `#${value}`;
}

// ─── Bbox computation ───────────────────────────────────────────────────────

export function calculateBbox(coordinates) {
    if (coordinates.length === 0) return [0, 0, 0, 0];
    return coordinates.reduce(
        ([west, south, east, north], [lng, lat]) => [
            Math.min(west, lng),
            Math.min(south, lat),
            Math.max(east, lng),
            Math.max(north, lat),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
    );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getArray(map, key) {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
}

function getSet(map, key) {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
}

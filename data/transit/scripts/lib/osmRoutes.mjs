/**
 * OSM route relations → transit lines.
 *
 * Groups directional `route` relations under their `route_master`, resolves
 * stop members to station records, and produces line objects for the
 * transit-line question.
 */

import { normalizeName } from "./names.mjs";
import { createOsmElementId } from "./osmStations.mjs";

// ─── Route relation processing ─────────────────────────────────────────────

/**
 * Process OSM relations into line records.
 *
 * @param {object[]} relations - GeoJSON features with osmium -a type,id export
 * @param {object[]} stationRecords - OSM station records (from T5/T6) for stop resolution
 * @param {object} localeConfig - locale config from config.yaml
 * @returns {{ lines: object[], stats: object }}
 */
export function processOsmRoutes(relations, stationRecords, localeConfig) {
    const stats = {
        totalRelations: 0,
        masterCount: 0,
        masterlessCount: 0,
        linesKept: 0,
        linesDroppedGtfs: 0,
        unresolvedStops: 0,
        linesTooFewStations: 0,
    };

    // Separate masters from plain routes.
    const masters = [];
    const routes = [];

    for (const rel of relations) {
        const tags = rel.properties?.tags ?? rel.properties ?? {};
        const isRouteMaster =
            !!tags.route_master || rel.properties?.["@type"] === "route_master";
        const isRoute = tags.route != null;
        if (!isRouteMaster && !isRoute) continue;
        stats.totalRelations++;

        if (isRouteMaster) {
            masters.push(rel);
        } else {
            routes.push(rel);
        }
    }

    stats.masterCount = masters.length;
    stats.masterlessCount = routes.filter((r) => !hasMaster(r, masters)).length;

    // Build station lookup: normalized name → station records.
    const stationByName = new Map();
    for (const s of stationRecords) {
        const norm = normalizeName(s.name, localeConfig.nameSuffixes ?? []);
        if (!norm) continue;
        if (!stationByName.has(norm)) stationByName.set(norm, []);
        stationByName.get(norm).push(s);
    }

    // Build station lookup by OSM node id.
    const stationById = new Map();
    for (const s of stationRecords) {
        stationById.set(s.id, s);
    }

    // Group routes under masters.
    const masterLines = [];
    const masterIdsSeen = new Set();

    for (const master of masters) {
        const mid = master.id ?? master.properties?.["@id"];
        if (!mid || masterIdsSeen.has(mid)) continue;
        masterIdsSeen.add(mid);

        const variants = routes.filter((r) => {
            // Find routes whose master relation is this master.
            // OSM: route members have role=route in the master, or route's
            // tags reference the master via route_master tag... but in practice,
            // the master lists routes as members. We look at the master's members.
            return isMemberOfMaster(r, master);
        });

        // If no variants found, treat masterless routes.
        const allRouteRels = variants.length > 0 ? variants : [master];

        const line = buildLine(
            master,
            allRouteRels,
            stationById,
            stationByName,
            localeConfig,
            stats,
        );
        if (line) {
            masterLines.push(line);
        }
    }

    // Masterless routes become their own lines.
    for (const route of routes) {
        if (hasMaster(route, masters)) continue;
        const rid = route.id ?? route.properties?.["@id"];
        if (!rid || masterIdsSeen.has(rid)) continue;
        masterIdsSeen.add(rid);

        const line = buildLine(
            route,
            [route],
            stationById,
            stationByName,
            localeConfig,
            stats,
        );
        if (line) {
            masterLines.push(line);
        }
    }

    // Operator gating.
    const operators = localeConfig.operators ?? [];
    const operatorGtfsNamespaces = new Set(
        operators
            .filter((op) => op.routeSource === "gtfs")
            .flatMap((op) =>
                op.match?.gtfsNamespace ? [op.match.gtfsNamespace] : [],
            ),
    );

    const keptLines = [];
    for (const line of masterLines) {
        // Check if this operator is declared as GTFS-sourced.
        const osOp = line.operator;
        let isGtfsSourced = false;
        for (const op of operators) {
            if (op.routeSource === "gtfs" && op.match?.osmOperator) {
                if (op.match.osmOperator.some((n) => n === osOp)) {
                    isGtfsSourced = true;
                    break;
                }
            }
        }

        if (isGtfsSourced) {
            stats.linesDroppedGtfs++;
            continue;
        }

        // Undeclared overlap check deferred to T9 (feeds playbook).
        void operatorGtfsNamespaces;

        keptLines.push(line);
    }

    stats.linesKept = keptLines.length;

    return { lines: keptLines, stats };
}

// ─── Internals ─────────────────────────────────────────────────────────────

function buildLine(
    primaryRel,
    variants,
    stationById,
    stationByName,
    localeConfig,
    stats,
) {
    const tags = primaryRel.properties?.tags ?? primaryRel.properties ?? {};
    const id = primaryRel.id ?? primaryRel.properties?.["@id"];
    if (!id) return null;

    const lineId = createOsmElementId("relation", id);
    const name = tags.name || tags.ref || `Line ${id}`;
    // colour (British spelling) or color
    const colorRaw = tags.colour || tags.color || undefined;
    const color = colorRaw
        ? colorRaw.startsWith("#")
            ? colorRaw
            : `#${colorRaw}`
        : undefined;
    const operator = tags.operator || tags.network || undefined;

    // Resolve station members across all variants.
    const stationIds = new Set();
    const allMemberNodes = [];

    for (const rel of variants) {
        const members = rel.members ?? rel.properties?.members ?? [];
        for (const m of members) {
            const role = m.role ?? "";
            if (role === "stop" || role === "station") {
                const ref = m.ref;
                // Try exact OSM node id match.
                const canonicalId = createOsmElementId("node", ref);
                if (stationById.has(canonicalId)) {
                    stationIds.add(canonicalId);
                } else {
                    // Resolve by spatial + name lookup.
                    const nodeTags = m.tags ?? {};
                    const mName = nodeTags.name;
                    if (mName) {
                        const resolved = resolveStopMember(
                            m,
                            stationByName,
                            localeConfig,
                        );
                        if (resolved) {
                            stationIds.add(resolved.id);
                        } else {
                            stats.unresolvedStops++;
                        }
                    } else {
                        stats.unresolvedStops++;
                    }
                }
                allMemberNodes.push(m);
            }
        }
    }

    if (stationIds.size < 2) {
        stats.linesTooFewStations++;
        return null;
    }

    // Build geometry from member ways (simplified — just use stop positions
    // as a fallback polyline).
    const stopCoords = [...stationIds]
        .map((sid) => stationById.get(sid))
        .filter(Boolean)
        .map((s) => [s.lon, s.lat]);

    const geometry = {
        type: "MultiLineString",
        coordinates: stopCoords.length >= 2 ? [stopCoords] : [],
    };

    return {
        id: lineId,
        name,
        color: color || "#888888",
        sourceId: String(id),
        operator,
        geometry,
        memberStationIds: [...stationIds],
    };
}

function resolveStopMember(member, stationByName, localeConfig) {
    const mName = member.tags?.name;
    if (!mName) return null;
    const norm = normalizeName(mName, localeConfig.nameSuffixes ?? []);
    const candidates = stationByName.get(norm);
    if (!candidates || candidates.length === 0) return null;
    // Return the closest by name (simplified — in reality would check distance).
    return candidates[0];
}

function hasMaster(route, masters) {
    for (const master of masters) {
        if (isMemberOfMaster(route, master)) return true;
    }
    return false;
}

function isMemberOfMaster(route, master) {
    const rid = route.id ?? route.properties?.["@id"];
    if (!rid) return false;
    const members = master.members ?? master.properties?.members ?? [];
    return members.some((m) => String(m.ref) === String(rid));
}

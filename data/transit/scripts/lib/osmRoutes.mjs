/**
 * OSM route relations → transit lines.
 *
 * Groups directional `route` relations under their `route_master`, resolves
 * stop members to station records, and produces line objects for the
 * transit-line question.
 *
 * Through-service detection uses a way-overlap classifier
 * (classifyThroughServices): a line whose way members are (near) entirely
 * also used by other lines with different canonical keys is classified as a
 * through-service and dropped (unless its stations would be stranded, in
 * which case it is demoted to `_fallback` for gap-fill attachment).
 */

import { normalizeName } from "./names.mjs";
import { createOsmElementId } from "./osmStations.mjs";
import { haversineM } from "./grid.mjs";
import { detectImplausibleJumps, repairStopOrder } from "./stopOrderRepair.mjs";
import { buildOperatorNormalizer } from "./normalizeOperator.mjs";
import { stitchWays, attachStationsAlongLine } from "./wayStitch.mjs";
import { simplifyGeometry } from "./simplifyGeometry.mjs";

// ─── Route relation processing ─────────────────────────────────────────────

/**
 * Process OSM relations into line records.
 *
 * @param {object[]} relations - GeoJSON features with osmium -a type,id export
 * @param {object[]} stationRecords - OSM station records (from T5/T6) for stop resolution
 * @param {object} localeConfig - locale config from config.yaml
 * @param {Map<number, {lat: number, lon: number}>} [nodeCoords] - node id → coords
 * @param {Map<number, number[]>} [ways] - way id → ordered node refs (from extractOsmRoutes)
 * @returns {{ lines: object[], stats: object }}
 */
export function processOsmRoutes(
    relations,
    stationRecords,
    localeConfig,
    nodeCoords,
    ways,
) {
    const stats = {
        totalRelations: 0,
        masterCount: 0,
        masterlessCount: 0,
        linesKept: 0,
        linesDroppedGtfs: 0,
        linesDroppedUnopened: 0,
        unresolvedStops: 0,
        linesTooFewStations: 0,
        detectedJumps: 0,
        repairedStops: 0,
        unrepairableVariants: 0,
        ambiguousMatches: 0,
        weakMatches: 0,
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

        if (isUnopened(tags)) {
            stats.linesDroppedUnopened++;
            console.warn(
                `  [osmRoutes] Dropping unopened relation ${rel.id ?? rel.properties?.["@id"] ?? "?"} ` +
                    `(${tags.name || tags.ref || "unnamed"})`,
            );
            continue;
        }

        if (isRouteMaster) {
            masters.push(rel);
        } else {
            routes.push(rel);
        }
    }

    stats.masterCount = masters.length;
    stats.masterlessCount = routes.filter((r) => !hasMaster(r, masters)).length;

    // Drop the train service layer when railway infrastructure is active.
    // Keeps railway/tracks/subway/light_rail/monorail + their masters.
    const useRailway = !!localeConfig.useRailwayInfrastructure;
    let filteredMasters = masters;
    let filteredRoutes = routes;
    if (useRailway) {
        filteredMasters = masters.filter((m) => {
            const tags = m.properties?.tags ?? m.properties ?? {};
            const mt = tags.route_master;
            return mt !== "train";
        });
        filteredRoutes = routes.filter((r) => {
            const tags = r.properties?.tags ?? r.properties ?? {};
            const rt = tags.route;
            return rt !== "train";
        });
        // Update stats after filtering.
        stats.masterCount = filteredMasters.length;
        stats.masterlessCount = filteredRoutes.filter(
            (r) => !hasMaster(r, filteredMasters),
        ).length;
    }

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

    for (const master of filteredMasters) {
        const mid = master.id ?? master.properties?.["@id"];
        if (!mid || masterIdsSeen.has(mid)) continue;
        masterIdsSeen.add(mid);

        const variants = filteredRoutes.filter((r) => {
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
            nodeCoords,
            localeConfig.overrides?.relations,
            ways,
        );
        if (line) {
            line.isMastered = true;
            masterLines.push(line);
        }
    }

    // Masterless routes become their own lines.
    for (const route of filteredRoutes) {
        if (hasMaster(route, filteredMasters)) continue;
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
            nodeCoords,
            localeConfig.overrides?.relations,
            ways,
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

    // ─── Two-pass operator inference ────────────────────────────────────
    //
    // Many OSM route relations set `network` but omit `operator`.  Use
    // lines that DO have operators to infer operators for lines that don't.

    const networkNames = localeConfig.networkNames || {};

    // Pass 1: collect operator data from lines with real (non-network)
    //         operators.
    /** @type {Map<string, Map<string, number>>} network → (operator → count) */
    const networkOperatorVotes = new Map();
    /** @type {Map<string, Map<string, number>>} stationId → (operator → count) */
    const stationOperatorVotes = new Map();

    for (const line of keptLines) {
        const isNetworkFallback =
            line.networkTag && line.operator === line.networkTag;
        if (isNetworkFallback || !line.operator) continue;

        // Contribute to network → operator map.
        if (line.networkTag) {
            if (!networkOperatorVotes.has(line.networkTag)) {
                networkOperatorVotes.set(line.networkTag, new Map());
            }
            const netVotes = networkOperatorVotes.get(line.networkTag);
            netVotes.set(line.operator, (netVotes.get(line.operator) || 0) + 1);
        }

        // Contribute to station → operator map.
        for (const sid of line.memberStationIds) {
            if (!stationOperatorVotes.has(sid)) {
                stationOperatorVotes.set(sid, new Map());
            }
            const stVotes = stationOperatorVotes.get(sid);
            stVotes.set(line.operator, (stVotes.get(line.operator) || 0) + 1);
        }
    }

    // Resolve network → canonical operator (most-voted operator per network).
    /** @type {Map<string, string>} */
    const networkToOperator = new Map();
    for (const [network, votes] of networkOperatorVotes) {
        let bestOp = null;
        let bestCount = 0;
        for (const [op, count] of votes) {
            if (count > bestCount) {
                bestCount = count;
                bestOp = op;
            }
        }
        if (bestOp) networkToOperator.set(network, bestOp);
    }

    // Pass 2: infer operators for lines whose operator came from the
    //         network fallback (or is missing entirely).
    for (const line of keptLines) {
        const isNetworkFallback =
            line.networkTag && line.operator === line.networkTag;
        const isMissing = !line.operator;
        if (!isNetworkFallback && !isMissing) continue;

        let inferred = null;

        // 1. Network peer inference (other lines in same network).
        if (line.networkTag) {
            inferred = networkToOperator.get(line.networkTag);
        }

        // 2. Config-driven network → operator override.
        if (!inferred && line.networkTag) {
            inferred = networkNames[line.networkTag] || null;
        }

        // 3. Station majority vote.
        if (!inferred) {
            /** @type {Map<string, number>} */
            const votes = new Map();
            for (const sid of line.memberStationIds) {
                const stOps = stationOperatorVotes.get(sid);
                if (stOps) {
                    for (const [op, count] of stOps) {
                        votes.set(op, (votes.get(op) || 0) + count);
                    }
                }
            }
            let bestOp = null;
            let bestCount = 0;
            for (const [op, count] of votes) {
                if (count > bestCount) {
                    bestCount = count;
                    bestOp = op;
                }
            }
            inferred = bestOp;
        }

        if (inferred) {
            line.operator = inferred;
        }
    }

    // ─── Clean multi-operator tags ──────────────────────────────────────
    // OSM allows semicolon-joined operator values (e.g.
    // "JR East;Tokyo Metro") when multiple operators run trains on the
    // same physical line. We canonicalize to the owning operator by
    // taking the first ";"-part. Through-services are detected later by
    // the way-overlap classifier (classifyThroughServices).
    {
        let cleanedCount = 0;
        for (const line of keptLines) {
            if (line.operator && line.operator.includes(";")) {
                line.operator = line.operator.split(";")[0].trim();
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            console.log(
                `[osmRoutes] Cleaned ${cleanedCount} multi-operator line(s)`,
            );
        }
    }

    const operatorNames = localeConfig.operatorNames || {};
    const normalizeOp = buildOperatorNormalizer(operatorNames);
    const directionTokens = localeConfig.directionTokens;

    const collapsed = [];
    /** @type {Map<string, object[]>} */
    const masterlessGroups = new Map();

    for (const line of keptLines) {
        if (line.isMastered) {
            collapsed.push(line);
            continue;
        }
        const op = normalizeOp(line.operator) || line.operator || "_none";
        const key = `${op}|${lineNameKey(line.name, directionTokens)}`;
        if (!masterlessGroups.has(key)) masterlessGroups.set(key, []);
        masterlessGroups.get(key).push(line);
    }

    for (const [, group] of masterlessGroups) {
        if (group.length === 1) {
            collapsed.push(group[0]);
            continue;
        }

        // Prefer the variant with the most resolved stations; tie-break by OSM color.
        const sorted = [...group].sort((a, b) => {
            const diff = b.memberStationIds.length - a.memberStationIds.length;
            if (diff !== 0) return diff;
            if (a.color && !b.color) return -1;
            if (!a.color && b.color) return 1;
            return 0;
        });
        const representative = sorted[0];

        // Union member station ids across all variants.
        const memberSet = new Set();
        const waySet = new Set();
        for (const line of group) {
            for (const sid of line.memberStationIds) memberSet.add(sid);
            if (line.wayIds) {
                for (const wid of line.wayIds) waySet.add(wid);
            }
        }

        collapsed.push({
            ...representative,
            name:
                lineDisplayName(representative.name, directionTokens) ||
                representative.name,
            memberStationIds: [...memberSet],
            wayIds: [...waySet],
            _hasPassengerTag:
                representative._hasPassengerTag ||
                group.some((l) => l._hasPassengerTag),
            collapsedVariantIds: group.map((l) => l.id),
        });
        stats.collapsedGroups = (stats.collapsedGroups || 0) + 1;
    }

    keptLines.length = 0;
    keptLines.push(...collapsed);

    // ─── Through-service classification (way-overlap) ───────────────────
    // Detects inter-operator through-service relations by measuring how
    // much of a line's track (way members) is also used by other lines
    // with different canonical keys. A line contributing ≈ zero unique
    // track is a through-service — it duplicates other lines' coverage.
    const throughServiceConfig = {
        overlap: localeConfig.throughServiceOverlap ?? 0.9,
        minWays: localeConfig.minThroughServiceWays ?? 3,
        directionTokens,
    };
    const classifyResult = classifyThroughServices(
        keptLines,
        normalizeOp,
        throughServiceConfig,
    );
    if (classifyResult.throughServiceIds.size > 0) {
        const before = keptLines.length;
        const dropped = keptLines.filter(
            (l) => !classifyResult.throughServiceIds.has(l.id),
        );
        keptLines.length = 0;
        keptLines.push(...dropped);
        stats.throughServicesDropped = before - keptLines.length;
        console.log(
            `[osmRoutes] Dropped ${stats.throughServicesDropped} through-service line(s) (way-overlap classifier)`,
        );
    }
    if (classifyResult.strandedFallbackIds.size > 0) {
        for (const line of keptLines) {
            if (classifyResult.strandedFallbackIds.has(line.id)) {
                line._fallback = true;
            }
        }
        stats.strandedFallback = classifyResult.strandedFallbackIds.size;
        console.log(
            `[osmRoutes] ${stats.strandedFallback} through-service line(s) demoted to fallback (station safety net)`,
        );
    }

    // Resolve final colors: OSM tag → transitOverrides.routeColors →
    // deterministic hue fallback.
    const routeColors = localeConfig.routeColors || {};
    for (const line of keptLines) {
        line.color = resolveLineColor(line, routeColors);
    }

    stats.linesKept = keptLines.length;

    return { lines: keptLines, stats };
}

/**
 * Classify through-service lines by way overlap.
 *
 * A through-service is a journey stitched across other lines' physical track.
 * Since wayGeometry:true resolves each line's OSM way members, the discriminator
 * is locale-free and tag-free: a line is a through-service when (near) all of
 * its way members are also members of other route relations that resolve to a
 * different canonical line — i.e. it contributes ≈ zero unique track.
 *
 * Way overlap alone is symmetric (a through-service and the physical line it
 * runs on both see each other's ways). To break the tie, lines tagged with
 * the OSM `passenger` key (suburban, regional, long_distance, local) are
 * treated as service patterns; lines without it are treated as physical
 * infrastructure. This two-signal gate (overlap + passenger) avoids the v1
 * false-positive on European cross-border lines: those have `passenger` but
 * own unique track, so their overlap ratio stays below threshold.
 *
 * Lines with zero way members (stop-position fallbacks) are never classified.
 * Lines whose stations would be stranded (no coverage from kept lines) are
 * demoted to `_fallback` rather than dropped — the safety net.
 *
 * @param {object[]} lines - kept lines with wayIds and _hasPassengerTag
 * @param {(raw: string|null|undefined) => string|null} normalizeOp - operator normalizer
 * @param {{ overlap?: number, minWays?: number, directionTokens?: string[] }} opts
 * @returns {{ throughServiceIds: Set<string>, strandedFallbackIds: Set<string> }}
 */
export function classifyThroughServices(lines, normalizeOp, opts = {}) {
    const OVERLAP_THRESHOLD = opts.overlap ?? 0.9;
    const MIN_WAYS = opts.minWays ?? 3;
    const directionTokens = opts.directionTokens;

    // Build canonical key for each line (same key as collapse).
    /** @type {Map<string, string>} line id → canonical key */
    const lineKey = new Map();
    for (const line of lines) {
        const op = normalizeOp(line.operator) || line.operator || "_none";
        const key = `${op}|${lineNameKey(line.name, directionTokens)}`;
        lineKey.set(line.id, key);
    }

    // Build way → owners index.
    /** @type {Map<number, Set<string>>} */
    const wayOwners = new Map();
    for (const line of lines) {
        if (!line.wayIds || line.wayIds.length === 0) continue;
        const key = lineKey.get(line.id);
        for (const wid of line.wayIds) {
            if (!wayOwners.has(wid)) wayOwners.set(wid, new Set());
            wayOwners.get(wid).add(key);
        }
    }

    // Score each line and classify.
    // Only classify lines that (a) have high way overlap AND (b) carry a
    // `passenger` tag. The passenger tag is the tiebreaker that resolves
    // the symmetry between a physical line and its through-service: both
    // see each other's ways, but only the through-service has passenger.
    const throughServiceIds = new Set();

    for (const line of lines) {
        const n = line.wayIds?.length ?? 0;
        if (n < MIN_WAYS) continue;

        // Only classify lines with a passenger tag — they're service
        // patterns, not physical infrastructure. Physical lines that
        // share track with through-services are NOT classified.
        if (!line._hasPassengerTag) continue;

        const ownKey = lineKey.get(line.id);
        let sharedForeign = 0;
        for (const wid of line.wayIds) {
            const owners = wayOwners.get(wid);
            if (!owners) continue;
            // Does any owner key differ from this line's own key?
            for (const ownerKey of owners) {
                if (ownerKey !== ownKey) {
                    sharedForeign++;
                    break;
                }
            }
        }

        const overlapRatio = sharedForeign / n;
        if (overlapRatio >= OVERLAP_THRESHOLD) {
            throughServiceIds.add(line.id);
        }
    }

    // Safety net: never strand a station.
    // If a through-service covers a station that no kept line reaches,
    // demote it to fallback instead of dropping.
    const strandedFallbackIds = new Set();
    const keptLines = lines.filter((l) => !throughServiceIds.has(l.id));

    /** @type {Map<string, number>} station id → count of kept lines covering it */
    const stationCoverage = new Map();
    for (const line of keptLines) {
        for (const sid of line.memberStationIds) {
            stationCoverage.set(sid, (stationCoverage.get(sid) || 0) + 1);
        }
    }

    for (const line of lines) {
        if (!throughServiceIds.has(line.id)) continue;
        let wouldStrand = false;
        for (const sid of line.memberStationIds) {
            if (!stationCoverage.has(sid)) {
                wouldStrand = true;
                break;
            }
        }
        if (wouldStrand) {
            strandedFallbackIds.add(line.id);
            throughServiceIds.delete(line.id);
        }
    }

    return { throughServiceIds, strandedFallbackIds };
}

// ─── Internals ─────────────────────────────────────────────────────────────

/**
 * Return true if a relation is tagged as not in service (under construction,
 * proposed, or disused). These relations are dropped before line building.
 *
 * @param {object} tags
 * @returns {boolean}
 */
function isUnopened(tags) {
    if (tags["construction:route"] != null) return true;
    if (tags.route === "construction") return true;
    if (tags["proposed:route"] != null) return true;
    if (tags.route === "proposed") return true;
    if (tags["disused:route"] != null) return true;
    if (tags.route === "disused") return true;
    const state = tags.state;
    if (state === "construction" || state === "proposed") return true;
    return false;
}

function buildLine(
    primaryRel,
    variants,
    stationById,
    stationByName,
    localeConfig,
    stats,
    nodeCoords,
    relationOverrides = {},
    ways,
) {
    const tags = primaryRel.properties?.tags ?? primaryRel.properties ?? {};
    const id = primaryRel.id ?? primaryRel.properties?.["@id"];
    if (!id) return null;

    const lineId = createOsmElementId("relation", id);
    const name = tags.name || tags.ref || `Line ${id}`;
    // colour (British spelling) or color — validate as hex; drop CSS names
    const colorRaw = tags.colour || tags.color || undefined;
    const colorCandidate = colorRaw
        ? colorRaw.startsWith("#")
            ? colorRaw
            : `#${colorRaw}`
        : undefined;
    const color =
        colorCandidate && /^#[0-9a-fA-F]{3,8}$/.test(colorCandidate)
            ? colorCandidate
            : undefined;
    // Prefer the primary relation's operator.  Fall back to the first
    // variant that has one — many route_masters omit the operator tag
    // but set it on the directional variants (e.g. Keihin-Tōhoku Line).
    let operator = tags.operator || tags.network || undefined;
    if (!operator || operator === tags.network) {
        for (const rel of variants) {
            const vt = rel.properties?.tags ?? rel.properties ?? {};
            if (vt.operator) {
                operator = vt.operator;
                break;
            }
        }
    }

    // Resolve station members per variant — each variant produces one
    // ordered station list, giving one LineString segment in the output
    // MultiLineString.  This keeps branches (e.g. Utsunomiya vs Yokosuka
    // on the Shōnan–Shinjuku Line) as separate segments instead of
    // interleaving all stops into one polyline with wild jumps.
    const allStationIds = new Set();
    const branchLines = [];

    for (const rel of variants) {
        const relId = rel.id ?? rel.properties?.["@id"];
        const members = rel.members ?? rel.properties?.members ?? [];
        const variantStationIds = [];

        for (const m of members) {
            const role = m.role ?? "";
            if (role !== "stop" && role !== "station") continue;

            const ref = m.ref;
            let resolvedId = null;

            // Try exact OSM node id match.
            const canonicalId = createOsmElementId("node", ref);
            if (stationById.has(canonicalId)) {
                resolvedId = canonicalId;
            } else if (
                nodeCoords &&
                nodeCoords.has(
                    typeof ref === "number" ? ref : parseInt(ref, 10),
                )
            ) {
                // Spatial fallback: the stop node (often a stop_position)
                // isn't in the station cache but we have its coordinates.
                // Pick the closest station within range.
                const nid = typeof ref === "number" ? ref : parseInt(ref, 10);
                const nc = nodeCoords.get(nid);
                const maxDist = (localeConfig.maxClusterMeters ?? 150) * 2;
                let bestEffectiveDist = Infinity;
                let bestStationId = null;
                let bestRawDist = Infinity;
                let secondBestEffectiveDist = Infinity;
                let secondBestStationId = null;
                for (const station of stationById.values()) {
                    if (!station.name) continue;
                    const dist = haversineM(
                        nc.lat,
                        nc.lon,
                        station.lat,
                        station.lon,
                    );
                    if (dist >= maxDist) continue;
                    const railway = station.tags?.railway;
                    const penalty =
                        railway === "station"
                            ? 0
                            : railway === "halt"
                              ? 25
                              : 50;
                    const effectiveDist = dist + penalty;
                    if (effectiveDist < bestEffectiveDist) {
                        secondBestEffectiveDist = bestEffectiveDist;
                        secondBestStationId = bestStationId;
                        bestEffectiveDist = effectiveDist;
                        bestStationId = station.id;
                        bestRawDist = dist;
                    } else if (effectiveDist < secondBestEffectiveDist) {
                        secondBestEffectiveDist = effectiveDist;
                        secondBestStationId = station.id;
                    }
                }
                if (bestStationId) {
                    resolvedId = bestStationId;

                    // Ambiguous: second-best is within 10% of best (R10).
                    if (
                        secondBestStationId !== null &&
                        secondBestEffectiveDist <= bestEffectiveDist * 1.1
                    ) {
                        stats.ambiguousMatches++;
                        console.warn(
                            `  [osmRoutes] Ambiguous spatial match for relation ${relId || "?"} ` +
                                `stop node ${nid}: best=${bestStationId} (${bestEffectiveDist.toFixed(0)}m), ` +
                                `second=${secondBestStationId} (${secondBestEffectiveDist.toFixed(0)}m)`,
                        );
                    }

                    // Weak: best raw distance is near the max threshold (>80%) (R10).
                    if (bestRawDist > maxDist * 0.8) {
                        stats.weakMatches++;
                        console.warn(
                            `  [osmRoutes] Weak spatial match for relation ${relId || "?"} ` +
                                `stop node ${nid}: ${bestStationId} at ${bestRawDist.toFixed(0)}m ` +
                                `(threshold ${maxDist}m)`,
                        );
                    }
                } else {
                    stats.unresolvedStops++;
                }
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
                        resolvedId = resolved.id;
                    } else {
                        stats.unresolvedStops++;
                    }
                } else {
                    stats.unresolvedStops++;
                }
            }

            if (resolvedId) {
                variantStationIds.push(resolvedId);
                allStationIds.add(resolvedId);
            }
        }

        // Apply explicit stop-order override if present.
        const relOverride = relId
            ? relationOverrides[String(relId)]
            : undefined;
        if (relOverride?.stopOrder) {
            const matched = relOverride.stopOrder.filter((sid) =>
                variantStationIds.includes(sid),
            ).length;
            if (matched === 0) {
                console.warn(
                    `  [osmRoutes] Stale stopOrder override for relation ${relId}: ` +
                        `none of the ${relOverride.stopOrder.length} specified IDs matched resolved stops`,
                );
            } else if (matched < relOverride.stopOrder.length) {
                console.warn(
                    `  [osmRoutes] Partial stopOrder override for relation ${relId}: ` +
                        `${matched}/${relOverride.stopOrder.length} specified IDs matched`,
                );
            }

            const ordered = [];
            for (const sid of relOverride.stopOrder) {
                if (variantStationIds.includes(sid)) {
                    ordered.push(sid);
                }
            }
            for (const sid of variantStationIds) {
                if (!ordered.includes(sid)) ordered.push(sid);
            }
            variantStationIds.length = 0;
            variantStationIds.push(...ordered);
        }

        // Stop-order detection and repair.
        // Dedupe consecutive duplicate station ids (R6) before repair.
        const dedupedStationIds = [];
        for (const sid of variantStationIds) {
            if (dedupedStationIds[dedupedStationIds.length - 1] !== sid) {
                dedupedStationIds.push(sid);
            }
        }

        const variantStops = dedupedStationIds
            .map((sid) => {
                const s = stationById.get(sid);
                return s ? { id: sid, lat: s.lat, lon: s.lon } : null;
            })
            .filter(Boolean);

        if (variantStops.length >= 3) {
            const flagged = detectImplausibleJumps(variantStops);
            if (flagged.length > 0) {
                // detectedJumps counts flagged gaps, not variants (one variant can
                // have several flagged gaps).
                if (!relOverride?.suppressJumpWarning) {
                    stats.detectedJumps += flagged.length;
                }

                if (relOverride?.suppressJumpWarning) {
                    // Silently skip repair and warning.
                } else if (relOverride?.stopOrder) {
                    // Human-specified order is highest authority; warn only (R3).
                    console.warn(
                        `  [osmRoutes] Stop-order warning for relation ${relId || "?"}: ` +
                            `explicit stopOrder still has ${flagged.length} flagged gap(s)`,
                    );
                } else {
                    const repairResult = repairStopOrder(variantStops, {
                        maxRepairs: 3,
                    });
                    if (repairResult.repaired) {
                        stats.repairedStops += repairResult.repairsDone;
                        variantStationIds.length = 0;
                        variantStationIds.push(
                            ...repairResult.stops.map((s) => s.id),
                        );
                        console.warn(
                            `  [osmRoutes] Repaired stop order for relation ${relId || "?"} ` +
                                `(${repairResult.repairsDone} reinsertion(s))`,
                        );
                    } else {
                        stats.unrepairableVariants++;
                    }
                    for (const w of repairResult.warnings) {
                        console.warn(
                            `  [osmRoutes] Stop-order warning for relation ${relId || "?"}: ${w}`,
                        );
                    }
                }
            }
        }

        // Build one LineString for this variant's ordered stops.
        if (variantStationIds.length >= 2) {
            const coords = [];
            for (const sid of variantStationIds) {
                const s = stationById.get(sid);
                if (!s) continue;
                const c = [s.lon, s.lat];
                // Deduplicate consecutive identical coordinates.
                const last = coords[coords.length - 1];
                if (last && last[0] === c[0] && last[1] === c[1]) continue;
                coords.push(c);
            }
            if (coords.length >= 2) {
                branchLines.push(coords);
            }
        }
    }

    // Way-stitch geometry from the *variants'* track ways. The master
    // relation itself carries only incidental/connector ways (not the real
    // line), so reading primaryRel.members would stitch junk and override the
    // good geometry — gather from variants instead. Dedupe by way id so a
    // bidirectional way shared by both directional variants isn't doubled.
    let geometry;
    const wayMembers = [];
    const seenWayRefs = new Set();
    for (const rel of variants) {
        const mems = rel.members ?? rel.properties?.members ?? [];
        for (const m of mems) {
            if (m.type !== "way") continue;
            const ref = typeof m.ref === "number" ? m.ref : parseInt(m.ref, 10);
            if (!Number.isFinite(ref) || seenWayRefs.has(ref)) continue;
            seenWayRefs.add(ref);
            wayMembers.push({ ref });
        }
    }

    if (ways && wayMembers.length > 0 && localeConfig.wayGeometry !== false) {
        const stitched = stitchWays(wayMembers, ways, nodeCoords);
        if (stitched.coordinates.length > 0) {
            const simplifyMeters =
                localeConfig.simplifyMeters != null
                    ? localeConfig.simplifyMeters
                    : (localeConfig.transitOverrides?.simplifyMeters ?? 11);
            geometry =
                simplifyMeters > 0
                    ? simplifyGeometry(stitched, simplifyMeters)
                    : stitched;

            // Spatial attach: pull in stations near the stitched track that
            // aren't already resolved as stop members. This is what gives
            // 0-stop infrastructure lines (e.g. 縱貫線/宜蘭線) their stations.
            const attachMeters = localeConfig.railwayAttachMeters ?? 120;
            const spatialIds = attachStationsAlongLine(
                geometry,
                stationById,
                attachMeters,
                allStationIds,
            );
            for (const sid of spatialIds) {
                allStationIds.add(sid);
            }
        }
    }

    // A line needs >= 2 member stations (resolved stops or spatial attaches).
    // Runs AFTER stitch+attach so way-only lines survive on spatial members.
    if (allStationIds.size < 2) {
        stats.linesTooFewStations++;
        return null;
    }

    // Fall back to the stop-position polyline if no way geometry was built.
    if (!geometry) {
        geometry = {
            type: "MultiLineString",
            coordinates: branchLines,
        };
    }

    // Discard lines whose geometry collapsed to nothing. This can happen when
    // stop-position resolution finds stations but every variant has fewer than
    // two distinct coordinates (e.g. a long-distance route touching only one
    // station inside the region).
    const parts =
        geometry.type === "LineString"
            ? [geometry.coordinates]
            : geometry.type === "MultiLineString"
              ? geometry.coordinates
              : [];
    if (
        parts.length === 0 ||
        parts.every((part) => !Array.isArray(part) || part.length < 2)
    ) {
        stats.linesEmptyGeometry = (stats.linesEmptyGeometry || 0) + 1;
        return null;
    }

    // Capture way member ids for through-service classification.
    const wayIds = wayMembers
        .map((m) => m.ref)
        .filter((ref) => Number.isFinite(ref));

    return {
        id: lineId,
        name,
        color: color || undefined,
        sourceId: String(id),
        operator,
        /** Raw network tag — preserved for two-pass operator inference. */
        networkTag: tags.network || undefined,
        geometry,
        memberStationIds: [...allStationIds],
        /** Way member ids for through-service overlap detection. */
        wayIds,
        /** True when the original OSM relation had a `passenger` tag
         *  (values like suburban, regional, long_distance, local).
         *  Used by classifyThroughServices as a tiebreaker: lines with
         *  passenger tags that overlap other lines' track are through-
         *  services; lines without that share track are physical. */
        _hasPassengerTag: !!tags.passenger,
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

const DEFAULT_DIRECTION_TOKENS = [
    "順向",
    "逆向",
    "上り",
    "下り",
    "往程",
    "返程",
    "西向",
    "東向",
    "北向",
    "南向",
    "順行",
    "逆行",
    "inbound",
    "outbound",
];

/**
 * Returns true if the string contains CJK characters.
 *
 * @param {string} s
 * @returns {boolean}
 */
function hasCjk(s) {
    return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(s);
}

/**
 * Normalizes a line name into a stable lookup key.
 *
 * Strips direction tokens, parenthetical notes, arrows, trailing dash
 * suffixes, and stand-alone numbers. Collapses whitespace and removes
 * leading/trailing dashes left behind by direction-token stripping
 * (e.g. `"Red Line - Inbound"` → `"red line"`).
 *
 * Note: CJK direction tokens are stripped as substrings (no word boundaries),
 * so multi-character tokens are safe but single-character tokens may over-strip.
 *
 * @param {string} name - raw line name
 * @param {string[]} [tokens] - direction tokens to strip
 * @returns {string}
 */
export function lineNameKey(name, tokens = DEFAULT_DIRECTION_TOKENS) {
    if (!name || typeof name !== "string") return "";
    let key = name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
    key = key.replace(/[（(][^）)]+[）)]/gu, " ").trim();
    // Strip trailing direction arrows. When an arrow is preceded by whitespace,
    // remove that whole token too (station names like "南港→左營"); otherwise
    // only remove the arrow and what follows (e.g. "A→B"). For dash suffixes
    // like "-North", preserve the word before the dash.
    const ARROW_RE = /(?:[→⇒←⇐↔]|->)/u;
    key = key
        .replace(new RegExp(`\\s+\\S*?${ARROW_RE.source}.*$`, "u"), " ")
        .trim();
    key = key.replace(new RegExp(`${ARROW_RE.source}.*$`, "u"), " ").trim();
    for (const token of tokens) {
        if (!token) continue;
        const escaped = token
            .toLowerCase()
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (hasCjk(token)) {
            key = key.replace(new RegExp(escaped, "gu"), " ").trim();
        } else {
            key = key.replace(new RegExp(`\\b${escaped}\\b`, "gu"), " ").trim();
        }
    }

    const DASH_DIRECTION_SUFFIXES = [
        "north",
        "south",
        "east",
        "west",
        "inbound",
        "outbound",
        "北",
        "南",
        "東",
        "西",
    ];
    const dashSuffixPattern = DASH_DIRECTION_SUFFIXES.map((s) =>
        s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("|");
    key = key
        .replace(new RegExp(`\\s*-\\s*(${dashSuffixPattern})$`, "iu"), " ")
        .trim();

    key = key.replace(/\b\d+\b/gu, " ").trim();
    // Remove leading/trailing standalone dashes left after token stripping
    // (e.g. "Red Line - Inbound" would otherwise end as "red line -").
    key = key.replace(/(^\s*-\s*|\s+-\s*$)/gu, " ").trim();
    key = key.replace(/\s+/g, " ").trim();
    return key;
}

/**
 * Strip direction tokens, arrows, and train numbers from a line name while
 * preserving the original casing. Used for the display name of a collapsed
 * logical line.
 *
 * @param {string} name - raw line name
 * @param {string[]} [tokens] - direction tokens to strip
 * @returns {string}
 */
export function lineDisplayName(name, tokens = DEFAULT_DIRECTION_TOKENS) {
    if (!name || typeof name !== "string") return "";
    let key = name.replace(/\s+/g, " ").trim();
    key = key.replace(/[（(][^）)]+[）)]/gu, " ").trim();

    const ARROW_RE = /(?:[→⇒←⇐↔]|->)/u;
    key = key
        .replace(new RegExp(`\\s+\\S*?${ARROW_RE.source}.*$`, "u"), " ")
        .trim();
    key = key.replace(new RegExp(`${ARROW_RE.source}.*$`, "u"), " ").trim();

    for (const token of tokens) {
        if (!token) continue;
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (hasCjk(token)) {
            key = key.replace(new RegExp(escaped, "gu"), " ").trim();
        } else {
            key = key
                .replace(new RegExp(`\\b${escaped}\\b`, "giu"), " ")
                .trim();
        }
    }

    const DASH_DIRECTION_SUFFIXES = [
        "north",
        "south",
        "east",
        "west",
        "inbound",
        "outbound",
        "北",
        "南",
        "東",
        "西",
    ];
    const dashSuffixPattern = DASH_DIRECTION_SUFFIXES.map((s) =>
        s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("|");
    key = key
        .replace(new RegExp(`\\s*-\\s*(${dashSuffixPattern})$`, "iu"), " ")
        .trim();

    key = key.replace(/\b\d+\b/gu, " ").trim();
    key = key.replace(/(^\s*-\s*|\s+-\s*$)/gu, " ").trim();
    key = key.replace(/\s+/g, " ").trim();
    return key;
}

/**
 * Convert HSL values to a 6-digit hex color string.
 *
 * @param {number} h - hue in degrees [0, 360)
 * @param {number} s - saturation in percent [0, 100]
 * @param {number} l - lightness in percent [0, 100]
 * @returns {string}
 */
function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;
    let r = 0,
        g = 0,
        b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const toHex = (v) =>
        Math.round((v + m) * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Deterministically map a string to a hue in degrees.
 *
 * @param {string} input
 * @returns {number} hue in [0, 360)
 */
function hashHue(input) {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
}

/**
 * Resolve a stable color for a transit line.
 *
 * Prefers the OSM `colour`/`color` tag, then a configured `routeColors`
 * lookup (by line key or operator), then a deterministic HSL fallback.
 *
 * @param {object} line - line record with `name`, optional `color` and `operator`
 * @param {Record<string, string>} [routeColors] - configured color overrides
 * @returns {string} hex color string
 */
export function resolveLineColor(line, routeColors = {}) {
    if (line.color) return line.color;
    const key = lineNameKey(line.name);
    if (routeColors[key]) return routeColors[key];
    if (line.operator && routeColors[line.operator])
        return routeColors[line.operator];
    return hslToHex(hashHue(key || line.name || line.id || "x"), 65, 45);
}

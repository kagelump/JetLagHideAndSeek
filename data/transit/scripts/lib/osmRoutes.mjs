/**
 * OSM route relations → transit lines.
 *
 * Groups directional `route` relations under their `route_master`, resolves
 * stop members to station records, and produces line objects for the
 * transit-line question.
 */

import { normalizeName } from "./names.mjs";
import { createOsmElementId } from "./osmStations.mjs";
import { haversineM } from "./grid.mjs";
import { detectImplausibleJumps, repairStopOrder } from "./stopOrderRepair.mjs";

// ─── Route relation processing ─────────────────────────────────────────────

/**
 * Process OSM relations into line records.
 *
 * @param {object[]} relations - GeoJSON features with osmium -a type,id export
 * @param {object[]} stationRecords - OSM station records (from T5/T6) for stop resolution
 * @param {object} localeConfig - locale config from config.yaml
 * @returns {{ lines: object[], stats: object }}
 */
export function processOsmRoutes(
    relations,
    stationRecords,
    localeConfig,
    nodeCoords,
) {
    const stats = {
        totalRelations: 0,
        masterCount: 0,
        masterlessCount: 0,
        linesKept: 0,
        linesDroppedGtfs: 0,
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
            nodeCoords,
            localeConfig.overrides?.relations,
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
            nodeCoords,
            localeConfig.overrides?.relations,
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
    nodeCoords,
    relationOverrides = {},
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
                const matchCandidates = [];
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
                    matchCandidates.push({
                        stationId: station.id,
                        effectiveDist,
                        dist,
                    });
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

    if (allStationIds.size < 2) {
        stats.linesTooFewStations++;
        return null;
    }

    const geometry = {
        type: "MultiLineString",
        coordinates: branchLines,
    };

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

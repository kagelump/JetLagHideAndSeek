/**
 * Way stitching — chain OSM way members into ordered LineStrings.
 *
 * Given an array of way members (with `ref` and `direction`) and a
 * wayId→[nodeRef…] map plus a nodeCoords map, stitch ways into a
 * GeoJSON MultiLineString. Ways are chained by shared endpoints;
 * gaps produce separate segments. Never throws — degenerate input
 * yields empty coordinates.
 *
 * @module wayStitch
 */

/**
 * Stitch way members into a GeoJSON MultiLineString geometry.
 *
 * @param {object[]} wayMembers - relation members with type="way" (each has `ref` and optional `role`)
 * @param {Map<number, number[]>} ways - wayId → ordered [nodeRef, …]
 * @param {Map<number, {lat: number, lon: number}>} nodeCoords - nodeRef → coords
 * @returns {{ type: "MultiLineString", coordinates: number[][][] }}
 */
export function stitchWays(wayMembers, ways, nodeCoords) {
    if (!wayMembers || wayMembers.length === 0 || !ways || !nodeCoords) {
        return { type: "MultiLineString", coordinates: [] };
    }

    // Resolve each way member to an ordered list of [lon, lat] coordinates.
    const resolvedWays = [];
    for (const member of wayMembers) {
        const wayId =
            typeof member.ref === "number"
                ? member.ref
                : parseInt(member.ref, 10);
        const nodeRefs = ways.get(wayId);
        if (!nodeRefs || nodeRefs.length < 2) continue;

        const coords = [];
        for (const nid of nodeRefs) {
            const c = nodeCoords.get(nid);
            if (c) coords.push([c.lon, c.lat]);
        }
        if (coords.length >= 2) {
            resolvedWays.push(coords);
        }
    }

    if (resolvedWays.length === 0) {
        return { type: "MultiLineString", coordinates: [] };
    }

    if (resolvedWays.length === 1) {
        return { type: "MultiLineString", coordinates: [resolvedWays[0]] };
    }

    // Chain ways by matching endpoints.
    // Track which ways have been used.
    const used = new Set();
    const segments = [];

    function coordsMatch(a, b) {
        return a[0] === b[0] && a[1] === b[1];
    }

    function reverseCoords(coords) {
        return [...coords].reverse();
    }

    // Try to extend a chain from the given way index.
    function tryExtend(chain, wayIdx) {
        used.add(wayIdx);
        const way = resolvedWays[wayIdx];
        const chainEnd = chain[chain.length - 1];
        const wayStart = way[0];
        const wayEnd = way[way.length - 1];

        if (coordsMatch(chainEnd, wayStart)) {
            // Normal append.
            for (let i = 1; i < way.length; i++) chain.push(way[i]);
        } else if (coordsMatch(chainEnd, wayEnd)) {
            // Append reversed.
            const reversed = reverseCoords(way);
            for (let i = 1; i < reversed.length; i++) chain.push(reversed[i]);
        } else if (coordsMatch(chain[0], wayEnd)) {
            // Prepend.
            for (let i = way.length - 2; i >= 0; i--) chain.unshift(way[i]);
        } else if (coordsMatch(chain[0], wayStart)) {
            // Prepend reversed.
            const reversed = reverseCoords(way);
            for (let i = reversed.length - 2; i >= 0; i--)
                chain.unshift(reversed[i]);
        } else {
            // Can't chain — put it back.
            used.delete(wayIdx);
            return false;
        }
        return true;
    }

    for (let i = 0; i < resolvedWays.length; i++) {
        if (used.has(i)) continue;
        const chain = [...resolvedWays[i]];
        used.add(i);

        // Keep trying to extend with unused ways.
        let extended = true;
        while (extended) {
            extended = false;
            for (let j = 0; j < resolvedWays.length; j++) {
                if (used.has(j)) continue;
                if (tryExtend(chain, j)) {
                    extended = true;
                    break;
                }
            }
        }

        if (chain.length >= 2) {
            segments.push(chain);
        }
    }

    return { type: "MultiLineString", coordinates: segments };
}

/**
 * Compute point-to-segment distance (in meters) from a point to a
 * line segment defined by two endpoints. Uses haversine.
 *
 * @param {number} lat - point latitude
 * @param {number} lon - point longitude
 * @param {number} lat1 - segment start latitude
 * @param {number} lon1 - segment start longitude
 * @param {number} lat2 - segment end latitude
 * @param {number} lon2 - segment end longitude
 * @returns {number} distance in meters
 */
export function pointToSegmentDistM(lat, lon, lat1, lon1, lat2, lon2) {
    // Project point onto segment in equirectangular approximation.
    const toRad = (deg) => (deg * Math.PI) / 180;
    const cosLat = Math.cos(toRad((lat1 + lat2 + lat) / 3));

    const px = lon * cosLat;
    const py = lat;
    const ax = lon1 * cosLat;
    const ay = lat1;
    const bx = lon2 * cosLat;
    const by = lat2;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t;
    if (lenSq === 0) {
        t = 0;
    } else {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
    }

    const projX = ax + t * dx;
    const projY = ay + t * dy;

    // Convert back to degrees for haversine.
    const projLon = projX / cosLat;
    const projLat = projY;

    const R = 6371000;
    const dLat = toRad(projLat - lat);
    const dLon = toRad(projLon - lon);
    const rlat1 = toRad(lat);
    const rlat2 = toRad(projLat);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute the projection fraction `t` of a point onto a line segment.
 * Returns a value in [0, 1] representing how far along the segment
 * the closest point is.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} projection fraction in [0, 1]
 */
function pointToSegmentProjection(lat, lon, lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const cosLat = Math.cos(toRad((lat1 + lat2 + lat) / 3));

    const px = lon * cosLat;
    const py = lat;
    const ax = lon1 * cosLat;
    const ay = lat1;
    const bx = lon2 * cosLat;
    const by = lat2;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) return 0;
    const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    return Math.max(0, Math.min(1, t));
}

/**
 * Attach stations along a line geometry by spatial proximity.
 *
 * For each station, check if it's within `meters` of any segment of
 * the geometry. Return the set of station ids that are near the line.
 * Spatial-only members (not already in memberStationIds) are ordered
 * by their projection along the first segment they're closest to.
 *
 * @param {object} geometry - GeoJSON MultiLineString
 * @param {Map<string, object>} stationById - station id → station record ({lat, lon, ...})
 * @param {number} meters - max attach distance in meters
 * @param {Set<string>} existingMemberIds - already-attached station ids (skip ordering)
 * @returns {string[]} ordered list of spatially-attached station ids
 */
export function attachStationsAlongLine(
    geometry,
    stationById,
    meters,
    existingMemberIds,
) {
    if (
        !geometry ||
        !geometry.coordinates ||
        geometry.coordinates.length === 0
    ) {
        return [];
    }

    const attached = []; // { id, segmentIndex, projection }

    for (const [sid, station] of stationById) {
        if (existingMemberIds.has(sid)) continue;

        let bestDist = Infinity;
        let bestSegIdx = 0;
        let bestProj = 0;

        for (let si = 0; si < geometry.coordinates.length; si++) {
            const segment = geometry.coordinates[si];
            for (let ci = 0; ci < segment.length - 1; ci++) {
                const [lon1, lat1] = segment[ci];
                const [lon2, lat2] = segment[ci + 1];
                const dist = pointToSegmentDistM(
                    station.lat,
                    station.lon,
                    lat1,
                    lon1,
                    lat2,
                    lon2,
                );
                if (dist < bestDist) {
                    bestDist = dist;
                    bestSegIdx = si;
                    bestProj = pointToSegmentProjection(
                        station.lat,
                        station.lon,
                        lat1,
                        lon1,
                        lat2,
                        lon2,
                    );
                }
            }
        }

        if (bestDist <= meters) {
            attached.push({
                id: sid,
                segmentIndex: bestSegIdx,
                projection: bestProj,
            });
        }
    }

    // Sort by segment index, then by projection along the line.
    attached.sort((a, b) => {
        if (a.segmentIndex !== b.segmentIndex)
            return a.segmentIndex - b.segmentIndex;
        return a.projection - b.projection;
    });

    return attached.map((a) => a.id);
}

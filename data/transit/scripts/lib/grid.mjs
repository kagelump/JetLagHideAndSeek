/**
 * Spatial grid index for station conflation.
 *
 * Buckets records into `cellDeg`-sized cells for O(1) neighbour lookup
 * within `maxClusterMeters`.  The 3×3 cell block check guarantees that a
 * candidate within range is always found even when straddling a cell edge.
 */

/**
 * @param {number} meters - distance in meters
 * @param {number} lat - reference latitude (for degree-width approximation)
 * @returns {number} approximate degrees for the given meters
 */
export function metersToDegApprox(meters, lat) {
    const latRad = (lat * Math.PI) / 180;
    // 1° lat ≈ 111320 m; 1° lon ≈ 111320 * cos(lat)
    return meters / (111320 * Math.cos(latRad));
}

/**
 * Build a spatial grid index over an array of records.
 *
 * @param {object[]} records - array of { lat, lon, ... }
 * @param {number} cellDeg - cell size in degrees (default ~150 m at mid-lat)
 * @returns {object} grid index
 */
export function buildGrid(records, cellDeg = 0.002) {
    const cells = new Map(); // "col,row" → record[]

    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const col = Math.floor(r.lon / cellDeg);
        const row = Math.floor(r.lat / cellDeg);
        const key = `${col},${row}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
    }

    return { cells, cellDeg, records };
}

/**
 * Find all records within `maxDistM` meters of a target point.
 * Checks the 3×3 cell block around the target.  Returns indices into
 * the records array.  When `excludeIndex` is provided, that index is
 * skipped (used when the queried point belongs to the grid itself).
 *
 * @param {object} grid - from buildGrid
 * @param {number} lat
 * @param {number} lon
 * @param {number} maxDistM
 * @param {number} [excludeIndex] - optional index to skip
 * @returns {number[]} indices of matching records
 */
export function gridNeighbors(grid, lat, lon, maxDistM, excludeIndex) {
    const { cells, cellDeg, records } = grid;
    const col = Math.floor(lon / cellDeg);
    const row = Math.floor(lat / cellDeg);
    const result = [];

    for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
            const key = `${col + dc},${row + dr}`;
            const cell = cells.get(key);
            if (!cell) continue;
            for (const idx of cell) {
                if (idx === excludeIndex) continue;
                const r = records[idx];
                const d = haversineM(lat, lon, r.lat, r.lon);
                if (d <= maxDistM) result.push(idx);
            }
        }
    }

    return result;
}

/**
 * Haversine distance in meters between two [lat, lon] pairs.
 */
export function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const rlat1 = toRad(lat1);
    const rlat2 = toRad(lat2);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

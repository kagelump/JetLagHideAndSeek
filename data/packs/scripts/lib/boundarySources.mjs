/**
 * Boundary-source helpers.
 *
 * Some Geofabrik regions are themselves an admin-level-4 unit (e.g. every US
 * state). When extracted in isolation, their own level-4 boundary relation
 * references member ways that lie across the clip edge (shared with neighbors),
 * so `osmium getid` can't close the rings and the polygon is dropped as broken.
 *
 * A `boundarySource` lets such regions source their coarse levels (typically
 * just level 4) from a larger *parent* PBF (e.g. north-america) where every
 * member way is present and the relation assembles cleanly. The parent admin
 * set is assembled once, cached, and each region selects the parent features
 * whose bbox intersects the region — full polygons, not geometrically clipped,
 * so a state pack gains its own state plus its neighbors.
 *
 * This module holds the pure (osmium-free) logic so it is unit-testable without
 * a PBF.
 *
 * @module boundarySources
 */

import { computePolygonBbox } from "../../../geofabrik/scripts/lib/geometryCleanup.mjs";

/**
 * Split a region's extract levels into those built from the region's own PBF
 * and those supplied by the parent boundary source.
 *
 * Parent levels are removed from the region build (they assemble broken from a
 * clipped extract) and only the parent levels actually requested in `extract`
 * are sourced from the parent.
 *
 * @param {number[]} extractLevels - the region's adminLevels.extract
 * @param {number[]} [parentLevels=[]] - levels the boundary source provides
 * @returns {{ regionLevels: number[], parentLevels: number[] }}
 */
export function partitionExtractLevels(extractLevels, parentLevels = []) {
    const parentSet = new Set(parentLevels);
    return {
        regionLevels: extractLevels.filter((l) => !parentSet.has(l)),
        parentLevels: extractLevels.filter((l) => parentSet.has(l)),
    };
}

/**
 * Axis-aligned bbox intersection test. Boxes are [west, south, east, north].
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean}
 */
export function bboxIntersects(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Select parent admin features whose bbox intersects the region bbox, optionally
 * restricted to a set of admin levels. Returns whole features (no geometric
 * clipping), so a state plus its bbox-overlapping neighbors come through intact.
 *
 * @param {object[]} features - assembled GeoJSON admin features from the parent
 * @param {number[]} regionBbox - [west, south, east, north]
 * @param {number[]} [allowedLevels] - admin levels to keep (default: all)
 * @returns {object[]}
 */
export function filterParentFeaturesByBbox(
    features,
    regionBbox,
    allowedLevels,
) {
    const levelSet =
        allowedLevels && allowedLevels.length ? new Set(allowedLevels) : null;
    const out = [];
    for (const f of features) {
        const geom = f?.geometry;
        if (
            !geom ||
            (geom.type !== "Polygon" && geom.type !== "MultiPolygon")
        ) {
            continue;
        }
        if (levelSet) {
            const lv = parseInt(f.properties?.admin_level, 10);
            if (!Number.isFinite(lv) || !levelSet.has(lv)) continue;
        }
        if (bboxIntersects(computePolygonBbox(geom), regionBbox)) {
            out.push(f);
        }
    }
    return out;
}

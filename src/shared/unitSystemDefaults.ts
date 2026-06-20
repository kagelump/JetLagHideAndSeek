import type { PlayArea } from "@/features/map/playArea";
import { isPlayAreaSet } from "@/features/map/playArea";
import type { Bbox, Position } from "@/shared/geojson";

/** Preferred display unit system. Mirrors the store's `UnitSystem`. */
export type UnitSystem = "metric" | "imperial";

/**
 * Lon/lat boxes covering United States territory. Used to pick a default unit
 * system from a play area's location — imperial inside the US, metric
 * everywhere else. A centroid-in-box test, so it's approximate: border towns
 * may resolve to a neighbor, which is acceptable for a *default* the user can
 * override in Settings.
 *
 * The contiguous US is split into longitude bands with different northern caps
 * so a single rectangle doesn't sweep up southern Canada — the border dips well
 * south through the Great Lakes, so a naive box would mark Toronto, Montreal,
 * and Vancouver as US. Bands approximate the 49th parallel in the west and the
 * Great Lakes / St. Lawrence line in the east. Far-northern fringes of the US
 * (e.g. the Minnesota Northwest Angle) are intentionally dropped.
 */
const US_BBOXES: Bbox[] = [
    // Contiguous US, west to east. [west, south, east, north]
    [-125.0, 24.4, -95.0, 49.0], // West: clean 49th-parallel border.
    [-95.0, 24.4, -83.0, 48.5], // Upper Midwest (Minnesota, Michigan UP).
    [-83.0, 24.4, -76.0, 43.3], // Great Lakes east (border in the lakes).
    [-76.0, 24.4, -71.0, 45.0], // NY / New England (border ~45°N).
    [-71.0, 24.4, -66.9, 47.5], // Maine.
    // Alaska (mainland + nearer Aleutians; far western Aleutians omitted).
    [-170.0, 51.0, -129.9, 71.6],
    // Hawaii.
    [-160.3, 18.9, -154.7, 22.3],
    // Puerto Rico.
    [-67.3, 17.9, -65.2, 18.6],
];

function isInBbox([lon, lat]: Position, [west, south, east, north]: Bbox) {
    return lon >= west && lon <= east && lat >= south && lat <= north;
}

/** Whether a lon/lat coordinate falls within United States territory. */
export function isUnitedStatesLngLat(position: Position): boolean {
    return US_BBOXES.some((bbox) => isInBbox(position, bbox));
}

/**
 * The default unit system for a play area: imperial when the play area's center
 * is in the United States, metric otherwise. An unset play area defaults to
 * metric.
 */
export function defaultUnitSystemForPlayArea(playArea: PlayArea): UnitSystem {
    if (!isPlayAreaSet(playArea)) return "metric";
    return isUnitedStatesLngLat(playArea.center) ? "imperial" : "metric";
}

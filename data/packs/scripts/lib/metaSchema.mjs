/**
 * Meta artifact schema and validation.
 *
 * Every pack gets a meta.json that describes the region and which
 * artifacts + categories are present.  Shared by the builder and pack-lint.
 *
 * @module metaSchema
 */

/** Current meta artifact schema version. */
export const META_SCHEMA_VERSION = 1;

/** Valid measuring category names (must match the app's MeasuringCategory). */
const VALID_MEASURING_CATEGORIES = new Set([
    "coastline",
    "body-of-water",
    "admin-1st-border",
    "admin-2nd-border",
    "high-speed-rail",
    "admin-boundaries",
]);

/** Valid matching category names (must match the app's MatchingCategory). */
const VALID_MATCHING_CATEGORIES = new Set([
    "museum",
    "park",
    "station",
    "commercial-airport",
    "general-aviation",
    "heliport",
    "railway-station",
    "metro-station",
    "tram-stop",
    "bus-station",
    "ferry-terminal",
    "aerialway-station",
    "castle",
    "ruins",
    "place-of-worship",
    "zoo",
    "aquarium",
    "theme-park",
    "water-park",
    "observation-tower",
    "attraction",
    "stadium",
    "university",
    "library",
    "hospital",
    "admin-1st",
    "admin-2nd",
    "admin-3rd",
    "admin-4th",
    "amusement-park",
    "foreign-consulate",
    "golf-course",
    "landmark",
    "mountain",
    "movie-theater",
    "station-name-length",
]);

/**
 * Validate a meta.json object. Returns an array of error messages.
 *
 * @param {object} meta - parsed meta.json
 * @param {string} [label] - context label for error messages
 * @returns {string[]} error messages (empty = valid)
 */
export function validateMeta(meta, label = "meta.json") {
    const errors = [];

    if (!meta || typeof meta !== "object") {
        return [`${label}: must be a JSON object`];
    }

    // schemaVersion
    if (meta.schemaVersion !== META_SCHEMA_VERSION) {
        errors.push(
            `${label}: "schemaVersion" must be ${META_SCHEMA_VERSION}, got ${JSON.stringify(meta.schemaVersion)}`,
        );
    }

    // regionId
    if (!meta.regionId || typeof meta.regionId !== "string") {
        errors.push(`${label}: "regionId" must be a non-empty string`);
    }

    // label
    if (!meta.label || typeof meta.label !== "string") {
        errors.push(`${label}: "label" must be a non-empty string`);
    }

    // regionPath
    if (!meta.regionPath || !Array.isArray(meta.regionPath)) {
        errors.push(`${label}: "regionPath" must be a non-empty array`);
    } else if (
        meta.regionPath.some((p) => typeof p !== "string" || p.trim() === "")
    ) {
        errors.push(
            `${label}: every "regionPath" element must be a non-empty string`,
        );
    }

    // bbox
    if (!meta.bbox || !Array.isArray(meta.bbox)) {
        errors.push(
            `${label}: "bbox" must be an array [west, south, east, north]`,
        );
    } else {
        const [w, s, e, n] = meta.bbox;
        if (
            typeof w !== "number" ||
            typeof s !== "number" ||
            typeof e !== "number" ||
            typeof n !== "number"
        ) {
            errors.push(`${label}: "bbox" values must be numbers`);
        } else if (w >= e) {
            errors.push(`${label}: bbox west (${w}) must be < east (${e})`);
        } else if (s >= n) {
            errors.push(`${label}: bbox south (${s}) must be < north (${n})`);
        } else if (w < -180 || e > 180 || s < -90 || n > 90) {
            errors.push(`${label}: bbox must be within [-180,180],[-90,90]`);
        }
    }

    // osmSnapshot
    if (
        !meta.osmSnapshot ||
        typeof meta.osmSnapshot !== "string" ||
        meta.osmSnapshot.trim() === ""
    ) {
        errors.push(`${label}: "osmSnapshot" must be a non-empty date string`);
    }

    // adminLevels
    if (!meta.adminLevels || typeof meta.adminLevels !== "object") {
        errors.push(`${label}: "adminLevels" must be an object`);
    } else {
        if (
            !meta.adminLevels.matching ||
            !Array.isArray(meta.adminLevels.matching)
        ) {
            errors.push(`${label}: "adminLevels.matching" must be an array`);
        }
        if (
            !meta.adminLevels.extract ||
            !Array.isArray(meta.adminLevels.extract)
        ) {
            errors.push(`${label}: "adminLevels.extract" must be an array`);
        }
    }

    // categories
    if (!meta.categories || typeof meta.categories !== "object") {
        errors.push(`${label}: "categories" must be an object`);
    } else {
        if (
            !meta.categories.measuring ||
            !Array.isArray(meta.categories.measuring)
        ) {
            errors.push(`${label}: "categories.measuring" must be an array`);
        } else {
            for (const cat of meta.categories.measuring) {
                if (!VALID_MEASURING_CATEGORIES.has(cat)) {
                    errors.push(
                        `${label}: unknown measuring category "${cat}"`,
                    );
                }
            }
        }
        if (
            !meta.categories.matching ||
            !Array.isArray(meta.categories.matching)
        ) {
            errors.push(`${label}: "categories.matching" must be an array`);
        } else {
            for (const cat of meta.categories.matching) {
                if (!VALID_MATCHING_CATEGORIES.has(cat)) {
                    errors.push(`${label}: unknown matching category "${cat}"`);
                }
            }
        }
    }

    // attribution
    if (
        !meta.attribution ||
        typeof meta.attribution !== "string" ||
        meta.attribution.trim() === ""
    ) {
        errors.push(`${label}: "attribution" must be a non-empty string`);
    }

    return errors;
}

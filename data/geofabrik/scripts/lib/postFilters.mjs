/**
 * Post-filter predicates for measuring bundle categories.
 *
 * Each predicate receives OSM tags and returns true when the feature
 * should be included for that category.  `applyPostFilter` dispatches
 * by the category's configured postFilter name.
 *
 * @module postFilters
 */

/**
 * High-speed rail: exclude maglev, keep highspeed=yes, service=high_speed,
 * or maxspeed ≥ 200 km/h.
 */
export function highSpeedPostFilter(tags) {
    // Exclude linear motor (maglev) lines — e.g. Chūō Shinkansen.
    if (tags.propulsion === "linear_motor") return false;
    if (tags.highspeed === "yes") return true;
    if (tags.service === "high_speed") return true;
    const ms = parseInt(tags.maxspeed, 10);
    return Number.isFinite(ms) && ms >= 200;
}

/**
 * Admin boundary filter for a specific OSM admin_level.
 */
export function adminLevelPostFilter(tags, level) {
    return (
        tags.boundary === "administrative" && tags.admin_level === String(level)
    );
}

/**
 * Dispatch to the correct post-filter for a category definition.
 *
 * @param {{ postFilter?: string }} category
 * @param {Record<string, string>} tags
 * @returns {boolean}
 */
export function applyPostFilter(category, tags) {
    switch (category.postFilter) {
        case "high-speed":
            return highSpeedPostFilter(tags);
        case "admin-4":
            return adminLevelPostFilter(tags, 4);
        case "admin-7":
            return adminLevelPostFilter(tags, 7);
        case "admin-all":
            return (
                tags.boundary === "administrative" &&
                typeof tags.admin_level === "string" &&
                tags.admin_level.length > 0
            );
        default:
            // Handle parameterized admin-<N> post-filters
            // (e.g. "admin-8" for Dutch municipalities).
            if (category.postFilter?.startsWith("admin-")) {
                const level = parseInt(category.postFilter.slice(6), 10);
                if (Number.isFinite(level)) {
                    return adminLevelPostFilter(tags, level);
                }
            }
            return true;
    }
}

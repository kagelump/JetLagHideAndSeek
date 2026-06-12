/**
 * Name normalization for search index: lowercase + Unicode NFKD + strip
 * combining marks. CJK characters are left as-is (NFKD doesn't decompose
 * CJK, and stripping combining marks on CJK is a no-op).
 *
 * @module normalizeNames
 */

/**
 * Normalize a name string for fuzzy search matching.
 *
 * 1. NFKD normalize (decomposes é → e + combining accent)
 * 2. Strip combining marks (characters in the Unicode Mn category)
 * 3. Lowercase
 *
 * CJK characters survive NFKD unchanged and have no combining marks, so
 * they pass through as-is.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
    if (!name) return "";
    return name
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "") // Combining Diacritical Marks block
        .toLowerCase();
}

/**
 * Collect all normalized variants for a relation's name tags.
 *
 * Includes name, name:en, and any other name:* tags (name:ja, name:zh, etc.).
 * Deduplicates (same normalized string may appear from different source tags).
 *
 * @param {object} properties - OSM relation properties (tags)
 * @returns {string[]} sorted unique normalized variants
 */
export function collectNormalizedVariants(properties) {
    const variants = new Set();

    const tags = properties ?? {};

    // Primary name
    if (tags.name) {
        variants.add(normalizeName(tags.name));
    }

    // name:en
    if (tags["name:en"]) {
        variants.add(normalizeName(tags["name:en"]));
    }

    // All other name:* variants
    for (const [key, value] of Object.entries(tags)) {
        if (key.startsWith("name:") && key !== "name:en" && value) {
            variants.add(normalizeName(value));
        }
    }

    // Remove empty strings
    const result = [...variants].filter((v) => v.length > 0);
    result.sort();
    return result;
}

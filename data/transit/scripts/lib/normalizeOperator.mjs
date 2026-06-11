/**
 * Normalize operator name variants to canonical forms.
 *
 * OSM station tags often carry operator name variants (e.g. "東日本旅客鉄道"
 * vs "JR東日本" vs "JR East"). This module provides utilities to map those
 * variants to a single canonical name so that stations served by the same
 * operator merge into a single operator preset.
 *
 * @module normalizeOperator
 */

/**
 * Build a function that normalizes operator names to their canonical form.
 *
 * @param {Record<string, string[]>} operatorNames - canonical name → list of variant names
 * @returns {(raw: string | null | undefined) => string | null} normalizer function
 *
 * @example
 * const normalizer = buildOperatorNormalizer({
 *   "JR East": ["東日本旅客鉄道", "JR東日本"],
 * });
 * normalizer("JR東日本"); // => "JR East"
 * normalizer("未知の鉄道"); // => "未知の鉄道"
 * normalizer(null); // => null
 */
export function buildOperatorNormalizer(operatorNames) {
    // Build reverse map: variant → canonical
    const variantToCanonical = new Map();
    for (const [canonical, variants] of Object.entries(operatorNames)) {
        for (const variant of variants) {
            variantToCanonical.set(variant, canonical);
        }
    }

    return (raw) => {
        if (!raw) return null;
        // Check exact match first.
        const canonical = variantToCanonical.get(raw);
        if (canonical) return canonical;
        // Check substring containment — handles cases like
        // "東日本旅客鉄道 (JR East)" containing "東日本旅客鉄道".
        for (const [variant, canonicalName] of variantToCanonical) {
            if (raw.includes(variant)) return canonicalName;
        }
        // Return raw as-is (unknown operator).
        return raw;
    };
}

/**
 * Split a potentially multi-operator string (semicolon-separated) into
 * individual normalized operator names.
 *
 * OSM allows semicolon-separated operator values (e.g. "東日本旅客鉄道;JR東日本"),
 * and GTFS `agency_name` fields occasionally concatenate values. This helper
 * splits on `;`, trims, normalizes each part, and discards empties.
 *
 * @param {string | null | undefined} raw - raw operator string, possibly "A;B"
 * @param {(raw: string) => string | null} normalize - normalizer function
 * @returns {string[]} array of normalized operator names (may be empty)
 *
 * @example
 * const normalizer = buildOperatorNormalizer({ "JR East": ["JR東日本"] });
 * splitOperators("JR東日本;東京メトロ", normalizer);
 * // => ["JR East", "東京メトロ"]
 */
export function splitOperators(raw, normalize) {
    if (!raw) return [];
    return raw
        .split(";")
        .map((s) => normalize(s.trim()))
        .filter(Boolean);
}

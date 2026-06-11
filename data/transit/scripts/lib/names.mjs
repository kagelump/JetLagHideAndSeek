/**
 * Name normalisation for station conflation.
 *
 * Unicode NFKC, case-fold, collapse whitespace, strip locale-specific
 * suffixes/prefixes from config (`nameSuffixes` list).
 */

/**
 * Strip locale suffixes/prefixes from a station name.
 * Each entry in `suffixes` is stripped when it appears at the end of the
 * name (with optional leading whitespace). Prefixes are matched at the start.
 *
 * @param {string} name - already NFKC + case-folded + whitespace-collapsed
 * @param {string[]} suffixes - suffix strings to strip
 * @returns {string}
 */
export function stripNameAffixes(name, suffixes) {
  let out = name;
  for (const sfx of suffixes) {
    if (!sfx) continue;
    // Lower the suffix too (name is already lowercased).
    const lowerSfx = sfx.toLowerCase();
    const suffixRe = new RegExp(`\\s*${escapeRegExp(lowerSfx)}$`, "u");
    out = out.replace(suffixRe, "");
    // Also strip when suffix is the *entire* name.
    if (out === lowerSfx) out = "";
  }
  return out.trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a station name for matching:
 * 1. Unicode NFKC
 * 2. Case-fold (lowercase)
 * 3. Collapse whitespace
 * 4. Strip config-supplied suffixes/prefixes
 *
 * @param {string} raw - raw name from OSM / GTFS
 * @param {string[]} suffixes - locale suffix list from config
 * @returns {string} normalized name (empty string if unnameable)
 */
export function normalizeName(raw, suffixes = []) {
  if (!raw || typeof raw !== "string") return "";
  // NFKC.
  let n = raw.normalize("NFKC");
  // Case-fold.
  n = n.toLowerCase();
  // Collapse whitespace.
  n = n.replace(/\s+/g, " ").trim();
  // Strip suffixes.
  n = stripNameAffixes(n, suffixes);
  return n;
}

/**
 * Collect all name variants for conflation matching.
 *
 * @param {object} tags - OSM tags (or GTFS-equivalent name fields)
 * @param {string[]} [extra] - extra name strings
 * @returns {string[]} deduplicated non-empty names
 */
export function collectNameVariants(tags, extra = []) {
  const seen = new Set();
  const out = [];
  const add = (v) => {
    if (v && typeof v === "string" && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  add(tags.name);
  add(tags["name:en"]);
  add(tags.alt_name);
  for (const e of extra) add(e);
  return out;
}

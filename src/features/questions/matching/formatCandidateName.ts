import type { OsmFeature } from "./matchingTypes";

/**
 * Formats an OsmFeature's name for display, including category-specific
 * annotations when present:
 *   - station-name-length: appends (nameLength),   e.g. "Shinjuku Station (13)"
 *   - commercial-airport:  appends (IATA code),    e.g. "Haneda Airport (HND)"
 *
 * Presence-based, not category-gated — any feature with an iata or
 * nameLength field gets the annotation regardless of its category.
 *
 * When `preference` is `"english"`, the name is taken from the feature's
 * `tags["name:en"]` (when available), falling back to `feature.name`.
 * The default (`"native"`) always uses `feature.name`.
 */
export function formatCandidateName(
    feature: OsmFeature,
    preference?: "native" | "english",
): string {
    const name =
        preference === "english"
            ? feature.tags["name:en"]?.trim() || feature.name
            : feature.name;
    const parts = [name];
    if (feature.nameLength !== undefined) {
        parts.push(`(${feature.nameLength})`);
    }
    if (feature.iata) {
        parts.push(`(${feature.iata})`);
    }
    return parts.join(" ");
}

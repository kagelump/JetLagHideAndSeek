import type { Bbox } from "@/shared/geojson";
import {
    getBundledCategoryFeatures,
    getRegionGeneratedAt,
    regionCoveringBbox,
} from "./bundledPois";
import { isBundleableCategory } from "./matchingSelectors";
import type { MatchingCategory, OsmFeature } from "./matchingTypes";
import { fetchAndParseOverpassBboxFeatures } from "./osmMatching";

/**
 * A bounding box expressed as an object with named cardinal edges.
 * Matches the cell bbox shape from osmMatchingGrid.cellBbox().
 */
export type BboxObj = {
    south: number;
    west: number;
    north: number;
    east: number;
};

/** Discriminates local (bundled) from Overpass (network) feature sources. */
export type FeatureSourceKind = "local" | "overpass";

export type ResolvedBboxFeatures = {
    features: OsmFeature[];
    source: FeatureSourceKind;
    /** ISO timestamp of the bundle the local features came from (for staleness stamping). */
    generatedAt?: string;
};

const toBbox = (b: BboxObj): Bbox => [b.west, b.south, b.east, b.north];

/**
 * Returns bundled features whose point falls inside the bbox, or null if no
 * bundled region fully covers the bbox or the category is not bundleable.
 */
export function localBboxFeatures(
    category: MatchingCategory,
    bbox: BboxObj,
): { features: OsmFeature[]; generatedAt: string } | null {
    // Non-bundleable categories (admin, transit-line) always fall through
    // to Overpass, even if a region covers the bbox.
    if (!isBundleableCategory(category)) return null;

    const tuple = toBbox(bbox);
    const regionId = regionCoveringBbox(tuple);
    if (!regionId) return null;

    const all = getBundledCategoryFeatures(regionId, category);
    const features = all.filter(
        (f) =>
            f.lon >= bbox.west &&
            f.lon < bbox.east &&
            f.lat >= bbox.south &&
            f.lat < bbox.north,
    );
    return { features, generatedAt: getRegionGeneratedAt(regionId) ?? "" };
}

/**
 * Resolve features for a cell bbox: bundled data if a region fully covers the
 * cell, else Overpass. The cell cache (task 05) calls this in place of
 * `fetchAndParseOverpassBboxFeatures`.
 */
export async function resolveBboxFeatures(
    category: MatchingCategory,
    bbox: BboxObj,
    signal?: AbortSignal,
): Promise<ResolvedBboxFeatures> {
    const local = localBboxFeatures(category, bbox);
    if (local) {
        return {
            features: local.features,
            source: "local",
            generatedAt: local.generatedAt || undefined,
        };
    }
    const features = await fetchAndParseOverpassBboxFeatures(
        category,
        bbox.south,
        bbox.west,
        bbox.north,
        bbox.east,
        signal,
    );
    return { features, source: "overpass" };
}

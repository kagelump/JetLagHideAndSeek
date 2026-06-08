import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
} from "geojson";

import type { Bbox } from "@/shared/geojson";
import type { MeasuringCategory } from "./measuringTypes";

export type BundleFeature = Feature<
    LineString | MultiLineString | Polygon | MultiPolygon
>;

export type LineBundle = {
    schemaVersion: number;
    category: string;
    generatedAt: string;
    source: string;
    extractBbox: Bbox;
    features: BundleFeature[];
};

const cache = new Map<string, LineBundle | null>();

/** Test seam: inject a synthetic bundle (or null) for a category. */
export function __setLineBundleForTest(
    category: MeasuringCategory,
    bundle: LineBundle | null,
): void {
    cache.set(category, bundle);
}

/** Test seam: drop all injected/loaded bundles. */
export function __clearLineBundlesForTest(): void {
    cache.clear();
}

/**
 * Returns the bundle for a line/polygon category, lazily `require()`-ing and
 * caching it on first use. Returns null for point categories.
 */
export function getLineBundle(category: MeasuringCategory): LineBundle | null {
    if (cache.has(category)) return cache.get(category) ?? null;

    const t0 = performance.now();
    let bundle: LineBundle | null = null;
    switch (category) {
        case "coastline":
            bundle = require("../../../../assets/measuring/coastline.json");
            break;
        case "high-speed-rail":
            bundle = require("../../../../assets/measuring/high-speed-rail.json");
            break;
        case "body-of-water":
            bundle = require("../../../../assets/measuring/body-of-water.json");
            break;
        case "admin-1st-border":
            bundle = require("../../../../assets/measuring/admin-1st-border.json");
            break;
        case "admin-2nd-border":
            bundle = require("../../../../assets/measuring/admin-2nd-border.json");
            break;
        default:
            bundle = null; // point category
    }
    const tMs = performance.now() - t0;
    if (bundle) {
        console.log(
            `[lineBundle] require(${category}): ${bundle.features.length} features ` +
                `in ${tMs.toFixed(0)}ms`,
        );
    }
    cache.set(category, bundle);
    return bundle;
}

/** Categories whose measuring calc draws from additional source bundles. */
const MEASURING_EXTRA_BUNDLES: Partial<
    Record<MeasuringCategory, MeasuringCategory[]>
> = {
    // The ocean is a body of water — fold the coastline shoreline in.
    "body-of-water": ["coastline"],
};

/**
 * Returns every source bundle that feeds `category`'s measuring calculation —
 * the category's own bundle plus any extras (e.g. coastline for body-of-water).
 * Nulls (point categories / missing bundles) are filtered out.
 */
export function getLineBundleSources(
    category: MeasuringCategory,
): LineBundle[] {
    const keys = [category, ...(MEASURING_EXTRA_BUNDLES[category] ?? [])];
    const out: LineBundle[] = [];
    for (const k of keys) {
        const b = getLineBundle(k);
        if (b && b.features.length > 0) out.push(b);
    }
    return out;
}

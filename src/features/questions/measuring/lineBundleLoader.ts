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

/** Categories whose cached result is a full merge (set by loadLineBundle). */
const mergedCache = new Set<string>();

/**
 * Registered measuring sources from installed packs.
 * Map: category -> [{ packId, path }]
 */
type MeasuringPackSource = {
    packId: string;
    path: string;
};

const packSources = new Map<MeasuringCategory, MeasuringPackSource[]>();

/**
 * Register a pack-based measuring source for a category.
 * Called by the pack installer (T5) when a pack is installed.
 *
 * @param packId - Pack identifier (e.g. "europe-netherlands")
 * @param category - Measuring category
 * @param path - Absolute filesystem path to the uncompressed .json file
 *   under Documents/packs/<packId>/
 */
export function registerMeasuringSource(
    packId: string,
    category: MeasuringCategory,
    path: string,
): void {
    const sources = packSources.get(category) ?? [];
    // Avoid duplicates from re-installation.
    if (!sources.some((s) => s.packId === packId && s.path === path)) {
        sources.push({ packId, path });
        packSources.set(category, sources);

        // Invalidate cache entry so next load re-merges.
        if (cache.has(category)) {
            cache.delete(category);
            mergedCache.delete(category);
            console.log(
                `[lineBundle] invalidated cache for ${category} due to pack source registration`,
            );
        }
    }
}

/**
 * Unregister all measuring sources for a pack. Called when a pack is removed.
 * Invalidates cache entries for any affected categories.
 */
export function unregisterMeasuringSources(packId: string): void {
    for (const [category, sources] of packSources) {
        const before = sources.length;
        const remaining = sources.filter((s) => s.packId !== packId);
        if (remaining.length < before) {
            if (remaining.length === 0) {
                packSources.delete(category);
            } else {
                packSources.set(category, remaining);
            }
            // Invalidate cache entry.
            if (cache.has(category)) {
                cache.delete(category);
                mergedCache.delete(category);
                console.log(
                    `[lineBundle] invalidated cache for ${category} after unregistering ${packId}`,
                );
            }
        }
    }
}

/** Test seam: clear all registered pack sources. */
export function __clearPackSourcesForTest(): void {
    packSources.clear();
}

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
    mergedCache.clear();
}

/** Test seam: get current pack sources (for assertions). */
export function __getPackSourcesForTest(): Map<
    MeasuringCategory,
    MeasuringPackSource[]
> {
    return new Map(packSources);
}

/**
 * Returns the bundle for a line/polygon category, lazily `require()`-ing and
 * caching it on first use. Returns null for point categories.
 *
 * After this task: returns what's cached (includes merged pack sources if
 * loadLineBundle has been called). Does NOT trigger FS reads — call
 * `loadLineBundle` first for pack-only categories.
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

/**
 * Load a measuring line bundle for a category, merging the bundled `require()`
 * source with any registered pack sources. Reads and parses each registered
 * pack file lazily.
 *
 * The merged result is cached in the existing `cache` map so the sync
 * `getLineBundle` returns it from then on.
 *
 * Call this on category selection in MeasuringQuestionDetailScreen so the
 * bundle is warm before the map asks. UseEnsureMeasuringBundles also calls
 * this for categories in current questions.
 *
 * @returns The merged LineBundle, or null if the category has no sources.
 */
export async function loadLineBundle(
    category: MeasuringCategory,
): Promise<LineBundle | null> {
    const hasSources = hasPackSources(category);

    // Return cached merge when present (only if set by a previous
    // loadLineBundle call, not by getLineBundle). The cache is invalidated
    // by registerMeasuringSource / unregisterMeasuringSources when pack
    // sources change, so a cache hit here is always fresh.
    if (hasSources && mergedCache.has(category) && cache.has(category)) {
        return cache.get(category) ?? null;
    }
    if (!hasSources && cache.has(category)) {
        return cache.get(category) ?? null;
    }

    // If no pack sources and we have a bundled require(), cache and return it.
    if (!hasSources && !isPackOnlyCategory(category)) {
        const bundled = getLineBundle(category);
        cache.set(category, bundled);
        return bundled;
    }

    // Build merged bundle from pristine sources.
    // Use requirePristineBundle to get the raw bundled data (never the
    // cached merged result) so that if this is a rebuild after cache
    // invalidation, we don't duplicate already-merged features.
    let merged: LineBundle | null = null;

    if (!isPackOnlyCategory(category)) {
        const bundled = requirePristineBundle(category);
        if (bundled) {
            merged = {
                ...bundled,
                features: [...bundled.features],
            };
        }
    }

    // Merge registered pack sources.
    const sources = packSources.get(category);
    if (sources && sources.length > 0) {
        for (const source of sources) {
            try {
                const text = await readFileText(source.path);
                const packBundle: LineBundle = JSON.parse(text);

                if (!merged) {
                    // First source: initialize from pack bundle.
                    merged = {
                        ...packBundle,
                        features: [...packBundle.features],
                    };
                } else {
                    // Merge: concatenate features, union bbox, join source.
                    merged.features.push(...packBundle.features);

                    // Union extractBbox.
                    const a = merged.extractBbox;
                    const b = packBundle.extractBbox;
                    merged.extractBbox = [
                        Math.min(a[0], b[0]),
                        Math.min(a[1], b[1]),
                        Math.max(a[2], b[2]),
                        Math.max(a[3], b[3]),
                    ];

                    // Append source attribution.
                    merged.source += `; ${packBundle.source}`;
                    console.log(
                        `[lineBundle] merged pack ${source.packId} into ${category}: ` +
                            `${packBundle.features.length} features (now ${merged.features.length} total)`,
                    );
                }
            } catch (err) {
                console.warn(
                    `[lineBundle] failed to load pack source for ${category} ` +
                        `from ${source.packId} at ${source.path}:`,
                    err,
                );
            }
        }
    }

    // Cache the result (even null — no sources at all).
    cache.set(category, merged);
    mergedCache.add(category);
    if (merged) {
        console.log(
            `[lineBundle] loadLineBundle(${category}): ${merged.features.length} features after merge`,
        );
    }
    return merged;
}

/**
 * Return the pristine bundled bundle for a category — always a fresh
 * `require()`, never the cached merge. Used by loadLineBundle as the
 * base for rebuilding after cache invalidation.
 */
function requirePristineBundle(category: MeasuringCategory): LineBundle | null {
    switch (category) {
        case "coastline":
            return require("../../../../assets/measuring/coastline.json");
        case "high-speed-rail":
            return require("../../../../assets/measuring/high-speed-rail.json");
        case "body-of-water":
            return require("../../../../assets/measuring/body-of-water.json");
        case "admin-1st-border":
            return require("../../../../assets/measuring/admin-1st-border.json");
        case "admin-2nd-border":
            return require("../../../../assets/measuring/admin-2nd-border.json");
        default:
            return null;
    }
}

/**
 * Returns true if a category has registered pack sources.
 */
export function hasPackSources(category: MeasuringCategory): boolean {
    const sources = packSources.get(category);
    return sources !== undefined && sources.length > 0;
}

/**
 * Returns true if a category has only pack sources (no bundled require()).
 */
function isPackOnlyCategory(category: MeasuringCategory): boolean {
    switch (category) {
        case "coastline":
        case "high-speed-rail":
        case "body-of-water":
        case "admin-1st-border":
        case "admin-2nd-border":
            return false;
        default:
            return true;
    }
}

/**
 * Read a file as text using the Expo SDK 54 File API.
 */
async function readFileText(fullPath: string): Promise<string> {
    // Expo SDK 54: use File from expo-file-system (not the legacy entry).
    // The main entry's readAsStringAsync is a stub that throws.
    const { File } = require("expo-file-system");
    // Split fullPath into parent directory + filename for the File constructor.
    const lastSep = fullPath.lastIndexOf("/");
    const dir = fullPath.slice(0, lastSep);
    const name = fullPath.slice(lastSep + 1);
    return new File(dir, name).text();
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

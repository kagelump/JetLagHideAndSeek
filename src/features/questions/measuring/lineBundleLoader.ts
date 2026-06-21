import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
} from "geojson";

import type { Bbox } from "@/shared/geojson";
import type { MeasuringCategory } from "./measuringTypes";
import {
    getBoundaryPolygonsAtLevel,
    getAvailableBoundaryLevels,
} from "@/features/offline/boundaryStore";
import {
    getAdminBorderOsmLevel,
    isAdminBorderCategory,
    type AdminBorderCategory,
} from "@/features/questions/matching/adminDivisionConfig";
import { getDefaultAdminDivisionPack } from "@/features/questions/matching/matchingCategories";
import { createLogger } from "@/shared/logger";

const log = createLogger("lineBundle");

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
            log.debug(
                `invalidated cache for ${category} due to pack source registration`,
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
                log.debug(
                    `invalidated cache for ${category} after unregistering ${packId}`,
                );
            }
        }
    }
}

/** Test seam: clear all registered pack sources. */
export function __clearPackSourcesForTest(): void {
    packSources.clear();
}

/**
 * Drop cached admin-border bundles so the next load rebuilds them against the
 * current admin-division pack. Call when the user changes admin levels.
 */
export function invalidateAdminBorderBundles(): void {
    for (const category of ["admin-1st-border", "admin-2nd-border"] as const) {
        cache.delete(category);
        mergedCache.delete(category);
    }
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
 * Returns the cached bundle for a line/polygon category, or null.
 * Does NOT trigger FS reads — call `loadLineBundle` first for pack sources.
 */
export function getLineBundle(category: MeasuringCategory): LineBundle | null {
    return cache.get(category) ?? null;
}

/**
 * Load a measuring line bundle for a category from registered pack sources.
 * Reads and parses each registered pack file lazily, merging them.
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
    // Return cached merge when present.
    if (mergedCache.has(category) && cache.has(category)) {
        return cache.get(category) ?? null;
    }

    // Admin border categories are unified onto the boundary polygons already
    // shipped in the `boundaries` artifact — they derive their level from the
    // shared admin-division pack, not a separate measuring-admin line bundle.
    if (isAdminBorderCategory(category)) {
        const adminBundle = await buildAdminBorderBundle(category);
        if (adminBundle) {
            cache.set(category, adminBundle);
            mergedCache.add(category);
            return adminBundle;
        }
        // No boundary data for this border tier — return null. After the
        // Phase 1 pipeline cut, packs no longer ship measuring-admin-*-border
        // artifacts, so there are no pack sources to fall through to.
        cache.set(category, null);
        mergedCache.add(category);
        return null;
    }

    // Build merged bundle from registered pack sources.
    let merged: LineBundle | null = null;

    const sources = packSources.get(category);
    if (sources && sources.length > 0) {
        for (const source of sources) {
            try {
                const text = await readFileText(source.path);
                const packBundle: LineBundle = JSON.parse(text);

                if (!merged) {
                    merged = {
                        ...packBundle,
                        features: [...packBundle.features],
                    };
                } else {
                    merged.features.push(...packBundle.features);

                    const a = merged.extractBbox;
                    const b = packBundle.extractBbox;
                    merged.extractBbox = [
                        Math.min(a[0], b[0]),
                        Math.min(a[1], b[1]),
                        Math.max(a[2], b[2]),
                        Math.max(a[3], b[3]),
                    ];

                    merged.source += `; ${packBundle.source}`;
                    log.debug(
                        `merged pack ${source.packId} into ${category}: ` +
                            `${packBundle.features.length} features (now ${merged.features.length} total)`,
                    );
                }
            } catch (err) {
                log.warn(
                    `failed to load pack source for ${category} ` +
                        `from ${source.packId} at ${source.path}:`,
                    err,
                );
            }
        }
    }

    cache.set(category, merged);
    mergedCache.add(category);
    if (merged) {
        log.debug(
            `loadLineBundle(${category}): ${merged.features.length} features after merge`,
        );
    }
    return merged;
}

/**
 * Resolve the OSM admin level a border tier maps to, from the active
 * admin-division pack. Returns null when the pack hasn't been synced yet.
 */
function resolveBorderLevel(category: AdminBorderCategory): number | null {
    const pack = getDefaultAdminDivisionPack();
    if (!pack) return null;
    const level = getAdminBorderOsmLevel(pack, category);
    return Number.isFinite(level) ? level : null;
}

/**
 * Build a measuring line bundle for an admin border tier from the boundary
 * polygons in installed packs. Each polygon ring becomes a LineString feature
 * (matching the legacy `polygon-to-ring` artifact shape), so the existing
 * line-distance pipeline and reference-line rendering work unchanged.
 *
 * Returns null when no installed pack carries boundaries at the resolved level.
 */
async function buildAdminBorderBundle(
    category: AdminBorderCategory,
): Promise<LineBundle | null> {
    const level = resolveBorderLevel(category);
    if (level == null) return null;

    const polygons = await getBoundaryPolygonsAtLevel(level);
    if (polygons.length === 0) return null;

    const features: BundleFeature[] = [];
    let west = Infinity,
        south = Infinity,
        east = -Infinity,
        north = -Infinity;

    for (const { relationId, name, nameEn, coords } of polygons) {
        const props = {
            relationId,
            name,
            ...(nameEn ? { "name:en": nameEn } : {}),
        };
        for (const poly of coords) {
            for (const ring of poly) {
                if (ring.length < 2) continue;
                let rw = Infinity,
                    rs = Infinity,
                    re = -Infinity,
                    rn = -Infinity;
                for (const [lon, lat] of ring) {
                    if (lon < rw) rw = lon;
                    if (lon > re) re = lon;
                    if (lat < rs) rs = lat;
                    if (lat > rn) rn = lat;
                }
                if (rw < west) west = rw;
                if (rs < south) south = rs;
                if (re > east) east = re;
                if (rn > north) north = rn;
                features.push({
                    type: "Feature",
                    bbox: [rw, rs, re, rn],
                    geometry: { type: "LineString", coordinates: ring },
                    properties: { ...props },
                });
            }
        }
    }

    if (features.length === 0) return null;

    log.debug(
        `built ${category} bundle from boundaries (level ${level}): ` +
            `${features.length} ring features`,
    );

    return {
        schemaVersion: 1,
        category,
        generatedAt: new Date().toISOString(),
        source: "boundary-store",
        extractBbox: [west, south, east, north],
        features,
    };
}

/**
 * Returns true if a category has registered pack sources.
 *
 * Admin border categories are backed by the boundary store rather than a
 * registered measuring source, so they report `true` whenever any installed
 * pack carries boundaries at the tier's resolved level.
 */
export function hasPackSources(category: MeasuringCategory): boolean {
    if (isAdminBorderCategory(category)) {
        const level = resolveBorderLevel(category);
        if (level == null) return false;
        return getAvailableBoundaryLevels().includes(level);
    }
    const sources = packSources.get(category);
    return sources !== undefined && sources.length > 0;
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

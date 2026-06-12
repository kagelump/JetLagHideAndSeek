import type { HidingZonePreset } from "./hidingZoneTypes";
import type { Bbox } from "@/shared/geojson";
import { bboxIntersects } from "@/shared/geojson";
import {
    TRANSIT_MANIFEST,
    transitBundleLoaders,
} from "./transitBundles.generated";

// ─── Module-level cache ────────────────────────────────────────────────────

/**
 * Presets loaded so far, keyed by bundle id.
 * null = load in progress or failed; undefined = not yet loaded.
 */
const bundleCache = new Map<string, HidingZonePreset[] | null>();

// ─── Pack transit sources ──────────────────────────────────────────────────

type TransitPresetSummary = {
    id: string;
    label: string;
    bbox: [number, number, number, number];
    kind?: string;
};

type PackTransitSource = {
    packId: string;
    path: string;
    presetSummaries: TransitPresetSummary[];
};

const packTransitSources = new Map<string, PackTransitSource>();

/**
 * Register a transit source from an installed pack.
 * Called by the pack installer (T5) after verifying the transit artifact.
 * Preset IDs are prefixed with `${packId}:` to avoid collisions with
 * bundled presets.
 */
export function registerTransitSource(
    packId: string,
    path: string,
    presetSummaries: TransitPresetSummary[],
): void {
    // Safety: reject preset ids containing ':' (belt and braces).
    for (const p of presetSummaries) {
        if (p.id.includes(":")) {
            throw new Error(
                `registerTransitSource: preset id "${p.id}" contains ':' — ` +
                    `this would make the prefix ambiguous.`,
            );
        }
    }

    packTransitSources.set(packId, { packId, path, presetSummaries });
    // Clear any cached presets for this pack so they reload with new data.
    bundleCache.delete(packId);
}

/**
 * Unregister a transit source when a pack is removed.
 * Also clears cached presets for that pack.
 */
export function unregisterTransitSource(packId: string): void {
    packTransitSources.delete(packId);
    bundleCache.delete(packId);
}

/** For testing. */
export function __getPackTransitSourcesForTest(): Map<
    string,
    PackTransitSource
> {
    return packTransitSources;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Load hiding-zone presets for the given play area (or all bundles when bbox
 * is omitted / null).  Safe to call multiple times — previously loaded bundles
 * are kept; only bundles newly intersecting the bbox are fetched.
 *
 * @param playAreaBbox - optional play-area bounding box [w, s, e, n]
 */
export async function loadHidingZonePresets(
    playAreaBbox?: Bbox | null,
): Promise<HidingZonePreset[]> {
    const bundles = pickBundles(playAreaBbox);

    // Load any bundles not yet fetched.
    const promises: Promise<HidingZonePreset[]>[] = [];
    for (const bundle of bundles) {
        // Pack sources share one file per pack — use packId as the cache
        // key so in-flight markers and results are consistent (N5).
        const packSource = findPackSourceByBundleId(bundle.id);
        const cacheKey = packSource ? packSource.packId : bundle.id;

        if (bundleCache.has(cacheKey)) {
            const cached = bundleCache.get(cacheKey);
            if (cached) promises.push(Promise.resolve(cached));
            // null = in-flight; skip.
            continue;
        }

        // Mark in-flight (all pack presets share one marker).
        bundleCache.set(cacheKey, null);

        if (packSource) {
            // Load all presets for this pack once.
            promises.push(loadPackTransitBundle(packSource));
            continue;
        }

        const loader = transitBundleLoaders[bundle.id];
        if (!loader) {
            if (__DEV__) {
                console.warn(
                    `[hidingZoneData] No loader for bundle "${bundle.id}" — skipping.`,
                );
            }
            bundleCache.set(cacheKey, []);
            continue;
        }

        promises.push(
            loader().then((mod) => {
                const presets =
                    (mod as { presets: HidingZonePreset[] }).presets ?? [];
                bundleCache.set(cacheKey, presets);
                return presets;
            }),
        );
    }

    await Promise.all(promises);

    // Collect all loaded presets (from ALL bundles + pack sources — not just
    // those matching the current bbox — so bundles loaded for a previous area
    // are still available).
    const all: HidingZonePreset[] = [];
    for (const bundle of TRANSIT_MANIFEST.bundles) {
        const cached = bundleCache.get(bundle.id);
        if (cached) all.push(...cached);
    }
    // Also collect from pack transit sources.
    for (const [packId] of packTransitSources) {
        const cached = bundleCache.get(packId);
        if (cached) all.push(...cached);
    }

    return all;
}

/**
 * Return the already-loaded presets.  Throws if `loadHidingZonePresets` has
 * not resolved yet — callers must ensure the data is loaded first.
 */
export function getHidingZonePresets(): HidingZonePreset[] {
    const all: HidingZonePreset[] = [];
    for (const bundle of TRANSIT_MANIFEST.bundles) {
        const cached = bundleCache.get(bundle.id);
        if (cached) all.push(...cached);
    }
    for (const [packId] of packTransitSources) {
        const cached = bundleCache.get(packId);
        if (cached) all.push(...cached);
    }
    if (all.length === 0) {
        throw new Error(
            "Hiding zone presets not loaded yet. " +
                "Call loadHidingZonePresets() first.",
        );
    }
    return all;
}

/**
 * Synchronous fallback for consumers that can't wait for async load.
 * Returns an empty array before the first successful load.
 */
export function getHidingZonePresetsOrEmpty(): HidingZonePreset[] {
    const all: HidingZonePreset[] = [];
    for (const bundle of TRANSIT_MANIFEST.bundles) {
        const cached = bundleCache.get(bundle.id);
        if (cached) all.push(...cached);
    }
    return all;
}

/**
 * Returns the manifest for external consumers (e.g. settings UI counting
 * stations within the play area).
 */
export function getTransitManifest() {
    return TRANSIT_MANIFEST;
}

/**
 * Clear the bundle cache.  Used in tests.
 */
export function clearTransitBundleCache(): void {
    bundleCache.clear();
}

/** Clear pack transit sources (for testing). */
export function __clearPackTransitSourcesForTest(): void {
    packTransitSources.clear();
    bundleCache.clear();
}

// ─── Internals ─────────────────────────────────────────────────────────────

/**
 * Find a pack transit source by its synthetic bundle ID
 * (format: `${packId}:${presetId}`).
 */
function findPackSourceByBundleId(bundleId: string): PackTransitSource | null {
    // Parse packId from the bundle ID.
    const colonIdx = bundleId.indexOf(":");
    if (colonIdx < 0) return null;
    const packId = bundleId.slice(0, colonIdx);
    return packTransitSources.get(packId) ?? null;
}

/**
 * Load a transit bundle from a pack's filesystem path.
 * Prefixes all preset IDs with `${packId}:`.
 */
async function loadPackTransitBundle(
    source: PackTransitSource,
): Promise<HidingZonePreset[]> {
    try {
        const { File } = await import("expo-file-system");
        const fullPath = source.path;
        const lastSep = fullPath.lastIndexOf("/");
        const dir = fullPath.slice(0, lastSep);
        const name = fullPath.slice(lastSep + 1);
        const raw = await new File(dir, name).text();
        const bundle = JSON.parse(raw);
        const presets: HidingZonePreset[] =
            bundle.presets?.map((p: { id: string }) => ({
                ...p,
                id: `${source.packId}:${p.id}`,
            })) ?? [];

        // Cache under the packId (not per-preset) since one file = all presets.
        bundleCache.set(source.packId, presets);
        return presets;
    } catch {
        bundleCache.set(source.packId, []);
        return [];
    }
}

/**
 * Pick bundles whose bbox intersects the play-area bbox.
 * Also includes registered pack transit sources.
 * Returns all bundles + pack sources when playAreaBbox is null/undefined.
 */
function pickBundles(playAreaBbox?: Bbox | null) {
    const bundles = [...TRANSIT_MANIFEST.bundles];

    // Add pack transit sources as synthetic bundle entries.
    for (const [packId, source] of packTransitSources) {
        for (const summary of source.presetSummaries) {
            if (!playAreaBbox || bboxIntersects(summary.bbox, playAreaBbox)) {
                bundles.push({
                    id: `${packId}:${summary.id}`,
                    bbox: summary.bbox,
                    file: source.path,
                    presets: [
                        {
                            id: `${packId}:${summary.id}`,
                            label: summary.label,
                            bbox: summary.bbox,
                            kind: summary.kind,
                        },
                    ],
                });
            }
        }
    }

    if (!playAreaBbox) {
        return bundles;
    }
    return bundles.filter((b) => bboxIntersects(b.bbox, playAreaBbox));
}

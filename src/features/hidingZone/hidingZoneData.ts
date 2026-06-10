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
        if (bundleCache.has(bundle.id)) {
            const cached = bundleCache.get(bundle.id);
            if (cached) promises.push(Promise.resolve(cached));
            // null = in-flight; skip.
            continue;
        }

        // Mark in-flight.
        bundleCache.set(bundle.id, null);

        const loader = transitBundleLoaders[bundle.id];
        if (!loader) {
            if (__DEV__) {
                console.warn(
                    `[hidingZoneData] No loader for bundle "${bundle.id}" — skipping.`,
                );
            }
            bundleCache.set(bundle.id, []);
            continue;
        }

        promises.push(
            loader().then((mod) => {
                const presets =
                    (mod as { presets: HidingZonePreset[] }).presets ?? [];
                bundleCache.set(bundle.id, presets);
                return presets;
            }),
        );
    }

    await Promise.all(promises);

    // Collect all loaded presets (from ALL bundles — not just those matching
    // the current bbox — so bundles loaded for a previous area are still
    // available).
    const all: HidingZonePreset[] = [];
    for (const bundle of TRANSIT_MANIFEST.bundles) {
        const cached = bundleCache.get(bundle.id);
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

// ─── Internals ─────────────────────────────────────────────────────────────

/**
 * Pick bundles whose bbox intersects the play-area bbox.
 * Returns all bundles when playAreaBbox is null/undefined.
 */
function pickBundles(playAreaBbox?: Bbox | null) {
    if (!playAreaBbox) {
        // Fresh install — load all bundles (acceptable this phase per T3 spec).
        return TRANSIT_MANIFEST.bundles;
    }
    return TRANSIT_MANIFEST.bundles.filter((b) =>
        bboxIntersects(b.bbox, playAreaBbox),
    );
}

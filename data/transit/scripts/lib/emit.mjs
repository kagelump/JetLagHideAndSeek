import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

/**
 * Find the region whose bbox contains a point [lng, lat].
 *
 * @param {number[][]} regionBboxes - array of [w, s, e, n]
 * @param {number} lng
 * @param {number} lat
 * @returns {number} region index, or -1 if no region contains the point
 */
export function regionIndexForPoint(regionBboxes, lng, lat) {
    for (let i = 0; i < regionBboxes.length; i++) {
        const [w, s, e, n] = regionBboxes[i];
        if (lng >= w && lng <= e && lat >= s && lat <= n) return i;
    }
    return -1;
}

/**
 * Compute a preset's bbox center.
 * @param {object} preset - { bbox: [w,s,e,n] }
 * @returns {[number, number]} [lng, lat]
 */
export function presetCenter(preset) {
    const [w, s, e, n] = preset.bbox;
    return [(w + e) / 2, (s + n) / 2];
}

/**
 * Assign presets to regions by bbox center.
 *
 * @param {object[]} presets
 * @param {object[]} regions - [{ id, bbox: [w,s,e,n] }]
 * @returns {Map<string, object[]>} regionId → presets
 */
export function assignPresetsToRegions(presets, regions) {
    const map = new Map();
    const regionBboxes = regions.map((r) => r.bbox);

    for (const r of regions) {
        map.set(r.id, []);
    }

    for (const preset of presets) {
        // OSM presets: id may be "osm-<regionId>" (coverage) or
        // "osm-<regionId>-<operatorSlug>" (per-operator).  Find the region by
        // matching the id prefix.
        if (preset.id.startsWith("osm-")) {
            let matched = false;
            for (const r of regions) {
                if (
                    preset.id === `osm-${r.id}` ||
                    preset.id.startsWith(`osm-${r.id}-`)
                ) {
                    map.get(r.id).push(preset);
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                map.get(regions[0].id).push(preset);
            }
            continue;
        }

        const [lng, lat] = presetCenter(preset);
        const idx = regionIndexForPoint(regionBboxes, lng, lat);
        if (idx >= 0) {
            map.get(regions[idx].id).push(preset);
        } else {
            // Fallback: assign to the first region.
            console.warn(
                `  [emit] Preset "${preset.id}" center [${lng.toFixed(4)}, ${lat.toFixed(4)}] ` +
                    `not in any region bbox — assigning to "${regions[0].id}"`,
            );
            map.get(regions[0].id).push(preset);
        }
    }

    return map;
}

/**
 * Validate globally unique preset ids across all bundles.
 * Throws on duplicates.
 *
 * @param {Map<string, object[]>} regionPresets - regionId → presets
 */
export function validateUniquePresetIds(regionPresets) {
    const seen = new Map(); // presetId → regionId
    for (const [regionId, presets] of regionPresets) {
        for (const p of presets) {
            if (seen.has(p.id)) {
                throw new Error(
                    `Duplicate preset id "${p.id}" in regions "${seen.get(p.id)}" and "${regionId}"`,
                );
            }
            seen.set(p.id, regionId);
        }
    }
}

/**
 * Build the manifest object.
 *
 * @param {Map<string, object[]>} regionPresets - regionId → presets
 * @param {object[]} regions - [{ id, bbox }]
 * @returns {object} manifest
 */
export function buildManifest(regionPresets, regions) {
    const bundles = [];

    for (const region of regions) {
        const presets = regionPresets.get(region.id) || [];
        if (presets.length === 0) continue;

        bundles.push({
            id: region.id,
            bbox: region.bbox,
            file: `${region.id}.json`,
            presets: presets.map((p) => ({
                id: p.id,
                label: p.label,
                bbox: p.bbox,
                kind:
                    p.kind ||
                    (p.id.startsWith("osm-") ? "coverage" : "operator"),
            })),
        });
    }

    return { version: 1, bundles };
}

/**
 * Generate the TypeScript require-map module.
 *
 * Metro cannot `import()` a computed string — every bundle path must be a
 * literal. This function emits a switch-based map matching the POI pattern.
 *
 * @param {object} manifest - built manifest
 * @param {string} relativeToScript - path from generated file to assets/transit/
 * @returns {string} TypeScript source
 */
export function generateRequireMap(manifest, relativeToScript) {
    const lines = [];
    lines.push("// GENERATED — regenerate with `pnpm data:transit`");
    lines.push("// Do not hand-edit.");
    lines.push("");
    lines.push("import type { Bbox } from '@/shared/geojson';");
    lines.push(
        "import type { HidingZonePreset } from '@/features/hidingZone/hidingZoneTypes';",
    );
    lines.push("");
    lines.push("export type TransitBundle = {");
    lines.push("  attribution?: unknown;");
    lines.push("  presets: HidingZonePreset[];");
    lines.push("};");
    lines.push("");
    lines.push("export type TransitBundleMeta = {");
    lines.push("  id: string;");
    lines.push("  bbox: Bbox;");
    lines.push("  file: string;");
    lines.push(
        "  presets: { id: string; label: string; bbox: Bbox; kind?: string }[];",
    );
    lines.push("};");
    lines.push("");
    lines.push("export type TransitManifest = {");
    lines.push("  version: number;");
    lines.push("  bundles: TransitBundleMeta[];");
    lines.push("};");
    lines.push("");

    // Embed the manifest statically.  as TransitManifest cast lets JSON
    // number[] arrays satisfy the Bbox tuple type.
    lines.push(
        `export const TRANSIT_MANIFEST = ${JSON.stringify(manifest, null, 2)} as TransitManifest;`,
    );
    lines.push("");

    // Loader map: bundleId → () => import(...)
    lines.push(
        "export const transitBundleLoaders: Record<string, () => Promise<TransitBundle>> = {",
    );

    for (const bundle of manifest.bundles) {
        const importPath = `${relativeToScript}/${bundle.file}`;
        // import() for JSON may return { default: object }; unwrap if so.
        lines.push(
            `  "${bundle.id}": () => import("${importPath}").then(m => ((m as Record<string, unknown>).default ?? m) as TransitBundle),`,
        );
    }

    lines.push("};");

    return lines.join("\n") + "\n";
}

/**
 * Emit bundles, manifest, and generated require map.
 *
 * @param {object} ctx - pipeline context
 * @returns {Promise<void>}
 */
export async function emitStage(ctx) {
    const regions = ctx.locale.osm?.regions;
    if (!regions || regions.length === 0) {
        console.log("[emit] No regions configured — skipping bundle emission.");
        return;
    }

    const presets = [
        ...(ctx.gtfsPresets || []),
        ...(ctx.osmBaselinePresets || []),
    ];

    // Assign presets to regions.
    const regionPresets = assignPresetsToRegions(presets, regions);

    // Validate unique preset ids.
    validateUniquePresetIds(regionPresets);

    const outputDir = ctx.outputDir;
    await mkdir(outputDir, { recursive: true });

    // Write per-region bundles.
    for (const [regionId, regionPresetList] of regionPresets) {
        if (regionPresetList.length === 0) {
            console.log(`  [emit] ${regionId}: 0 presets — skipping bundle.`);
            continue;
        }

        const bundle = {
            attribution: {
                text: "See data/transit/NOTICE.md for attribution and license details.",
            },
            presets: regionPresetList,
        };

        const bundlePath = resolve(outputDir, `${regionId}.json`);
        await writeFile(bundlePath, JSON.stringify(bundle) + "\n");
        console.log(
            `  [emit] ${regionId}.json: ${regionPresetList.length} preset(s), ` +
                `${(Buffer.byteLength(JSON.stringify(bundle)) / 1024).toFixed(1)} KB`,
        );
    }

    // Write manifest.
    const manifest = buildManifest(regionPresets, regions);
    const manifestPath = resolve(outputDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest) + "\n");
    console.log(`  [emit] manifest.json: ${manifest.bundles.length} bundle(s)`);

    // Write generated require map.
    // Path from src/features/hidingZone/ to assets/transit/.
    const generatedDir = resolve(
        ctx.transitDir,
        "..",
        "..",
        "src",
        "features",
        "hidingZone",
    );
    await mkdir(generatedDir, { recursive: true });
    const relativeToScript = "../../../assets/transit";
    const generatedSrc = generateRequireMap(manifest, relativeToScript);
    const generatedPath = resolve(generatedDir, "transitBundles.generated.ts");
    await writeFile(generatedPath, generatedSrc);
    console.log(
        `  [emit] Generated ${resolve(generatedDir, relative(generatedDir, generatedPath))}`,
    );
}

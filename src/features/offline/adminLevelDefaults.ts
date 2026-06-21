/**
 * Derive admin-level defaults from installed packs.
 *
 * When the play area falls inside an installed pack, the pack's
 * `meta.adminLevels.matching` overrides the default 4/7/9/10 mapping.
 * Manual user overrides are sticky per play-area relation ID.
 */

import type { Bbox } from "@/shared/geojson";
import type { AdminDivisionNamePack } from "@/features/questions/matching/adminDivisionConfig";

/**
 * Minimal pack info needed for admin-level derivation.
 * Populated from the installed pack index (T5).
 */
/** A [labelEn, labelNative] pair for one admin level tier. */
type AdminLabelPair = [string, string];

export type PackAdminLevelInfo = {
    packId: string;
    label: string;
    bbox: Bbox;
    matchingLevels: [number, number, number, number];
    /** Optional per-level human-readable labels from the pack. */
    labels?: [AdminLabelPair, AdminLabelPair, AdminLabelPair, AdminLabelPair];
};

const _packLevels: PackAdminLevelInfo[] = [];

/**
 * Register a pack's admin level mapping. Called by the pack installer (T5)
 * after verifying the meta artifact.
 */
export function registerPackAdminLevels(info: PackAdminLevelInfo): void {
    // Avoid duplicates.
    const idx = _packLevels.findIndex((p) => p.packId === info.packId);
    if (idx >= 0) {
        _packLevels[idx] = info;
    } else {
        _packLevels.push(info);
    }
}

/** Unregister when a pack is removed. */
export function unregisterPackAdminLevels(packId: string): void {
    const idx = _packLevels.findIndex((p) => p.packId === packId);
    if (idx >= 0) _packLevels.splice(idx, 1);
}

/**
 * Find the installed pack whose bbox contains the play area, if any.
 * Prefer the smallest-area pack when multiple match.
 */
export function findPackForPlayArea(
    playAreaBbox: Bbox,
): PackAdminLevelInfo | null {
    let best: PackAdminLevelInfo | null = null;
    let bestArea = Infinity;

    for (const info of _packLevels) {
        // Check if pack bbox intersects play area bbox.
        if (!bboxesIntersect(info.bbox, playAreaBbox)) continue;

        const area =
            (info.bbox[2] - info.bbox[0]) * (info.bbox[3] - info.bbox[1]);
        if (area < bestArea) {
            bestArea = area;
            best = info;
        }
    }

    return best;
}

/**
 * Build an AdminDivisionNamePack from a pack's matching levels.
 * Uses per-pack labels when available; falls back to generic ordinals.
 */
export function buildPackAdminDivisionPack(
    info: PackAdminLevelInfo,
): AdminDivisionNamePack {
    return info.matchingLevels.map((osmLevel, i) => {
        const label = info.labels?.[i];
        return {
            osmLevel: String(osmLevel),
            labelNative: label?.[1] ?? "",
            labelEn: label?.[0] ?? genericLabel(ordinal(i), String(osmLevel)),
        };
    }) as unknown as AdminDivisionNamePack;
}

function ordinal(n: number): string {
    switch (n) {
        case 0:
            return "1st";
        case 1:
            return "2nd";
        case 2:
            return "3rd";
        case 3:
            return "4th";
        default:
            return `${n + 1}th`;
    }
}

function genericLabel(ordinalStr: string, osmLevel: string): string {
    return `${ordinalStr} Admin Division (OSM level ${osmLevel})`;
}

function bboxesIntersect(a: Bbox, b: Bbox): boolean {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Clear all state (for testing). */
export function resetAdminLevelDefaults(): void {
    _packLevels.length = 0;
}

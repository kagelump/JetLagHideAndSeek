/**
 * Coverage status selector — drives the red (!) badge, download prompts,
 * and update check.  Pure function + hook.
 *
 * Bundled Japan regions count as "covered" regardless of catalog state.
 */

import type { Bbox } from "@/shared/geojson";

// ─── Types ────────────────────────────────────────────────────────────────

export type ArtifactKind =
    | "poi"
    | "measuring"
    | "boundaries"
    | "transit"
    | "meta";

export type CoverageStatus =
    | { state: "covered"; packId: string; updateAvailable: boolean }
    | {
          state: "partial";
          packId: string;
          missingKinds: ArtifactKind[];
      }
    | { state: "available"; packId: string; label: string; totalBytes: number }
    | { state: "uncovered" }
    | { state: "unknown" };

/** Minimal catalog pack entry for coverage computation. */
export type CatalogPackInfo = {
    id: string;
    label: string;
    bbox: Bbox;
    osmSnapshot: string;
    totalBytes: number;
};

/** Minimal installed pack entry for coverage computation. */
export type InstalledPackInfo = {
    id: string;
    osmSnapshot: string;
    bbox?: Bbox;
    artifactKinds: ArtifactKind[];
    missingKinds: ArtifactKind[];
};

// ─── Bundled Japan region bboxes ────────────────────────────────────────

/**
 * Bundled Japan regions from assets/poi/regions.json.
 * These are always "covered" — the badge must never show for Japan.
 */
const BUNDLED_REGION_BBOXES: { id: string; bbox: Bbox }[] = [
    { id: "japan-kanto", bbox: [138.4, 34.8, 140.3, 36.9] },
    { id: "japan-chubu", bbox: [136.5, 34.5, 138.8, 37.6] },
    { id: "japan-kansai", bbox: [134.6, 33.8, 136.9, 35.8] },
    { id: "japan-chugoku", bbox: [130.7, 33.9, 134.6, 35.7] },
    { id: "japan-shikoku", bbox: [131.9, 32.5, 134.8, 34.5] },
    { id: "japan-kyushu", bbox: [128.6, 30.1, 132.4, 34.2] },
    { id: "japan-tohoku", bbox: [139.4, 36.5, 142.2, 41.6] },
    { id: "japan-hokkaido", bbox: [139.0, 40.9, 145.8, 45.6] },
];

/**
 * Check if a bbox falls inside any bundled Japan region.
 * Japan must never show the offline badge.
 */
export function isBboxInJapan(_bbox: Bbox): boolean {
    return isCoveredByBundledJapan(_bbox);
}

function isCoveredByBundledJapan(_bbox: Bbox): boolean {
    // For simplicity, we check if the play area bbox intersects any bundled
    // Japan region. The actual Japan coverage is more nuanced (bundled Kantō
    // covers matching + measuring), but for badge purposes, if the play area
    // is in Japan we consider it covered.
    //
    // In practice, this is checked BEFORE pack-based coverage, so Japan
    // play areas always show "covered".
    for (const region of BUNDLED_REGION_BBOXES) {
        if (bboxesIntersect(_bbox, region.bbox)) return true;
    }
    return false;
}

// ─── Coverage computation ───────────────────────────────────────────────

/**
 * Compute the coverage status for a play-area bbox.
 *
 * Rules:
 * 1. Bundled Japan regions → `covered` (never show badge)
 * 2. Installed pack intersects → `covered` (or `partial` if incomplete)
 * 3. Catalog pack intersects but none installed → `available`
 * 4. Nothing intersects → `uncovered`
 * 5. No catalog data → `unknown`
 *
 * For overlapping packs, prefers: installed over catalog, then smallest-area.
 */
export function getCoverageStatus(
    playAreaBbox: Bbox,
    catalogPacks: CatalogPackInfo[] | undefined,
    installedPacks: InstalledPackInfo[],
): CoverageStatus {
    // 1. Bundled Japan regions are always covered.
    if (isCoveredByBundledJapan(playAreaBbox)) {
        return {
            state: "covered",
            packId: "japan-bundled",
            updateAvailable: false,
        };
    }

    // 2. Check installed packs.
    const installedCandidates = installedPacks
        .filter((p) => {
            // Use catalog bbox first, fall back to installed bbox.
            const catPack = catalogPacks?.find((c) => c.id === p.id);
            const packBbox = catPack?.bbox ?? p.bbox;
            if (!packBbox) return false;
            return bboxesIntersect(playAreaBbox, packBbox);
        })
        .sort((a, b) => {
            const aCat = catalogPacks?.find((c) => c.id === a.id);
            const bCat = catalogPacks?.find((c) => c.id === b.id);
            const aBbox = aCat?.bbox ?? a.bbox;
            const bBbox = bCat?.bbox ?? b.bbox;
            const aArea = aBbox
                ? (aBbox[2] - aBbox[0]) * (aBbox[3] - aBbox[1])
                : Infinity;
            const bArea = bBbox
                ? (bBbox[2] - bBbox[0]) * (bBbox[3] - bBbox[1])
                : Infinity;
            return aArea - bArea;
        });

    if (installedCandidates.length > 0) {
        const best = installedCandidates[0];
        if (best.missingKinds.length > 0) {
            return {
                state: "partial",
                packId: best.id,
                missingKinds: best.missingKinds,
            };
        }
        // Check for updates.
        const catPack = catalogPacks?.find((c) => c.id === best.id);
        const updateAvailable =
            catPack != null && catPack.osmSnapshot > best.osmSnapshot;
        return {
            state: "covered",
            packId: best.id,
            updateAvailable,
        };
    }

    // 3. Check catalog for available packs.
    if (catalogPacks && catalogPacks.length > 0) {
        const catalogCandidates = catalogPacks
            .filter((p) => bboxesIntersect(playAreaBbox, p.bbox))
            .sort((a, b) => packArea(a) - packArea(b));

        if (catalogCandidates.length > 0) {
            const best = catalogCandidates[0];
            return {
                state: "available",
                packId: best.id,
                label: best.label,
                totalBytes: best.totalBytes,
            };
        }
    }

    // 4. No catalog data at all.
    if (!catalogPacks) {
        return { state: "unknown" };
    }

    // 5. Nothing covers this area.
    return { state: "uncovered" };
}

function packArea(pack: CatalogPackInfo | undefined): number {
    if (!pack) return Infinity;
    return (pack.bbox[2] - pack.bbox[0]) * (pack.bbox[3] - pack.bbox[1]);
}

function bboxesIntersect(a: Bbox, b: Bbox): boolean {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Coverage status selector — drives the red (!) badge, download prompts,
 * and update check.  Pure function + hook.
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

// ─── Japan geographic check ─────────────────────────────────────────────

/** Japan region bboxes — used for geographic admin-division preset selection. */
const JAPAN_BBOXES: Bbox[] = [
    [138.4, 34.8, 140.3, 36.9], // Kantō
    [136.5, 34.5, 138.8, 37.6], // Chūbu
    [134.6, 33.8, 136.9, 35.8], // Kansai
    [130.7, 33.9, 134.6, 35.7], // Chūgoku
    [131.9, 32.5, 134.8, 34.5], // Shikoku
    [128.6, 30.1, 132.4, 34.2], // Kyūshū
    [139.4, 36.5, 142.2, 41.6], // Tōhoku
    [139.0, 40.9, 145.8, 45.6], // Hokkaidō
];

/** Check if a bbox falls inside Japan (geographic utility for admin-division presets). */
export function isBboxInJapan(bbox: Bbox): boolean {
    for (const jpBbox of JAPAN_BBOXES) {
        if (bboxesIntersect(bbox, jpBbox)) return true;
    }
    return false;
}

// ─── Coverage computation ───────────────────────────────────────────────

/**
 * Compute the coverage status for a play-area bbox.
 *
 * Ranking for intersecting packs:
 * 1. Packs that fully **contain** the play area (smallest first).
 * 2. Packs that partially overlap, sorted by highest intersection ratio
 *    (intersection area / play-area area).
 *
 * This prevents edge-clipping neighbors (e.g. Chubu barely touching
 * western Tokyo) from beating a region that actually covers the play
 * area (Kanto, which has an inflated bbox from Pacific island territories).
 */
export function getCoverageStatus(
    playAreaBbox: Bbox,
    catalogPacks: CatalogPackInfo[] | undefined,
    installedPacks: InstalledPackInfo[],
): CoverageStatus {
    const ranker = (aBbox: Bbox, bBbox: Bbox): number => {
        const aContains = bboxContains(aBbox, playAreaBbox);
        const bContains = bboxContains(bBbox, playAreaBbox);
        // Containers always beat non-containers.
        if (aContains && !bContains) return -1;
        if (!aContains && bContains) return 1;
        // Both containers: smaller area wins.
        if (aContains) return packAreaBbox(aBbox) - packAreaBbox(bBbox);
        // Neither contains: higher intersection ratio wins.
        return (
            intersectionRatio(bBbox, playAreaBbox) -
            intersectionRatio(aBbox, playAreaBbox)
        );
    };

    // 1. Check installed packs.
    const installedCandidates = installedPacks
        .filter((p) => {
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
            if (!aBbox || !bBbox) return 0;
            return ranker(aBbox, bBbox);
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
        const catPack = catalogPacks?.find((c) => c.id === best.id);
        const updateAvailable =
            catPack != null && catPack.osmSnapshot > best.osmSnapshot;
        return {
            state: "covered",
            packId: best.id,
            updateAvailable,
        };
    }

    // 2. Check catalog for available packs.
    if (catalogPacks && catalogPacks.length > 0) {
        const catalogCandidates = catalogPacks
            .filter((p) => bboxesIntersect(playAreaBbox, p.bbox))
            .sort((a, b) => ranker(a.bbox, b.bbox));

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

    // 3. No catalog data at all.
    if (!catalogPacks) {
        return { state: "unknown" };
    }

    // 4. Nothing covers this area.
    return { state: "uncovered" };
}

function bboxesIntersect(a: Bbox, b: Bbox): boolean {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Returns true when `container` fully encloses `inner`. */
function bboxContains(container: Bbox, inner: Bbox): boolean {
    return (
        container[0] <= inner[0] &&
        container[1] <= inner[1] &&
        container[2] >= inner[2] &&
        container[3] >= inner[3]
    );
}

/** Intersection area / inner area.  0 = no overlap, 1 = fully contained. */
function intersectionRatio(packBbox: Bbox, inner: Bbox): number {
    const ixMin = Math.max(packBbox[0], inner[0]);
    const iyMin = Math.max(packBbox[1], inner[1]);
    const ixMax = Math.min(packBbox[2], inner[2]);
    const iyMax = Math.min(packBbox[3], inner[3]);
    if (ixMin >= ixMax || iyMin >= iyMax) return 0;
    const intersection = (ixMax - ixMin) * (iyMax - iyMin);
    const innerArea = (inner[2] - inner[0]) * (inner[3] - inner[1]);
    return innerArea > 0 ? intersection / innerArea : 0;
}

function packAreaBbox(bbox: Bbox): number {
    return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
}

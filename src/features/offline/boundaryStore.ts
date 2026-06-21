/**
 * Boundary store — consumes the `boundaries` artifact installed by the
 * pack installer (T5).  Provides offline name search and lazy polygon
 * decoding for play-area setup and admin-division matching.
 *
 * Index rows are loaded eagerly at start / post-install (small).
 * Polygons are decoded lazily via an LRU cache (cap ~8).
 */

import { decodeDeltaPolygon } from "./deltaDecode";
import type { MultiPolygonCoords } from "./deltaDecode";
import type { Bbox } from "@/shared/geojson";

// ─── Types ────────────────────────────────────────────────────────────────

export type BoundaryIndexEntry = {
    relationId: number;
    name: string;
    nameEn?: string;
    normalized: string[];
    adminLevel: number;
    centroid: [number, number];
    bbox: Bbox;
    areaKm2: number;
};

export type BoundaryHit = {
    relationId: number;
    name: string;
    nameEn?: string;
    adminLevel: number;
    centroid: [number, number];
    bbox: Bbox;
    source: "pack";
};

type PackBoundarySource = {
    packId: string;
    indexPath: string;
    polygonsPath: string;
    index: BoundaryIndexEntry[];
    levels: number[];
};

// ─── LRU polygon cache ────────────────────────────────────────────────────

const POLYGON_CACHE_CAP = 8;
const polygonCache = new Map<string, MultiPolygonCoords>();
const polygonCacheOrder: string[] = [];

function cacheKey(packId: string, relationId: number): string {
    return `${packId}:${relationId}`;
}

function touchLru(key: string) {
    const idx = polygonCacheOrder.indexOf(key);
    if (idx >= 0) polygonCacheOrder.splice(idx, 1);
    polygonCacheOrder.push(key);
}

function evictLru() {
    while (polygonCacheOrder.length > POLYGON_CACHE_CAP) {
        const oldest = polygonCacheOrder.shift()!;
        polygonCache.delete(oldest);
    }
}

// ─── Registry ─────────────────────────────────────────────────────────────

const sources = new Map<string, PackBoundarySource>();

/**
 * Register a boundary source from an installed pack.
 * Called by the pack installer (T5) after verifying and splitting the
 * boundaries artifact.
 */
export function registerBoundarySource(
    packId: string,
    indexPath: string,
    polygonsPath: string,
    index: BoundaryIndexEntry[],
    levels: number[],
): void {
    sources.set(packId, {
        packId,
        indexPath,
        polygonsPath,
        index,
        levels,
    });
}

/**
 * Unregister a boundary source when a pack is removed.
 */
export function unregisterBoundarySource(packId: string): void {
    sources.delete(packId);
    // Evict cached polygons for this pack.
    for (const key of polygonCache.keys()) {
        if (key.startsWith(`${packId}:`)) {
            polygonCache.delete(key);
            const idx = polygonCacheOrder.indexOf(key);
            if (idx >= 0) polygonCacheOrder.splice(idx, 1);
        }
    }
}

/**
 * Return all registered pack IDs (for debugging/testing).
 */
export function getRegisteredBoundaryPackIds(): string[] {
    return [...sources.keys()];
}

// ─── Normalization ────────────────────────────────────────────────────────

/**
 * Normalize a string for search: lowercase + NFKD + strip combining marks.
 * Must exactly match the pipeline normalizer in
 * data/packs/scripts/lib/normalizeNames.mjs so queries match indexed variants.
 * Strips only U+0300–U+036F (Combining Diacritical Marks block), not all
 * \p{Mark} — Japanese dakuten/handakuten (U+3099/U+309A) are preserved.
 */
export function normalizeForSearch(input: string): string {
    return input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ─── Search ───────────────────────────────────────────────────────────────

/**
 * Search all registered boundary indexes for a query.
 *
 * Ranking: exact match > prefix match > substring match,
 * then lower adminLevel first, then larger areaKm2.
 * Capped at 20 results.
 */
export function searchBoundaries(query: string): BoundaryHit[] {
    if (!query || query.trim().length === 0) return [];

    const normalized = normalizeForSearch(query.trim());
    if (normalized.length === 0) return [];

    // Collect all hits from all sources.
    const hits: { entry: BoundaryIndexEntry; packId: string; rank: number }[] =
        [];

    for (const [packId, source] of sources) {
        for (const entry of source.index) {
            let bestRank = Infinity; // lower is better — 0=exact, 1=prefix, 2=substring

            for (const variant of entry.normalized) {
                if (variant === normalized) {
                    bestRank = Math.min(bestRank, 0);
                } else if (variant.startsWith(normalized)) {
                    bestRank = Math.min(bestRank, 1);
                } else if (variant.includes(normalized)) {
                    bestRank = Math.min(bestRank, 2);
                }
            }

            if (bestRank < Infinity) {
                hits.push({ entry, packId, rank: bestRank });
            }
        }
    }

    // Sort: rank (exact/prefix/substring) → adminLevel → area descending.
    hits.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (a.entry.adminLevel !== b.entry.adminLevel) {
            return a.entry.adminLevel - b.entry.adminLevel;
        }
        return b.entry.areaKm2 - a.entry.areaKm2;
    });

    return hits.slice(0, 20).map((h) => ({
        relationId: h.entry.relationId,
        name: h.entry.name,
        nameEn: h.entry.nameEn,
        adminLevel: h.entry.adminLevel,
        centroid: h.entry.centroid,
        bbox: h.entry.bbox,
        source: "pack" as const,
    }));
}

// ─── Polygon loading ──────────────────────────────────────────────────────

/**
 * Decode the polygon for a relation from its installed pack.
 * Uses an LRU cache — decodes only on first request.
 *
 * Returns null if the polygon is not found or the pack is not installed.
 */
export async function getBoundaryPolygon(
    packId: string,
    relationId: number,
): Promise<MultiPolygonCoords | null> {
    const key = cacheKey(packId, relationId);

    // LRU hit.
    const cached = polygonCache.get(key);
    if (cached) {
        touchLru(key);
        return cached;
    }

    const source = sources.get(packId);
    if (!source) return null;

    // Lazy-load the polygons JSON file.
    try {
        const { File } = await import("expo-file-system");
        const fullPath = source.polygonsPath;
        const lastSep = fullPath.lastIndexOf("/");
        const dir = fullPath.slice(0, lastSep);
        const name = fullPath.slice(lastSep + 1);
        const raw = await new File(dir, name).text();

        // The installer writes the polygons file as a `{ schemaVersion,
        // regionId, polygons: {...} }` envelope (see regionPacks install).
        // Accept that envelope, and tolerate a bare `{ [relationId]: encoded }`
        // map for forward/backward compatibility.
        const parsed = JSON.parse(raw) as
            | { polygons?: Record<string, number[]> }
            | Record<string, number[]>;
        const polygons: Record<string, number[]> =
            parsed && typeof parsed === "object" && "polygons" in parsed
                ? ((parsed.polygons ?? {}) as Record<string, number[]>)
                : (parsed as Record<string, number[]>);
        const encoded = polygons[String(relationId)];
        if (!encoded) return null;

        const coords = decodeDeltaPolygon(encoded);

        // Cache and evict if needed.
        polygonCache.set(key, coords);
        touchLru(key);
        evictLru();

        return coords;
    } catch {
        return null;
    }
}

/**
 * Find which installed pack (if any) contains a relation ID.
 * Returns the pack ID and the index entry, or null.
 */
export function findBoundaryRelation(
    relationId: number,
): { packId: string; entry: BoundaryIndexEntry } | null {
    for (const [packId, source] of sources) {
        const entry = source.index.find((e) => e.relationId === relationId);
        if (entry) return { packId, entry };
    }
    return null;
}

/**
 * Check whether a bbox intersects any installed pack's boundary index bbox.
 * Used by `loadPlayAreaByRelationId` to decide whether to search packs.
 */
export function anyPackIntersectsBbox(bbox: Bbox): boolean {
    for (const source of sources.values()) {
        for (const entry of source.index) {
            if (bboxesIntersect(bbox, entry.bbox)) {
                return true;
            }
        }
    }
    return false;
}

function bboxesIntersect(a: Bbox, b: Bbox): boolean {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * Get all boundary index entries from all installed packs.
 * Used by the admin-division loader (T8).
 */
export function getAllBoundaryEntries(): BoundaryIndexEntry[] {
    const result: BoundaryIndexEntry[] = [];
    for (const source of sources.values()) {
        result.push(...source.index);
    }
    return result;
}

/**
 * Get all admin levels present across installed packs.
 * Used to know which levels have boundary data available.
 */
export function getAvailableBoundaryLevels(): number[] {
    const levels = new Set<number>();
    for (const source of sources.values()) {
        for (const lv of source.levels) {
            levels.add(lv);
        }
    }
    return [...levels].sort((a, b) => a - b);
}

/**
 * Count index entries per admin level across installed packs.
 * Surfaced in the Admin Divisions settings UI so the user sees how many
 * relations back each level (a level with 0 relations would yield empty
 * matching/measuring results).
 */
export function getBoundaryLevelCounts(): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const source of sources.values()) {
        for (const entry of source.index) {
            counts[entry.adminLevel] = (counts[entry.adminLevel] ?? 0) + 1;
        }
    }
    return counts;
}

/**
 * Decode every boundary polygon at the given admin level across installed
 * packs. Used by the unified admin-border runtime adapter so measuring
 * "distance to admin border" reads from the SAME boundary polygons as
 * matching, instead of a separate measuring-admin line bundle.
 *
 * Returns decoded MultiPolygon coordinates per relation. Decoding goes through
 * the same LRU-cached `getBoundaryPolygon` path.
 */
export async function getBoundaryPolygonsAtLevel(osmLevel: number): Promise<
    {
        relationId: number;
        name: string;
        nameEn?: string;
        coords: MultiPolygonCoords;
    }[]
> {
    const out: {
        relationId: number;
        name: string;
        nameEn?: string;
        coords: MultiPolygonCoords;
    }[] = [];

    for (const [packId, source] of sources) {
        for (const entry of source.index) {
            if (entry.adminLevel !== osmLevel) continue;
            const coords = await getBoundaryPolygon(packId, entry.relationId);
            if (!coords || coords.length === 0) continue;
            out.push({
                relationId: entry.relationId,
                name: entry.name,
                nameEn: entry.nameEn,
                coords,
            });
        }
    }

    return out;
}

/** Clear all state (for testing). */
export function resetBoundaryStore(): void {
    sources.clear();
    polygonCache.clear();
    polygonCacheOrder.length = 0;
}

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Position } from "@/shared/geojson";
import { haversineDistanceMeters } from "@/shared/geojson";

import type { FetchDebugInfo, FetchOrigin } from "./fetchDebug";
import { getBundledCategoryFeatures, regionCoveringPoint } from "./bundledPois";
import { resolveBboxFeatures } from "./featureSource";
import { getCategoryConfig } from "./matchingCategories";
import { isBundleableCategory } from "./matchingSelectors";
import type { MatchingCategory, OsmFeature } from "./matchingTypes";
import {
    DEFAULT_SEARCH_RADIUS_METERS,
    fetchAndParseOverpassFeatures,
    rankMatchingFeatures,
    type OsmFeatureWithDistance,
} from "./osmMatching";
import { cellBbox, cellsForSearch } from "./osmMatchingGrid";

// ─── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;
const CACHE_KEY_PREFIX = "osm-matching-cache:";
const MANIFEST_KEY = "osm-matching-manifest";

/** Raw features are valid for 90 days before a background refresh is triggered. */
export const MATCHING_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Ratio by which the fetch radius exceeds the requested radius. Fetching a
 * larger circle lets the cached result serve nearby follow-up searches without
 * a new Overpass request. The larger fetch radius adds more features to the
 * response but also extends the reuse window proportionally.
 */
export const OVERSCAN_FACTOR = 1.5;

/** Maximum number of entries kept in the in-process LRU. */
const MEMORY_LRU_MAX = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

type OsmMatchingCacheEntry = {
    schemaVersion: number;
    category: MatchingCategory;
    centerLat: number;
    centerLon: number;
    radiusMeters: number;
    fetchedAt: number;
    features: OsmFeature[];
};

type OsmMatchingManifestRow = {
    key: string;
    category: MatchingCategory;
    centerLat: number;
    centerLon: number;
    radiusMeters: number;
    fetchedAt: number;
    featureCount: number;
};

type OsmMatchingManifest = {
    schemaVersion: number;
    rows: OsmMatchingManifestRow[];
};

export type OsmMatchingCacheSource = "memory" | "disk" | "stale" | "network";

export type OsmMatchingFeaturesResult = {
    candidates: OsmFeatureWithDistance[];
    source: OsmMatchingCacheSource;
    /** Fetch-debug metadata for the question-sheet footer. */
    debug?: FetchDebugInfo;
};

// ─── Cell-based cache types ────────────────────────────────────────────────

const CELL_SCHEMA_VERSION = 1;

type OsmMatchingCellEntry = {
    schemaVersion: number;
    category: MatchingCategory;
    cellIndex: string;
    bbox: { south: number; west: number; north: number; east: number };
    fetchedAt: number;
    features: OsmFeature[];
};

type OsmMatchingCellManifestRow = {
    key: string;
    category: MatchingCategory;
    cellIndex: string;
    fetchedAt: number;
    featureCount: number;
};

type OsmMatchingCellManifest = {
    schemaVersion: number;
    rows: OsmMatchingCellManifestRow[];
};

export type OsmMatchingCellSource = "memory" | "disk" | "stale" | "network";

// ─── Module-level state ───────────────────────────────────────────────────────

// In-memory LRU. Map preserves insertion order; re-inserting an entry at the
// end is an O(1) promotion. The oldest (least recently used) entry is the
// first key returned by Map.keys().
const memoryLru = new Map<string, OsmMatchingCacheEntry>();

// Per-key in-flight deduplication so parallel callers share one Overpass request.
const inflight = new Map<string, Promise<OsmFeature[]>>();

// Manifest loaded lazily and kept in memory to avoid re-reading AsyncStorage.
let manifestCache: OsmMatchingManifest | null = null;

// Sequential promise chain that serializes manifest mutations so concurrent
// persistEntry calls for different keys do not lose rows via a read-modify-write
// race.
let manifestMutex: Promise<void> = Promise.resolve();

// ─── Cell-based module-level state ─────────────────────────────────────────

// Separate in-memory LRU for cell-cached entries.
const cellMemoryLru = new Map<string, OsmMatchingCellEntry>();

// Per-cell in-flight deduplication.
const cellInflight = new Map<string, Promise<CellFetchResult>>();

// Cell manifest loaded lazily.
let cellManifestCache: OsmMatchingCellManifest | null = null;

// Sequential promise chain for cell manifest mutations.
let cellManifestMutex: Promise<void> = Promise.resolve();

// Monotonically increasing epoch that is bumped on every clearOsmMatchingCache
// call. In-flight fetchAndStoreCell / cellRevalidateInBackground captures the
// epoch at start and skips persistCellEntry when it no longer matches, avoiding
// a post-clear re-persist race.
let cacheEpoch = 0;

// ─── Spatial math ─────────────────────────────────────────────────────────────

/**
 * Returns true when every point within (requestedLat, requestedLon, requestedR)
 * is also within (cachedLat, cachedLon, cachedR). Proof:
 *   dist(cached, requested) + requestedR <= cachedR
 */
export function containsSearchCircle(
    cachedCenterLat: number,
    cachedCenterLon: number,
    cachedRadiusMeters: number,
    requestedCenterLat: number,
    requestedCenterLon: number,
    requestedRadiusMeters: number,
): boolean {
    const dist = haversineDistanceMeters(
        cachedCenterLat,
        cachedCenterLon,
        requestedCenterLat,
        requestedCenterLon,
    );
    return dist + requestedRadiusMeters <= cachedRadiusMeters;
}

/** Returns the overscan fetch radius for a given requested radius. */
export function getOverscanRadius(requestedRadiusMeters: number): number {
    return Math.ceil(requestedRadiusMeters * OVERSCAN_FACTOR);
}

// ─── Cache key ────────────────────────────────────────────────────────────────

function makeCacheKey(
    category: MatchingCategory,
    lat: number,
    lon: number,
    radiusMeters: number,
): string {
    // Round to ~1 cm precision to prevent IEEE-754 representation artifacts
    // (e.g. 35.680000000000001 vs 35.68) from producing different keys for
    // semantically identical coordinates.
    const rLat = Math.round(lat * 1e7) / 1e7;
    const rLon = Math.round(lon * 1e7) / 1e7;
    const rRadius = Math.round(radiusMeters);
    return `${CACHE_KEY_PREFIX}${category}:${rLat}:${rLon}:${rRadius}`;
}

// ─── Memory LRU helpers ───────────────────────────────────────────────────────

function memorySet(key: string, entry: OsmMatchingCacheEntry): void {
    memoryLru.delete(key);
    memoryLru.set(key, entry);
    while (memoryLru.size > MEMORY_LRU_MAX) {
        const oldest = memoryLru.keys().next().value;
        if (oldest !== undefined) memoryLru.delete(oldest);
    }
}

/** Finds the freshest in-memory entry whose coverage circle contains the request. */
function findInMemory(
    category: MatchingCategory,
    requestedLat: number,
    requestedLon: number,
    requestedRadius: number,
): { key: string; entry: OsmMatchingCacheEntry } | null {
    let best: { key: string; entry: OsmMatchingCacheEntry } | null = null;
    for (const [key, entry] of memoryLru) {
        if (entry.category !== category) continue;
        if (
            !containsSearchCircle(
                entry.centerLat,
                entry.centerLon,
                entry.radiusMeters,
                requestedLat,
                requestedLon,
                requestedRadius,
            )
        ) {
            continue;
        }
        if (!best || entry.fetchedAt > best.entry.fetchedAt) {
            best = { key, entry };
        }
    }
    return best;
}

// ─── Manifest helpers ─────────────────────────────────────────────────────────

async function loadManifest(): Promise<OsmMatchingManifest> {
    if (manifestCache) return manifestCache;
    try {
        const raw = await AsyncStorage.getItem(MANIFEST_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (isManifest(parsed)) {
                manifestCache = parsed;
                return manifestCache;
            }
        }
    } catch {
        // Treat corrupt or unavailable storage as an empty manifest.
    }
    manifestCache = { schemaVersion: SCHEMA_VERSION, rows: [] };
    return manifestCache;
}

async function saveManifest(manifest: OsmMatchingManifest): Promise<void> {
    manifestCache = manifest;
    try {
        await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
    } catch {
        // Storage may be unavailable; the in-memory manifestCache is still current.
    }
}

function isManifest(value: unknown): value is OsmMatchingManifest {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).schemaVersion === SCHEMA_VERSION &&
        Array.isArray((value as Record<string, unknown>).rows)
    );
}

/** Returns the freshest manifest row whose coverage circle contains the request. */
function findInManifest(
    manifest: OsmMatchingManifest,
    category: MatchingCategory,
    requestedLat: number,
    requestedLon: number,
    requestedRadius: number,
): OsmMatchingManifestRow | null {
    let best: OsmMatchingManifestRow | null = null;
    for (const row of manifest.rows) {
        if (row.category !== category) continue;
        if (
            !containsSearchCircle(
                row.centerLat,
                row.centerLon,
                row.radiusMeters,
                requestedLat,
                requestedLon,
                requestedRadius,
            )
        ) {
            continue;
        }
        if (!best || row.fetchedAt > best.fetchedAt) {
            best = row;
        }
    }
    return best;
}

// ─── Disk helpers ─────────────────────────────────────────────────────────────

async function loadFromDisk(
    key: string,
): Promise<OsmMatchingCacheEntry | null> {
    try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        return isCacheEntry(parsed) ? parsed : null;
    } catch {
        // Return null without deleting the corrupt entry — removing it would
        // orphan the corresponding manifest row.
        return null;
    }
}

async function persistEntry(
    key: string,
    entry: OsmMatchingCacheEntry,
): Promise<void> {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(entry));
    } catch {
        // Storage may be unavailable.
    }
    // Serialize manifest mutations through a sequential chain so concurrent
    // persistEntry calls for different keys do not lose rows.
    manifestMutex = manifestMutex
        .then(async () => {
            const manifest = await loadManifest();
            const row: OsmMatchingManifestRow = {
                key,
                category: entry.category,
                centerLat: entry.centerLat,
                centerLon: entry.centerLon,
                radiusMeters: entry.radiusMeters,
                fetchedAt: entry.fetchedAt,
                featureCount: entry.features.length,
            };
            const idx = manifest.rows.findIndex((r) => r.key === key);
            if (idx >= 0) {
                manifest.rows[idx] = row;
            } else {
                manifest.rows.push(row);
            }
            await saveManifest(manifest);
        })
        .catch(() => {
            // If a manifest mutation fails, allow subsequent mutations to
            // proceed.
        });
    await manifestMutex;
}

function isCacheEntry(value: unknown): value is OsmMatchingCacheEntry {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    return (
        obj.schemaVersion === SCHEMA_VERSION &&
        typeof obj.category === "string" &&
        typeof obj.centerLat === "number" &&
        typeof obj.centerLon === "number" &&
        typeof obj.radiusMeters === "number" &&
        typeof obj.fetchedAt === "number" &&
        Array.isArray(obj.features)
    );
}

// ─── TTL / staleness ──────────────────────────────────────────────────────────

function isStale(entry: OsmMatchingCacheEntry): boolean {
    const ageMs = Date.now() - entry.fetchedAt;
    return ageMs < 0 || ageMs >= MATCHING_CACHE_TTL_MS;
}

// ─── Background revalidation ──────────────────────────────────────────────────

function revalidateInBackground(
    key: string,
    entry: OsmMatchingCacheEntry,
): void {
    if (inflight.has(key)) return;

    const revalidateCenter: Position = [entry.centerLon, entry.centerLat];
    const request = fetchAndParseOverpassFeatures(
        entry.category,
        revalidateCenter,
        entry.radiusMeters,
    )
        .then(async (features) => {
            const updated: OsmMatchingCacheEntry = {
                ...entry,
                features,
                fetchedAt: Date.now(),
            };
            memorySet(key, updated);
            await persistEntry(key, updated);
            return features;
        })
        .catch((err) => {
            // Keep serving the stale entry when Overpass is unavailable.
            console.warn(
                "[osmMatchingCache] background revalidation failed:",
                err,
            );
            return entry.features;
        })
        .finally(() => {
            inflight.delete(key);
        });

    inflight.set(key, request);
}

// ─── Network fetch with in-flight deduplication ───────────────────────────────

async function fetchAndStore(
    key: string,
    category: MatchingCategory,
    center: Position,
    radiusMeters: number,
    signal?: AbortSignal,
): Promise<OsmFeature[]> {
    const existing = inflight.get(key);
    if (existing) return existing;

    const [lon, lat] = center;
    const request = fetchAndParseOverpassFeatures(
        category,
        center,
        radiusMeters,
        signal,
    )
        .then(async (features) => {
            const entry: OsmMatchingCacheEntry = {
                schemaVersion: SCHEMA_VERSION,
                category,
                centerLat: lat,
                centerLon: lon,
                radiusMeters,
                fetchedAt: Date.now(),
                features,
            };
            memorySet(key, entry);
            await persistEntry(key, entry);
            return features;
        })
        .finally(() => {
            inflight.delete(key);
        });

    inflight.set(key, request);
    return request;
}

// ─── Category eligibility ─────────────────────────────────────────────────────

function isCacheable(category: MatchingCategory): boolean {
    if (category === "station-name-length") return true;
    const config = getCategoryConfig(category);
    return Boolean(config?.osmQueryTags);
}

// ─── Cell helpers ──────────────────────────────────────────────────────────

const CELL_LRU_MAX = 200;

function makeCellCacheKey(category: MatchingCategory, cellId: string): string {
    return `${CACHE_KEY_PREFIX}cell:${category}:${cellId}`;
}

function cellMemorySet(key: string, entry: OsmMatchingCellEntry): void {
    cellMemoryLru.delete(key);
    cellMemoryLru.set(key, entry);
    while (cellMemoryLru.size > CELL_LRU_MAX) {
        const oldest = cellMemoryLru.keys().next().value;
        if (oldest !== undefined) cellMemoryLru.delete(oldest);
    }
}

function isCellStale(entry: OsmMatchingCellEntry): boolean {
    const ageMs = Date.now() - entry.fetchedAt;
    return ageMs < 0 || ageMs >= MATCHING_CACHE_TTL_MS;
}

function isCellEntry(value: unknown): value is OsmMatchingCellEntry {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    return (
        obj.schemaVersion === CELL_SCHEMA_VERSION &&
        typeof obj.category === "string" &&
        typeof obj.cellIndex === "string" &&
        typeof obj.bbox === "object" &&
        obj.bbox !== null &&
        typeof (obj.bbox as Record<string, unknown>).south === "number" &&
        typeof (obj.bbox as Record<string, unknown>).west === "number" &&
        typeof (obj.bbox as Record<string, unknown>).north === "number" &&
        typeof (obj.bbox as Record<string, unknown>).east === "number" &&
        typeof obj.fetchedAt === "number" &&
        Array.isArray(obj.features)
    );
}

function isCellManifest(value: unknown): value is OsmMatchingCellManifest {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).schemaVersion ===
            CELL_SCHEMA_VERSION &&
        Array.isArray((value as Record<string, unknown>).rows)
    );
}

async function loadCellManifest(): Promise<OsmMatchingCellManifest> {
    if (cellManifestCache) return cellManifestCache;
    try {
        const raw = await AsyncStorage.getItem(`${MANIFEST_KEY}:cell`);
        if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (isCellManifest(parsed)) {
                cellManifestCache = parsed;
                return cellManifestCache;
            }
        }
    } catch {
        // Treat corrupt or unavailable storage as an empty manifest.
    }
    cellManifestCache = { schemaVersion: CELL_SCHEMA_VERSION, rows: [] };
    return cellManifestCache;
}

async function saveCellManifest(
    manifest: OsmMatchingCellManifest,
): Promise<void> {
    cellManifestCache = manifest;
    try {
        await AsyncStorage.setItem(
            `${MANIFEST_KEY}:cell`,
            JSON.stringify(manifest),
        );
    } catch {
        // Storage may be unavailable; the in-memory cache is still current.
    }
}

async function loadCellFromDisk(
    key: string,
): Promise<OsmMatchingCellEntry | null> {
    try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        return isCellEntry(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

async function persistCellEntry(
    key: string,
    entry: OsmMatchingCellEntry,
): Promise<void> {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(entry));
    } catch {
        // Storage may be unavailable.
    }
    cellManifestMutex = cellManifestMutex
        .then(async () => {
            const manifest = await loadCellManifest();
            const row: OsmMatchingCellManifestRow = {
                key,
                category: entry.category,
                cellIndex: entry.cellIndex,
                fetchedAt: entry.fetchedAt,
                featureCount: entry.features.length,
            };
            const idx = manifest.rows.findIndex((r) => r.key === key);
            if (idx >= 0) {
                manifest.rows[idx] = row;
            } else {
                manifest.rows.push(row);
            }
            await saveCellManifest(manifest);
        })
        .catch(() => {
            // If a manifest mutation fails, allow subsequent mutations to proceed.
        });
    // Fire-and-forget: do NOT await cellManifestMutex here. The manifest write
    // is best-effort; the in-memory cache is already updated by cellMemorySet
    // before this function is called. The cell data is persisted to AsyncStorage
    // synchronously above, so a cold restart can load entries from disk even
    // without a manifest row. The manifest row catches up on the next tick after
    // the chain drains.
}

function cellRevalidateInBackground(
    key: string,
    entry: OsmMatchingCellEntry,
): void {
    if (cellInflight.has(key)) return;

    // Capture the epoch so that a clear() that fires while this revalidation
    // is in flight prevents the resolved data from being re-persisted.
    const epoch = cacheEpoch;

    const bbox = cellBbox(entry.cellIndex);
    const request = resolveBboxFeatures(entry.category, bbox)
        .then(async (resolved): Promise<CellFetchResult> => {
            const fetchedAt =
                resolved.source === "local" && resolved.generatedAt
                    ? Date.parse(resolved.generatedAt) || Date.now()
                    : Date.now();
            const updated: OsmMatchingCellEntry = {
                ...entry,
                features: resolved.features,
                fetchedAt,
            };
            cellMemorySet(key, updated);
            // Skip AsyncStorage persistence for local cells — the data
            // already lives in the app bundle. Persisting would duplicate it
            // and bloat storage. Also skip if a cache clear happened while
            // this revalidation was in flight (epoch mismatch).
            if (resolved.source !== "local" && cacheEpoch === epoch) {
                await persistCellEntry(key, updated);
            }
            return { features: resolved.features, sourceKind: resolved.source };
        })
        .catch(async (err): Promise<CellFetchResult> => {
            console.warn(
                "[osmMatchingCache] cell background revalidation failed:",
                err,
            );
            return { features: entry.features, sourceKind: "local" };
        })
        .finally(() => {
            cellInflight.delete(key);
        });

    cellInflight.set(key, request);
}

type CellFetchResult = {
    features: OsmFeature[];
    /** Resolved source: "local" (bundled) or "overpass" (network). */
    sourceKind: "local" | "overpass";
};

async function fetchAndStoreCell(
    key: string,
    category: MatchingCategory,
    cellId: string,
    bbox: { south: number; west: number; north: number; east: number },
    signal?: AbortSignal,
): Promise<CellFetchResult> {
    const existing = cellInflight.get(key);
    if (existing) {
        console.log(
            `[fetchCell] ${category} ${cellId}: dedup — reusing in-flight`,
        );
        return existing;
    }

    console.log(
        `[fetchCell] ${category} ${cellId}: fetching bbox=[${bbox.south.toFixed(2)},${bbox.west.toFixed(2)},${bbox.north.toFixed(2)},${bbox.east.toFixed(2)}]`,
    );

    // Capture the epoch so that a clear() that fires while this fetch is in
    // flight prevents the resolved data from being re-persisted.
    const epoch = cacheEpoch;

    const t0 = Date.now();
    const request = resolveBboxFeatures(category, bbox, signal)
        .then(async (resolved) => {
            console.log(
                `[fetchCell] ${category} ${cellId}: resolved ${resolved.source} — ${resolved.features.length} features in ${Date.now() - t0}ms`,
            );
            const fetchedAt =
                resolved.source === "local" && resolved.generatedAt
                    ? Date.parse(resolved.generatedAt) || Date.now()
                    : Date.now();
            const entry: OsmMatchingCellEntry = {
                schemaVersion: CELL_SCHEMA_VERSION,
                category,
                cellIndex: cellId,
                bbox: {
                    south: bbox.south,
                    west: bbox.west,
                    north: bbox.north,
                    east: bbox.east,
                },
                fetchedAt,
                features: resolved.features,
            };
            cellMemorySet(key, entry);
            // Skip AsyncStorage persistence for local cells — the data
            // already lives in the app bundle. Persisting would duplicate it
            // and bloat storage. Also skip if a cache clear happened while
            // this fetch was in flight (epoch mismatch).
            if (resolved.source !== "local" && cacheEpoch === epoch) {
                await persistCellEntry(key, entry);
            }
            return { features: resolved.features, sourceKind: resolved.source };
        })
        .catch((err) => {
            console.error(
                `[fetchCell] ${category} ${cellId}: FAILED — ${String(err)}`,
            );
            throw err;
        })
        .finally(() => {
            cellInflight.delete(key);
        });

    cellInflight.set(key, request);
    return request;
}

/**
 * Deduplicates an array of OsmFeatures by (osmType, osmId), keeping the first
 * occurrence. Used when merging features from multiple grid cells.
 */
export function deduplicateFeatures(features: OsmFeature[]): OsmFeature[] {
    const seen = new Set<string>();
    const result: OsmFeature[] = [];
    for (const f of features) {
        const key = `${f.osmType}:${f.osmId}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(f);
        }
    }
    return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns ranked OSM matching candidates using a multi-layer spatial cache:
 * in-memory LRU → persisted disk → Overpass network.
 *
 * A cached entry at (A, R) serves a request at (B, r) when
 * `dist(A, B) + r <= R`. Overpass fetches use an overscan radius so that
 * nearby follow-up searches reuse the cached result without a new request.
 *
 * Stale entries are returned immediately while a background refresh runs.
 */
export async function findMatchingFeaturesWithCache(
    category: MatchingCategory,
    center: Position,
    options?: {
        maxCandidates?: number;
        requestedRadiusMeters?: number;
        forceRefresh?: boolean;
        signal?: AbortSignal;
    },
): Promise<OsmMatchingFeaturesResult> {
    if (!isCacheable(category)) {
        return { candidates: [], source: "network" };
    }

    const [lon, lat] = center;
    const requestedRadius =
        options?.requestedRadiusMeters ?? DEFAULT_SEARCH_RADIUS_METERS;
    const maxCandidates = options?.maxCandidates ?? 10;
    const overscanRadius = getOverscanRadius(requestedRadius);

    if (!options?.forceRefresh) {
        // 1. Memory LRU: find the freshest covering entry.
        const memHit = findInMemory(category, lat, lon, requestedRadius);
        if (memHit) {
            // Promote to most-recently-used.
            memoryLru.delete(memHit.key);
            memoryLru.set(memHit.key, memHit.entry);

            if (isStale(memHit.entry)) {
                revalidateInBackground(memHit.key, memHit.entry);
                return {
                    candidates: rankMatchingFeatures(
                        memHit.entry.features,
                        center,
                        maxCandidates,
                    ),
                    source: "stale",
                };
            }
            return {
                candidates: rankMatchingFeatures(
                    memHit.entry.features,
                    center,
                    maxCandidates,
                ),
                source: "memory",
            };
        }

        // 2. Manifest → disk: find the freshest covering row.
        const manifest = await loadManifest();
        const row = findInManifest(
            manifest,
            category,
            lat,
            lon,
            requestedRadius,
        );
        if (row) {
            const diskEntry = await loadFromDisk(row.key);
            if (diskEntry) {
                memorySet(row.key, diskEntry);
                if (isStale(diskEntry)) {
                    revalidateInBackground(row.key, diskEntry);
                    return {
                        candidates: rankMatchingFeatures(
                            diskEntry.features,
                            center,
                            maxCandidates,
                        ),
                        source: "stale",
                    };
                }
                return {
                    candidates: rankMatchingFeatures(
                        diskEntry.features,
                        center,
                        maxCandidates,
                    ),
                    source: "disk",
                };
            }
        }
    }

    // 3. Network fetch with in-flight deduplication.
    const fetchKey = makeCacheKey(category, lat, lon, overscanRadius);
    // When force-refreshing, discard any in-flight request so the caller
    // does not receive a promise that was already aborted by the preceding
    // abort() call in performSearch.
    if (options?.forceRefresh) {
        inflight.delete(fetchKey);
    }
    const features = await fetchAndStore(
        fetchKey,
        category,
        center,
        overscanRadius,
        options?.signal,
    );

    return {
        candidates: rankMatchingFeatures(features, center, maxCandidates),
        source: "network",
    };
}

/** Clears the in-process memory cache and manifest. Call in tests to reset state. */
export function clearOsmMatchingMemoryCache(): void {
    memoryLru.clear();
    inflight.clear();
    manifestCache = null;
    manifestMutex = Promise.resolve();
}

// ─── Cell-based public API ─────────────────────────────────────────────────

/**
 * Returns ranked OSM matching candidates using a deterministic bbox grid cell
 * cache. The world is divided into fixed cells (0.1 degrees); a search maps to
 * the set of cells needed to cover its search disk.
 *
 * Cell cache reuse is valid when the union of loaded cell bboxes covers the
 * entire search region. If any cell is missing, only the missing cells are
 * fetched (not the entire search area).
 *
 * Follows the same patterns as findMatchingFeaturesWithCache: memory LRU,
 * persisted disk, stale-while-revalidate, and in-flight deduplication.
 */
export async function findMatchingFeaturesWithCellCache(
    category: MatchingCategory,
    center: Position,
    options?: {
        maxCandidates?: number;
        requestedRadiusMeters?: number;
        forceRefresh?: boolean;
        signal?: AbortSignal;
    },
): Promise<OsmMatchingFeaturesResult> {
    const startTime = Date.now();
    let networkStartMs: number | undefined;

    if (!isCacheable(category)) {
        console.log(`[cellCache] ${category}: not cacheable, returning []`);
        return { candidates: [], source: "network" };
    }

    const [lon, lat] = center;
    const requestedRadius =
        options?.requestedRadiusMeters ?? DEFAULT_SEARCH_RADIUS_METERS;
    const maxCandidates = options?.maxCandidates ?? 10;

    // ── Local-bundle fast path ───────────────────────────────────────────
    //
    // When a bundled region covers the search center and contains the
    // category, the cell-grid cache is pure overhead: it fetches the full
    // bundle once per cell only to filter 99%+ of features out.  For sparse
    // categories (e.g. commercial-airport with 10 features across all of
    // Kantō) this turns a single-array-sort into thousands of cell fetches.
    //
    // Fast-path: get every feature from the covering bundle, rank by
    // distance, and return — one region load, one sort, no cell grid.
    if (isBundleableCategory(category)) {
        const coveringRegion = regionCoveringPoint(lat, lon);
        if (coveringRegion) {
            const t0 = Date.now();
            const all = getBundledCategoryFeatures(coveringRegion, category);
            if (all.length > 0) {
                const candidates = rankMatchingFeatures(
                    all,
                    center,
                    maxCandidates,
                );
                const durationMs = Date.now() - t0;
                console.log(
                    `[cellCache] ${category} FAST-PATH: bundle region=${coveringRegion} all=${all.length} candidates=${candidates.length} in ${durationMs}ms`,
                );
                return {
                    candidates,
                    source: "memory",
                    debug: {
                        totalCount: candidates.length,
                        origins: { "local-bundle": all.length },
                        durationMs,
                        status: "done",
                        at: Date.now(),
                    },
                };
            }
            console.log(
                `[cellCache] ${category} fast-path skipped: bundle has 0 features for this category`,
            );
        }
    }

    // 1. Compute the set of cells that cover the search disk's bounding square.
    const neededCells = cellsForSearch(lat, lon, requestedRadius);

    console.log(
        `[cellCache] ${category} r=${requestedRadius} forceRefresh=${options?.forceRefresh ?? false} cells=${neededCells.length}`,
    );

    // Accumulate per-origin feature counts for debug metadata.
    const originCounts: Partial<Record<FetchOrigin, number>> = {};

    // 2. When force-refreshing, discard cached cells and fetch everything fresh.
    if (options?.forceRefresh) {
        console.log(
            `[cellCache] ${category} force-refresh: fetching ${neededCells.length} cells fresh`,
        );
        networkStartMs = Date.now();
        const forcePromises = neededCells.map((cellId) => {
            const cellKey = makeCellCacheKey(category, cellId);
            // Discard any in-flight request so the caller does not receive a
            // promise that was already aborted.
            cellInflight.delete(cellKey);
            const bbox = cellBbox(cellId);
            return fetchAndStoreCell(
                cellKey,
                category,
                cellId,
                bbox,
                options?.signal,
            );
        });
        const settled = await Promise.allSettled(forcePromises);
        const networkMs = Date.now() - networkStartMs;
        const succeeded = settled.filter(
            (r) => r.status === "fulfilled",
        ).length;
        const failed = settled.filter((r) => r.status === "rejected").length;
        console.log(
            `[cellCache] ${category} force-refresh done: ${succeeded} ok, ${failed} failed in ${networkMs}ms`,
        );
        const fetchedFeatures: OsmFeature[] = [];
        for (const r of settled) {
            if (r.status !== "fulfilled") continue;
            const origin: FetchOrigin =
                r.value.sourceKind === "local" ? "local-bundle" : "overpass";
            originCounts[origin] =
                (originCounts[origin] ?? 0) + r.value.features.length;
            fetchedFeatures.push(...r.value.features);
        }
        console.log(
            `[cellCache] ${category} force-refresh features: local=${originCounts["local-bundle"] ?? 0} overpass=${originCounts.overpass ?? 0} total=${fetchedFeatures.length}`,
        );
        const merged = deduplicateFeatures(fetchedFeatures);
        const candidates = rankMatchingFeatures(merged, center, maxCandidates);
        const durationMs = Date.now() - startTime;
        const hasOverpass = (originCounts.overpass ?? 0) > 0;
        return {
            candidates,
            source: "network",
            debug: {
                totalCount: candidates.length,
                origins: originCounts,
                durationMs,
                networkMs: hasOverpass ? networkMs : undefined,
                status: "done",
                at: Date.now(),
            },
        };
    }

    // 3. Attempt to load each cell from memory. Load the cell manifest once
    //    before checking disk for any uncached cells.
    const allFeatures: OsmFeature[] = [];
    const missingCells: string[] = [];
    let overallSource: OsmMatchingCacheSource = "memory";
    let anyStale = false;
    let cellManifestLoaded: OsmMatchingCellManifest | null = null;

    for (const cellId of neededCells) {
        const cellKey = makeCellCacheKey(category, cellId);

        // Check memory LRU.
        const memEntry = cellMemoryLru.get(cellKey);
        if (memEntry) {
            // Promote to MRU.
            cellMemoryLru.delete(cellKey);
            cellMemoryLru.set(cellKey, memEntry);

            if (isCellStale(memEntry)) {
                anyStale = true;
                cellRevalidateInBackground(cellKey, memEntry);
            }
            originCounts.memory =
                (originCounts.memory ?? 0) + memEntry.features.length;
            allFeatures.push(...memEntry.features);
            continue;
        }

        // Check disk via manifest (loaded lazily once).
        if (!cellManifestLoaded) {
            cellManifestLoaded = await loadCellManifest();
        }
        const manifestRow = cellManifestLoaded.rows.find(
            (r) => r.key === cellKey,
        );
        if (manifestRow) {
            const diskEntry = await loadCellFromDisk(cellKey);
            if (diskEntry) {
                cellMemorySet(cellKey, diskEntry);
                if (overallSource === "memory") overallSource = "disk";
                if (isCellStale(diskEntry)) {
                    anyStale = true;
                    cellRevalidateInBackground(cellKey, diskEntry);
                }
                originCounts.disk =
                    (originCounts.disk ?? 0) + diskEntry.features.length;
                allFeatures.push(...diskEntry.features);
                continue;
            }
        }

        // Cell is not cached at all.
        missingCells.push(cellId);
    }

    console.log(
        `[cellCache] ${category} cache walk: memory=${Object.keys(originCounts).includes("memory") ? (originCounts.memory ?? 0) : 0} disk=${originCounts.disk ?? 0} missing=${missingCells.length}`,
    );

    // 4. All cells were cached — local ranking only.
    if (missingCells.length === 0) {
        console.log(
            `[cellCache] ${category} all cached, ranking ${allFeatures.length} features`,
        );
        const deduped = deduplicateFeatures(allFeatures);
        const candidates = rankMatchingFeatures(deduped, center, maxCandidates);
        const durationMs = Date.now() - startTime;
        return {
            candidates,
            source: anyStale ? "stale" : overallSource,
            debug: {
                totalCount: candidates.length,
                origins: originCounts,
                durationMs,
                status: "done",
                at: Date.now(),
            },
        };
    }

    // 5. Fetch missing cells in parallel.
    console.log(
        `[cellCache] ${category} fetching ${missingCells.length} missing cells`,
    );
    networkStartMs = Date.now();
    const fetchPromises = missingCells.map((cellId) => {
        const cellKey = makeCellCacheKey(category, cellId);
        const bbox = cellBbox(cellId);
        return fetchAndStoreCell(
            cellKey,
            category,
            cellId,
            bbox,
            options?.signal,
        );
    });
    const settled = await Promise.allSettled(fetchPromises);
    const networkMs = Date.now() - networkStartMs;
    const succeeded = settled.filter((r) => r.status === "fulfilled").length;
    const failed = settled.filter((r) => r.status === "rejected").length;
    console.log(
        `[cellCache] ${category} fetch done: ${succeeded} ok, ${failed} failed in ${networkMs}ms`,
    );
    const fetchedFeatures: OsmFeature[] = [];
    for (const r of settled) {
        if (r.status !== "fulfilled") continue;
        const origin: FetchOrigin =
            r.value.sourceKind === "local" ? "local-bundle" : "overpass";
        originCounts[origin] =
            (originCounts[origin] ?? 0) + r.value.features.length;
        fetchedFeatures.push(...r.value.features);
    }
    console.log(
        `[cellCache] ${category} fetch features: local=${originCounts["local-bundle"] ?? 0} overpass=${originCounts.overpass ?? 0}`,
    );

    // 6. Merge all features, deduplicate, rank.
    // Fresh network data takes precedence over stale cached data at cell boundaries.
    const merged = deduplicateFeatures([...fetchedFeatures, ...allFeatures]);
    console.log(
        `[cellCache] ${category} merged: ${allFeatures.length} cached + ${fetchedFeatures.length} fetched → ${merged.length} deduped`,
    );
    const candidates = rankMatchingFeatures(merged, center, maxCandidates);
    const durationMs = Date.now() - startTime;
    const hasOverpass = (originCounts.overpass ?? 0) > 0;
    return {
        candidates,
        source: anyStale ? "stale" : "network",
        debug: {
            totalCount: candidates.length,
            origins: originCounts,
            durationMs,
            networkMs: hasOverpass ? networkMs : undefined,
            status: "done",
            at: Date.now(),
        },
    };
}

/** Clears the in-process cell memory cache and manifest. Call in tests to reset state. */
export async function clearOsmMatchingCellMemoryCache(): Promise<void> {
    cellMemoryLru.clear();
    cellInflight.clear();
    cellManifestCache = null;
    // Drain any in-flight manifest write before replacing the chain so
    // that concurrent persistCellEntry calls do not race with the reset.
    await cellManifestMutex;
    cellManifestMutex = Promise.resolve();
}

/**
 * Clears all OSM matching caches — memory and persisted AsyncStorage rows.
 * Returns the number of persisted keys removed. Safe to call at any time;
 * keeps other storage namespaces (game state, React Query, boundaries) intact.
 *
 * This is the manual workaround for the stale-selector bug (§4 of
 * docs/settings-maintenance-and-fetch-debug.md) and the backing impl for
 * Settings → Clear Cache.
 */
export async function clearOsmMatchingCache(): Promise<number> {
    // Bump the epoch so any in-flight fetchAndStoreCell / cellRevalidateInBackground
    // that resolves after this point skips re-persisting stale data.
    cacheEpoch++;

    // 1. Clear in-memory caches.
    clearOsmMatchingMemoryCache();
    await clearOsmMatchingCellMemoryCache();

    // 2. Sweep persisted rows.
    let keys: readonly string[];
    try {
        keys = await AsyncStorage.getAllKeys();
    } catch {
        return 0;
    }

    const ours = keys.filter(
        (k) =>
            k.startsWith(CACHE_KEY_PREFIX) ||
            k === MANIFEST_KEY ||
            k === `${MANIFEST_KEY}:cell`,
    );

    if (ours.length === 0) return 0;

    try {
        await AsyncStorage.multiRemove([...ours]);
    } catch {
        // Storage may be unavailable; memory is already cleared.
    }
    return ours.length;
}

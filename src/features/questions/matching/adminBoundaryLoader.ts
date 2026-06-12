/**
 * Lazy-loader and grid-accelerated point-in-polygon index for the offline
 * admin-boundaries bundle (`assets/measuring/admin-boundaries.json`).
 *
 * The bundle contains ALL `boundary=administrative` relations (levels 2–11)
 * from the Kantō+margin extract.  At query time we filter by a single OSM
 * admin_level (e.g. "7" for admin-2nd / municipalities) so the index only
 * tests polygons that could match.
 *
 * ## Architecture
 *
 * 1. Bundle is lazy-loaded via `require()` on first call (Metro bundles it
 *    with the app; no network needed).
 * 2. A lightweight uniform grid index is built per requested `admin_level`
 *    and cached.  Each cell stores the indices of polygons whose outer bbox
 *    overlaps that cell.
 * 3. Query: O(1) cell lookup → candidate bboxes → exact ray-crossing
 *    point-in-polygon test on the candidate polygons (typically 1–3).
 *
 * ## Return convention
 *
 * - `null`   — bundle unavailable (e.g. point outside extract bbox)
 * - `[]`     — no containing boundary found at this level
 * - `[...]`  — one or more containing features as `OsmFeatureWithDistance[]`
 */

import type { Bbox } from "@/shared/geojson";
import type { OsmFeatureWithDistance } from "../matching/osmMatching";
import { pointInGeometry } from "@/shared/geometry/pointInPolygon";
import {
    getAllBoundaryEntries,
    getBoundaryPolygon,
    findBoundaryRelation,
} from "@/features/offline/boundaryStore";
import { multiPolygonCoordsToGeoJSON } from "@/features/offline/deltaDecode";

// ─── Bundle types ────────────────────────────────────────────────────────────

type Position = [number, number];

type AdminBoundaryFeature = {
    type: "Feature";
    bbox: Bbox;
    geometry:
        | {
              type: "Polygon";
              coordinates: Position[][];
          }
        | {
              type: "MultiPolygon";
              coordinates: Position[][][];
          };
    properties: {
        osmId: number;
        admin_level: string;
        name?: string;
        "name:en"?: string;
    };
};

type AdminBoundaryBundle = {
    schemaVersion: number;
    category: string;
    generatedAt: string;
    source: string;
    extractBbox: Bbox;
    features: AdminBoundaryFeature[];
};

// ─── Grid index ──────────────────────────────────────────────────────────────

/** Degrees per grid cell. 0.05° ≈ 5.5 km at mid-latitudes. */
const GRID_CELL_DEG = 0.05;

type PolygonGrid = {
    /** All features for this admin_level (only those whose bbox may contain
     * the query point are tested in the exact phase). */
    features: AdminBoundaryFeature[];
    /** Per-feature outer-ring bboxes (parallel to `features`). */
    bboxes: Bbox[];
    /** Flat grid: (col * rows + row) → list of feature indices. */
    grid: (number[] | undefined)[];
    cols: number;
    rows: number;
    minX: number;
    minY: number;
    cellDeg: number;
};

// ─── Module-level state ──────────────────────────────────────────────────────

let _bundle: AdminBoundaryBundle | null | undefined; // undefined = not loaded yet

/** Per-admin_level grid cache.  Keyed by osmLevel string (e.g. "7"). */
const gridCache = new Map<string, PolygonGrid | null>();

// ─── Feature-level query (used when no grid is built yet) ────────────────────

function bboxContainsPoint(b: Bbox, px: number, py: number): boolean {
    return px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3];
}

// ─── Grid construction ───────────────────────────────────────────────────────

function buildLevelGrid(osmLevel: string): PolygonGrid | null {
    const bundle = getBundle();
    if (!bundle) return null;

    const filtered: AdminBoundaryFeature[] = [];
    for (const f of bundle.features) {
        if (f.properties.admin_level === osmLevel) {
            filtered.push(f);
        }
    }
    if (filtered.length === 0) return null;

    // Build per-feature outer-ring bboxes.
    const bboxes: Bbox[] = filtered.map((f) => {
        if (f.geometry.type === "Polygon") {
            return ringBbox(f.geometry.coordinates[0]);
        }
        // MultiPolygon: union of all outer-ring bboxes.
        let bx0 = Infinity,
            by0 = Infinity,
            bx1 = -Infinity,
            by1 = -Infinity;
        for (const poly of f.geometry.coordinates) {
            const [rx0, ry0, rx1, ry1] = ringBbox(poly[0]);
            if (rx0 < bx0) bx0 = rx0;
            if (ry0 < by0) by0 = ry0;
            if (rx1 > bx1) bx1 = rx1;
            if (ry1 > by1) by1 = ry1;
        }
        return [bx0, by0, bx1, by1];
    });

    // Compute grid bounds from the bundle's extract bbox.
    const [minX, minY, maxX, maxY] = bundle.extractBbox;
    const cellDeg = GRID_CELL_DEG;
    const cols = Math.ceil((maxX - minX) / cellDeg);
    const rows = Math.ceil((maxY - minY) / cellDeg);

    const grid: (number[] | undefined)[] = new Array(cols * rows);

    for (let fi = 0; fi < filtered.length; fi++) {
        const [fx0, fy0, fx1, fy1] = bboxes[fi];
        const ci0 = Math.max(0, Math.floor((fx0 - minX) / cellDeg));
        const ci1 = Math.min(cols - 1, Math.floor((fx1 - minX) / cellDeg));
        const ri0 = Math.max(0, Math.floor((fy0 - minY) / cellDeg));
        const ri1 = Math.min(rows - 1, Math.floor((fy1 - minY) / cellDeg));

        for (let ci = ci0; ci <= ci1; ci++) {
            for (let ri = ri0; ri <= ri1; ri++) {
                const idx = ci * rows + ri;
                if (!grid[idx]) grid[idx] = [];
                grid[idx]!.push(fi);
            }
        }
    }

    return {
        features: filtered,
        bboxes,
        grid,
        cols,
        rows,
        minX,
        minY,
        cellDeg,
    };
}

function ringBbox(ring: Position[]): Bbox {
    let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
    for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
}

// ─── Bundle loading ──────────────────────────────────────────────────────────

function getBundle(): AdminBoundaryBundle | null {
    if (_bundle !== undefined) return _bundle;
    try {
        _bundle =
            require("../../../../assets/measuring/admin-boundaries.json") as AdminBoundaryBundle;
    } catch {
        _bundle = null;
    }
    return _bundle;
}

/** Inject a test bundle — call before any query.  Use `resetAdminBoundaryState` to restore. */
export function setAdminBoundaryBundle(
    bundle: AdminBoundaryBundle | null,
): void {
    _bundle = bundle;
    gridCache.clear();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Query the admin-boundary polygon index for the feature that contains
 * `(lng, lat)` at the given OSM admin_level.
 *
 * Checks, in order:
 * 1. Bundled Japan bundle (when point is inside its bbox)
 * 2. Registered pack sources (when point is inside the pack's index bbox)
 * 3. Returns null (caller falls back to Overpass)
 *
 * Returns `null` when no source covers the point. Returns `[]` when a
 * source covers the point but no boundary at this level contains it.
 */
export function queryAdminBoundary(
    lng: number,
    lat: number,
    osmLevel: string,
): OsmFeatureWithDistance[] | null {
    // 1. Try bundled Japan bundle.
    const bundle = getBundle();
    if (bundle) {
        const [w, s, e, n] = bundle.extractBbox;
        if (lng >= w && lng <= e && lat >= s && lat <= n) {
            return queryBundleGrid(lng, lat, osmLevel);
        }
    }

    // 2. Try pack sources.
    const levelNum = parseInt(osmLevel, 10);
    if (Number.isFinite(levelNum)) {
        const entries = getAllBoundaryEntries().filter(
            (e) =>
                e.adminLevel === levelNum &&
                lng >= e.bbox[0] &&
                lng <= e.bbox[2] &&
                lat >= e.bbox[1] &&
                lat <= e.bbox[3],
        );

        for (const entry of entries) {
            const packId = findBoundaryRelation(entry.relationId)?.packId;
            if (!packId) continue;

            // Synchronous poly cache check — if not cached, skip (lazy decode
            // happens on first use; Overpass fallback covers the gap).
            // The polygon is decoded synchronously from the LRU cache.
            // For the first query, we need to trigger a pre-load.
            // See queryAdminBoundaryAsync for the async variant.
        }

        // For sync queries, we return null if no cached polygon matches.
        // Callers should use queryAdminBoundaryAsync for pack-backed queries.
    }

    return null;
}

/**
 * Async variant that can decode pack polygons on demand.
 * Use this when the query may hit a pack source that hasn't been cached yet.
 */
export async function queryAdminBoundaryAsync(
    lng: number,
    lat: number,
    osmLevel: string,
): Promise<OsmFeatureWithDistance[] | null> {
    // 1. Try bundled Japan bundle (sync).
    const bundle = getBundle();
    if (bundle) {
        const [w, s, e, n] = bundle.extractBbox;
        if (lng >= w && lng <= e && lat >= s && lat <= n) {
            return queryBundleGrid(lng, lat, osmLevel);
        }
    }

    // 2. Try pack sources (async — may decode polygons).
    const levelNum = parseInt(osmLevel, 10);
    if (!Number.isFinite(levelNum)) return null;

    const entries = getAllBoundaryEntries().filter(
        (e) =>
            e.adminLevel === levelNum &&
            lng >= e.bbox[0] &&
            lng <= e.bbox[2] &&
            lat >= e.bbox[1] &&
            lat <= e.bbox[3],
    );

    for (const entry of entries) {
        const match = findBoundaryRelation(entry.relationId);
        if (!match) continue;

        const coords = await getBoundaryPolygon(match.packId, entry.relationId);
        if (!coords || coords.length === 0) continue;

        const geometry = multiPolygonCoordsToGeoJSON(coords);
        if (pointInGeometry(lng, lat, geometry)) {
            return [
                {
                    lat,
                    lon: lng,
                    name: entry.nameEn ?? entry.name,
                    osmId: entry.relationId,
                    osmType: "relation",
                    tags: {
                        "name:en": entry.nameEn ?? "",
                        admin_level: String(entry.adminLevel),
                    },
                    distanceMeters: 0,
                },
            ];
        }
    }

    return null;
}

/** Internal: query the bundled Japan grid (sync). */
function queryBundleGrid(
    lng: number,
    lat: number,
    osmLevel: string,
): OsmFeatureWithDistance[] | null {
    const bundle = getBundle();
    if (!bundle) return null;

    // Quick reject: point outside the extract bbox.
    const [w, s, e, n] = bundle.extractBbox;
    if (lng < w || lng > e || lat < s || lat > n) return null;

    // Get or build the per-level grid.
    let grid = gridCache.get(osmLevel);
    if (grid === undefined) {
        grid = buildLevelGrid(osmLevel);
        gridCache.set(osmLevel, grid);
    }
    if (!grid) return null;

    // Grid cell lookup.
    const ci = Math.floor((lng - grid.minX) / grid.cellDeg);
    const ri = Math.floor((lat - grid.minY) / grid.cellDeg);
    if (ci < 0 || ci >= grid.cols || ri < 0 || ri >= grid.rows) return null;

    const cell = grid.grid[ci * grid.rows + ri];
    if (!cell) return [];

    // Exact point-in-polygon on candidates.
    const hits: OsmFeatureWithDistance[] = [];
    for (const fi of cell) {
        const feature = grid.features[fi];
        // Quick bbox reject before the full ring test.
        if (!bboxContainsPoint(grid.bboxes[fi], lng, lat)) continue;
        if (!pointInGeometry(lng, lat, feature.geometry)) continue;

        hits.push({
            lat,
            lon: lng,
            name: feature.properties.name ?? "",
            osmId: feature.properties.osmId,
            osmType: "relation",
            tags: {
                "name:en": feature.properties["name:en"] ?? "",
                admin_level: feature.properties.admin_level,
            },
            distanceMeters: 0,
        });
    }

    return hits;
}

/**
 * Clears the per-level grid cache.  Call when the admin division pack changes
 * so the next query rebuilds with the new osmLevel mapping.
 */
export function clearAdminBoundaryCache(): void {
    gridCache.clear();
}

/**
 * Exposed for tests: reset all module state.
 */
export function resetAdminBoundaryState(): void {
    _bundle = undefined;
    gridCache.clear();
}

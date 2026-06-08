import { intersection, type Geom } from "polyclip-ts";
import type {
    Feature,
    FeatureCollection,
    GeoJsonProperties,
    MultiPolygon,
    Polygon,
} from "geojson";
import { VORONOI } from "@/config/appConfig";

const MAX_CACHE_SIZE = VORONOI.maxClipCacheSize;
const cache = new Map<string, FeatureCollection<Polygon | MultiPolygon>>();
const cellCollectionIds = new WeakMap<object, number>();
const boundaryIds = new WeakMap<object, number>();
let nextCellCollectionId = 1;
let nextBoundaryId = 1;

/** Memoizes extractBoundaryCoords result by boundary object identity. */
const boundaryGeomCache = new WeakMap<object, Geom | null>();

// ─── Bbox helpers ─────────────────────────────────────────────────────────

type CellBbox = [number, number, number, number]; // [west, south, east, north]

/** Bounding box of a multipolygon Geom (the boundary). */
function computeBbox(coords: Geom): CellBbox {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    // Work with plain number[][][] to avoid polyclip-ts Geom union types.
    // The inner arrays are coordinate pairs [lng, lat] — iterate by index.
    const polys = coords as unknown as number[][][];
    for (const poly of polys) {
        for (const ring of poly) {
            for (let i = 0; i < ring.length; i++) {
                const point = ring[i] as unknown as [number, number];
                const x = point[0];
                const y = point[1];
                if (x < west) west = x;
                if (y < south) south = y;
                if (x > east) east = x;
                if (y > north) north = y;
            }
        }
    }
    return [west, south, east, north];
}

/** Bounding box of a single Voronoi cell Polygon. */
function computeCellBbox(cell: Feature<Polygon>): CellBbox {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    // Outer ring only — sufficient for the envelope check.
    const ring = cell.geometry.coordinates[0];
    if (!ring) return [0, 0, 0, 0];
    for (let i = 0; i < ring.length; i++) {
        const [x, y] = ring[i];
        if (x < west) west = x;
        if (y < south) south = y;
        if (x > east) east = x;
        if (y > north) north = y;
    }
    return [west, south, east, north];
}

/** True when `inner` is fully inside `outer`. */
function bboxContains(outer: CellBbox, inner: CellBbox): boolean {
    return (
        inner[0] >= outer[0] &&
        inner[1] >= outer[1] &&
        inner[2] <= outer[2] &&
        inner[3] <= outer[3]
    );
}

/** True when `a` and `b` overlap. */
function bboxIntersects(a: CellBbox, b: CellBbox): boolean {
    return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

export function clearClipCellsCache() {
    cache.clear();
}

function cacheKey(cells: object, boundary: object): string {
    let cid = cellCollectionIds.get(cells);
    if (cid === undefined) {
        cid = nextCellCollectionId++;
        cellCollectionIds.set(cells, cid);
    }
    let bid = boundaryIds.get(boundary);
    if (bid === undefined) {
        bid = nextBoundaryId++;
        boundaryIds.set(boundary, bid);
    }
    return `${cid}|${bid}`;
}

/**
 * Extract polygon coordinate arrays from a boundary FeatureCollection into a
 * single multipolygon Geom. Returns null when the boundary has no polygons.
 *
 * Memoizes by boundary object identity so that multiple matching questions
 * sharing the same boundary reference only traverse it once.
 */
function extractBoundaryCoords(
    boundary: FeatureCollection<Polygon | MultiPolygon>,
): Geom | null {
    const memoized = boundaryGeomCache.get(boundary);
    if (memoized !== undefined) {
        return memoized;
    }

    // Build as plain number[][][] to avoid the polyclip-ts Geom push type
    // constraint, then cast at the end — consistent with maskBuilder.ts.
    const coords: number[][][] = [];
    for (const feature of boundary.features) {
        const geom = feature.geometry;
        if (geom.type === "Polygon") {
            coords.push(geom.coordinates as unknown as number[][]);
        } else if (geom.type === "MultiPolygon") {
            for (const polygon of geom.coordinates) {
                coords.push(polygon as unknown as number[][]);
            }
        }
    }
    const result = coords.length > 0 ? (coords as unknown as Geom) : null;
    boundaryGeomCache.set(boundary, result);
    return result;
}

/**
 * Clip Voronoi cells (bbox-clipped by `@turf/voronoi`) to the play area
 * boundary polygon.
 *
 * Each cell is intersected with the boundary; cells whose site lies outside
 * the boundary are dropped. Original cell properties (e.g. `osmKey`) are
 * preserved on the output features.
 *
 * A cheap bbox pre-filter avoids the expensive polyclip-ts intersection for
 * cells that are clearly inside or outside the boundary envelope. Without
 * this, clipping even 17 cells against the 3,197-vertex Tokyo boundary takes
 * 340ms on a fast machine — enough to block the React render frame.
 *
 * Results are cached by object identity of both inputs so that re-renders
 * and edits to unrelated questions are free.
 */
export function clipCellsToPlayArea<
    P extends GeoJsonProperties = GeoJsonProperties,
>(
    cells: FeatureCollection<Polygon, P>,
    boundary: FeatureCollection<Polygon | MultiPolygon>,
): FeatureCollection<Polygon | MultiPolygon, P> {
    // Empty cells → empty output
    if (cells.features.length === 0) {
        return { type: "FeatureCollection", features: [] };
    }

    // Empty/zero-polygon boundary → empty output
    const boundaryCoords = extractBoundaryCoords(boundary);
    if (!boundaryCoords) {
        return { type: "FeatureCollection", features: [] };
    }

    // Identity-keyed cache: stable collection references → cache hit
    const key = cacheKey(cells, boundary);
    const cached = cache.get(key) as
        | FeatureCollection<Polygon | MultiPolygon, P>
        | undefined;
    if (cached) {
        // Move to end (LRU)
        cache.delete(key);
        cache.set(key, cached as FeatureCollection<Polygon | MultiPolygon>);
        console.log(
            `[clipCells] ${cells.features.length} cells → ${cached.features.length} features (cached)`,
        );
        return cached;
    }

    // Compute the boundary envelope once before the loop. Most Voronoi cells
    // near the search center lie well inside the play-area bbox and can skip
    // the expensive polyclip-ts intersection entirely.
    const bbox = computeBbox(boundaryCoords);
    const resultFeatures: Feature<Polygon | MultiPolygon, P>[] = [];

    let fastPathHits = 0;
    let slowPathHits = 0;
    let droppedCells = 0;
    const t0 = Date.now();

    for (const cell of cells.features) {
        // @turf/voronoi produces undefined entries for points whose
        // Voronoi cell lies entirely outside the bbox. Skip them.
        if (!cell?.geometry) continue;

        const cellBbox = computeCellBbox(cell);

        // Cell fully inside the boundary envelope — keep as-is.
        if (bboxContains(bbox, cellBbox)) {
            fastPathHits++;
            resultFeatures.push({
                ...cell,
                properties: cell.properties
                    ? { ...cell.properties }
                    : ({} as P),
            } as Feature<Polygon | MultiPolygon, P>);
            continue;
        }

        // Cell fully outside the boundary envelope — drop.
        if (!bboxIntersects(bbox, cellBbox)) {
            droppedCells++;
            continue;
        }

        // Cell straddles the boundary edge — expensive polyclip-ts clip.
        slowPathHits++;
        try {
            const cellGeom = cell.geometry.coordinates as unknown as Geom;
            const clipped = intersection(cellGeom, boundaryCoords);

            // Cell whose site lies outside the boundary → intersection is empty → drop
            if (clipped.length === 0) {
                continue;
            }

            let geometry: Polygon | MultiPolygon;
            if (clipped.length === 1) {
                geometry = {
                    type: "Polygon",
                    coordinates: clipped[0],
                } as Polygon;
            } else {
                geometry = {
                    type: "MultiPolygon",
                    coordinates: clipped,
                } as MultiPolygon;
            }

            resultFeatures.push({
                type: "Feature",
                properties: cell.properties
                    ? { ...cell.properties }
                    : ({} as P),
                geometry,
            });
        } catch (err) {
            if (__DEV__) {
                console.warn(
                    "[clipCellsToPlayArea] skipping degenerate cell:",
                    err,
                );
            }
            // Drop the offending cell; continue clipping the rest
        }
    }

    const result: FeatureCollection<Polygon | MultiPolygon, P> = {
        type: "FeatureCollection",
        features: resultFeatures,
    };

    const durationMs = Date.now() - t0;
    if (cells.features.length > 0) {
        console.log(
            `[clipCells] ${cells.features.length} cells → ${resultFeatures.length} features ` +
                `(fast:${fastPathHits} slow:${slowPathHits} dropped:${droppedCells}) ` +
                `in ${durationMs}ms`,
        );
    }

    // Evict oldest entry when cache exceeds max size
    if (cache.size >= MAX_CACHE_SIZE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, result as FeatureCollection<Polygon | MultiPolygon>);

    return result;
}

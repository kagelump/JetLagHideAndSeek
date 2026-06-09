import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { GeoJsonFeatureCollection, Position } from "./geojsonTypes";
import { MAP } from "@/config/appConfig";
import { getGeometryBackend } from "@/shared/geometry/geometryBackend";

export const WORLD_MASK_RING: Position[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
];

type PolygonFeatureCollection = {
    features: PolygonFeature[];
    type: "FeatureCollection";
};

type PolygonFeature = {
    geometry: {
        coordinates: unknown;
        type: "Polygon" | "MultiPolygon";
    };
};

/** Normalized array of polygon coordinate arrays (consistent with getPolygons). */
type PolyCoords = Position[][][];

export type PlayAreaMaskHole = {
    featureIndex: number;
    polygonIndex: number | null;
    reverse: boolean;
};

export function buildPlayAreaMask(
    boundary: GeoJsonFeatureCollection,
): GeoJsonFeatureCollection {
    const holes = getExteriorRings(boundary).map(orientHoleRing);

    return buildPlayAreaMaskFromHoles(holes);
}

export function buildPlayAreaMaskFromMetadata(
    boundary: GeoJsonFeatureCollection,
    maskHoles: PlayAreaMaskHole[],
): GeoJsonFeatureCollection {
    const holes = maskHoles.map((hole) => {
        const ring = getMaskHoleRing(boundary, hole);
        return hole.reverse ? [...ring].reverse() : ring;
    });

    return buildPlayAreaMaskFromHoles(holes);
}

function buildPlayAreaMaskFromHoles(
    holes: Position[][],
): GeoJsonFeatureCollection {
    return {
        features: [
            {
                geometry: {
                    coordinates: [
                        orientExteriorRing(WORLD_MASK_RING),
                        ...holes,
                    ],
                    type: "Polygon",
                },
                properties: {},
                type: "Feature",
            },
        ],
        type: "FeatureCollection",
    };
}

function getMaskHoleRing(
    boundary: GeoJsonFeatureCollection,
    hole: PlayAreaMaskHole,
): Position[] {
    const feature = boundary.features[hole.featureIndex];
    if (!feature) {
        throw new Error("Invalid precomputed play-area mask feature index.");
    }

    const { coordinates, type } = feature.geometry;
    const ring =
        type === "Polygon"
            ? coordinates[0]
            : hole.polygonIndex !== null
              ? coordinates[hole.polygonIndex]?.[0]
              : null;
    if (
        !Array.isArray(ring) ||
        !Array.isArray(ring[0]) ||
        typeof ring[0][0] !== "number" ||
        typeof ring[0][1] !== "number"
    ) {
        throw new Error("Invalid precomputed play-area mask polygon index.");
    }
    return ring as Position[];
}

export function buildCombinedInsideMask(
    playArea: PolygonFeatureCollection,
    ...cutouts: PolygonFeatureCollection[]
): GeoJsonFeatureCollection {
    return buildCombinedEligibilityMask(playArea, cutouts);
}

const MAX_MASK_CACHE_SIZE = MAP.maxMaskCacheSize;
const maskResultCache = new Map<string, GeoJsonFeatureCollection>();
const featureCacheIds = new WeakMap<PolygonFeature, number>();
const featurePolygonCache = new WeakMap<PolygonFeature, Position[][][]>();
let nextFeatureCacheId = 1;

// Fast-path cache for the common case of a single required constraint and no
// excluded areas (e.g. hiding-zones only). Uses object identity for O(1)
// lookup without the string-key overhead of maskResultCache.
const playAreaMinusSingleRequiredCache = new WeakMap<
    PolygonFeatureCollection,
    WeakMap<PolygonFeatureCollection, GeoJsonFeatureCollection>
>();

export function clearMaskResultCache() {
    maskResultCache.clear();
}

function getCachedPlayAreaMinusSingleRequired(
    playArea: PolygonFeatureCollection,
    required: PolygonFeatureCollection,
): GeoJsonFeatureCollection | undefined {
    const inner = playAreaMinusSingleRequiredCache.get(playArea);
    if (!inner) return undefined;
    return inner.get(required);
}

function setCachedPlayAreaMinusSingleRequired(
    playArea: PolygonFeatureCollection,
    required: PolygonFeatureCollection,
    result: GeoJsonFeatureCollection,
): void {
    let inner = playAreaMinusSingleRequiredCache.get(playArea);
    if (!inner) {
        inner = new WeakMap();
        playAreaMinusSingleRequiredCache.set(playArea, inner);
    }
    inner.set(required, result);
}

/**
 * Build a cache key from the exact feature objects supplied by the derived
 * render state. Upstream geometry builders memoize their results, so object
 * identity is both cheaper and safer than sampling coordinates.
 */
function maskCacheKey(
    playArea: PolygonFeatureCollection,
    requiredConstraints: PolygonFeatureCollection[],
    excludedAreas: PolygonFeatureCollection[],
): string {
    return [
        `playArea:${collectionCacheKey(playArea)}`,
        `required:${requiredConstraints.map(collectionCacheKey).join(";")}`,
        `excluded:${excludedAreas.map(collectionCacheKey).join(";")}`,
    ].join("|");
}

function collectionCacheKey(collection: PolygonFeatureCollection): string {
    return collection.features
        .map((feature) => {
            let id = featureCacheIds.get(feature);
            if (id === undefined) {
                id = nextFeatureCacheId;
                nextFeatureCacheId += 1;
                featureCacheIds.set(feature, id);
            }
            return `${feature.geometry.type}:${id}`;
        })
        .join(",");
}

export function buildCombinedEligibilityMask(
    playArea: PolygonFeatureCollection,
    requiredConstraints: PolygonFeatureCollection[],
    excludedAreas: PolygonFeatureCollection[] = [],
): GeoJsonFeatureCollection {
    const cacheKey = maskCacheKey(playArea, requiredConstraints, excludedAreas);
    const cached = maskResultCache.get(cacheKey);
    if (cached) {
        maskResultCache.delete(cacheKey);
        maskResultCache.set(cacheKey, cached);
        return cached;
    }

    // Fast path: single required constraint, no excluded areas.
    if (requiredConstraints.length === 1 && excludedAreas.length === 0) {
        const cached = getCachedPlayAreaMinusSingleRequired(
            playArea,
            requiredConstraints[0],
        );
        if (cached) {
            return cached;
        }
    }

    const playAreaPolygons = getPolygons(playArea);

    if (playAreaPolygons.length === 0) {
        return { features: [], type: "FeatureCollection" };
    }

    const requiredGeoms = getGeoms(requiredConstraints);
    const excludedGeoms = getGeoms(excludedAreas);

    if (requiredGeoms.length === 0 && excludedGeoms.length === 0) {
        return { features: [], type: "FeatureCollection" };
    }

    const backend = getGeometryBackend();

    let eligibleArea: PolyCoords;
    if (requiredGeoms.length === 0) {
        eligibleArea = playAreaPolygons;
    } else if (requiredGeoms.length === 1) {
        eligibleArea = requiredGeoms[0];
    } else {
        const t0 = performance.now();
        const features = requiredGeoms.map(coordsToFeature);
        const intersected = reduceOverlay(
            features,
            backend.intersection.bind(backend),
        );
        eligibleArea = intersected ? featureToCoords(intersected) : [];
        console.log(
            `[maskBuilder] intersection(${requiredGeoms.length} geoms) in ${(performance.now() - t0).toFixed(2)}ms`,
        );
    }

    if (!hasGeomArea(eligibleArea)) {
        return buildMultiPolygonFeatureCollection(playAreaPolygons);
    }

    if (excludedGeoms.length > 0) {
        const t0 = performance.now();
        let excludedCoords: PolyCoords;
        if (excludedGeoms.length === 1) {
            excludedCoords = excludedGeoms[0];
        } else {
            const features = excludedGeoms.map(coordsToFeature);
            const united = reduceOverlay(features, backend.union.bind(backend));
            excludedCoords = united ? featureToCoords(united) : [];
        }
        if (excludedGeoms.length > 1) {
            console.log(
                `[maskBuilder] union(${excludedGeoms.length} geoms) in ${(performance.now() - t0).toFixed(2)}ms`,
            );
        }

        if (hasGeomArea(excludedCoords)) {
            const t1 = performance.now();
            const diffResult = backend.difference(
                coordsToFeature(eligibleArea),
                coordsToFeature(excludedCoords),
            );
            eligibleArea = diffResult ? featureToCoords(diffResult) : [];
            console.log(
                `[maskBuilder] difference(eligibleArea, excludedArea) in ${(performance.now() - t1).toFixed(2)}ms`,
            );
        }
    }

    if (!hasGeomArea(eligibleArea)) {
        return buildMultiPolygonFeatureCollection(playAreaPolygons);
    }

    const t2 = performance.now();
    const diffResult = backend.difference(
        coordsToFeature(playAreaPolygons),
        coordsToFeature(eligibleArea),
    );
    const maskedArea: PolyCoords = diffResult
        ? featureToCoords(diffResult)
        : [];
    console.log(
        `[maskBuilder] difference(playArea, eligibleArea) in ${(performance.now() - t2).toFixed(2)}ms`,
    );

    const result = buildMultiPolygonFeatureCollection(maskedArea);

    // Cache single-required-constraint results for fast-path reuse.
    if (requiredConstraints.length === 1 && excludedAreas.length === 0) {
        setCachedPlayAreaMinusSingleRequired(
            playArea,
            requiredConstraints[0],
            result,
        );
    }

    // Evict oldest entry when cache exceeds max size.
    if (maskResultCache.size >= MAX_MASK_CACHE_SIZE) {
        const oldest = maskResultCache.keys().next().value;
        if (oldest !== undefined) maskResultCache.delete(oldest);
    }
    maskResultCache.set(cacheKey, result);

    return result;
}

function getGeoms(collections: PolygonFeatureCollection[]): PolyCoords[] {
    const geoms: PolyCoords[] = [];
    for (const collection of collections) {
        const polygons = getPolygons(collection);
        if (polygons.length > 0) {
            geoms.push(polygons);
        }
    }
    return geoms;
}

function hasGeomArea(geom: PolyCoords): boolean {
    return geom.some((polygon) => Array.isArray(polygon) && polygon.length > 0);
}

function buildMultiPolygonFeatureCollection(
    polygons: PolyCoords,
): GeoJsonFeatureCollection {
    return {
        features:
            polygons.length > 0
                ? [
                      {
                          geometry: {
                              coordinates: polygons,
                              type: "MultiPolygon" as const,
                          },
                          properties: {},
                          type: "Feature" as const,
                      },
                  ]
                : [],
        type: "FeatureCollection",
    };
}

// ── Overlay helpers (G5) ──────────────────────────────────────────────────

/** Wrap a normalized array of polygon coords into a Polygon/MultiPolygon Feature. */
function coordsToFeature(coords: PolyCoords): Feature<Polygon | MultiPolygon> {
    if (coords.length === 1) {
        return {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: coords[0] },
        };
    }
    return {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: coords },
    };
}

/** Unwrap a Polygon/MultiPolygon Feature back to normalized polygon coords. */
function featureToCoords(f: Feature<Polygon | MultiPolygon>): PolyCoords {
    if (f.geometry.type === "Polygon") {
        return [f.geometry.coordinates as Position[][]];
    }
    return f.geometry.coordinates as PolyCoords;
}

/** Reduce an array of Features with a binary overlay op. Returns null if any step produces empty. */
function reduceOverlay(
    features: Feature<Polygon | MultiPolygon>[],
    op: (
        a: Feature<Polygon | MultiPolygon>,
        b: Feature<Polygon | MultiPolygon>,
    ) => Feature<Polygon | MultiPolygon> | null,
): Feature<Polygon | MultiPolygon> | null {
    if (features.length === 0) return null;
    let result: Feature<Polygon | MultiPolygon> | null = features[0];
    for (let i = 1; i < features.length && result; i++) {
        result = op(result, features[i]);
    }
    return result;
}

export function asSeparateMaskConstraints(
    collection: PolygonFeatureCollection,
): PolygonFeatureCollection[] {
    return collection.features.map((feature) => ({
        features: [feature],
        type: "FeatureCollection",
    }));
}

function getExteriorRings(collection: PolygonFeatureCollection): Position[][] {
    return collection.features.flatMap((feature) => {
        const { coordinates, type } = feature.geometry;

        if (type === "Polygon") {
            const rings = Array.isArray(coordinates) ? coordinates : [];
            const exterior = toPositionRing(rings[0]);
            return exterior ? [exterior] : [];
        }

        const polygons = Array.isArray(coordinates) ? coordinates : [];
        return polygons.flatMap((polygon) => {
            const rings = Array.isArray(polygon) ? polygon : [];
            const exterior = toPositionRing(rings[0]);
            return exterior ? [exterior] : [];
        });
    });
}

function getPolygons(collection: PolygonFeatureCollection): Position[][][] {
    return collection.features.flatMap((feature) => {
        const cached = featurePolygonCache.get(feature);
        if (cached) return cached;

        const { coordinates, type } = feature.geometry;
        let polygons: Position[][][];

        if (type === "Polygon") {
            const polygon = toPolygon(coordinates);
            polygons = polygon ? [polygon] : [];
        } else {
            const candidates = Array.isArray(coordinates) ? coordinates : [];
            polygons = candidates.flatMap((polygon) => {
                const converted = toPolygon(polygon);
                return converted ? [converted] : [];
            });
        }

        featurePolygonCache.set(feature, polygons);
        return polygons;
    });
}

function toPolygon(value: unknown): Position[][] | null {
    if (!Array.isArray(value)) return null;

    const rings = value.flatMap((ring) => {
        const positions = toPositionRing(ring);
        return positions ? [positions] : [];
    });

    return rings.length > 0 ? rings : null;
}

function toPositionRing(value: unknown): Position[] | null {
    if (!Array.isArray(value)) return null;

    const ring = value.flatMap((point) => {
        if (
            Array.isArray(point) &&
            typeof point[0] === "number" &&
            typeof point[1] === "number"
        ) {
            return [[point[0], point[1]] as Position];
        }
        return [];
    });

    return ring.length > 0 ? ring : null;
}

function orientExteriorRing(ring: Position[]): Position[] {
    return signedRingArea(ring) >= 0 ? ring : [...ring].reverse();
}

function orientHoleRing(ring: Position[]): Position[] {
    return signedRingArea(ring) <= 0 ? ring : [...ring].reverse();
}

export function signedRingArea(ring: Position[]): number {
    let area = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
        const [x1, y1] = ring[index];
        const [x2, y2] = ring[index + 1];
        area += x1 * y2 - x2 * y1;
    }
    return area / 2;
}

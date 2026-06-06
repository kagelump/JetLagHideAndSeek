import circle from "@turf/circle";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";

import { clipCellsToPlayArea } from "@/features/questions/clipVoronoiCells";
import {
    computeVoronoiCells,
    makeOsmKey,
} from "@/features/questions/matching/matchingVoronoi";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";
import type { QuestionState } from "@/features/questions/questionTypes";
import { haversineDistanceMeters } from "@/shared/geojson";
import type { Bbox, Position } from "@/shared/geojson";

import type { TentaclesQuestion, TentaclesRenderState } from "./tentaclesTypes";
import { EMPTY_TENTACLES_RENDER_STATE } from "./tentaclesTypes";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CACHE_SIZE = 20;

/** Increment to invalidate all cached state when the algorithm changes. */
const GEOMETRY_CACHE_VERSION = 1;

// ─── LRU cache ───────────────────────────────────────────────────────────────

const stateCache = new Map<string, TentaclesRenderState>();

const boundaryIds = new WeakMap<object, number>();
let nextBoundaryId = 1;

function getBoundaryId(boundary: object): number {
    let id = boundaryIds.get(boundary);
    if (id === undefined) {
        id = nextBoundaryId++;
        boundaryIds.set(boundary, id);
    }
    return id;
}

/** Round to 7 decimal places to prevent floating-point drift in cache keys. */
function round7(n: number): number {
    return Math.round(n * 1e7) / 1e7;
}

function candidateIdentitySnapshot(
    candidates: (OsmFeature & { distanceMeters?: number })[],
): string {
    return candidates
        .map((c) => {
            const base = `${makeOsmKey(c.osmType, c.osmId)}@${round7(c.lon)},${round7(c.lat)}`;
            const nl = c.nameLength !== undefined ? `:nl${c.nameLength}` : "";
            return `${base}${nl}`;
        })
        .sort()
        .join(",");
}

function questionStateCacheKey(
    center: Position,
    distanceMeters: number,
    candidateSnapshot: string,
    selectedOsmKey: string | null,
    boundaryId: number,
): string {
    return [
        GEOMETRY_CACHE_VERSION,
        round7(center[0]),
        round7(center[1]),
        distanceMeters,
        candidateSnapshot,
        selectedOsmKey ?? "none",
        boundaryId,
    ].join(":");
}

/** Clears the in-memory caches. Call in tests to reset state. */
export function clearTentaclesGeometryCache(): void {
    stateCache.clear();
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function buildTentaclesRenderState(
    questions: QuestionState[],
    playAreaBbox: Bbox,
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): TentaclesRenderState {
    const tentaclesQuestions = questions.filter(
        (q): q is TentaclesQuestion => q.type === "tentacles",
    );

    if (tentaclesQuestions.length === 0) {
        return EMPTY_TENTACLES_RENDER_STATE;
    }

    // Aggregate across all tentacles questions.
    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const missFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const poiFeatures: Feature<
        Point,
        { isSelected: boolean; name: string; osmId: number }
    >[] = [];
    const voronoiOutlineFeatures: Feature<Polygon | MultiPolygon>[] = [];
    // Use the last question's radius outline (there should be at most one).
    let radiusOutlineFeature: Feature<Polygon> | null = null;

    for (const q of tentaclesQuestions) {
        const single = buildSingleTentaclesRenderState(
            q,
            playAreaBbox,
            playAreaBoundary,
        );
        hitFeatures.push(...single.hitMaskFeatures.features);
        missFeatures.push(...single.missMaskFeatures.features);
        poiFeatures.push(...single.poiFeatures.features);
        voronoiOutlineFeatures.push(...single.voronoiOutlineFeatures.features);
        if (single.radiusOutlineFeature) {
            radiusOutlineFeature = single.radiusOutlineFeature;
        }
    }

    return {
        hitMaskFeatures: {
            type: "FeatureCollection",
            features: hitFeatures,
        },
        missMaskFeatures: {
            type: "FeatureCollection",
            features: missFeatures,
        },
        poiFeatures: {
            type: "FeatureCollection",
            features: poiFeatures,
        },
        radiusOutlineFeature,
        voronoiOutlineFeatures: {
            type: "FeatureCollection",
            features: voronoiOutlineFeatures,
        },
    };
}

// ─── Single-question render state ────────────────────────────────────────────

function buildSingleTentaclesRenderState(
    q: TentaclesQuestion,
    playAreaBbox: Bbox,
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): TentaclesRenderState {
    const { center, distanceMeters, candidates } = q;
    const selectedOsmKey =
        q.selectedOsmId !== null && q.selectedOsmType !== null
            ? makeOsmKey(q.selectedOsmType, q.selectedOsmId)
            : null;

    // 0. Check cache.
    const candidateSnap = candidateIdentitySnapshot(candidates);
    const boundaryId = getBoundaryId(playAreaBoundary);
    const cacheKey = questionStateCacheKey(
        center,
        distanceMeters,
        candidateSnap,
        selectedOsmKey,
        boundaryId,
    );
    const cached = stateCache.get(cacheKey);
    if (cached) {
        stateCache.delete(cacheKey);
        stateCache.set(cacheKey, cached);
        return cached;
    }

    // 1. Build radius circle.
    const radiusCircle = circle(center, distanceMeters / 1000, {
        units: "kilometers",
        properties: {},
    }) as Feature<Polygon>;

    // 2. Filter candidates to within distanceMeters of center.
    const inRadius = candidates.filter((c) => {
        const dist = haversineDistanceMeters(
            center[1],
            center[0],
            c.lat,
            c.lon,
        );
        return dist <= distanceMeters;
    });

    // 3. Compute Voronoi cells over in-radius candidates.
    const cells = computeVoronoiCells(inRadius, playAreaBbox);

    // 4. Clip cells to the radius circle.
    const radiusBoundary: FeatureCollection<Polygon> = {
        type: "FeatureCollection",
        features: [radiusCircle],
    };
    const clippedToRadius = clipCellsToPlayArea(cells, radiusBoundary);

    // 5a. Voronoi outlines: clip raw cells to play area (visual only).
    const outlines = clipCellsToPlayArea(cells, playAreaBoundary);

    // 5b. poiFeatures: in-radius candidates as point features.
    const poiFeats: Feature<
        Point,
        { isSelected: boolean; name: string; osmId: number }
    >[] = inRadius.map((c) => ({
        type: "Feature",
        geometry: {
            type: "Point",
            coordinates: [c.lon, c.lat],
        },
        properties: {
            isSelected: c.osmId === q.selectedOsmId,
            name: c.name ?? "",
            osmId: c.osmId,
        },
    }));

    // 6. Answered masks from radius-clipped cells.
    let hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    let missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;

    const isAnswered = q.answer === "positive" && selectedOsmKey !== null;

    if (isAnswered) {
        hitMaskFeatures = {
            type: "FeatureCollection",
            features: clippedToRadius.features.filter(
                (f) => f.properties?.osmKey === selectedOsmKey,
            ),
        };
        missMaskFeatures = {
            type: "FeatureCollection",
            features: clippedToRadius.features.filter(
                (f) => f.properties?.osmKey !== selectedOsmKey,
            ),
        };
    } else {
        hitMaskFeatures = { type: "FeatureCollection", features: [] };
        missMaskFeatures = { type: "FeatureCollection", features: [] };
    }

    // ── Store in cache ─────────────────────────────────────────────
    const result: TentaclesRenderState = {
        hitMaskFeatures,
        missMaskFeatures,
        poiFeatures: {
            type: "FeatureCollection",
            features: poiFeats,
        },
        radiusOutlineFeature: radiusCircle,
        voronoiOutlineFeatures: outlines,
    };

    if (stateCache.size >= MAX_CACHE_SIZE) {
        const oldest = stateCache.keys().next().value;
        if (oldest !== undefined) stateCache.delete(oldest);
    }
    stateCache.set(cacheKey, result);

    return result;
}

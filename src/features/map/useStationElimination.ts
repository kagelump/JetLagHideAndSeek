import { useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager } from "react-native";
import circle from "@turf/circle";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import { HIDING_ZONE } from "@/config/appConfig";
import { clipStationsToPlayArea } from "@/features/hidingZone/hidingZone";
import type { TransitStation } from "@/features/hidingZone/hidingZoneTypes";
import type { GeoJsonFeatureCollection } from "@/features/map/geojsonTypes";
import { buildCombinedEligibilityMask } from "@/features/map/maskBuilder";
import type { MaskFeatureCollection } from "@/features/map/maskBuilder";
import { buildEligibilityConstraints } from "@/features/map/eliminationMath";
import type { QuestionMapRenderState } from "@/features/questions/radar/radarTypes";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";
import {
    useHidingZoneDerived,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { bboxIntersects, EARTH_RADIUS_METERS } from "@/shared/geojson";
import type { Bbox } from "@/shared/geojson";
import { getGeometryBackend } from "@/shared/geometry/geometryBackend";
import { geomAreaM2 } from "@/shared/geometry/parityMetrics";
import { createLogger } from "@/shared/logger";

const log = createLogger("useStationElimination");

const CIRCLE_STEPS = HIDING_ZONE.circleSteps;

export type StationAreaInfo = {
    /** Eligible fraction of the station's circle, in [0, 1]. */
    fraction: number;
    /** Eligible area within the circle, m² (used as the sort key). */
    remainingM2: number;
};

export type StationEliminationResult = {
    /**
     * Number of stations still eligible, or `null` while the computation
     * is deferred to avoid blocking the UI thread.
     */
    remainingCount: number | null;
    /** Total number of stations (clipped to play area). */
    totalCount: number;
    /** Set of station IDs that are fully eliminated (empty while loading). */
    eliminatedStationIds: Set<string>;
    /** Per-station area info, keyed by station id. Empty while loading. */
    stationAreas: Map<string, StationAreaInfo>;
    /** True while the async computation is pending. */
    isComputing: boolean;
};

// ---------------------------------------------------------------------------
// Module-level result cache
// ---------------------------------------------------------------------------
//
// Follows the same LRU pattern as maskResultCache in maskBuilder.ts and
// zoneFeatureCache in hidingZone.ts.  The cache survives React re-renders
// and component remounts — it only invalidates when a content-based key
// signals that the inputs have semantically changed.
//
// The cache key is built BEFORE the combined mask so we can check the
// cache without any GEOS work.  The render-state signature now includes
// each family's raw-feature bbox, which disambiguates different masks
// with the same feature count (e.g. a 5 km radar circle vs a 150 km one).

const MAX_RESULT_CACHE_SIZE = 30;
const resultCache = new Map<string, StationEliminationResult>();

// ---------------------------------------------------------------------------
// Bbox helpers
// ---------------------------------------------------------------------------

function circleBbox(lat: number, lon: number, radiusMeters: number): Bbox {
    const latRad = (lat * Math.PI) / 180;
    const dLat = (radiusMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
    const cosLat = Math.cos(latRad);
    const dLon =
        cosLat > 0.001
            ? ((radiusMeters / EARTH_RADIUS_METERS) * (180 / Math.PI)) / cosLat
            : 180;
    const margin = 1.01;
    return [
        lon - dLon * margin,
        lat - dLat * margin,
        lon + dLon * margin,
        lat + dLat * margin,
    ];
}

/** Walk a FeatureCollection's coordinates and return its bbox, or null if empty. */
function fcBbox(fc: MaskFeatureCollection): Bbox | null {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

    for (const feature of fc.features) {
        const { coordinates } = feature.geometry;
        const stack: unknown[] = [coordinates];
        while (stack.length > 0) {
            const item = stack.pop();
            if (!Array.isArray(item)) continue;
            if (
                item.length === 2 &&
                typeof item[0] === "number" &&
                typeof item[1] === "number"
            ) {
                const lon = item[0] as number;
                const lat = item[1] as number;
                if (lon < west) west = lon;
                if (lon > east) east = lon;
                if (lat < south) south = lat;
                if (lat > north) north = lat;
            } else {
                for (const child of item) {
                    stack.push(child);
                }
            }
        }
    }

    if (!Number.isFinite(west)) return null;
    return [west, south, east, north];
}

/** Round a bbox to 4 decimal places (~11 m) for cache-key stability. */
function bboxString(bb: Bbox | null): string {
    if (!bb) return "nobbox";
    return bb.map((v) => Math.round(v * 1e4) / 1e4).join(",");
}

// ---------------------------------------------------------------------------
// Cache-key helpers
// ---------------------------------------------------------------------------

/**
 * Build a cache-key signature from the question render state.
 *
 * Includes each question family's hit/miss feature **count and bbox** so
 * that different mask geometries (e.g. a 5 km radar circle vs a 150 km one)
 * produce different keys — without needing to build the combined mask first.
 */
function renderStateSignature(rs: QuestionMapRenderState): string {
    const parts: string[] = [];
    for (const key of Object.keys(rs) as (keyof QuestionMapRenderState)[]) {
        const family = rs[key];
        if (!family || typeof family !== "object") continue;
        const hitFc: MaskFeatureCollection | undefined =
            "hitMaskFeatures" in family
                ? (family as { hitMaskFeatures: MaskFeatureCollection })
                      .hitMaskFeatures
                : undefined;
        const missFc: MaskFeatureCollection | undefined =
            "missMaskFeatures" in family
                ? (
                      family as {
                          missMaskFeatures?: MaskFeatureCollection;
                      }
                  ).missMaskFeatures
                : undefined;
        const hitCount = hitFc?.features?.length ?? 0;
        const missCount = missFc?.features?.length ?? 0;
        if (hitCount === 0 && missCount === 0) continue;
        const hitBb = hitCount > 0 && hitFc ? bboxString(fcBbox(hitFc)) : "";
        const missBb =
            missCount > 0 && missFc ? bboxString(fcBbox(missFc)) : "";
        parts.push(`${key}:${hitCount}:${missCount}:${hitBb}:${missBb}`);
    }
    parts.sort();
    return parts.join(",") || "empty";
}

function lruEvictCache(): void {
    if (resultCache.size >= MAX_RESULT_CACHE_SIZE) {
        const oldest = resultCache.keys().next().value;
        if (oldest !== undefined) resultCache.delete(oldest);
    }
}

export function clearStationEliminationCache(): void {
    resultCache.clear();
}

// ---------------------------------------------------------------------------
// Feature conversion helpers
// ---------------------------------------------------------------------------

function fcToSingleFeature(
    fc: MaskFeatureCollection,
): Feature<Polygon | MultiPolygon> | null {
    if (fc.features.length === 0) return null;
    return fc.features[0] as Feature<Polygon | MultiPolygon>;
}

// ---------------------------------------------------------------------------
// Pure computation (still exported for testing)
// ---------------------------------------------------------------------------

/**
 * Compute per-station elimination status.
 *
 * A station is "remaining" if its buffer circle still has eligible area
 * (not fully covered by the ineligibility mask from question constraints).
 *
 * Reuses the shared mask pipeline ({@link buildEligibilityConstraints},
 * {@link buildCombinedEligibilityMask}) so the results are consistent with
 * the hero elimination percentage and per-question contribution stats.
 *
 * Results are cached at module level (LRU, max 30 entries).  Callers should
 * check the cache via {@link getCachedResult} before calling this function
 * on the main thread.
 */
export function computeStationElimination(
    stations: TransitStation[],
    zoneFeatures: MaskFeatureCollection,
    boundary: MaskFeatureCollection | null,
    radiusMeters: number,
    playAreaBbox: Bbox | undefined,
    questionRenderState: QuestionMapRenderState,
    manuallyEliminatedIds: Set<string> = new Set(),
): StationEliminationResult {
    // ── Guard clauses ──────────────────────────────────────────────

    if (stations.length === 0) {
        return {
            remainingCount: 0,
            totalCount: 0,
            eliminatedStationIds: new Set(),
            stationAreas: new Map(),
            isComputing: false,
        };
    }

    if (!boundary || boundary.features.length === 0) {
        const areas = new Map<string, StationAreaInfo>();
        const eliminated = new Set<string>();
        for (const s of stations) {
            const elim = manuallyEliminatedIds.has(s.id);
            areas.set(s.id, {
                fraction: elim ? 0 : 1,
                remainingM2: elim ? 0 : Math.PI * radiusMeters * radiusMeters,
            });
            if (elim) eliminated.add(s.id);
        }
        return {
            remainingCount: stations.length - eliminated.size,
            totalCount: stations.length,
            eliminatedStationIds: eliminated,
            stationAreas: areas,
            isComputing: false,
        };
    }

    // Clip stations to play-area bbox.
    const clipped = clipStationsToPlayArea(
        stations,
        playAreaBbox,
        radiusMeters,
    );
    if (clipped.length === 0) {
        return {
            remainingCount: 0,
            totalCount: 0,
            eliminatedStationIds: new Set(),
            stationAreas: new Map(),
            isComputing: false,
        };
    }

    // Build the combined eligibility mask (ineligible region).
    const { required, excluded } = buildEligibilityConstraints(
        zoneFeatures,
        questionRenderState,
    );
    const mask = buildCombinedEligibilityMask(boundary, required, excluded);

    // Fast path: empty mask → all stations remaining.
    if (mask.features.length === 0) {
        const areas = new Map<string, StationAreaInfo>();
        // Compute circle area analytically for each station (avoids building
        // a polygon just for area measurement on the fast path).
        for (const station of clipped) {
            const fraction = manuallyEliminatedIds.has(station.id) ? 0 : 1;
            areas.set(station.id, {
                fraction,
                remainingM2:
                    fraction > 0 ? Math.PI * radiusMeters * radiusMeters : 0,
            });
        }
        const manuallyEliminated = clipped.filter((s) =>
            manuallyEliminatedIds.has(s.id),
        );
        return {
            remainingCount: clipped.length - manuallyEliminated.length,
            totalCount: clipped.length,
            eliminatedStationIds: new Set(manuallyEliminated.map((s) => s.id)),
            stationAreas: areas,
            isComputing: false,
        };
    }

    const backend = getGeometryBackend();
    const boundaryFeature = fcToSingleFeature(boundary);
    const maskFeature = fcToSingleFeature(mask);

    if (!boundaryFeature || !maskFeature) {
        const areas = new Map<string, StationAreaInfo>();
        const eliminated = new Set<string>();
        for (const station of clipped) {
            const elim = manuallyEliminatedIds.has(station.id);
            areas.set(station.id, {
                fraction: elim ? 0 : 1,
                remainingM2: elim ? 0 : Math.PI * radiusMeters * radiusMeters,
            });
            if (elim) eliminated.add(station.id);
        }
        return {
            remainingCount: clipped.length - eliminated.size,
            totalCount: clipped.length,
            eliminatedStationIds: eliminated,
            stationAreas: areas,
            isComputing: false,
        };
    }

    // Compute the eligible area polygon: playArea - mask.
    const eligibleFeature = backend.difference(boundaryFeature, maskFeature);

    // If difference is null, the entire play area is masked → zero remaining.
    if (!eligibleFeature) {
        const eliminated = new Set(clipped.map((s) => s.id));
        // Force manual eliminations (they're already in eliminated).
        for (const id of manuallyEliminatedIds) eliminated.add(id);
        const areas = new Map<string, StationAreaInfo>();
        for (const station of clipped) {
            areas.set(station.id, { fraction: 0, remainingM2: 0 });
        }
        return {
            remainingCount: 0,
            totalCount: clipped.length,
            eliminatedStationIds: eliminated,
            stationAreas: areas,
            isComputing: false,
        };
    }

    // Pre-compute mask bbox for fast-path filtering.
    const maskBboxValue = fcBbox(mask);
    const remaining: string[] = [];
    const eliminated: string[] = [];
    const stationAreas = new Map<string, StationAreaInfo>();

    for (const station of clipped) {
        // Force manually eliminated stations to 0 regardless of geometry.
        if (manuallyEliminatedIds.has(station.id)) {
            eliminated.push(station.id);
            stationAreas.set(station.id, { fraction: 0, remainingM2: 0 });
            continue;
        }

        const stationBbox = circleBbox(station.lat, station.lon, radiusMeters);

        // Fast path: station circle bbox doesn't overlap mask bbox →
        // the circle is entirely outside the ineligible region.
        if (maskBboxValue && !bboxIntersects(stationBbox, maskBboxValue)) {
            remaining.push(station.id);
            // Circle area analytically: π·r² (planar approximation; parity
            // with geomAreaM2 is not needed for a sort key at city scale).
            stationAreas.set(station.id, {
                fraction: 1,
                remainingM2: Math.PI * radiusMeters * radiusMeters,
            });
            continue;
        }

        // Slow path: create the station's circle polygon and check if it
        // intersects the eligible area.
        const stationCircle = circle(
            [station.lon, station.lat],
            radiusMeters / 1000,
            { steps: CIRCLE_STEPS, units: "kilometers" },
        ) as Feature<Polygon>;

        const intersectionResult = backend.intersection(
            stationCircle,
            eligibleFeature,
        );

        if (intersectionResult) {
            remaining.push(station.id);
            const circleArea = geomAreaM2(stationCircle.geometry);
            const intersectionArea = geomAreaM2(intersectionResult.geometry);
            const fraction =
                circleArea > 0 ? Math.min(1, intersectionArea / circleArea) : 0;
            stationAreas.set(station.id, {
                fraction,
                remainingM2: intersectionArea,
            });
        } else {
            eliminated.push(station.id);
            stationAreas.set(station.id, { fraction: 0, remainingM2: 0 });
        }
    }

    return {
        remainingCount: remaining.length,
        totalCount: clipped.length,
        eliminatedStationIds: new Set(eliminated),
        stationAreas,
        isComputing: false,
    };
}

// ---------------------------------------------------------------------------
// Cache-key builder (no mask computation needed)
// ---------------------------------------------------------------------------

/**
 * Build a cache key from the raw inputs without building the combined mask.
 * This lets callers check the module-level cache synchronously and skip the
 * expensive computation on navigation transitions.
 */
function buildCacheKey(
    stations: TransitStation[],
    zoneFeatures: MaskFeatureCollection,
    boundary: MaskFeatureCollection | null,
    radiusMeters: number,
    questionRenderState: QuestionMapRenderState,
    manuallyEliminatedIds?: Set<string>,
    playAreaBbox?: Bbox,
): string {
    const n = stations.length;
    const stationSig =
        n === 0
            ? "0"
            : `${n}:${stations[0].id}:${stations[Math.floor(n / 2)].id}:${stations[n - 1].id}`;
    // Include the actual geometry radius (from zone feature properties)
    // so the key invalidates when the debounced zone geometry updates,
    // not just when the canonical radius changes.
    const firstFeature = zoneFeatures.features[0] as
        | { properties?: { radiusMeters?: number } }
        | undefined;
    const zoneRadius = firstFeature?.properties?.radiusMeters ?? radiusMeters;
    const zoneSig = `${zoneFeatures.features.length}:${radiusMeters}:${zoneRadius}`;
    const boundarySig = boundary
        ? `${boundary.features.length}:${bboxString(playAreaBbox ?? null)}`
        : "0";
    const qSig = renderStateSignature(questionRenderState);
    const manualSig = manuallyEliminatedIds?.size
        ? `manual:${[...manuallyEliminatedIds].sort().join(",")}`
        : "";
    return `${stationSig}|${zoneSig}|${boundarySig}|${qSig}|${manualSig}`;
}

/**
 * Check the module-level cache for a previously computed result.
 * Returns the cached result or `null`.  This is cheap — no geometry work.
 */
export function getCachedResult(
    stations: TransitStation[],
    zoneFeatures: MaskFeatureCollection,
    boundary: MaskFeatureCollection | null,
    radiusMeters: number,
    questionRenderState: QuestionMapRenderState,
    manuallyEliminatedIds?: Set<string>,
    playAreaBbox?: Bbox,
): StationEliminationResult | null {
    const key = buildCacheKey(
        stations,
        zoneFeatures,
        boundary,
        radiusMeters,
        questionRenderState,
        manuallyEliminatedIds,
        playAreaBbox,
    );
    const cached = resultCache.get(key);
    if (cached) {
        // Promote to LRU tail.
        resultCache.delete(key);
        resultCache.set(key, cached);
    }
    return cached ?? null;
}

/** Store a result in the module-level cache. */
function putCachedResult(
    stations: TransitStation[],
    zoneFeatures: MaskFeatureCollection,
    boundary: MaskFeatureCollection | null,
    radiusMeters: number,
    questionRenderState: QuestionMapRenderState,
    result: StationEliminationResult,
    manuallyEliminatedIds?: Set<string>,
    playAreaBbox?: Bbox,
): void {
    const key = buildCacheKey(
        stations,
        zoneFeatures,
        boundary,
        radiusMeters,
        questionRenderState,
        manuallyEliminatedIds,
        playAreaBbox,
    );
    lruEvictCache();
    resultCache.set(key, result);
}

// ---------------------------------------------------------------------------
// React hook — async with loading state
// ---------------------------------------------------------------------------

/**
 * Hook that returns per-station elimination status.
 *
 * On the first call with a given input the hook checks the module-level
 * cache synchronously.  On a cache hit the result is available immediately
 * (no loading state).  On a cache miss the heavy geometry computation is
 * **deferred** via {@link InteractionManager.runAfterInteractions} so that
 * sheet navigation animations aren't blocked.  While computing,
 * `remainingCount` is `null` and `isComputing` is `true`.
 */
export function useStationElimination(): StationEliminationResult {
    const { selectedStations, activeZoneFeatures } = useHidingZoneDerived();
    const { radiusMeters, eliminatedStationIds } = useHidingZoneState();
    const { playArea } = usePlayArea();
    const {
        renderState: questionMapRenderState,
        isComputing: renderComputing,
    } = useQuestionMapRenderState();

    const boundary = playArea.boundary as GeoJsonFeatureCollection | null;
    const bbox = playArea.bbox;

    // Derive the dependencies we pass to useEffect / cache.
    const stations = selectedStations;
    // Use active zone (without manually eliminated stations) as the
    // eligibility numerator — this makes manual elimination count as
    // elimination progress and reshapes the eligible region correctly.
    const zf = activeZoneFeatures;
    const qrs = questionMapRenderState;
    const manuallyEliminatedSet = useMemo(
        () => new Set(eliminatedStationIds),
        [eliminatedStationIds],
    );

    // Check the module cache synchronously on every render.
    const cached = getCachedResult(
        stations,
        zf,
        boundary,
        radiusMeters,
        qrs,
        manuallyEliminatedSet,
        bbox,
    );

    // Track the latest result (initialised from cache if available).
    const [result, setResult] = useState<StationEliminationResult>(
        cached ?? {
            remainingCount: null,
            totalCount: stations.length,
            eliminatedStationIds: new Set(),
            stationAreas: new Map(),
            isComputing: true,
        },
    );

    // Refs to detect genuine input changes vs React re-renders.
    const cacheKeyRef = useRef<string | null>(null);
    const computeIdRef = useRef(0);

    // Kick off async computation when inputs change and the cache misses.
    useEffect(() => {
        const cacheKey = buildCacheKey(
            stations,
            zf,
            boundary,
            radiusMeters,
            qrs,
            manuallyEliminatedSet,
            bbox,
        );

        // Same cache key as last effect run → nothing changed.
        if (cacheKeyRef.current === cacheKey) return;
        cacheKeyRef.current = cacheKey;

        // Cache hit → update state immediately (no loading flash).
        const hit = getCachedResult(
            stations,
            zf,
            boundary,
            radiusMeters,
            qrs,
            manuallyEliminatedSet,
            bbox,
        );
        if (hit) {
            log.debug(
                `cache HIT — remaining=${hit.remainingCount}/${hit.totalCount}`,
            );
            setResult(hit);
            return;
        }

        // Cache miss → show loading state and defer the heavy work.
        const computeId = ++computeIdRef.current;
        log.debug(
            `cache MISS — setting isComputing=true, ` +
                `stations=${stations.length}, zoneFeats=${zf.features.length}`,
        );
        setResult({
            remainingCount: null,
            totalCount: stations.length,
            eliminatedStationIds: new Set(),
            stationAreas: new Map(),
            isComputing: true,
        });

        const t0 = performance.now();
        let rafId: number | null = null;
        const handle = InteractionManager.runAfterInteractions(() => {
            if (computeId !== computeIdRef.current) {
                log.debug(`runAfterInteractions STALE computeId=${computeId}`);
                return;
            }
            // Yield one frame so React can commit the loading state before
            // the synchronous compute blocks the JS thread.
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (computeId !== computeIdRef.current) return;
                log.debug(
                    `runAfterInteractions START compute ` +
                        `(computeId=${computeId}, elapsed=${(performance.now() - t0).toFixed(0)}ms)`,
                );
                const r = computeStationElimination(
                    stations,
                    zf,
                    boundary,
                    radiusMeters,
                    bbox,
                    qrs,
                    manuallyEliminatedSet,
                );
                const dt = (performance.now() - t0).toFixed(0);
                log.debug(
                    `runAfterInteractions DONE compute ` +
                        `(computeId=${computeId}, elapsed=${dt}ms, remaining=${r.remainingCount}/${r.totalCount})`,
                );
                if (computeId !== computeIdRef.current) return; // stale
                putCachedResult(
                    stations,
                    zf,
                    boundary,
                    radiusMeters,
                    qrs,
                    r,
                    manuallyEliminatedSet,
                    bbox,
                );
                setResult(r);
            });
        });

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            handle.cancel();
        };
    }, [
        stations,
        zf,
        boundary,
        radiusMeters,
        bbox,
        qrs,
        manuallyEliminatedSet,
    ]);

    // Treat an upstream render-state recompute as "still computing" too — the
    // elimination inputs (the question render state) aren't final yet.
    const withUpstream = (
        r: StationEliminationResult,
    ): StationEliminationResult =>
        renderComputing && !r.isComputing ? { ...r, isComputing: true } : r;

    // When a cached result was available on this render but state still
    // holds a stale loading/null value, update synchronously (avoids a
    // one-frame flash of loading indicator on cache hits).
    if (cached && result.isComputing) {
        return withUpstream(cached);
    }

    return withUpstream(result);
}

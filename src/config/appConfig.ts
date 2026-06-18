/**
 * Central application configuration constants.
 *
 * Algorithm tuning parameters, cache sizes, budget limits, and other
 * configurable values are collected here so they are discoverable and
 * adjustable in one place — rather than scattered across individual
 * feature modules.
 *
 * Cache version numbers (incremented when algorithms change) and
 * physical constants (EARTH_RADIUS_METERS, METERS_PER_KM) remain in
 * their domain modules — they are not configuration, they are
 * implementation details.
 */

export const APP_CONFIG = {
    measuring: {
        /**
         * Approximate degrees per meter at mid-latitudes.
         * 1° ≈ 111,320 m (WGS-84).
         */
        degPerMeter: 1 / 111_320,

        line: {
            /** Minimum query window (50 km) even when the seeker is on the line. */
            minWindowMarginM: 50_000,
            /** Query margin for bbox pre-filter in line-distance computation. */
            queryMarginM: 50_000,
            /** Maximum cached line-category results (LRU). */
            categoryCacheMax: 50,
            /** Maximum cached line-distance results (LRU). */
            distanceCacheMax: 100,
            /** Maximum cached line-buffer results (LRU). */
            bufferCacheMax: 50,
            /** Maximum cached clipped-line results (LRU). */
            clippedLineCacheMax: 20,

            // ── Buffer input budget ─────────────────────────────
            /** Maximum line segments allowed before budget escalation. */
            maxBufferSegments: 400,
            /** Maximum coordinates allowed before budget escalation. */
            maxBufferCoords: 20_000,
            /** Buffer circle resolution (Turf steps). */
            bufferSteps: 8,
            /** Maximum escalation rounds for buffer budget enforcement. */
            budgetMaxRounds: 6,

            // ── Simplify parameters ────────────────────────────
            /** Simplify tolerance: fraction of buffer radius. */
            simplifyFraction: 0.02,
            /** Simplify tolerance: floor in meters. */
            simplifyMinM: 10,
            /** Minimum feature length: fraction of buffer radius. */
            minFeatureLenFraction: 0.1,
            /** Minimum feature length: cap in meters. */
            minFeatureLenCapM: 500,
            /** Polygon simplify fraction (more aggressive fallback). */
            polySimplifyFraction: 0.2,
            /** Polygon simplify floor in meters. */
            polySimplifyMinM: 50,

            // ── Clip ───────────────────────────────────────────
            /**
             * Small outward dilation (~30 m) for the play-area clip
             * boundary so coincident borders survive the clip.
             */
            clipDilationM: 30,
            /** Simplify tolerance for nearest-point-on-line search (fast path). */
            nearestPointSimplifyM: 10,
        },

        point: {
            /** Fallback query margin (25 km) when no play-area bbox. */
            fallbackMarginM: 25_000,
            /** Maximum cached point-distance results (LRU). */
            distanceCacheMax: 100,
            /** Maximum cached point-buffer results (LRU). */
            bufferCacheMax: 50,
            /** Grid dedup cell size: fraction of buffer radius. */
            gridDedupFraction: 0.05,
            /** Grid dedup cell size: floor in meters. */
            gridDedupMinM: 10,
        },
    },

    hidingZone: {
        /** Maximum hiding-zone feature cache size (LRU). */
        maxZoneCacheSize: 30,
        /** Circle generation step count (Turf). */
        circleSteps: 12,
        /** Maximum circle cache size (LRU). */
        maxCircleCacheSize: 500,
        /** Maximum component feature cache size (LRU). */
        maxComponentCacheSize: 50,
        /** Default hiding-zone radius in meters. */
        defaultRadiusM: 600,
    },

    map: {
        /** Maximum station color rings (concentric rendering limit). */
        maxStationColorRings: 6,
        /** Minimum zoom level for route lines. */
        routeMinZoom: 9,
        /** Minimum zoom level for station dots. */
        stationMinZoom: 12,
        /** Maximum mask cache size (LRU). */
        maxMaskCacheSize: 40,
        /** Simplify tolerance for boundary GeoJSON polygons (degrees). */
        boundarySimplifyTolerance: 0.0001,
        /** Hit radius in pixels for pin drag detection. */
        pinHitRadiusPx: 50,
    },

    matching: {
        /** Default search radius in meters (Overpass / spatial index). */
        defaultSearchRadiusM: 50_000,
        /** Progressive search maximum radius in meters. */
        progressiveMaxRadiusM: 200_000,
        /** Progressive search minimum initial radius in meters. */
        minInitialRadiusM: 1_200,
        /** Progressive search candidate cap. */
        progressiveCandidateCap: 999,
        /** Maximum Voronoi cache size (LRU). */
        maxVoronoiCacheSize: 20,
        /** Maximum inflate bytes for region pack decompression. */
        inflateMaxBytes: 100 * 1024 * 1024, // 100 MB
        /** Manifest stale time (30 minutes). */
        manifestStaleTimeMs: 30 * 60 * 1000,
    },

    thermometer: {
        /** Minimum travel distance between pins in meters. */
        minTravelM: 100,
        /** Maximum geometry cache size (LRU). */
        maxCacheSize: 20,
    },

    tentacles: {
        /** Maximum geometry cache size (LRU). */
        maxCacheSize: 20,
    },

    radar: {
        /** Circle generation step count (Turf). */
        circleSteps: 32,
        /** Maximum circle fragment cache size (LRU). */
        circleCacheMax: 200,
    },

    voronoi: {
        /** Maximum Voronoi clip cache size (LRU). */
        maxClipCacheSize: 20,
    },

    geometry: {
        /**
         * Geometry-operation backend selection.
         *
         * - `"auto"` — native GEOS if available, else pure JS (default).
         * - `"js"`   — force pure-JS backend (kill switch / Jest).
         * - `"geos"` — force native GEOS; falls back to JS if unavailable.
         *
         * Only affects `bufferMeters` in G0–G4. Future phases may route
         * overlay ops (union / difference / intersection) through the same
         * backend.
         */
        backend: (process.env.EXPO_PUBLIC_GEOMETRY_BACKEND === "geos"
            ? "geos"
            : "auto") as "auto" | "js" | "geos",
    },

    animation: {
        /** Sheet transition duration in milliseconds. */
        sheetTransitionMs: 300,
        /** Minimum horizontal translation to trigger swipe-back (px). */
        swipeBackThreshold: 80,
        /** Minimum velocity to trigger swipe-back (px/s). */
        swipeBackVelocity: 500,
    },

    camera: {
        /** Viewport bottom-padding factor (fraction of screen height reserved for the sheet). */
        topPaddingFactor: 0.48,
        /** Additional top inset padding (px), added to safe-area topInset. */
        topPaddingMin: 120,
        /** Horizontal padding (left/right) in px. */
        sidePadding: 40,
    },

    search: {
        /** Debounce delay for search input in milliseconds. */
        debounceMs: 350,
        /** Minimum query length before triggering a search. */
        minQueryLength: 2,
        /** Delay before auto-focusing the search input on mount (ms). */
        inputDelayMs: 400,
        /** Delay before scrolling to search section after focus (ms). */
        scrollDelayMs: 100,
        /** Maximum number of search results to display. */
        resultLimit: 10,
    },

    network: {
        /**
         * Headers sent on every Overpass API request.
         *
         * A descriptive User-Agent is required by the OSM/Overpass usage
         * policy. It is also load-bearing: without it, overpass-api.de's WAF
         * returns 406 Not Acceptable to React Native's default Android
         * (OkHttp `okhttp/x.y`) User-Agent, while the iOS (CFNetwork/Darwin)
         * default slips through — so boundary/POI fetches silently failed on
         * Android only.
         */
        overpassHeaders: {
            "User-Agent":
                "HideAndSeekMapper/0.1.7 (+https://jetlag.hinoka.org)",
            Accept: "application/json",
        } as Record<string, string>,
    },

    offline: {
        /**
         * URL to the v2 packs catalog (GitHub Pages).
         * Served from site/packs/ via the pages.yml Actions deployment.
         */
        catalogUrl: "https://jetlag.hinoka.org/packs/catalog.json",
        /** Catalog stale time (30 minutes). */
        catalogStaleTimeMs: 30 * 60 * 1000,
        /** Key for the AsyncStorage installed-packs index (v2). */
        installedIndexKey: "installed-packs-v2",
        /** Maximum inflate bytes for any single artifact (100 MB). */
        inflateMaxBytes: 100 * 1024 * 1024,
    },
} as const;

// ─── Convenience re-exports ──────────────────────────────────────────

export const ANIMATION = APP_CONFIG.animation;
export const CAMERA = APP_CONFIG.camera;
export const SEARCH = APP_CONFIG.search;
export const MEASURING_LINE = APP_CONFIG.measuring.line;
export const MEASURING_POINT = APP_CONFIG.measuring.point;
export const HIDING_ZONE = APP_CONFIG.hidingZone;
export const MAP = APP_CONFIG.map;
export const MATCHING = APP_CONFIG.matching;
export const THERMOMETER = APP_CONFIG.thermometer;
export const TENTACLES = APP_CONFIG.tentacles;
export const RADAR = APP_CONFIG.radar;
export const VORONOI = APP_CONFIG.voronoi;
export const GEOMETRY = APP_CONFIG.geometry;
export const NETWORK = APP_CONFIG.network;
export const OFFLINE = APP_CONFIG.offline;

// ─── Derived-value helpers ───────────────────────────────────────────

/**
 * Simplify tolerance for line/polygon buffer geometry.
 * Fraction of the buffer radius clamped to a minimum in meters.
 */
export function simplifyTolerance(radiusMeters: number): number {
    return Math.max(
        radiusMeters * APP_CONFIG.measuring.line.simplifyFraction,
        APP_CONFIG.measuring.line.simplifyMinM,
    );
}

/**
 * Polygon simplify tolerance (more aggressive fallback for polygon coords).
 */
export function polySimplifyTolerance(radiusMeters: number): number {
    return Math.max(
        radiusMeters * APP_CONFIG.measuring.line.polySimplifyFraction,
        APP_CONFIG.measuring.line.polySimplifyMinM,
    );
}

/**
 * Minimum feature length for line buffer input.
 * Fraction of the buffer radius capped at a maximum in meters.
 */
export function minFeatureLength(radiusMeters: number): number {
    return Math.min(
        radiusMeters * APP_CONFIG.measuring.line.minFeatureLenFraction,
        APP_CONFIG.measuring.line.minFeatureLenCapM,
    );
}

/**
 * Grid dedup cell size for point-measuring buffer.
 * Fraction of the buffer radius clamped to a minimum in meters.
 */
export function gridDedupCellSize(radiusMeters: number): number {
    return Math.max(
        radiusMeters * APP_CONFIG.measuring.point.gridDedupFraction,
        APP_CONFIG.measuring.point.gridDedupMinM,
    );
}

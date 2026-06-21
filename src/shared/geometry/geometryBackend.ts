import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPoint,
    MultiPolygon,
    Polygon,
} from "geojson";

import { APP_CONFIG } from "@/config/appConfig";
import { jsGeometryBackend } from "./jsGeometryBackend";
import { geosGeometryBackend } from "./geosGeometryBackend";
import { createLogger } from "@/shared/logger";

const log = createLogger("geometryBackend");

// ─── Interface ───────────────────────────────────────────────────────────

/**
 * Swappable geometry-operation backend.
 *
 * The default implementation (`jsGeometryBackend`) delegates to
 * `@turf/buffer` (JSTS) and is the Jest-compatible reference oracle. A
 * future native GEOS backend (G2) will provide the same interface backed
 * by compiled C++ — same semantics, sub-ms performance.
 */
export interface GeometryBackend {
    /** Discriminant for logging / debugging. */
    readonly name: "js" | "geos";

    /**
     * Buffer a geometry by `meters` using `quadrantSegments` arc fidelity.
     * The return is always a single Polygon or MultiPolygon Feature, or
     * `null` on failure.
     *
     * ⚠️ FeatureCollection input does NOT union. Each feature is buffered
     * independently and **only the first result is returned** — a bug-for-bug
     * quirk shared by both backends (see geosGeometryBackend header; a real
     * N-ary union is deferred to GEOSUnaryUnion). In particular,
     * `bufferMeters(fc, 0)` is NOT a "cheap union" — it returns only
     * `features[0]` and silently drops the rest. To union multiple polygons,
     * merge them into one MultiPolygon feature (polyclip difference/
     * intersection treat a MultiPolygon's members as their set union) or call
     * polyclip-ts `union` directly. To buffer a set of points as a unioned
     * blob, pass a single MultiPoint feature (not an FC) — GEOS/turf union
     * the resulting circles natively.
     *
     * @param geom  Input geometry or FeatureCollection (see the union caveat
     *   above before passing an FC).
     * @param meters  Buffer radius in meters. `0` is a per-feature no-op pass
     *   (NOT a union — see above).
     * @param quadrantSegments  Arc resolution (maps to turf `steps` in JS
     *   backend, GEOS `quadrantSegments` in native backend).
     * @param units  Always "meters" for the JS backend; kept for future
     *   degree-based buffers.
     */
    bufferMeters(
        geom:
            | Feature<
                  | LineString
                  | MultiLineString
                  | Polygon
                  | MultiPolygon
                  | MultiPoint
              >
            | FeatureCollection<
                  | LineString
                  | MultiLineString
                  | Polygon
                  | MultiPolygon
                  | MultiPoint
              >,
        meters: number,
        quadrantSegments: number,
        units?: "meters",
    ): Feature<Polygon | MultiPolygon> | null;

    /**
     * Topological difference `a - b`.
     *
     * Returns a Polygon or MultiPolygon Feature, or `null` when the result is
     * empty (a is wholly contained in b). Operates in the input coordinate
     * space — no projection is applied.
     *
     * Backed by {@link https://libgeos.org/doxygen/geos__c_8h.html GEOSDifference_r}
     * (GEOS) or polyclip-ts Greiner-Hormann (JS).
     */
    difference(
        a: Feature<Polygon | MultiPolygon>,
        b: Feature<Polygon | MultiPolygon>,
    ): Feature<Polygon | MultiPolygon> | null;

    /**
     * Topological union `a ∪ b`.
     *
     * Returns a Polygon or MultiPolygon Feature, or `null` when both inputs
     * are empty / cancel out.
     *
     * Backed by {@link https://libgeos.org/doxygen/geos__c_8h.html GEOSUnion_r}
     * (GEOS) or polyclip-ts Greiner-Hormann (JS).
     */
    union(
        a: Feature<Polygon | MultiPolygon>,
        b: Feature<Polygon | MultiPolygon>,
    ): Feature<Polygon | MultiPolygon> | null;

    /**
     * Topological intersection `a ∩ b`.
     *
     * Returns a Polygon or MultiPolygon Feature, or `null` when the result is
     * empty (a and b are disjoint).
     *
     * Backed by {@link https://libgeos.org/doxygen/geos__c_8h.html GEOSIntersection_r}
     * (GEOS) or polyclip-ts Greiner-Hormann (JS).
     */
    intersection(
        a: Feature<Polygon | MultiPolygon>,
        b: Feature<Polygon | MultiPolygon>,
    ): Feature<Polygon | MultiPolygon> | null;

    /**
     * Unary union (self-dissolve) of a single geometry.
     *
     * For a MultiPolygon whose members overlap, this dissolves the overlaps
     * into a clean non-overlapping Polygon or MultiPolygon. For a simple
     * Polygon with no self-overlap, returns it as-is. Returns `null` when the
     * input is empty or the union produces an empty result.
     *
     * This is the correct semantic for "dissolve this MultiPolygon into clean
     * geometry" — unlike `bufferMeters(geom, 0)`, which is a bug-for-bug
     * per-feature buffer and does NOT union at distance 0.
     *
     * Backed by {@link https://libgeos.org/doxygen/geos__c_8h.html GEOSUnaryUnion_r}
     * (GEOS) or polyclip-ts N-ary union over member polygons (JS).
     */
    unaryUnion(
        a: Feature<Polygon | MultiPolygon>,
    ): Feature<Polygon | MultiPolygon> | null;
}

// ─── Selection ───────────────────────────────────────────────────────────

/** The *configured* backend value, as read from `APP_CONFIG.geometry.backend`. */
export type GeometryBackendConfig = "auto" | "js" | "geos";

let _backend: GeometryBackend | null = null;

// Runtime override of the configured backend, consulted *before* APP_CONFIG.
// Default `null` ⇒ no override, so reads are byte-identical to today. Set only
// via `setGeometryBackendConfigOverride` (the gated e2e controls + tests).
let _backendConfigOverride: GeometryBackendConfig | null = null;

/**
 * Returns the active {@link GeometryBackend}, selected once on first call
 * based on `APP_CONFIG.geometry.backend` and native-module availability.
 *
 * Logs the selection decision to the console on first call so the active
 * backend is always obvious in Metro / device logs.
 */
export function getGeometryBackend(): GeometryBackend {
    if (_backend) return _backend;

    const configBackend = _backendConfigOverride ?? APP_CONFIG.geometry.backend;

    // ── Force JS ────────────────────────────────────────────────
    if (configBackend === "js") {
        _backend = jsGeometryBackend;
        log.debug(
            'backend=js reason=config (backend forced to "js" in APP_CONFIG)',
        );
        return _backend;
    }

    // ── Probe native module ─────────────────────────────────────
    let nativeAvailable = false;
    let nativeAbi = 0;
    try {
        // Dynamic require — the native-geometry module doesn't exist
        // until G2. Metro resolves this at bundle time; when the
        // module is absent the require throws and we fall back to JS.
        const mod = require("native-geometry") as {
            isAvailable?: () => boolean;
            nativeAbiVersion?: () => number;
            EXPECTED_NATIVE_ABI?: number;
        };
        nativeAvailable = mod?.isAvailable?.() ?? false;
        nativeAbi = mod?.nativeAbiVersion?.() ?? 0;
    } catch {
        nativeAvailable = false;
    }

    // ── Force native (with JS fallback) ─────────────────────────
    if (configBackend === "geos") {
        if (nativeAvailable) {
            _backend = geosGeometryBackend;
            log.debug(
                'backend=geos reason=config (backend forced to "geos" in APP_CONFIG)',
            );
            _checkAbiMismatch(nativeAbi);
            return _backend;
        }
        log.warn(
            "backend=js reason=fallback — native-geometry module not found. " +
                "Rebuild the dev client (expo prebuild + run:ios/android) to enable GEOS.",
        );
        _backend = jsGeometryBackend;
        return _backend;
    }

    // ── Auto ────────────────────────────────────────────────────
    if (nativeAvailable) {
        _backend = geosGeometryBackend;
        log.debug(
            "backend=geos reason=auto (native-geometry module available)",
        );
        _checkAbiMismatch(nativeAbi);
        return _backend;
    }

    log.debug(
        "backend=js reason=unavailable (native-geometry module not found)",
    );
    _backend = jsGeometryBackend;
    return _backend;
}

// ─── ABI handshake (G5 follow-up) ──────────────────────────────────────────
// Single source of truth for the expected ABI version is
// modules/native-geometry/abi-version.json. Bump that file and keep the
// Swift (NativeGeometryModule.swift) and Kotlin (GeosBridge.kt) constants
// in sync.

let _abiWarned = false;

function _checkAbiMismatch(nativeAbi: number): void {
    if (_abiWarned) return;

    // Lazy-require so Jest can mock the module.
    const mod = require("native-geometry") as {
        EXPECTED_NATIVE_ABI?: number;
    };
    const expected = mod?.EXPECTED_NATIVE_ABI ?? 0;

    if (nativeAbi < expected) {
        _abiWarned = true;
        log.warn(
            `native-geometry binary is stale (abi ${nativeAbi} < expected ${expected}) — ` +
                "rebuild the dev client (expo prebuild + run:ios/android) to enable all GEOS ops. " +
                "Buffer is still native; overlay ops will fall back to JS per op.",
        );
    }
}

// ─── Test seam ───────────────────────────────────────────────────────────

/**
 * Override the active backend for tests. Pass `null` to reset to default
 * selection (the memoized backend is re-resolved on the next call).
 *
 * @internal Only call from test files.
 */
export function __setGeometryBackendForTest(b: GeometryBackend | null): void {
    _backend = b;
}

/**
 * Override the *configured* backend at runtime (the value normally read from
 * `APP_CONFIG.geometry.backend`), then re-resolve on the next
 * {@link getGeometryBackend} call. Unlike {@link __setGeometryBackendForTest},
 * this flows through the real native probe — so `"geos"` still falls back to JS
 * when the native module is absent (e.g. in Jest).
 *
 * Pass `null` to clear the override. The memo and the one-shot ABI warning are
 * reset so the next call re-selects. Only the gated e2e controls
 * (`src/testing/e2e/e2eControls.ts`) and tests call this; the read it adds to
 * the selection path is a cheap nullish coalesce off the memoized fast path.
 */
export function setGeometryBackendConfigOverride(
    backend: GeometryBackendConfig | null,
): void {
    _backendConfigOverride = backend;
    _backend = null;
    _abiWarned = false;
}

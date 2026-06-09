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
}

// ─── Selection ───────────────────────────────────────────────────────────

let _backend: GeometryBackend | null = null;

/**
 * Returns the active {@link GeometryBackend}, selected once on first call
 * based on `APP_CONFIG.geometry.backend` and native-module availability.
 *
 * Logs the selection decision to the console on first call so the active
 * backend is always obvious in Metro / device logs.
 */
export function getGeometryBackend(): GeometryBackend {
    if (_backend) return _backend;

    const configBackend = APP_CONFIG.geometry.backend;

    // ── Force JS ────────────────────────────────────────────────
    if (configBackend === "js") {
        _backend = jsGeometryBackend;
        console.log(
            '[geometryBackend] backend=js reason=config (backend forced to "js" in APP_CONFIG)',
        );
        return _backend;
    }

    // ── Probe native module ─────────────────────────────────────
    let nativeAvailable = false;
    try {
        // Dynamic require — the native-geometry module doesn't exist
        // until G2. Metro resolves this at bundle time; when the
        // module is absent the require throws and we fall back to JS.
        const mod = require("native-geometry") as
            | { isAvailable?: () => boolean }
            | undefined;
        nativeAvailable = mod?.isAvailable?.() ?? true;
    } catch {
        nativeAvailable = false;
    }

    // ── Force native (with JS fallback) ─────────────────────────
    if (configBackend === "geos") {
        if (nativeAvailable) {
            _backend = geosGeometryBackend;
            console.log(
                '[geometryBackend] backend=geos reason=config (backend forced to "geos" in APP_CONFIG)',
            );
            return _backend;
        }
        console.log(
            "[geometryBackend] backend=js reason=fallback (native-geometry module not found)",
        );
        _backend = jsGeometryBackend;
        return _backend;
    }

    // ── Auto ────────────────────────────────────────────────────
    if (nativeAvailable) {
        _backend = geosGeometryBackend;
        console.log(
            "[geometryBackend] backend=geos reason=auto (native-geometry module available)",
        );
        return _backend;
    }

    console.log(
        "[geometryBackend] backend=js reason=unavailable (native-geometry module not found)",
    );
    _backend = jsGeometryBackend;
    return _backend;
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

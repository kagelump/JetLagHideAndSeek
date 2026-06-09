/**
 * GEOS-native {@link GeometryBackend}.
 *
 * Projects WGS84 coordinates to per-feature azimuthal-equidistant planar
 * meters, encodes to WKB, calls the native `bufferWKB`, decodes the result,
 * and unprojects back to WGS84 — matching `@turf/buffer`'s projection chain
 * exactly.
 *
 * Known intentional quirks (bug-for-bug fidelity with `jsGeometryBackend`):
 *
 * 1. `FeatureCollection` input: each feature is buffered independently (turf
 *    does the same — no N-ary union). The first feature's result is returned;
 *    this matches the JS backend's `fc.features[0]` extraction.
 * 2. `buffer(fc, 0)` "union" semantics: turf buffers each feature individually
 *    and the seam keeps only the first. A real N-ary union belongs in Phase B
 *    (G5, `GEOSUnaryUnion`).
 *
 * These quirks are replicated deliberately for G2 so parity testing doesn't
 * flag them as bugs. Do NOT "fix" them here.
 */

import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPoint,
    MultiPolygon,
    Polygon,
} from "geojson";

import type { GeometryBackend } from "./geometryBackend";
import { jsGeometryBackend } from "./jsGeometryBackend";
import { encodeWkb, decodeWkb } from "./wkb";
import {
    projectionFor,
    projectGeometry,
    unprojectGeometry,
} from "./bufferProjection";

function isFeatureCollection(geom: {
    type: string;
}): geom is FeatureCollection {
    return geom.type === "FeatureCollection";
}

/**
 * Buffer a single Feature through the GEOS native path:
 * project → encode → bufferWKB → decode → unproject.
 *
 * When `__DEV__` is true, logs a `[geosPerf]` line with per-step timings
 * (encode, native, decode) so the marshalling split can be validated
 * independently of the total wall-clock time.
 */
function bufferFeature(
    feature: Feature,
    meters: number,
    quadrantSegments: number,
): Feature<Polygon | MultiPolygon> | null {
    // Dynamically require so Jest can mock the native module.
    const { bufferWKB } = require("native-geometry") as {
        bufferWKB: (
            wkb: Uint8Array,
            distance: number,
            qs: number,
        ) => Uint8Array | null;
    };

    const geom = feature.geometry;
    if (!geom) return null;

    // 1. Build per-feature AEQD projection (same as turf).
    const proj = projectionFor(feature);

    // 2. Project to planar meters (handles all geometry types).
    const projected = projectGeometry(
        geom as
            | LineString
            | MultiLineString
            | Polygon
            | MultiPolygon
            | MultiPoint,
        proj,
    );

    // 3. Encode projected geometry to WKB.
    const tEncode0 = __DEV__ ? performance.now() : 0;
    const wkb = encodeWkb(projected);
    const tEncodeMs = __DEV__ ? performance.now() - tEncode0 : 0;

    // 4. Call native GEOS buffer in meter units.
    const tNative0 = __DEV__ ? performance.now() : 0;
    const resultWkb = bufferWKB(wkb, meters, quadrantSegments);
    const tNativeMs = __DEV__ ? performance.now() - tNative0 : 0;
    if (!resultWkb) return null;

    // 5. Decode buffered WKB back to GeoJSON.
    const tDecode0 = __DEV__ ? performance.now() : 0;
    const buffered = decodeWkb(resultWkb);
    const tDecodeMs = __DEV__ ? performance.now() - tDecode0 : 0;
    if (!buffered) return null; // empty geometry (POLYGON EMPTY etc.)

    // 6. Unproject from planar meters back to WGS84.
    const unprojected = unprojectGeometry(buffered, proj);

    if (__DEV__) {
        console.log(
            `[geosPerf] encode=${tEncodeMs.toFixed(2)}ms ` +
                `native=${tNativeMs.toFixed(2)}ms ` +
                `decode=${tDecodeMs.toFixed(2)}ms ` +
                `type=${geom.type} r=${meters} qs=${quadrantSegments}`,
        );
    }

    return {
        type: "Feature",
        properties: {},
        geometry: unprojected,
    };
}

export const geosGeometryBackend: GeometryBackend = {
    name: "geos",

    bufferMeters(geom, meters, quadrantSegments, units = "meters") {
        const t0 = performance.now();
        try {
            if (isFeatureCollection(geom)) {
                // Bug-for-bug: buffer each feature independently, keep only
                // the first (matching jsGeometryBackend's fc.features[0]).
                // A real N-ary union will happen in G5.
                const results: Feature<Polygon | MultiPolygon>[] = [];
                for (const feature of geom.features) {
                    const result = bufferFeature(
                        feature as Feature,
                        meters,
                        quadrantSegments,
                    );
                    if (result) results.push(result);
                }
                const ms = performance.now() - t0;
                console.log(
                    `[geos] bufferMeters FC(${geom.features.length}) r=${meters} qs=${quadrantSegments} → ` +
                        `${results.length} features (returning ${results[0]?.geometry.type ?? "null"}) in ${ms.toFixed(0)}ms`,
                );
                return results[0] ?? null;
            }

            // Single Feature input.
            const result = bufferFeature(
                geom as Feature,
                meters,
                quadrantSegments,
            );
            const ms = performance.now() - t0;
            console.log(
                `[geos] bufferMeters ${geom.geometry?.type ?? "?"} r=${meters} qs=${quadrantSegments} → ` +
                    `${result?.geometry.type ?? "null"} in ${ms.toFixed(0)}ms`,
            );
            return result;
        } catch (err) {
            const ms = performance.now() - t0;
            console.warn(
                `[geos] bufferMeters failed (${ms.toFixed(0)}ms), falling back to JS:`,
                err,
            );
            return jsGeometryBackend.bufferMeters(
                geom,
                meters,
                quadrantSegments,
                units,
            );
        }
    },
};

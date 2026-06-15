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

// ─── Overlay helpers (G5) ─────────────────────────────────────────────────

type GeosOutcome =
    | { status: "native"; feature: Feature<Polygon | MultiPolygon> | null }
    | { status: "fallback" };

/**
 * Shared encode → call native → decode pipeline for binary overlay ops.
 *
 * ⚠️ No projection — overlay ops are topological and run directly on raw
 * WGS84 coordinates, matching polyclip-ts. See G5-plan.md §Scope.
 *
 * Falls back to the corresponding JS backend method when the native call
 * throws or returns null due to a missing native entry point.
 */
function binaryGeosOp(
    a: Feature<Polygon | MultiPolygon>,
    b: Feature<Polygon | MultiPolygon>,
    nativeFn: (wkbA: Uint8Array, wkbB: Uint8Array) => Uint8Array | null,
): GeosOutcome {
    const geomA = a.geometry;
    const geomB = b.geometry;
    // can't do topology on null geometries — fall back to JS to match its behavior
    if (!geomA || !geomB) return { status: "fallback" };

    const tEncode0 = __DEV__ ? performance.now() : 0;

    // Encode both inputs to WKB (raw WGS84 — no projection).
    const wkbA = encodeWkb(geomA);
    const wkbB = encodeWkb(geomB);

    const tEncodeMs = __DEV__ ? performance.now() - tEncode0 : 0;

    // Call native binary overlay op.
    const tNative0 = __DEV__ ? performance.now() : 0;
    let resultWkb: Uint8Array | null;
    try {
        resultWkb = nativeFn(wkbA, wkbB);
    } catch {
        resultWkb = null;
    }
    const tNativeMs = __DEV__ ? performance.now() - tNative0 : 0;

    // nativeFn returns null when the op is missing from the native binary
    // (W2e per-op guard) — fall back to JS in that case too.
    if (!resultWkb) return { status: "fallback" };

    // Decode result WKB.
    const tDecode0 = __DEV__ ? performance.now() : 0;
    const decoded = decodeWkb(resultWkb);
    const tDecodeMs = __DEV__ ? performance.now() - tDecode0 : 0;

    if (__DEV__) {
        console.log(
            `[geosPerf] encode=${tEncodeMs.toFixed(2)}ms ` +
                `native=${tNativeMs.toFixed(2)}ms ` +
                `decode=${tDecodeMs.toFixed(2)}ms ` +
                `types=${geomA.type},${geomB.type}`,
        );
    }

    // empty result (e.g. disjoint intersection)
    if (!decoded) return { status: "native", feature: null };

    return {
        status: "native",
        feature: {
            type: "Feature",
            properties: {},
            geometry: decoded,
        },
    };
}

/**
 * Per-op guard: if a native overlay function is missing (stale binary),
 * return null so the GEOS backend falls back to JS. Does NOT throw —
 * the caller's catch block routes to the JS fallback.
 */
function nativeOpAvailable(fn: unknown): boolean {
    return typeof fn === "function";
}

// ─── One-time per-op fallback warning ──────────────────────────────────────

const _fallbackWarned = new Set<string>();

/**
 * Emit a one-time warning when a native overlay op is unavailable.
 * Deduped per op name — logs once per session, not per call.
 */
function warnOncePerOp(opName: string): void {
    if (_fallbackWarned.has(opName)) return;
    _fallbackWarned.add(opName);
    console.warn(
        `[geometryBackend] native ${opName} missing — using JS fallback. ` +
            "Rebuild the dev client (expo prebuild + run:ios/android) to enable GEOS overlay ops.",
    );
}

function isFeatureCollection(geom: {
    type: string;
}): geom is FeatureCollection {
    return geom.type === "FeatureCollection";
}

/**
 * Coordinate sanity stats for diagnosing native GEOS WKB parse failures.
 *
 * Native GEOS rejects geometries with non-finite coords
 * (`Invalid Coordinate at or near point nan nan`) and polygon rings whose
 * endpoints differ (`Points of LinearRing do not form a closed linestring`).
 * A `NaN` endpoint *also* reads as unclosed because `NaN !== NaN`, so these
 * two failures share a root cause. This walk lets us localize it.
 */
function coordSanity(geom: { type: string; coordinates: unknown }): {
    total: number;
    nonFinite: number;
    rings: number;
    unclosedRings: number;
    sampleBad: number[] | null;
} {
    let total = 0;
    let nonFinite = 0;
    let rings = 0;
    let unclosedRings = 0;
    let sampleBad: number[] | null = null;

    const visitPt = (p: number[]) => {
        total++;
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
            nonFinite++;
            if (!sampleBad) sampleBad = p;
        }
    };
    const visitRing = (ring: number[][]) => {
        rings++;
        for (const p of ring) visitPt(p);
        const a = ring[0];
        const z = ring[ring.length - 1];
        if (a && z && (a[0] !== z[0] || a[1] !== z[1])) unclosedRings++;
    };

    const c = geom.coordinates as number[][] & number[][][] & number[][][][];
    switch (geom.type) {
        case "LineString":
        case "MultiPoint":
            for (const p of c as number[][]) visitPt(p);
            break;
        case "MultiLineString":
            for (const l of c as number[][][]) for (const p of l) visitPt(p);
            break;
        case "Polygon":
            for (const r of c as number[][][]) visitRing(r);
            break;
        case "MultiPolygon":
            for (const poly of c as number[][][][])
                for (const r of poly) visitRing(r);
            break;
    }
    return { total, nonFinite, rings, unclosedRings, sampleBad };
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

    // 2b. Sanity-check what we're about to hand native GEOS. GEOS rejects
    // non-finite coords and unclosed rings at parse time (the body-of-water
    // "ring not closed" / "nan nan" failures). Comparing input vs projected
    // localizes whether the corruption is upstream (source/simplify) or
    // introduced by the AEQD projection. Only warns on actual malformation,
    // so it's quiet on the happy path.
    const projSanity = coordSanity(projected);
    if (projSanity.nonFinite > 0 || projSanity.unclosedRings > 0) {
        const inSanity = coordSanity(
            geom as { type: string; coordinates: unknown },
        );
        const origin =
            inSanity.nonFinite > 0
                ? "input already had non-finite coords (upstream source/simplify)"
                : projSanity.nonFinite > 0
                  ? "projection introduced non-finite coords (AEQD centroid degenerate?)"
                  : "ring closure lost (not NaN-related)";
        console.warn(
            `[geosSanity] ${geom.type} will be REJECTED by native GEOS: ` +
                `projected nonFinite=${projSanity.nonFinite}/${projSanity.total} ` +
                `unclosedRings=${projSanity.unclosedRings}/${projSanity.rings}; ` +
                `input nonFinite=${inSanity.nonFinite}/${inSanity.total} ` +
                `unclosedRings=${inSanity.unclosedRings}/${inSanity.rings}; ` +
                `sampleBadProjected=${JSON.stringify(projSanity.sampleBad)} ` +
                `r=${meters} → ${origin}.`,
        );
    }

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

    // ── Overlay ops (GEOS native, no projection) ──────────────────────────

    difference(a, b) {
        const t0 = performance.now();
        try {
            const { differenceWKB } = require("native-geometry") as {
                differenceWKB: (
                    a: Uint8Array,
                    b: Uint8Array,
                ) => Uint8Array | null;
            };
            if (!nativeOpAvailable(differenceWKB)) {
                warnOncePerOp("differenceWKB");
                return jsGeometryBackend.difference(a, b);
            }

            const outcome = binaryGeosOp(a, b, differenceWKB);
            // Native ran: trust the result, including an empty one (a wholly
            // inside b). Only the "fallback" status means native couldn't run.
            if (outcome.status === "native") {
                const ms = performance.now() - t0;
                console.log(
                    `[geos] difference ${a.geometry.type} vs ${b.geometry.type} → ${outcome.feature ? outcome.feature.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
                );
                return outcome.feature;
            }
            // Native unavailable — try JS fallback.
            const jsResult = jsGeometryBackend.difference(a, b);
            const ms = performance.now() - t0;
            console.log(
                `[geos] difference → native unavailable, JS fallback → ${jsResult ? jsResult.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
            );
            return jsResult;
        } catch (err) {
            const ms = performance.now() - t0;
            console.warn(
                `[geos] difference failed (${ms.toFixed(0)}ms), falling back to JS:`,
                err,
            );
            return jsGeometryBackend.difference(a, b);
        }
    },

    union(a, b) {
        const t0 = performance.now();
        try {
            const { unionWKB } = require("native-geometry") as {
                unionWKB: (a: Uint8Array, b: Uint8Array) => Uint8Array | null;
            };
            if (!nativeOpAvailable(unionWKB)) {
                warnOncePerOp("unionWKB");
                return jsGeometryBackend.union(a, b);
            }

            const outcome = binaryGeosOp(a, b, unionWKB);
            if (outcome.status === "native") {
                const ms = performance.now() - t0;
                console.log(
                    `[geos] union ${a.geometry.type} vs ${b.geometry.type} → ${outcome.feature ? outcome.feature.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
                );
                return outcome.feature;
            }
            const jsResult = jsGeometryBackend.union(a, b);
            const ms = performance.now() - t0;
            console.log(
                `[geos] union → native unavailable, JS fallback → ${jsResult ? jsResult.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
            );
            return jsResult;
        } catch (err) {
            const ms = performance.now() - t0;
            console.warn(
                `[geos] union failed (${ms.toFixed(0)}ms), falling back to JS:`,
                err,
            );
            return jsGeometryBackend.union(a, b);
        }
    },

    intersection(a, b) {
        const t0 = performance.now();
        try {
            const { intersectionWKB } = require("native-geometry") as {
                intersectionWKB: (
                    a: Uint8Array,
                    b: Uint8Array,
                ) => Uint8Array | null;
            };
            if (!nativeOpAvailable(intersectionWKB)) {
                warnOncePerOp("intersectionWKB");
                return jsGeometryBackend.intersection(a, b);
            }

            const outcome = binaryGeosOp(a, b, intersectionWKB);
            if (outcome.status === "native") {
                const ms = performance.now() - t0;
                console.log(
                    `[geos] intersection ${a.geometry.type} vs ${b.geometry.type} → ${outcome.feature ? outcome.feature.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
                );
                return outcome.feature;
            }
            const jsResult = jsGeometryBackend.intersection(a, b);
            const ms = performance.now() - t0;
            console.log(
                `[geos] intersection → native unavailable, JS fallback → ${jsResult ? jsResult.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
            );
            return jsResult;
        } catch (err) {
            const ms = performance.now() - t0;
            console.warn(
                `[geos] intersection failed (${ms.toFixed(0)}ms), falling back to JS:`,
                err,
            );
            return jsGeometryBackend.intersection(a, b);
        }
    },

    unaryUnion(a) {
        const t0 = performance.now();
        try {
            const { unaryUnionWKB } = require("native-geometry") as {
                unaryUnionWKB: (wkb: Uint8Array) => Uint8Array | null;
            };
            if (!nativeOpAvailable(unaryUnionWKB)) {
                warnOncePerOp("unaryUnionWKB");
                return jsGeometryBackend.unaryUnion(a);
            }

            const geom = a.geometry;
            if (!geom) return null;

            const tEncode0 = __DEV__ ? performance.now() : 0;
            const wkb = encodeWkb(geom); // raw WGS84 — no projection
            const tEncodeMs = __DEV__ ? performance.now() - tEncode0 : 0;

            const tNative0 = __DEV__ ? performance.now() : 0;
            let resultWkb: Uint8Array | null;
            try {
                resultWkb = unaryUnionWKB(wkb);
            } catch {
                resultWkb = null;
            }
            const tNativeMs = __DEV__ ? performance.now() - tNative0 : 0;
            if (!resultWkb) {
                // Native returned null — try JS fallback.
                const jsResult = jsGeometryBackend.unaryUnion(a);
                const ms = performance.now() - t0;
                console.log(
                    `[geos] unaryUnion → native null, JS fallback → ${jsResult ? jsResult.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
                );
                return jsResult;
            }

            const tDecode0 = __DEV__ ? performance.now() : 0;
            const decoded = decodeWkb(resultWkb);
            const tDecodeMs = __DEV__ ? performance.now() - tDecode0 : 0;

            if (__DEV__) {
                console.log(
                    `[geosPerf] encode=${tEncodeMs.toFixed(2)}ms ` +
                        `native=${tNativeMs.toFixed(2)}ms ` +
                        `decode=${tDecodeMs.toFixed(2)}ms ` +
                        `type=${geom.type}`,
                );
            }

            if (!decoded) return null;

            const result: Feature<Polygon | MultiPolygon> = {
                type: "Feature",
                properties: {},
                geometry: decoded,
            };
            const ms = performance.now() - t0;
            console.log(
                `[geos] unaryUnion ${geom.type} → ${result.geometry.type} in ${ms.toFixed(0)}ms`,
            );
            return result;
        } catch (err) {
            const ms = performance.now() - t0;
            console.warn(
                `[geos] unaryUnion failed (${ms.toFixed(0)}ms), falling back to JS:`,
                err,
            );
            return jsGeometryBackend.unaryUnion(a);
        }
    },
};

import buffer from "@turf/buffer";
import {
    difference as polyDifference,
    intersection as polyIntersection,
    union as polyUnion,
    type Geom,
} from "polyclip-ts";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
    Position,
} from "geojson";

import type { GeometryBackend } from "./geometryBackend";

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Wrap polyclip-ts result (a `MultiPoly` = `Position[][][]`) back into a
 * Polygon or MultiPolygon Feature. Returns `null` when the result is empty.
 */
function geomToFeature(
    result: Position[][][],
): Feature<Polygon | MultiPolygon> | null {
    if (result.length === 0) return null;
    if (result.length === 1) {
        return {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: result[0] },
        };
    }
    return {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: result },
    };
}

/** Extract coordinates from a Polygon/MultiPolygon Feature as a polyclip Geom. */
function featureToGeom(f: Feature<Polygon | MultiPolygon>): Geom {
    return f.geometry.coordinates as Geom;
}

/** Timing log prefix. */
const LOG_PREFIX = "[js]";

// ─── Backend ───────────────────────────────────────────────────────────────

/**
 * Pure-JS {@link GeometryBackend} that delegates to `@turf/buffer` (JSTS) and
 * polyclip-ts (Greiner-Hormann overlay).
 *
 * This is the default backend and the Jest-compatible reference oracle.
 * Behavior is identical to the pre-seam inline calls — same arguments,
 * same return shapes after post-processing.
 */
export const jsGeometryBackend: GeometryBackend = {
    name: "js",

    bufferMeters(geom, meters, quadrantSegments, units = "meters") {
        const t0 = performance.now();
        try {
            // @turf/buffer v7 has two overloads — Feature → Feature and
            // FeatureCollection → FeatureCollection. TypeScript can't
            // resolve a union argument against overloads, so narrow first.
            if (geom.type === "FeatureCollection") {
                // ⚠️ Does NOT union: turf buffers each feature independently
                // and we keep only features[0]. `bufferMeters(fc, 0)` is not a
                // cheap union — see the GeometryBackend.bufferMeters JSDoc.
                const fc = buffer(geom, meters, {
                    units,
                    steps: quadrantSegments,
                }) as FeatureCollection<Polygon | MultiPolygon> | undefined;

                const result = fc?.features?.[0]
                    ? (fc.features[0] as Feature<Polygon | MultiPolygon>)
                    : null;
                const ms = performance.now() - t0;
                console.log(
                    `[js] bufferMeters FC(${geom.features.length}) r=${meters} qs=${quadrantSegments} → ${result ? result.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
                );
                return result;
            }

            // Single Feature input — result is already a Feature.
            const result = buffer(geom, meters, {
                units,
                steps: quadrantSegments,
            }) as Feature<Polygon | MultiPolygon> | undefined;

            const ms = performance.now() - t0;
            console.log(
                `[js] bufferMeters ${geom.geometry?.type ?? "?"} r=${meters} qs=${quadrantSegments} → ${result ? result.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
            );
            return result ?? null;
        } catch (err) {
            console.warn("[js] bufferMeters failed:", err);
            return null;
        }
    },

    // ── Overlay ops (polyclip-ts Greiner-Hormann) ─────────────────────────

    difference(a, b) {
        const t0 = performance.now();
        try {
            const result = geomToFeature(
                polyDifference(featureToGeom(a), featureToGeom(b)),
            );
            const ms = performance.now() - t0;
            console.log(
                `${LOG_PREFIX} difference ${a.geometry.type} vs ${b.geometry.type} → ${result ? result.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
            );
            return result;
        } catch (err) {
            console.warn(`${LOG_PREFIX} difference failed:`, err);
            return null;
        }
    },

    union(a, b) {
        const t0 = performance.now();
        try {
            const result = geomToFeature(
                polyUnion(featureToGeom(a), featureToGeom(b)),
            );
            const ms = performance.now() - t0;
            console.log(
                `${LOG_PREFIX} union ${a.geometry.type} vs ${b.geometry.type} → ${result ? result.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
            );
            return result;
        } catch (err) {
            console.warn(`${LOG_PREFIX} union failed:`, err);
            return null;
        }
    },

    intersection(a, b) {
        const t0 = performance.now();
        try {
            const result = geomToFeature(
                polyIntersection(featureToGeom(a), featureToGeom(b)),
            );
            const ms = performance.now() - t0;
            console.log(
                `${LOG_PREFIX} intersection ${a.geometry.type} vs ${b.geometry.type} → ${result ? result.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
            );
            return result;
        } catch (err) {
            console.warn(`${LOG_PREFIX} intersection failed:`, err);
            return null;
        }
    },

    unaryUnion(a) {
        const t0 = performance.now();
        try {
            if (a.geometry.type === "Polygon") {
                // A single polygon has no self-overlap — return it as-is.
                const ms = performance.now() - t0;
                console.log(
                    `${LOG_PREFIX} unaryUnion Polygon (no-op) in ${ms.toFixed(0)}ms`,
                );
                return {
                    ...a,
                    properties: { ...a.properties },
                } as Feature<Polygon>;
            }

            // MultiPolygon: union all member polygons.
            const polys = a.geometry.coordinates as Position[][][];
            if (polys.length <= 1) {
                const ms = performance.now() - t0;
                console.log(
                    `${LOG_PREFIX} unaryUnion MultiPolygon(${polys.length}) (no-op) in ${ms.toFixed(0)}ms`,
                );
                return {
                    ...a,
                    properties: { ...a.properties },
                } as Feature<MultiPolygon>;
            }

            // polyclip-ts union takes Geom args; each member polygon is a Ring[].
            const geoms: Geom[] = polys.map((p) => p as Geom);
            const result = geomToFeature(
                polyUnion(geoms[0], ...geoms.slice(1)),
            );
            const ms = performance.now() - t0;
            console.log(
                `${LOG_PREFIX} unaryUnion MultiPolygon(${polys.length}) → ${result ? result.geometry.type : "null"} in ${ms.toFixed(0)}ms`,
            );
            return result;
        } catch (err) {
            console.warn(`${LOG_PREFIX} unaryUnion failed:`, err);
            return null;
        }
    },
};

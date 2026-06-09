import buffer from "@turf/buffer";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

import type { GeometryBackend } from "./geometryBackend";

/**
 * Pure-JS {@link GeometryBackend} that delegates to `@turf/buffer` (JSTS).
 *
 * This is the default backend and the Jest-compatible reference oracle.
 * Behavior is identical to the pre-seam inline `buffer()` calls — same
 * arguments, same turf options, same return shapes after post-processing.
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
};

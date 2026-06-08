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
        try {
            // @turf/buffer v7 has two overloads — Feature → Feature and
            // FeatureCollection → FeatureCollection. TypeScript can't
            // resolve a union argument against overloads, so narrow first.
            if (geom.type === "FeatureCollection") {
                const fc = buffer(geom, meters, {
                    units,
                    steps: quadrantSegments,
                }) as FeatureCollection<Polygon | MultiPolygon> | undefined;

                if (fc?.features?.[0]) {
                    return fc.features[0] as Feature<Polygon | MultiPolygon>;
                }
                return null;
            }

            // Single Feature input — result is already a Feature.
            const result = buffer(geom, meters, {
                units,
                steps: quadrantSegments,
            }) as Feature<Polygon | MultiPolygon> | undefined;

            return result ?? null;
        } catch (err) {
            console.warn("[jsGeometryBackend] bufferMeters failed:", err);
            return null;
        }
    },
};

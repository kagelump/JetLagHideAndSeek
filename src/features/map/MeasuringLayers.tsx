import { useMemo } from "react";
import type { LineString } from "geojson";

import type { MeasuringRenderState } from "@/features/questions/measuring/measuringTypes";
import { colors } from "@/theme/colors";

import {
    MLCircleLayer,
    MLLineLayer,
    MLShapeSource,
} from "./mapLibrePrimitives";

type MeasuringLayersProps = {
    measuring: MeasuringRenderState;
    visible: boolean;
};

const EMPTY_FEATURES = {
    features: [],
    type: "FeatureCollection",
} as const;

/**
 * Stable key derived from connector geometry so that the ShapeSource
 * remounts when a connector endpoint changes — prevents stale GeoJSON
 * from persisting across map-tap / my-location updates.
 */
function useConnectorsKey(
    features: MeasuringRenderState["nearestPointConnectors"]["features"],
): string {
    return useMemo(
        () =>
            features
                .map((f) => {
                    const coords = (f.geometry as LineString).coordinates;
                    return [
                        coords[0][0].toFixed(6),
                        coords[0][1].toFixed(6),
                        coords[1][0].toFixed(6),
                        coords[1][1].toFixed(6),
                    ].join(",");
                })
                .join("|"),
        [features],
    );
}

/**
 * Renders connector lines, nearest-point markers, and the clipped reference
 * line geometry for line-category Measuring questions (e.g. Shinkansen
 * tracks, prefecture borders).
 *
 * Always keeps the ShapeSources mounted — even with empty collections — so
 * MapLibre GL Native does not fail to re-register the source ids during
 * gestures.
 */
export function MeasuringLayers({ measuring, visible }: MeasuringLayersProps) {
    const lineFeatures = visible ? measuring.lineFeatures : EMPTY_FEATURES;
    const connectorsKey = useConnectorsKey(
        measuring.nearestPointConnectors.features,
    );
    const markersKey = useMemo(
        () =>
            measuring.nearestPointMarkers.features
                .map((f) => f.geometry.coordinates.join(","))
                .join("|"),
        [measuring.nearestPointMarkers.features],
    );

    return (
        <>
            {/* ── Reference line for line-category questions ── */}
            <MLShapeSource id="measuring-line-ref" shape={lineFeatures}>
                <MLLineLayer
                    id="measuring-line-ref-layer"
                    style={{
                        lineColor: colors.measuringLine,
                        lineOpacity: 0.6,
                        lineWidth: 3,
                    }}
                />
            </MLShapeSource>

            {/* ── Connector: seeker pin → nearest point ──────────────── */}
            <MLShapeSource
                id="measuring-connectors"
                key={`conn:${connectorsKey}`}
                shape={measuring.nearestPointConnectors}
            >
                <MLLineLayer
                    id="measuring-connectors-line"
                    style={{
                        lineColor: colors.measuringLine,
                        lineDasharray: [4, 3],
                        lineOpacity: 0.8,
                        lineWidth: 2,
                    }}
                />
            </MLShapeSource>

            {/* ── Nearest-point marker ────────────────────────────────── */}
            <MLShapeSource
                id="measuring-markers"
                key={`markers:${markersKey}`}
                shape={measuring.nearestPointMarkers}
            >
                <MLCircleLayer
                    id="measuring-markers-circle"
                    style={{
                        circleColor: colors.measuringLine,
                        circleOpacity: 0.9,
                        circleRadius: 5,
                        circleStrokeColor: colors.white,
                        circleStrokeWidth: 2,
                    }}
                />
            </MLShapeSource>
        </>
    );
}

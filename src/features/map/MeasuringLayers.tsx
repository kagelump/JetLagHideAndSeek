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

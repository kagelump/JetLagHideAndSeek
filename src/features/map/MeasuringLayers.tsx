import type { MeasuringRenderState } from "@/features/questions/measuring/measuringTypes";
import { colors } from "@/theme/colors";

import {
    MLCircleLayer,
    MLLineLayer,
    MLShapeSource,
} from "./mapLibrePrimitives";

type MeasuringLayersProps = {
    measuring: MeasuringRenderState;
};

/**
 * Renders connector lines and nearest-point markers for line-category
 * Measuring questions.
 *
 * Always keeps the ShapeSources mounted — even with empty collections — so
 * MapLibre GL Native does not fail to re-register the source ids during
 * gestures.
 */
export function MeasuringLayers({ measuring }: MeasuringLayersProps) {
    return (
        <>
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

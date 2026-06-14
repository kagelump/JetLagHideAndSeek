import type { Feature, LineString } from "geojson";

import type { ThermometerRenderState } from "@/features/questions/thermometer/thermometerTypes";
import { MLLineLayer, MLShapeSource } from "./mapLibrePrimitives";

type ThermometerPreviewLayerProps = {
    thermometer: ThermometerRenderState;
    visible: boolean;
};

const EMPTY_FEATURES = {
    features: [],
    type: "FeatureCollection",
} as const;

const BISECTOR_SOURCE_ID = "thermometer-bisector";

export function ThermometerPreviewLayer({
    thermometer,
    visible,
}: ThermometerPreviewLayerProps) {
    const previewFeatures = visible
        ? thermometer.previewFeatures
        : EMPTY_FEATURES;

    const bisectorShape: Feature<LineString> | null = visible
        ? thermometer.bisectorLine
        : null;

    return (
        <>
            <MLShapeSource id="thermometer-preview" shape={previewFeatures}>
                <MLLineLayer
                    filter={[
                        "all",
                        ["==", ["get", "role"], "travel-line"],
                        ["!", ["get", "degenerate"]],
                    ]}
                    id="thermometer-travel-line"
                    style={{
                        lineColor: "#888888",
                        lineWidth: 2,
                    }}
                />
                <MLLineLayer
                    filter={[
                        "all",
                        ["==", ["get", "role"], "travel-line"],
                        ["get", "degenerate"],
                    ]}
                    id="thermometer-travel-line-degenerate"
                    style={{
                        lineColor: "#aaaaaa",
                        lineDasharray: [4, 3],
                        lineWidth: 1.5,
                    }}
                />
                <MLLineLayer
                    filter={[
                        "match",
                        ["get", "role"],
                        "ring-1km",
                        true,
                        "ring-5km",
                        true,
                        "ring-15km",
                        true,
                        false,
                    ]}
                    id="thermometer-range-rings"
                    style={{
                        lineColor: "#888888",
                        lineDasharray: [4, 3],
                        lineWidth: 1,
                    }}
                />
            </MLShapeSource>
            {bisectorShape ? (
                <MLShapeSource id={BISECTOR_SOURCE_ID} shape={bisectorShape}>
                    <MLLineLayer
                        id="thermometer-bisector-line"
                        style={{
                            lineColor: "#5a9fd4",
                            lineDasharray: [6, 4],
                            lineWidth: 2,
                        }}
                    />
                </MLShapeSource>
            ) : null}
        </>
    );
}

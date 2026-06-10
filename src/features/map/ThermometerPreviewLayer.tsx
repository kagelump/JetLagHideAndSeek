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

export function ThermometerPreviewLayer({
    thermometer,
    visible,
}: ThermometerPreviewLayerProps) {
    const previewFeatures = visible
        ? thermometer.previewFeatures
        : EMPTY_FEATURES;

    return (
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
    );
}

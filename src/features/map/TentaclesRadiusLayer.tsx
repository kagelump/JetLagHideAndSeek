import type { TentaclesRenderState } from "@/features/questions/tentacles/tentaclesTypes";
import { MLLineLayer, MLShapeSource } from "./mapLibrePrimitives";

type TentaclesRadiusLayerProps = {
    tentacles: TentaclesRenderState;
    visible: boolean;
};

const EMPTY_FEATURES = {
    features: [],
    type: "FeatureCollection",
} as const;

export function TentaclesRadiusLayer({
    tentacles,
    visible,
}: TentaclesRadiusLayerProps) {
    const radiusFeature =
        visible && tentacles.radiusOutlineFeature
            ? {
                  type: "FeatureCollection" as const,
                  features: [tentacles.radiusOutlineFeature],
              }
            : EMPTY_FEATURES;

    return (
        <MLShapeSource id="tentacles-radius" shape={radiusFeature}>
            <MLLineLayer
                id="tentacles-radius-outline"
                style={{
                    lineColor: "#FF8C00",
                    lineDasharray: [4, 2],
                    lineWidth: 2,
                }}
            />
        </MLShapeSource>
    );
}

import type { OnPressEvent } from "@maplibre/maplibre-react-native";

import type { TentaclesRenderState } from "@/features/questions/tentacles/tentaclesTypes";
import { MLCircleLayer, MLShapeSource } from "./mapLibrePrimitives";

type TentaclesPoiLayerProps = {
    /** Raises a POI callout when a marker is tapped (see `useMapCallout`). */
    onPoiPress: (event: OnPressEvent) => void;
    tentacles: TentaclesRenderState;
    visible: boolean;
};

const EMPTY_FEATURES = {
    features: [],
    type: "FeatureCollection",
} as const;

export function TentaclesPoiLayer({
    onPoiPress,
    tentacles,
    visible,
}: TentaclesPoiLayerProps) {
    const poiFeatures = visible ? tentacles.poiFeatures : EMPTY_FEATURES;

    return (
        <MLShapeSource
            id="tentacles-pois"
            hitbox={{ width: 32, height: 32 }}
            onPress={onPoiPress}
            shape={poiFeatures}
        >
            {/* Unselected POIs — bright white fill, orange stroke */}
            <MLCircleLayer
                filter={["==", "isSelected", false]}
                id="tentacles-poi-unselected"
                style={{
                    circleColor: "#ffffff",
                    circleRadius: 7,
                    circleStrokeColor: "#FF8C00",
                    circleStrokeWidth: 2,
                }}
            />
            {/* Selected POI — bright white fill, prominent teal stroke */}
            <MLCircleLayer
                filter={["==", "isSelected", true]}
                id="tentacles-poi-selected"
                style={{
                    circleColor: "#ffffff",
                    circleRadius: 9,
                    circleStrokeColor: "#00BFA5",
                    circleStrokeWidth: 3,
                }}
            />
        </MLShapeSource>
    );
}

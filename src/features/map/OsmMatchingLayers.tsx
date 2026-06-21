import type { OnPressEvent } from "@maplibre/maplibre-react-native";

import type { OsmMatchingRenderState } from "@/features/questions/matching/matchingTypes";

import { MLCircleLayer, MLShapeSource } from "./mapLibrePrimitives";

const EMPTY_POI_FEATURES = {
    features: [],
    type: "FeatureCollection",
} as const;

type OsmMatchingLayersProps = {
    /** Raises a POI callout when a marker is tapped (see `useMapCallout`). */
    onPoiPress: (event: OnPressEvent) => void;
    osmMatching: OsmMatchingRenderState;
    visible: boolean;
};

export function OsmMatchingLayers({
    onPoiPress,
    osmMatching,
    visible,
}: OsmMatchingLayersProps) {
    // Always render the ShapeSource — even with an empty FeatureCollection — so
    // the source id stays registered in the MapLibre style. If we return null
    // and later re-add a source with the same id, MapLibre GL Native can fail
    // to re-register it (particularly during gestures), causing POI markers to
    // disappear and never come back.
    const poiFeatures = visible ? osmMatching.poiFeatures : EMPTY_POI_FEATURES;

    return (
        <MLShapeSource
            id="osm-matching-pois"
            hitbox={{ width: 32, height: 32 }}
            onPress={onPoiPress}
            shape={poiFeatures}
        >
            <MLCircleLayer
                filter={["==", "isSelected", true]}
                id="osm-matching-poi-selected"
                style={{
                    circleColor: "#ffffff",
                    circleRadius: 7,
                    circleStrokeColor: "#e53935",
                    circleStrokeWidth: 2,
                }}
            />
            <MLCircleLayer
                filter={["==", "isSelected", false]}
                id="osm-matching-poi-unselected"
                style={{
                    circleColor: "#ffffff",
                    circleRadius: 6,
                    circleStrokeColor: "#000000",
                    circleStrokeWidth: 1,
                }}
            />
        </MLShapeSource>
    );
}

import { useCallback, useEffect, useState } from "react";
import type { OnPressEvent } from "@maplibre/maplibre-react-native";

import type { TentaclesRenderState } from "@/features/questions/tentacles/tentaclesTypes";
import {
    MLCallout,
    MLCircleLayer,
    MLPointAnnotation,
    MLShapeSource,
} from "./mapLibrePrimitives";

type TentaclesPoiLayerProps = {
    /** Incremented on map background taps to dismiss the callout. */
    calloutDismissKey: number;
    tentacles: TentaclesRenderState;
    visible: boolean;
};

const EMPTY_FEATURES = {
    features: [],
    type: "FeatureCollection",
} as const;

type CalloutState = {
    coordinate: [number, number];
    name: string;
    osmId: number;
} | null;

export function TentaclesPoiLayer({
    calloutDismissKey,
    tentacles,
    visible,
}: TentaclesPoiLayerProps) {
    const [callout, setCallout] = useState<CalloutState>(null);

    // Dismiss the callout when the user taps the map background.
    useEffect(() => {
        setCallout(null);
    }, [calloutDismissKey]);

    const poiFeatures = visible ? tentacles.poiFeatures : EMPTY_FEATURES;

    const handlePoiPress = useCallback((event: OnPressEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const props = feature.properties as
            | { name: string; osmId: number }
            | undefined;
        if (!props?.name) return;
        const geom = feature.geometry as unknown as {
            coordinates: [number, number];
        };
        const coords = geom.coordinates;
        if (!coords) return;
        setCallout({
            coordinate: [coords[0], coords[1]],
            name: props.name,
            osmId: props.osmId,
        });
    }, []);

    return (
        <>
            <MLShapeSource
                id="tentacles-pois"
                hitbox={{ width: 32, height: 32 }}
                onPress={handlePoiPress}
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

            {/* Callout annotation — always mounted to avoid the nil-subview
                 crash; hidden off-screen with empty title when no callout. */}
            <MLPointAnnotation
                coordinate={callout ? callout.coordinate : [0, 0]}
                id="tentacles-poi-callout"
                selected={callout !== null}
                title={callout ? callout.name : ""}
            >
                <MLCallout title={callout ? callout.name : ""} />
            </MLPointAnnotation>
        </>
    );
}

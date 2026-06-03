import type { GeoJsonFeatureCollection } from "./geojsonTypes";
import { MLFillLayer, MLShapeSource } from "./mapLibrePrimitives";

type PlayAreaOutsideMaskLayerProps = {
    osmId: number;
    playAreaMask: GeoJsonFeatureCollection;
};

export function PlayAreaOutsideMaskLayer({
    osmId,
    playAreaMask,
}: PlayAreaOutsideMaskLayerProps) {
    return (
        <MLShapeSource
            id={`play-area-outside-mask-${osmId}`}
            shape={playAreaMask}
        >
            <MLFillLayer
                id={`play-area-outside-mask-fill-${osmId}`}
                style={{
                    fillColor: "#07111f",
                    fillOpacity: 0.58,
                }}
            />
        </MLShapeSource>
    );
}

type CombinedInsideMaskLayerProps = {
    combinedInsideMask: GeoJsonFeatureCollection;
    osmId: number;
};

export function CombinedInsideMaskLayer({
    combinedInsideMask,
    osmId,
}: CombinedInsideMaskLayerProps) {
    // Always render the ShapeSource — even with an empty FeatureCollection — so
    // the source id stays registered in the MapLibre style (same reasoning as
    // OsmMatchingLayers). Returning null and later re-adding with the same id
    // can fail non-deterministically in MapLibre GL Native.

    return (
        <MLShapeSource
            id={`combined-inside-mask-${osmId}`}
            shape={combinedInsideMask}
        >
            <MLFillLayer
                id={`combined-inside-mask-fill-${osmId}`}
                style={{
                    fillColor: "#07111f",
                    fillOpacity: 0.35,
                }}
            />
        </MLShapeSource>
    );
}

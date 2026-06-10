import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

import { MLLineLayer, MLShapeSource } from "./mapLibrePrimitives";

const EMPTY_FEATURES: FeatureCollection = {
    features: [],
    type: "FeatureCollection",
} as const;

type VoronoiOutlineLayersProps = {
    voronoiOutlineFeatures: FeatureCollection<Polygon | MultiPolygon>;
    visible: boolean;
};

/**
 * Renders faint Voronoi cell boundaries clipped to the play area.
 *
 * There is exactly one instance of this component in the map layer stack; it
 * renders the aggregate outline features merged from all candidate-based
 * question types (currently matching; tentacles in the future).
 *
 * Always keeps the ShapeSource mounted — even with an empty collection — so
 * MapLibre GL Native does not fail to re-register the source id during
 * gestures (same pattern as OsmMatchingLayers).
 */
export function VoronoiOutlineLayers({
    voronoiOutlineFeatures,
    visible,
}: VoronoiOutlineLayersProps) {
    const shape = visible ? voronoiOutlineFeatures : EMPTY_FEATURES;

    return (
        <MLShapeSource id="voronoi-outlines" shape={shape}>
            <MLLineLayer
                id="voronoi-outlines-line"
                style={{
                    lineColor: "#555555",
                    lineOpacity: 0.5,
                    lineWidth: 1.5,
                }}
            />
        </MLShapeSource>
    );
}

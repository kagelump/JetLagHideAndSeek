import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

import { MLLineLayer, MLShapeSource } from "./mapLibrePrimitives";

type ThermometerPreviewLayerProps = {
    /** Travel line + range rings for the question currently being edited. */
    previewFeatures: FeatureCollection<LineString | Polygon>;
    /** Perpendicular bisector for the active question (null when unavailable). */
    bisectorLine: Feature<LineString> | null;
    visible: boolean;
};

const EMPTY_FEATURES = {
    features: [],
    type: "FeatureCollection",
} as const;

const EMPTY_LINE_FEATURES: FeatureCollection<LineString> = {
    features: [],
    type: "FeatureCollection",
};

const BISECTOR_SOURCE_ID = "thermometer-bisector";

export function ThermometerPreviewLayer({
    previewFeatures: activePreviewFeatures,
    bisectorLine,
    visible,
}: ThermometerPreviewLayerProps) {
    const previewFeatures = visible ? activePreviewFeatures : EMPTY_FEATURES;

    // Always keep the bisector ShapeSource mounted — even with an empty
    // collection — so the source id stays registered in the MapLibre style.
    // Conditionally mounting/unmounting native children crashes MapLibre RN
    // (NSInvalidArgumentException: object cannot be nil in insertReactSubview).
    const bisectorShape: FeatureCollection<LineString> =
        visible && bisectorLine
            ? {
                  type: "FeatureCollection",
                  features: [bisectorLine],
              }
            : EMPTY_LINE_FEATURES;

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
        </>
    );
}

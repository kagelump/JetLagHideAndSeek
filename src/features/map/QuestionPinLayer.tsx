import { useMemo } from "react";
import type { FeatureCollection, Point } from "geojson";

import questionPinImage from "../../../assets/map/question-pin.png";
import questionPinStartImage from "../../../assets/map/question-pin-start.png";

import type { MapPin } from "./getQuestionPins";
import type { PinDragState } from "./usePinDrag";
import {
    MLCircleLayer,
    MLImages,
    MLShapeSource,
    MLSymbolLayer,
} from "./mapLibrePrimitives";

/** Pin color for each variant, used by the glow circle. */
const PIN_COLORS: Record<string, string> = {
    center: "#e46f4d",
    start: "#4a90d9",
    end: "#e46f4d",
};

const DEFAULT_PIN_COLOR = "#e46f4d";

type QuestionPinLayerProps = {
    canMove: boolean;
    pins: MapPin[];
    pinDrag: PinDragState;
    onPress?: (event?: unknown) => void;
};

export function QuestionPinLayer({
    canMove,
    pins,
    onPress,
    pinDrag,
}: QuestionPinLayerProps) {
    const questionPinImages = useMemo(
        () => ({
            "question-pin": questionPinImage,
            "question-pin-start": questionPinStartImage,
        }),
        [],
    );
    const { isDragging, draggedPinKey, draftCoordinate } = pinDrag;

    const feature = useMemo<FeatureCollection<Point>>(
        () => ({
            type: "FeatureCollection",
            features: pins.map((pin) => {
                const isPinDragging = isDragging && draggedPinKey === pin.key;
                return {
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: isPinDragging
                            ? (draftCoordinate ?? pin.position)
                            : pin.position,
                    },
                    properties: {
                        pinKey: pin.key,
                        isDragging: isPinDragging,
                        pinColor: PIN_COLORS[pin.key] ?? DEFAULT_PIN_COLOR,
                    },
                };
            }),
        }),
        [pins, isDragging, draggedPinKey, draftCoordinate],
    );

    return (
        <>
            <MLImages images={questionPinImages} />
            <MLShapeSource id="question-pins" onPress={onPress} shape={feature}>
                <MLCircleLayer
                    id="question-pin-glow-base"
                    style={{
                        circleBlur: 0.75,
                        circleColor: [
                            "to-color",
                            ["get", "pinColor"],
                            DEFAULT_PIN_COLOR,
                        ],
                        circleOpacity: canMove ? 0.3 : 0.15,
                        circleRadius: 24,
                        circleTranslate: [0, -31],
                    }}
                />
                <MLCircleLayer
                    id="question-pin-glow-drag"
                    filter={["==", "isDragging", true]}
                    style={{
                        circleBlur: 0.75,
                        circleColor: "#ffffff",
                        circleOpacity: canMove ? 0.42 : 0.15,
                        circleRadius: 60,
                        circleTranslate: [0, -31],
                    }}
                />
                <MLSymbolLayer
                    id="question-pin-icon"
                    style={{
                        iconAllowOverlap: true,
                        iconAnchor: "bottom",
                        iconIgnorePlacement: true,
                        iconImage: [
                            "match",
                            ["get", "pinKey"],
                            "start",
                            "question-pin-start",
                            "question-pin",
                        ],
                        iconSize: 0.42,
                    }}
                />
            </MLShapeSource>
        </>
    );
}

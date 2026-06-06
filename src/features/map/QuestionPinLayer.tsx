import { useMemo } from "react";
import type { FeatureCollection, Point } from "geojson";

import questionPinImage from "../../../assets/map/question-pin.png";

import type { MapPin } from "./getQuestionPins";
import type { PinDragState } from "./usePinDrag";
import {
    MLCircleLayer,
    MLImages,
    MLShapeSource,
    MLSymbolLayer,
} from "./mapLibrePrimitives";

type QuestionPinLayerProps = {
    activePinKey?: string | null;
    canMove: boolean;
    pins: MapPin[];
    pinDrag: PinDragState;
    onPress?: (event?: unknown) => void;
};

export function QuestionPinLayer({
    activePinKey,
    canMove,
    pins,
    onPress,
    pinDrag,
}: QuestionPinLayerProps) {
    const questionPinImages = useMemo(
        () => ({ "question-pin": questionPinImage }),
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
                        isActive: activePinKey
                            ? pin.key === activePinKey
                            : true,
                    },
                };
            }),
        }),
        [pins, isDragging, draggedPinKey, draftCoordinate, activePinKey],
    );

    return (
        <>
            <MLImages images={questionPinImages} />
            <MLShapeSource id="question-pins" onPress={onPress} shape={feature}>
                <MLCircleLayer
                    id="question-pin-glow-base"
                    style={{
                        circleBlur: 0.75,
                        circleColor: "#e46f4d",
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
                <MLCircleLayer
                    filter={["==", "isActive", false]}
                    id="question-pin-dimmed"
                    style={{
                        circleColor: "#888888",
                        circleOpacity: 0.5,
                        circleRadius: 8,
                        circleTranslate: [0, -31],
                    }}
                />
                <MLSymbolLayer
                    id="question-pin-icon"
                    style={{
                        iconAllowOverlap: true,
                        iconAnchor: "bottom",
                        iconIgnorePlacement: true,
                        iconImage: "question-pin",
                        iconSize: 0.42,
                    }}
                />
            </MLShapeSource>
        </>
    );
}

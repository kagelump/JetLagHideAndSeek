import type { QuestionState } from "@/features/questions/questionTypes";
import type { Position } from "@/shared/geojson";

export type MapPin = {
    key: string;
    position: Position;
};

export function getQuestionPins(question: QuestionState | null): MapPin[] {
    if (!question) return [];

    switch (question.type) {
        case "radar":
        case "matching":
        case "measuring":
        case "tentacles":
            return [{ key: "center", position: question.center }];
        case "thermometer": {
            const pins: MapPin[] = [];
            if (question.previousPosition) {
                pins.push({
                    key: "start",
                    position: question.previousPosition,
                });
            }
            if (question.currentPosition) {
                pins.push({ key: "end", position: question.currentPosition });
            }
            return pins;
        }
        default:
            return [];
    }
}

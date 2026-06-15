import { indexedTitle } from "@/features/questions/indexedTitle";
import type { QuestionDefinition } from "@/features/questions/questionRegistry";
import type {
    ThermometerQuestion,
    ThermometerStationAnchor,
} from "@/features/questions/thermometer/thermometerTypes";
import { fromMeters } from "@/shared/distanceUnits";
import { formatCoordinate, haversineDistanceMeters } from "@/shared/geojson";
import type { Position } from "@/shared/geojson";

function describeAnchor(
    anchor: ThermometerStationAnchor | null,
    pos: Position,
): string {
    const coord = formatCoordinate(pos);
    return anchor?.name ? `${anchor.name} ${coord}` : coord;
}

export const thermometerQuestionConfig = {
    answerLabels: {
        negative: "Colder",
        positive: "Hotter",
    },
    answerMapBehavior: {
        negative: "none",
        positive: "none",
    },
    answerModel: "binary",
    cost: "Draw 2, pick 1",
    defaultAnswer: "unanswered",
    detail: "Compare whether movement is hotter or colder.",
    implemented: true,
    listTitle: "Thermometer",
    mapBehavior: {},
    sharePrompt: (question) => {
        const { previousPosition: from, currentPosition: to } = question;
        if (!from || !to) {
            return "Am I getting closer to you?"; // pins not both set
        }
        const meters = haversineDistanceMeters(from[1], from[0], to[1], to[0]);
        const distance = `${fromMeters(meters, "km")} km`;
        const start = describeAnchor(question.previousStation, from);
        const end = describeAnchor(question.currentStation, to);
        return `I went ${distance} from ${start} to ${end} — am I hotter or colder?`;
    },
    summary: (question) =>
        question.answer !== "unanswered"
            ? question.answer === "positive"
                ? "Hotter"
                : "Colder"
            : "",
    time: "5 minutes",
    title: indexedTitle("Thermometer"),
    type: "thermometer",
} satisfies QuestionDefinition<ThermometerQuestion>;

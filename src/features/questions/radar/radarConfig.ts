import type { QuestionDefinition } from "@/features/questions/questionRegistry";
import type { RadarQuestion } from "@/features/questions/radar/radarTypes";
import { formatCoordinate } from "@/shared/geojson";
import { fromMeters } from "@/shared/distanceUnits";

const answerLabels = {
    negative: "Miss",
    positive: "Hit",
} as const;

function formatRadarDistance(question: RadarQuestion): string {
    if (question.distanceOption !== "other") {
        return question.distanceOption;
    }
    const value = fromMeters(question.distanceMeters, question.distanceUnit);
    return `${value}${question.distanceUnit}`;
}

export const radarQuestionConfig = {
    answerLabels,
    answerMapBehavior: {
        negative: "darken-inside",
        positive: "darken-outside",
    },
    answerModel: "binary",
    cost: "Draw 2, pick 1",
    defaultAnswer: "unanswered",
    detail: "Ask whether the hider is within a distance of you.",
    implemented: true,
    listTitle: "Radar",
    mapBehavior: {},
    sharePrompt: (question) =>
        `Are you within ${formatRadarDistance(question)} of ${formatCoordinate(question.center)}?`,
    summary: (question) =>
        question.answer !== "unanswered" ? answerLabels[question.answer] : "",
    time: "5 minutes",
    title: (question) =>
        question.distanceOption !== "other"
            ? `${question.distanceOption} Radar`
            : `${Math.round(question.distanceMeters)}m Radar`,
    type: "radar",
} satisfies QuestionDefinition<RadarQuestion>;

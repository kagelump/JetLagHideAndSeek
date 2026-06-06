import type { QuestionDefinition } from "@/features/questions/questionRegistry";

const answerLabels = {
    negative: "Miss",
    positive: "Hit",
} as const;

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
    mapBehavior: { usesMovableAnchor: true },
    summary: (question) =>
        question.type === "radar"
            ? question.answer !== "unanswered"
                ? answerLabels[question.answer]
                : ""
            : "",
    time: "5 minutes",
    title: (question) =>
        question.type === "radar"
            ? question.distanceOption !== "other"
                ? `${question.distanceOption} Radar`
                : `${Math.round(question.distanceMeters)}m Radar`
            : "Radar Question",
    type: "radar",
} satisfies QuestionDefinition;

import { getCategoryTitle } from "@/features/questions/matching/matchingCategories";
import type { QuestionDefinition } from "@/features/questions/questionRegistry";
import type { QuestionState } from "@/features/questions/questionTypes";

export const tentaclesQuestionConfig = {
    answerMapBehavior: {
        negative: "none",
        positive: "none",
    },
    answerModel: "poi",
    cost: "Draw 4, pick 2",
    defaultAnswer: "unanswered",
    detail: "Find the closest qualifying place within range.",
    implemented: true,
    listTitle: "Tentacles",
    mapBehavior: {},
    summary: (question: QuestionState) =>
        question.type === "tentacles"
            ? `Tentacles: ${getCategoryTitle(question.category)} (${question.distanceOption}) — ${question.selectedName ?? "Unanswered"}`
            : "",
    time: "5 minutes",
    title: "Tentacles",
    type: "tentacles",
} satisfies QuestionDefinition;

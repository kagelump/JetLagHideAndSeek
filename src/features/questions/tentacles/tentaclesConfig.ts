import { getCategoryTitle } from "@/features/questions/matching/matchingCategories";
import { indexedTitle } from "@/features/questions/indexedTitle";
import type { QuestionDefinition } from "@/features/questions/questionRegistry";
import type { TentaclesQuestion } from "@/features/questions/tentacles/tentaclesTypes";
import { formatCoordinate } from "@/shared/geojson";

export const tentaclesQuestionConfig = {
    answerMapBehavior: {
        negative: "darken-inside",
        positive: "none",
    },
    answerModel: "poi",
    cost: "Draw 4, pick 2",
    defaultAnswer: "unanswered",
    detail: "Find the closest qualifying place within range.",
    implemented: true,
    listTitle: "Tentacles",
    mapBehavior: {},
    sharePrompt: (question) =>
        `What is the closest ${getCategoryTitle(question.category).toLowerCase()} within ${question.distanceOption} of ${formatCoordinate(question.center)}?`,
    summary: (question) =>
        `Tentacles: ${getCategoryTitle(question.category)} (${question.distanceOption}) — ${question.selectedName ?? "Unanswered"}`,
    time: "5 minutes",
    title: indexedTitle("Tentacles"),
    type: "tentacles",
} satisfies QuestionDefinition<TentaclesQuestion>;

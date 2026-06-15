import { indexedTitle } from "@/features/questions/indexedTitle";
import type { QuestionDefinition } from "@/features/questions/questionRegistry";
import type { MatchingQuestion } from "@/features/questions/matching/matchingTypes";
import { getCategoryTitle } from "./matchingCategories";

export const matchingQuestionConfig = {
    answerLabels: {
        negative: "Miss",
        positive: "Hit",
    },
    answerMapBehavior: {
        negative: "none",
        positive: "none",
    },
    answerModel: "binary",
    cost: "Draw 2, pick 1",
    defaultAnswer: "unanswered",
    detail: "Compare nearest candidates from a movable map pin.",
    implemented: true,
    listTitle: "Matching",
    mapBehavior: {},
    sharePrompt: (question) => {
        if (question.category === "transit-line") {
            return question.lineName
                ? `Are you on the ${question.lineName}?`
                : "Which transit line are you on?";
        }
        const categoryTitle = getCategoryTitle(question.category);
        return question.targetName
            ? `Do we match on ${categoryTitle} (${question.targetName})?`
            : `Do we match on ${categoryTitle}?`;
    },
    summary: (question) => {
        const categoryTitle = getCategoryTitle(question.category);
        if (question.category === "transit-line") {
            return question.lineName
                ? `Same transit line: ${question.lineName}`
                : "Same transit line: not selected";
        }
        if (question.category === "station-name-length") {
            if (!question.targetName) {
                return `${categoryTitle}: not selected`;
            }
            // Show the station name and its English-name character count.
            const nameLen = question.candidates.find(
                (c) => c.osmId === question.selectedOsmId,
            )?.nameLength;
            const suffix = nameLen !== undefined ? ` (${nameLen} chars)` : "";
            return `${categoryTitle}: ${question.targetName}${suffix}`;
        }
        return question.targetName
            ? `${categoryTitle}: ${question.targetName}`
            : `${categoryTitle}: not selected`;
    },
    time: "5 minutes",
    title: indexedTitle("Matching"),
    type: "matching",
} satisfies QuestionDefinition<MatchingQuestion>;

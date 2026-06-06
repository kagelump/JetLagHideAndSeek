import type { QuestionDefinition } from "@/features/questions/questionRegistry";
import type { QuestionState } from "@/features/questions/questionTypes";

export const measuringQuestionConfig = {
    answerLabels: {
        negative: "Farther",
        positive: "Closer",
    },
    answerMapBehavior: {
        negative: "none",
        positive: "none",
    },
    answerModel: "binary",
    cost: "Draw 3, pick 1",
    defaultAnswer: "unanswered",
    detail: "Compare distance to a selected place or boundary.",
    implemented: true,
    listTitle: "Measuring",
    mapBehavior: { usesMovableAnchor: false },
    summary: (question: QuestionState) =>
        question.type === "measuring" ? `Measuring: ${question.category}` : "",
    time: "5 minutes",
    title: "Measuring",
    type: "measuring",
} satisfies QuestionDefinition;

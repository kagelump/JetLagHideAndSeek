import type { QuestionDefinition } from "@/features/questions/questionRegistry";
import type { QuestionState } from "@/features/questions/questionTypes";

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
    mapBehavior: { usesMovableAnchor: false },
    summary: (question: QuestionState) =>
        question.type === "thermometer"
            ? question.answer !== "unanswered"
                ? question.answer === "positive"
                    ? "Hotter"
                    : "Colder"
                : ""
            : "",
    time: "5 minutes",
    title: "Thermometer",
    type: "thermometer",
} satisfies QuestionDefinition;

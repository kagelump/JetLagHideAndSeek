import { indexedTitle } from "@/features/questions/indexedTitle";
import type { QuestionDefinition } from "@/features/questions/questionRegistry";
import type { MeasuringQuestion } from "@/features/questions/measuring/measuringTypes";
import { getMeasuringCategoryTitle } from "@/features/questions/measuring/measuringCategories";
import { fromMeters } from "@/shared/distanceUnits";

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
    mapBehavior: {},
    sharePrompt: (question) => {
        const categoryTitle = getMeasuringCategoryTitle(
            question.category,
        ).toLowerCase();
        if (question.seekerDistanceMeters != null) {
            const dist = fromMeters(
                question.seekerDistanceMeters,
                question.seekerDistanceUnit,
            );
            const unit = question.seekerDistanceUnit;
            const poi = question.nearestPoiName ?? "unknown";
            return `I am ${dist} ${unit} away from the nearest ${categoryTitle} (${poi}). Are you closer or farther from a ${categoryTitle} than me?`;
        }
        return `Are you closer to a ${categoryTitle} than me?`;
    },
    summary: (question) =>
        `Measuring: ${getMeasuringCategoryTitle(question.category)}`,
    time: "5 minutes",
    title: indexedTitle("Measuring"),
    type: "measuring",
} satisfies QuestionDefinition<MeasuringQuestion>;

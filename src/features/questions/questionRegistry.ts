import { matchingQuestionConfig } from "@/features/questions/matching/matchingConfig";
import { measuringQuestionConfig } from "@/features/questions/measuring/measuringConfig";
import type {
    ImplementedQuestionType,
    QuestionAnswer,
    QuestionAnswerLabels,
    QuestionState,
    QuestionType,
} from "@/features/questions/questionTypes";
import { radarQuestionConfig } from "@/features/questions/radar/radarConfig";
import { tentaclesQuestionConfig } from "@/features/questions/tentacles/tentaclesConfig";
import { thermometerQuestionConfig } from "@/features/questions/thermometer/thermometerConfig";

export type QuestionAnswerModel = "binary" | "poi";

export type QuestionDefinition = {
    answerLabels?: QuestionAnswerLabels;
    answerMapBehavior: Record<
        Exclude<QuestionAnswer, "unanswered">,
        "darken-inside" | "darken-outside" | "none"
    >;
    answerModel: QuestionAnswerModel;
    cost: string;
    defaultAnswer: QuestionAnswer;
    detail: string;
    implemented: boolean;
    listTitle: string;
    mapBehavior: {
        usesMovableAnchor: boolean;
    };
    summary: (question: QuestionState, index: number) => string;
    time: string;
    title: string | ((question: QuestionState) => string);
    type: QuestionType;
};

export const questionDefinitions = {
    matching: matchingQuestionConfig,
    measuring: measuringQuestionConfig,
    radar: radarQuestionConfig,
    tentacles: tentaclesQuestionConfig,
    thermometer: thermometerQuestionConfig,
} satisfies Record<QuestionType, QuestionDefinition>;

export const implementedQuestionTypes: ImplementedQuestionType[] =
    Object.values(questionDefinitions)
        .filter((definition) => definition.implemented)
        .map((definition) => definition.type as ImplementedQuestionType);

export function getQuestionDefinition(type: QuestionType): QuestionDefinition {
    return questionDefinitions[type];
}

export function isPoiAnswerModel(type: QuestionType): boolean {
    return questionDefinitions[type]?.answerModel === "poi";
}

/**
 * Derive the canonical answer status for a POI-model question from its
 * selectedOsmId.  This is the single source of truth for the
 * selectedOsmId → answer mapping; use it everywhere to avoid drift.
 */
export function derivePoiAnswer(
    selectedOsmId: number | null,
): "unanswered" | "positive" {
    return selectedOsmId !== null ? "positive" : "unanswered";
}

export function getQuestionAnswerStatus(
    question: QuestionState,
): "answered" | "unanswered" {
    if (isPoiAnswerModel(question.type)) {
        return "selectedOsmId" in question && question.selectedOsmId !== null
            ? "answered"
            : "unanswered";
    }
    return question.answer === "unanswered" ? "unanswered" : "answered";
}

export function getQuestionAnswerLabel(
    type: QuestionType,
    answer: QuestionAnswer,
): string {
    if (answer === "unanswered") return "N/A";
    if (isPoiAnswerModel(type)) return "N/A";
    const def = questionDefinitions[type] as QuestionDefinition & {
        answerLabels: QuestionAnswerLabels;
    };
    return def.answerLabels[answer];
}

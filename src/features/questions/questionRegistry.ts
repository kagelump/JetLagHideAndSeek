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

/**
 * Per-type question configuration. Members that operate on the question are
 * written in **method-shorthand syntax** (e.g. `sharePrompt(q: T): string`, not
 * an arrow property) on purpose: method params are checked **bivariantly**, which
 * lets each narrowly-typed config (e.g. `QuestionDefinition<RadarQuestion>`)
 * satisfy the homogeneous `questionDefinitions` record. Converting them to arrow
 * properties will break `pnpm typecheck`.
 */
export type QuestionDefinition<T extends QuestionState = QuestionState> = {
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
    mapBehavior: Record<string, never>;
    /** Human-readable question text sent to the hider via share. */
    sharePrompt(question: T): string;
    /** Subtitle shown under the question title in the question list. */
    summary(question: T, index: number): string;
    time: string;
    /**
     * Display title for the question. The optional index is the question's
     * 0-based position in the list; detail views omit it.
     */
    title(question: T, index?: number): string;
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
        // POI-model questions are answered when a POI is selected OR when the
        // answer is explicitly negative (e.g. tentacles "None").
        if (
            ("selectedOsmId" in question && question.selectedOsmId !== null) ||
            question.answer === "negative"
        ) {
            return "answered";
        }
        return "unanswered";
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

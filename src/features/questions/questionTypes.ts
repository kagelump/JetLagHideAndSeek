import type { MatchingQuestion } from "@/features/questions/matching/matchingTypes";
import type { MeasuringQuestion } from "@/features/questions/measuring/measuringTypes";
import type { RadarQuestion } from "@/features/questions/radar/radarTypes";
import type { TentaclesQuestion } from "@/features/questions/tentacles/tentaclesTypes";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";

export type {
    BaseQuestion,
    ImplementedQuestionType,
    QuestionAnswer,
    QuestionAnswerLabels,
    QuestionType,
} from "@/features/questions/coreTypes";

export type QuestionState =
    | RadarQuestion
    | MatchingQuestion
    | MeasuringQuestion
    | ThermometerQuestion
    | TentaclesQuestion;
export type QuestionsImportState = QuestionState[];

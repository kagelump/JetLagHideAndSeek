import { measuringQuestionConfig } from "../measuringConfig";
import type { QuestionState } from "@/features/questions/questionTypes";

function makeMeasuringStub(): QuestionState {
    return {
        answer: "unanswered",
        category: "rail-station",
        center: [139.7, 35.66],
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "q-test",
        isLocked: false,
        seekerDistanceUnit: "m",
        type: "measuring",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

describe("measuringQuestionConfig", () => {
    it("is a valid QuestionDefinition with the measuring type", () => {
        expect(measuringQuestionConfig.type).toBe("measuring");
        expect(measuringQuestionConfig.implemented).toBe(true);
        expect(measuringQuestionConfig.title).toBe("Measuring");
        expect(measuringQuestionConfig.time).toBe("5 minutes");
        expect(measuringQuestionConfig.cost).toBe("Draw 3, pick 1");
    });

    it("has expected answer labels", () => {
        expect(measuringQuestionConfig.answerLabels.positive).toBe("Closer");
        expect(measuringQuestionConfig.answerLabels.negative).toBe("Farther");
    });

    it("has a summary function keyed off category", () => {
        expect(measuringQuestionConfig.summary(makeMeasuringStub())).toBe(
            "Measuring: rail-station",
        );
    });
});

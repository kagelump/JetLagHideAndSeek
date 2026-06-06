import { thermometerQuestionConfig } from "../thermometerConfig";
import type { QuestionState } from "@/features/questions/questionTypes";

function makeThermometerStub(
    answer: "unanswered" | "positive" | "negative" = "unanswered",
): QuestionState {
    return {
        answer,
        previousPosition: [139.7, 35.66],
        currentPosition: [139.71, 35.67],
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "q-test",
        isLocked: false,
        type: "thermometer",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

describe("thermometerQuestionConfig", () => {
    it("is a valid QuestionDefinition with the thermometer type", () => {
        expect(thermometerQuestionConfig.type).toBe("thermometer");
        expect(thermometerQuestionConfig.implemented).toBe(true);
        expect(thermometerQuestionConfig.title).toBe("Thermometer");
        expect(thermometerQuestionConfig.time).toBe("5 minutes");
        expect(thermometerQuestionConfig.cost).toBe("Draw 2, pick 1");
    });

    it("has expected answer labels", () => {
        expect(thermometerQuestionConfig.answerLabels.positive).toBe("Hotter");
        expect(thermometerQuestionConfig.answerLabels.negative).toBe("Colder");
    });

    it("has a summary function", () => {
        expect(thermometerQuestionConfig.summary(makeThermometerStub())).toBe(
            "",
        );
        expect(
            thermometerQuestionConfig.summary(makeThermometerStub("positive")),
        ).toBe("Hotter");
        expect(
            thermometerQuestionConfig.summary(makeThermometerStub("negative")),
        ).toBe("Colder");
    });
});

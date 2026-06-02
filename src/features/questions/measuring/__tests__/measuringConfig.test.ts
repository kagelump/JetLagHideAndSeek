import { measuringQuestionConfig } from "../measuringConfig";

describe("measuringQuestionConfig", () => {
    it("is a valid QuestionDefinition with the measuring type", () => {
        expect(measuringQuestionConfig.type).toBe("measuring");
        expect(measuringQuestionConfig.implemented).toBe(false);
        expect(measuringQuestionConfig.title).toBe("Measuring");
        expect(measuringQuestionConfig.time).toBe("5 minutes");
        expect(measuringQuestionConfig.cost).toBe("Draw 3, pick 1");
    });

    it("has expected answer labels", () => {
        expect(measuringQuestionConfig.answerLabels.positive).toBe("Hit");
        expect(measuringQuestionConfig.answerLabels.negative).toBe("Miss");
    });

    it("has a summary function returning the placeholder", () => {
        expect(measuringQuestionConfig.summary()).toBe("Not yet implemented");
    });
});

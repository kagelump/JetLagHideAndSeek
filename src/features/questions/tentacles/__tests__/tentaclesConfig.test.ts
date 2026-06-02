import { tentaclesQuestionConfig } from "../tentaclesConfig";

describe("tentaclesQuestionConfig", () => {
    it("is a valid QuestionDefinition with the tentacles type", () => {
        expect(tentaclesQuestionConfig.type).toBe("tentacles");
        expect(tentaclesQuestionConfig.implemented).toBe(false);
        expect(tentaclesQuestionConfig.title).toBe("Tentacles");
        expect(tentaclesQuestionConfig.time).toBe("5 minutes");
        expect(tentaclesQuestionConfig.cost).toBe("Draw 4, pick 2");
    });

    it("has expected answer labels", () => {
        expect(tentaclesQuestionConfig.answerLabels.positive).toBe("Hit");
        expect(tentaclesQuestionConfig.answerLabels.negative).toBe("Miss");
    });

    it("has a summary function returning the placeholder", () => {
        expect(tentaclesQuestionConfig.summary()).toBe("Not yet implemented");
    });
});

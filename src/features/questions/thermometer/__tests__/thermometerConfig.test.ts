import { thermometerQuestionConfig } from "../thermometerConfig";

describe("thermometerQuestionConfig", () => {
    it("is a valid QuestionDefinition with the thermometer type", () => {
        expect(thermometerQuestionConfig.type).toBe("thermometer");
        expect(thermometerQuestionConfig.implemented).toBe(false);
        expect(thermometerQuestionConfig.title).toBe("Thermometer");
        expect(thermometerQuestionConfig.time).toBe("5 minutes");
        expect(thermometerQuestionConfig.cost).toBe("Draw 2, pick 1");
    });

    it("has expected answer labels", () => {
        expect(thermometerQuestionConfig.answerLabels.positive).toBe("Warmer");
        expect(thermometerQuestionConfig.answerLabels.negative).toBe("Colder");
    });

    it("has a summary function returning the placeholder", () => {
        expect(thermometerQuestionConfig.summary()).toBe("Not yet implemented");
    });
});

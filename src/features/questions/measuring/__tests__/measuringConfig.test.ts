import { measuringQuestionConfig } from "../measuringConfig";
import type { MeasuringQuestion } from "../measuringTypes";

function makeMeasuringStub(
    overrides: Partial<MeasuringQuestion> = {},
): MeasuringQuestion {
    return {
        answer: "unanswered",
        category: "rail-station",
        center: [139.7, 35.66],
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "q-test",
        isLocked: false,
        nearestPoiName: null,
        seekerDistanceMeters: null,
        seekerDistanceUnit: "m",
        type: "measuring",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("measuringQuestionConfig", () => {
    it("is a valid QuestionDefinition with the measuring type", () => {
        expect(measuringQuestionConfig.type).toBe("measuring");
        expect(measuringQuestionConfig.implemented).toBe(true);
        expect(measuringQuestionConfig.title(makeMeasuringStub())).toBe(
            "Measuring",
        );
        expect(measuringQuestionConfig.time).toBe("5 minutes");
        expect(measuringQuestionConfig.cost).toBe("Draw 3, pick 1");
    });

    it("has expected answer labels", () => {
        expect(measuringQuestionConfig.answerLabels.positive).toBe("Closer");
        expect(measuringQuestionConfig.answerLabels.negative).toBe("Farther");
    });

    it("has a summary function keyed off category", () => {
        expect(measuringQuestionConfig.summary(makeMeasuringStub())).toBe(
            "Measuring: Rail Station",
        );
    });

    describe("sharePrompt", () => {
        it("falls back to simple prompt when distance not resolved", () => {
            expect(
                measuringQuestionConfig.sharePrompt(makeMeasuringStub()),
            ).toBe("Are you closer to a rail station than me?");
        });

        it("returns full prompt when distance is resolved", () => {
            const q = makeMeasuringStub({
                seekerDistanceMeters: 1500,
                seekerDistanceUnit: "km",
                nearestPoiName: "Shinjuku Station",
            });
            expect(measuringQuestionConfig.sharePrompt(q)).toBe(
                "I am 1.50 km away from the nearest rail station (Shinjuku Station). Are you closer or farther from a rail station than me?",
            );
        });

        it("uses 'unknown' when POI name is not resolved but distance is", () => {
            const q = makeMeasuringStub({
                seekerDistanceMeters: 300,
                seekerDistanceUnit: "m",
                nearestPoiName: null,
            });
            expect(measuringQuestionConfig.sharePrompt(q)).toBe(
                "I am 300 m away from the nearest rail station (unknown). Are you closer or farther from a rail station than me?",
            );
        });
    });
});

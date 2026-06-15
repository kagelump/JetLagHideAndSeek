import { thermometerQuestionConfig } from "../thermometerConfig";
import type { ThermometerQuestion } from "../thermometerTypes";
import { haversineDistanceMeters } from "@/shared/geojson";
import { fromMeters } from "@/shared/distanceUnits";

function makeThermometerStub(
    answer: "unanswered" | "positive" | "negative" = "unanswered",
    overrides: Partial<ThermometerQuestion> = {},
): ThermometerQuestion {
    return {
        answer,
        previousPosition: [139.7, 35.66],
        currentPosition: [139.71, 35.67],
        previousStation: null,
        currentStation: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "q-test",
        isLocked: false,
        type: "thermometer",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("thermometerQuestionConfig", () => {
    it("is a valid QuestionDefinition with the thermometer type", () => {
        expect(thermometerQuestionConfig.type).toBe("thermometer");
        expect(thermometerQuestionConfig.implemented).toBe(true);
        expect(thermometerQuestionConfig.title(makeThermometerStub())).toBe(
            "Thermometer",
        );
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

    describe("sharePrompt", () => {
        it("returns static fallback when pins are not both set", () => {
            const q = makeThermometerStub("unanswered", {
                previousPosition: null,
                currentPosition: null,
            });
            expect(thermometerQuestionConfig.sharePrompt(q)).toBe(
                "Am I getting closer to you?",
            );
        });

        it("returns coords-only prompt when pins are set but anchors are null", () => {
            const q = makeThermometerStub();
            const prompt = thermometerQuestionConfig.sharePrompt(q);
            expect(prompt).toContain("I went");
            expect(prompt).toContain("from (35.66000, 139.70000)");
            expect(prompt).toContain("to (35.67000, 139.71000)");
            expect(prompt).toContain("am I hotter or colder?");
        });

        it("returns full station+coord prompt when anchors are resolved", () => {
            const meters = haversineDistanceMeters(35.66, 139.7, 35.67, 139.71);
            const expectedDistance = `${fromMeters(meters, "km")} km`;
            const q = makeThermometerStub("unanswered", {
                previousStation: { name: "Shibuya", distanceMeters: 300 },
                currentStation: { name: "Shinjuku", distanceMeters: 500 },
            });
            const prompt = thermometerQuestionConfig.sharePrompt(q);
            expect(prompt).toContain(`I went ${expectedDistance}`);
            expect(prompt).toContain("from Shibuya (35.66000, 139.70000)");
            expect(prompt).toContain("to Shinjuku (35.67000, 139.71000)");
            expect(prompt).toContain("am I hotter or colder?");
        });
    });
});

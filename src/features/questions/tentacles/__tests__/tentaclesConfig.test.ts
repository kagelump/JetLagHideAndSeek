import { tentaclesQuestionConfig } from "../tentaclesConfig";
import type { QuestionState } from "@/features/questions/questionTypes";

function makeTentaclesStub(): QuestionState {
    return {
        answer: "unanswered",
        candidates: [],
        category: "museum",
        center: [139.7, 35.66],
        createdAt: "2026-01-01T00:00:00.000Z",
        distanceMeters: 2000,
        distanceOption: "2km",
        id: "q-test",
        isLocked: false,
        selectedOsmId: null,
        selectedOsmType: null,
        selectedName: null,
        type: "tentacles",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

describe("tentaclesQuestionConfig", () => {
    it("is a valid QuestionDefinition with the tentacles type", () => {
        expect(tentaclesQuestionConfig.type).toBe("tentacles");
        expect(tentaclesQuestionConfig.implemented).toBe(true);
        expect(tentaclesQuestionConfig.title).toBe("Tentacles");
        expect(tentaclesQuestionConfig.time).toBe("5 minutes");
        expect(tentaclesQuestionConfig.cost).toBe("Draw 4, pick 2");
    });

    it("uses the poi answer model", () => {
        expect(tentaclesQuestionConfig.answerModel).toBe("poi");
    });

    it("has no answerLabels (poi model does not use binary labels)", () => {
        const config = tentaclesQuestionConfig as {
            answerLabels?: unknown;
        };
        expect(config.answerLabels).toBeUndefined();
    });

    it("has a summary function keyed off category", () => {
        expect(tentaclesQuestionConfig.summary(makeTentaclesStub())).toBe(
            "Tentacles: Museum (2km) — Unanswered",
        );
    });

    it("shows selected name in summary when answered", () => {
        const answered = makeTentaclesStub();
        const stubbed = {
            ...answered,
            selectedName: "Tokyo National Museum",
        } as QuestionState;
        expect(tentaclesQuestionConfig.summary(stubbed)).toBe(
            "Tentacles: Museum (2km) — Tokyo National Museum",
        );
    });
});

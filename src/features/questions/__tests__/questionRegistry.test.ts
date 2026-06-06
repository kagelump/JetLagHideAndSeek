import {
    getQuestionAnswerLabel,
    getQuestionAnswerStatus,
    implementedQuestionTypes,
    isPoiAnswerModel,
    questionDefinitions,
} from "@/features/questions/questionRegistry";
import type {
    QuestionState,
    QuestionType,
} from "@/features/questions/questionTypes";

describe("questionRegistry", () => {
    it("has config for every planned question type", () => {
        const questionTypes: QuestionType[] = [
            "matching",
            "measuring",
            "radar",
            "tentacles",
            "thermometer",
        ];

        expect(Object.keys(questionDefinitions).sort()).toEqual(
            questionTypes.sort(),
        );
    });

    it("exposes implemented question types", () => {
        expect(implementedQuestionTypes.sort()).toEqual(
            [
                "matching",
                "measuring",
                "radar",
                "tentacles",
                "thermometer",
            ].sort(),
        );
    });

    it("marks measuring, thermometer, and tentacles as implemented", () => {
        expect(questionDefinitions.measuring.implemented).toBe(true);
        expect(questionDefinitions.thermometer.implemented).toBe(true);
        expect(questionDefinitions.tentacles.implemented).toBe(true);
    });

    it("resolves answer labels per question type", () => {
        expect(getQuestionAnswerLabel("radar", "positive")).toBe("Hit");
        expect(getQuestionAnswerLabel("radar", "negative")).toBe("Miss");
        expect(getQuestionAnswerLabel("thermometer", "positive")).toBe(
            "Hotter",
        );
        expect(getQuestionAnswerLabel("thermometer", "negative")).toBe(
            "Colder",
        );
        expect(getQuestionAnswerLabel("radar", "unanswered")).toBe("N/A");
    });

    it("keeps radar answer defaults and map semantics in config", () => {
        expect(questionDefinitions.radar.defaultAnswer).toBe("unanswered");
        expect(questionDefinitions.radar.answerMapBehavior).toEqual({
            negative: "darken-inside",
            positive: "darken-outside",
        });
    });
});

// ---------------------------------------------------------------------------
// Task 02: answer model
// ---------------------------------------------------------------------------

describe("answer model", () => {
    it("has answerModel on every question definition", () => {
        for (const definition of Object.values(questionDefinitions)) {
            expect(definition.answerModel).toBeDefined();
            expect(["binary", "poi"]).toContain(definition.answerModel);
        }
    });

    it("radar, matching, measuring, thermometer use binary answer model", () => {
        expect(questionDefinitions.radar.answerModel).toBe("binary");
        expect(questionDefinitions.matching.answerModel).toBe("binary");
        expect(questionDefinitions.measuring.answerModel).toBe("binary");
        expect(questionDefinitions.thermometer.answerModel).toBe("binary");
    });

    it("tentacles uses poi answer model", () => {
        expect(questionDefinitions.tentacles.answerModel).toBe("poi");
    });

    it("isPoiAnswerModel returns true only for tentacles", () => {
        expect(isPoiAnswerModel("tentacles")).toBe(true);
        expect(isPoiAnswerModel("radar")).toBe(false);
        expect(isPoiAnswerModel("matching")).toBe(false);
        expect(isPoiAnswerModel("measuring")).toBe(false);
        expect(isPoiAnswerModel("thermometer")).toBe(false);
    });

    it("getQuestionAnswerStatus returns answered/unanswered for binary questions", () => {
        const unansweredRadar: QuestionState = {
            answer: "unanswered",
            center: [0, 0],
            createdAt: "2026-01-01T00:00:00.000Z",
            distanceMeters: 500,
            distanceOption: "500m",
            distanceUnit: "m",
            id: "q-1",
            type: "radar",
            updatedAt: "2026-01-01T00:00:00.000Z",
        };
        const answeredRadar = {
            ...unansweredRadar,
            answer: "positive",
        } as const;

        expect(getQuestionAnswerStatus(unansweredRadar)).toBe("unanswered");
        expect(getQuestionAnswerStatus(answeredRadar)).toBe("answered");
    });

    it("getQuestionAnswerStatus returns answered/unanswered for poi questions", () => {
        const unansweredTentacles: QuestionState = {
            answer: "unanswered",
            candidates: [],
            category: "museum",
            center: [0, 0],
            createdAt: "2026-01-01T00:00:00.000Z",
            distanceMeters: 2000,
            distanceOption: "2km",
            id: "q-2",
            selectedOsmId: null,
            selectedOsmType: null,
            selectedName: null,
            type: "tentacles",
            updatedAt: "2026-01-01T00:00:00.000Z",
        };
        const answeredTentacles = {
            ...unansweredTentacles,
            selectedOsmId: 123,
        } as QuestionState;

        expect(getQuestionAnswerStatus(unansweredTentacles)).toBe("unanswered");
        expect(getQuestionAnswerStatus(answeredTentacles)).toBe("answered");
    });

    it("getQuestionAnswerStatus for poi model keys off selectedOsmId, not answer field", () => {
        // Regression: even if answer drifts from selection, reads are correct.
        const drifted: QuestionState = {
            answer: "positive",
            candidates: [],
            category: "museum",
            center: [0, 0],
            createdAt: "2026-01-01T00:00:00.000Z",
            distanceMeters: 2000,
            distanceOption: "2km",
            id: "q-3",
            selectedOsmId: null,
            selectedOsmType: null,
            selectedName: null,
            type: "tentacles",
            updatedAt: "2026-01-01T00:00:00.000Z",
        };
        expect(getQuestionAnswerStatus(drifted)).toBe("unanswered");
    });

    it("returns N/A for poi model answer labels", () => {
        expect(getQuestionAnswerLabel("tentacles", "positive")).toBe("N/A");
        expect(getQuestionAnswerLabel("tentacles", "negative")).toBe("N/A");
    });

    it("tentacles config has no answerLabels", () => {
        const def = questionDefinitions.tentacles as {
            answerLabels?: unknown;
        };
        expect(def.answerLabels).toBeUndefined();
    });
});

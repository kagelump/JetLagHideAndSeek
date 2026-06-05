import { applyImport } from "@/sharing/import/applyImport";
import type { AppStores } from "@/sharing/import/applyImport";
import { buildQuestionRequestEnvelope } from "@/sharing/export/buildEnvelope";
import { buildAppStateEnvelope } from "@/sharing/export/buildEnvelope";
import type { QuestionState } from "@/features/questions/questionTypes";
import type { WireEnvelope } from "@/sharing/wire/schema";
import { defaultPlayArea } from "@/features/map/playArea";

function makeRadarQuestion(): QuestionState {
    return {
        answer: "unanswered",
        center: [139.69171, 35.6895],
        createdAt: "2026-06-05T00:00:00.000Z",
        distanceMeters: 5000,
        distanceOption: "5km",
        distanceUnit: "m",
        id: "q-radar-1",
        type: "radar",
        updatedAt: "2026-06-05T00:00:00.000Z",
    };
}

function makeMatchingQuestion(): QuestionState {
    return {
        answer: "unanswered",
        candidates: [],
        category: "park",
        center: [139.7, 35.7],
        createdAt: "2026-06-05T00:00:00.000Z",
        id: "q-matching-1",
        lineId: null,
        lineName: null,
        selectedOsmId: null,
        selectedOsmType: null,
        targetName: "Ueno Park",
        targetOsmId: 456,
        targetOsmType: "way",
        type: "matching",
        updatedAt: "2026-06-05T00:00:00.000Z",
    };
}

function makeStores(overrides?: Partial<AppStores>): {
    stores: AppStores;
    addedQuestions: QuestionState[];
    importedQuestions: QuestionState[][];
    importedPlayAreas: unknown[];
    replacedSetups: unknown[];
} {
    const addedQuestions: QuestionState[] = [];
    const importedQuestions: QuestionState[][] = [];
    const importedPlayAreas: unknown[] = [];
    const replacedSetups: unknown[] = [];

    const stores: AppStores = {
        hidingZones: {
            replaceSetup: (nextSetup) => {
                replacedSetups.push(nextSetup);
            },
        },
        playArea: {
            importPlayArea: (playArea) => {
                importedPlayAreas.push(playArea);
            },
        },
        questions: {
            addImportedQuestion: (question) => {
                addedQuestions.push(question);
                return question;
            },
            importQuestions: (questions) => {
                importedQuestions.push(questions);
            },
        },
        ...overrides,
    };

    return {
        addedQuestions,
        importedPlayAreas,
        importedQuestions,
        replacedSetups,
        stores,
    };
}

describe("applyImport — question-request", () => {
    it("calls addImportedQuestion for a question-request envelope", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });

        const { addedQuestions, stores } = makeStores();
        const result = applyImport({ envelope, stores });

        expect(result).toEqual({ ok: true });
        expect(addedQuestions).toHaveLength(1);
        expect(addedQuestions[0].type).toBe("radar");
        if (addedQuestions[0].type === "radar") {
            expect(addedQuestions[0].distanceMeters).toBe(5000);
        }
    });

    it("calls addImportedQuestion for a matching question-request envelope", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeMatchingQuestion(),
        });

        const { addedQuestions, stores } = makeStores();
        const result = applyImport({ envelope, stores });

        expect(result).toEqual({ ok: true });
        expect(addedQuestions).toHaveLength(1);
        expect(addedQuestions[0].type).toBe("matching");
        if (addedQuestions[0].type === "matching") {
            expect(addedQuestions[0].category).toBe("park");
            expect(addedQuestions[0].targetName).toBe("Ueno Park");
            expect(addedQuestions[0].targetOsmId).toBe(456);
            expect(addedQuestions[0].targetOsmType).toBe("way");
        }
    });

    it("does not touch play area or hiding zones for a question-request", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });

        const { importedPlayAreas, replacedSetups, stores } = makeStores();
        applyImport({ envelope, stores });

        expect(importedPlayAreas).toHaveLength(0);
        expect(replacedSetups).toHaveLength(0);
    });

    it("does not call importQuestions for a question-request (additive only)", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });

        const { importedQuestions, stores } = makeStores();
        applyImport({ envelope, stores });

        expect(importedQuestions).toHaveLength(0);
    });

    it("returns an error when questions store is unavailable", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });

        const { stores } = makeStores({ questions: undefined });
        const result = applyImport({ envelope, stores });

        expect(result).toEqual({
            error: "Questions are unavailable in this context.",
            ok: false,
        });
    });

    it("returns an error for unsupported envelope kinds", () => {
        const unsupported = { kind: "future-kind" } as unknown as WireEnvelope;
        const { stores } = makeStores();
        const result = applyImport({ envelope: unsupported, stores });

        expect(result).toEqual({
            error: "Unsupported share link type.",
            ok: false,
        });
    });
});

describe("applyImport — app-state (regression)", () => {
    it("still imports app-state envelopes correctly", () => {
        const envelope = buildAppStateEnvelope({
            gameId: "test-game",
            hidingZones: {
                radiusMeters: 900,
                radiusUnit: "m",
                selectedPresetIds: ["tokyo-metro"],
            },
            now: new Date("2026-06-05T00:00:00.000Z"),
            playArea: defaultPlayArea,
            questions: [],
        });

        const { importedPlayAreas, replacedSetups, stores } = makeStores();
        const result = applyImport({ envelope, stores });

        expect(result).toEqual({ ok: true });
        expect(importedPlayAreas).toHaveLength(1);
        expect(replacedSetups).toHaveLength(1);
    });
});

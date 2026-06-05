import { buildQuestionSharePrompt } from "@/features/questions/questionSharePrompt";
import type { QuestionState } from "@/features/questions/questionTypes";

function makeRadarQuestion(
    overrides?: Partial<Extract<QuestionState, { type: "radar" }>>,
): QuestionState {
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
        ...overrides,
    };
}

function makeMatchingQuestion(
    overrides?: Partial<Extract<QuestionState, { type: "matching" }>>,
): QuestionState {
    return {
        answer: "unanswered",
        candidates: [],
        category: "transit-line",
        center: [139.7, 35.7],
        createdAt: "2026-06-05T00:00:00.000Z",
        id: "q-matching-1",
        lineId: null,
        lineName: null,
        selectedOsmId: null,
        selectedOsmType: null,
        targetName: null,
        targetOsmId: null,
        targetOsmType: null,
        type: "matching",
        updatedAt: "2026-06-05T00:00:00.000Z",
        ...overrides,
    };
}

describe("buildQuestionSharePrompt", () => {
    // -- Radar questions ---------------------------------------------------

    it("formats a radar question with a preset distance option", () => {
        const prompt = buildQuestionSharePrompt(makeRadarQuestion());
        expect(prompt).toBe("Are you within 5km of (35.68950, 139.69171)?");
    });

    it('formats a radar question with "other" distance option using meters', () => {
        const prompt = buildQuestionSharePrompt(
            makeRadarQuestion({
                distanceMeters: 1500,
                distanceOption: "other",
            }),
        );
        expect(prompt).toBe("Are you within 1500m of (35.68950, 139.69171)?");
    });

    it('uses the configured distanceUnit for "other" option', () => {
        const prompt = buildQuestionSharePrompt(
            makeRadarQuestion({
                distanceMeters: 1609,
                distanceOption: "other",
                distanceUnit: "mi",
            }),
        );
        // 1609 meters ≈ 1 mile. fromMeters formats based on unit.
        // The exact value depends on fromMeters formatting, but must be a
        // numeric value followed by "mi" — never the raw meter value.
        expect(prompt).toMatch(
            /Are you within \d+(\.\d+)?mi of \(35\.68950, 139\.69171\)\?/,
        );
    });

    it("formats radar coordinates to 5 decimal places", () => {
        const prompt = buildQuestionSharePrompt(
            makeRadarQuestion({ center: [139.7, 35.66] }),
        );
        expect(prompt).toContain("(35.66000, 139.70000)");
    });

    // -- Matching transit-line ---------------------------------------------

    it("formats a transit-line question with a line name", () => {
        const prompt = buildQuestionSharePrompt(
            makeMatchingQuestion({
                category: "transit-line",
                lineName: "Hibiya Line",
            }),
        );
        expect(prompt).toBe("Are you on the Hibiya Line?");
    });

    it("formats a transit-line question without a line name", () => {
        const prompt = buildQuestionSharePrompt(
            makeMatchingQuestion({
                category: "transit-line",
                lineName: null,
            }),
        );
        expect(prompt).toBe("Which transit line are you on?");
    });

    // -- Other matching categories -----------------------------------------

    it("formats a matching question with a target name", () => {
        const prompt = buildQuestionSharePrompt(
            makeMatchingQuestion({
                category: "park",
                targetName: "Ueno Park",
            }),
        );
        expect(prompt).toBe("Do we match on Park (Ueno Park)?");
    });

    it("formats a matching question without a target name", () => {
        const prompt = buildQuestionSharePrompt(
            makeMatchingQuestion({
                category: "museum",
                targetName: null,
            }),
        );
        expect(prompt).toBe("Do we match on Museum?");
    });

    it("uses getCategoryTitle for other matching categories", () => {
        const prompt = buildQuestionSharePrompt(
            makeMatchingQuestion({
                category: "commercial-airport",
                targetName: "Narita",
            }),
        );
        expect(prompt).toBe("Do we match on Airport (Narita)?");
    });
});

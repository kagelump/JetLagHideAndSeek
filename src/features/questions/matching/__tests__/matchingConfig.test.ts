import { matchingQuestionConfig } from "../matchingConfig";
import type { MatchingQuestion } from "../matchingTypes";

function makeMockMatchingQuestion(
    overrides: Partial<MatchingQuestion> = {},
): MatchingQuestion {
    return {
        answer: "unanswered",
        candidates: [],
        category: "park",
        center: [139.76, 35.68],
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "matching-1",
        lineId: null,
        lineName: null,
        selectedOsmId: null,
        selectedOsmType: null,
        targetName: null,
        targetOsmId: null,
        targetOsmType: null,
        type: "matching",
        updatedAt: "2026-01-01T00:00:00.000Z",
        isLocked: false,
        ...overrides,
    };
}

describe("matchingQuestionConfig", () => {
    it("is a valid QuestionDefinition with the matching type", () => {
        expect(matchingQuestionConfig.type).toBe("matching");
        expect(matchingQuestionConfig.implemented).toBe(true);
        expect(matchingQuestionConfig.title).toBe("Matching");
    });

    describe("summary function", () => {
        it("returns empty string for non-matching questions", () => {
            const result = matchingQuestionConfig.summary({
                type: "radar",
            } as any);
            expect(result).toBe("");
        });

        it("includes category title for park question without target", () => {
            const question = makeMockMatchingQuestion({ category: "park" });
            const result = matchingQuestionConfig.summary(question);
            expect(result).toBe("Park: not selected");
        });

        it("includes the target name when selected", () => {
            const question = makeMockMatchingQuestion({
                category: "park",
                targetName: "Yoyogi Park",
            });
            const result = matchingQuestionConfig.summary(question);
            expect(result).toBe("Park: Yoyogi Park");
        });

        it("shows transit line with line name when selected", () => {
            const question = makeMockMatchingQuestion({
                category: "transit-line",
                lineName: "Ginza Line",
            });
            const result = matchingQuestionConfig.summary(question);
            expect(result).toBe("Transit line: Ginza Line");
        });

        it("shows transit line placeholder when line not selected", () => {
            const question = makeMockMatchingQuestion({
                category: "transit-line",
            });
            const result = matchingQuestionConfig.summary(question);
            expect(result).toBe("Transit line: not selected");
        });

        it("shows station-name-length placeholder when target not selected", () => {
            const question = makeMockMatchingQuestion({
                category: "station-name-length",
            });
            const result = matchingQuestionConfig.summary(question);
            expect(result).toBe("Station's Name Length: not selected");
        });

        it("shows station-name-length with character count", () => {
            const question = makeMockMatchingQuestion({
                category: "station-name-length",
                targetName: "Shinjuku Station",
                selectedOsmId: 42,
                candidates: [
                    {
                        lat: 35.69,
                        lon: 139.7,
                        name: "Shinjuku Station",
                        nameLength: 16,
                        osmId: 42,
                        osmType: "node",
                        tags: {},
                    },
                ],
            });
            const result = matchingQuestionConfig.summary(question);
            expect(result).toBe(
                "Station's Name Length: Shinjuku Station (16 chars)",
            );
        });

        it("shows station-name-length without char count when candidate not found", () => {
            const question = makeMockMatchingQuestion({
                category: "station-name-length",
                targetName: "Unknown Station",
                selectedOsmId: 99,
            });
            const result = matchingQuestionConfig.summary(question);
            expect(result).toBe("Station's Name Length: Unknown Station");
        });
    });
});

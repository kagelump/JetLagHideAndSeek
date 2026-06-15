import { getQuestionPins } from "@/features/map/getQuestionPins";
import type { QuestionState } from "@/features/questions/questionTypes";

const center: [number, number] = [139.7, 35.66];

function radarQuestion(): Extract<QuestionState, { type: "radar" }> {
    return {
        answer: "unanswered",
        center,
        createdAt: "2026-06-01T00:00:00.000Z",
        distanceMeters: 500,
        distanceOption: "500m",
        distanceUnit: "m",
        id: "q-radar",
        isLocked: false,
        type: "radar",
        updatedAt: "2026-06-01T00:00:00.000Z",
    };
}

function matchingQuestion(): Extract<QuestionState, { type: "matching" }> {
    return {
        answer: "unanswered",
        candidates: [],
        category: "transit-line",
        center,
        createdAt: "2026-06-01T00:00:00.000Z",
        id: "q-matching",
        isLocked: false,
        lineId: null,
        lineName: null,
        selectedOsmId: null,
        selectedOsmType: null,
        targetName: null,
        targetOsmId: null,
        targetOsmType: null,
        type: "matching",
        updatedAt: "2026-06-01T00:00:00.000Z",
    };
}

function measuringQuestion(): Extract<QuestionState, { type: "measuring" }> {
    return {
        answer: "unanswered",
        category: "rail-station",
        center,
        createdAt: "2026-06-01T00:00:00.000Z",
        id: "q-measuring",
        isLocked: false,
        seekerDistanceUnit: "m",
        seekerDistanceMeters: null,
        nearestPoiName: null,
        type: "measuring",
        updatedAt: "2026-06-01T00:00:00.000Z",
    };
}

function tentaclesQuestion(): Extract<QuestionState, { type: "tentacles" }> {
    return {
        answer: "unanswered",
        candidates: [],
        category: "museum",
        center,
        createdAt: "2026-06-01T00:00:00.000Z",
        distanceMeters: 2000,
        distanceOption: "2km",
        id: "q-tentacles",
        isLocked: false,
        selectedOsmId: null,
        selectedOsmType: null,
        selectedName: null,
        type: "tentacles",
        updatedAt: "2026-06-01T00:00:00.000Z",
    };
}

function thermometerQuestion(
    previousPosition: [number, number] | null,
    currentPosition: [number, number] | null,
): Extract<QuestionState, { type: "thermometer" }> {
    return {
        answer: "unanswered",
        previousPosition,
        currentPosition,
        previousStation: null,
        currentStation: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        id: "q-thermometer",
        isLocked: false,
        type: "thermometer",
        updatedAt: "2026-06-01T00:00:00.000Z",
    };
}

describe("getQuestionPins", () => {
    it("returns one center pin for radar", () => {
        const pins = getQuestionPins(radarQuestion());
        expect(pins).toEqual([{ key: "center", position: center }]);
    });

    it("returns one center pin for matching", () => {
        const pins = getQuestionPins(matchingQuestion());
        expect(pins).toEqual([{ key: "center", position: center }]);
    });

    it("returns one center pin for measuring", () => {
        const pins = getQuestionPins(measuringQuestion());
        expect(pins).toEqual([{ key: "center", position: center }]);
    });

    it("returns one center pin for tentacles", () => {
        const pins = getQuestionPins(tentaclesQuestion());
        expect(pins).toEqual([{ key: "center", position: center }]);
    });

    it("returns two pins for thermometer with both positions", () => {
        const pins = getQuestionPins(
            thermometerQuestion(center, [139.72, 35.68]),
        );
        expect(pins).toEqual([
            { key: "start", position: center },
            { key: "end", position: [139.72, 35.68] },
        ]);
    });

    it("returns only end pin when previousPosition is null", () => {
        const pins = getQuestionPins(
            thermometerQuestion(null, [139.72, 35.68]),
        );
        expect(pins).toEqual([{ key: "end", position: [139.72, 35.68] }]);
    });

    it("returns only start pin when currentPosition is null", () => {
        const pins = getQuestionPins(thermometerQuestion(center, null));
        expect(pins).toEqual([{ key: "start", position: center }]);
    });

    it("returns empty array for null question", () => {
        expect(getQuestionPins(null)).toEqual([]);
    });
});

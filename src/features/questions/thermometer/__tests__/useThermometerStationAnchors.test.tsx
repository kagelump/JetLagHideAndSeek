import { renderHook, waitFor } from "@testing-library/react-native";

import type { ThermometerQuestion } from "../thermometerTypes";

// ---------------------------------------------------------------------------
// Mock the spatial lookup so the hook's resolution is deterministic.
// ---------------------------------------------------------------------------
const mockFind = jest.fn();

jest.mock("@/features/questions/matching/osmMatchingCache", () => ({
    findMatchingFeaturesWithIndex: (...args: unknown[]) => mockFind(...args),
}));

// Import after the mock is registered.
import { useThermometerStationAnchors } from "../useThermometerStationAnchors";

function makeQuestion(
    overrides: Partial<ThermometerQuestion> = {},
): ThermometerQuestion {
    return {
        answer: "unanswered",
        createdAt: "2026-01-01T00:00:00.000Z",
        previousPosition: [139.7, 35.66],
        currentPosition: [139.71, 35.67],
        previousStation: null,
        currentStation: null,
        id: "q-test",
        isLocked: false,
        type: "thermometer",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("useThermometerStationAnchors", () => {
    beforeEach(() => {
        mockFind.mockReset();
    });

    it("resolves and writes a station anchor for each unresolved pin", async () => {
        mockFind.mockResolvedValue({
            candidates: [{ name: "Shibuya", distanceMeters: 300.4 }],
            source: "memory",
        });
        const updateQuestion = jest.fn();
        const question = makeQuestion();

        renderHook(() =>
            useThermometerStationAnchors(question, updateQuestion),
        );

        await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(2));

        // Queries the rail-station category at the configured radius.
        expect(mockFind).toHaveBeenCalledWith(
            "station-name-length",
            [139.7, 35.66],
            { maxCandidates: 1, requestedRadiusMeters: 2000 },
        );

        // Applying each updater to the current question yields the anchor
        // (distance is rounded to whole meters).
        const startUpdate = updateQuestion.mock.calls[0][1](question);
        expect(startUpdate.previousStation).toEqual({
            name: "Shibuya",
            distanceMeters: 300,
        });
        const endUpdate = updateQuestion.mock.calls[1][1](question);
        expect(endUpdate.currentStation).toEqual({
            name: "Shibuya",
            distanceMeters: 300,
        });
    });

    it("writes a resolved-but-none anchor when no station is nearby", async () => {
        mockFind.mockResolvedValue({ candidates: [], source: "memory" });
        const updateQuestion = jest.fn();
        const question = makeQuestion({ currentPosition: null });

        renderHook(() =>
            useThermometerStationAnchors(question, updateQuestion),
        );

        await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1));

        const update = updateQuestion.mock.calls[0][1](question);
        expect(update.previousStation).toEqual({
            name: null,
            distanceMeters: null,
        });
    });

    it("drops a stale write when the pin moved during the lookup", async () => {
        mockFind.mockResolvedValue({
            candidates: [{ name: "Shibuya", distanceMeters: 300 }],
            source: "memory",
        });
        const updateQuestion = jest.fn();
        const question = makeQuestion({ currentPosition: null });

        renderHook(() =>
            useThermometerStationAnchors(question, updateQuestion),
        );

        await waitFor(() => expect(updateQuestion).toHaveBeenCalledTimes(1));

        // The updater receives the *latest* question state. If the pin has
        // since moved, the resolved anchor is dropped (returns current as-is).
        const moved = makeQuestion({ previousPosition: [1, 2] });
        const updater = updateQuestion.mock.calls[0][1];
        expect(updater(moved)).toBe(moved);
    });

    it("does not query a pin that already has an anchor", async () => {
        mockFind.mockResolvedValue({ candidates: [], source: "memory" });
        const updateQuestion = jest.fn();
        const question = makeQuestion({
            previousStation: { name: "Shibuya", distanceMeters: 100 },
            currentStation: { name: "Shinjuku", distanceMeters: 200 },
        });

        renderHook(() =>
            useThermometerStationAnchors(question, updateQuestion),
        );

        // Give any (unexpected) async resolution a chance to fire.
        await waitFor(() => expect(mockFind).not.toHaveBeenCalled());
        expect(updateQuestion).not.toHaveBeenCalled();
    });
});

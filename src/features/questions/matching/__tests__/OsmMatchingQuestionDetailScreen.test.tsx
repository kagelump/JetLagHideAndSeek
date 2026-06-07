import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { FetchDebugScope } from "@/features/questions/matching/fetchDebug";
import { OsmMatchingQuestionDetailScreen } from "@/features/questions/matching/OsmMatchingQuestionDetailScreen";
import type { MatchingQuestion } from "@/features/questions/matching/matchingTypes";
import type { QuestionState } from "@/features/questions/questionTypes";

const mockPlayAreaCenter: [number, number] = [139.75, 35.675];
const mockPlayAreaBbox: [number, number, number, number] = [
    139.6, 35.55, 139.9, 35.8,
];

const mockCandidates = [
    {
        distanceMeters: 150,
        lat: 35.681,
        lon: 139.761,
        name: "Nearest Park",
        osmId: 1,
        osmType: "node" as const,
        tags: {},
    },
    {
        distanceMeters: 900,
        lat: 35.685,
        lon: 139.765,
        name: "Farther Park",
        osmId: 2,
        osmType: "way" as const,
        tags: {},
    },
    {
        distanceMeters: 2100,
        lat: 35.69,
        lon: 139.77,
        name: "Distant Park",
        osmId: 3,
        osmType: "relation" as const,
        tags: {},
    },
];

const fiveCandidates = [
    ...mockCandidates,
    {
        distanceMeters: 3200,
        lat: 35.7,
        lon: 139.78,
        name: "Fourth Park",
        osmId: 4,
        osmType: "node" as const,
        tags: {},
    },
    {
        distanceMeters: 5000,
        lat: 35.71,
        lon: 139.79,
        name: "Fifth Park",
        osmId: 5,
        osmType: "way" as const,
        tags: {},
    },
];

let mockSearchMatchingFeaturesProgressive: jest.Mock;

jest.mock("@/features/questions/matching/progressiveSearch", () => ({
    searchCoversBbox: jest.fn(),
    searchMatchingFeaturesProgressive: (...args: unknown[]) =>
        mockSearchMatchingFeaturesProgressive(...args),
}));

jest.mock("@/state/hidingZoneStore", () => ({
    useHidingZoneState: () => ({ radiusMeters: 600 }),
}));

jest.mock("@/state/playAreaStore", () => ({
    usePlayArea: () => ({
        playArea: {
            bbox: [139.6, 35.55, 139.9, 35.8],
            center: [139.75, 35.675],
            label: "Test Area",
            osmId: 1,
            osmType: "R",
            boundary: { type: "FeatureCollection", features: [] },
        },
    }),
}));

function TestScreen({
    initialQuestion,
    onUpdate,
}: {
    initialQuestion: MatchingQuestion;
    onUpdate: jest.Mock;
}) {
    const [question, setQuestion] =
        React.useState<MatchingQuestion>(initialQuestion);

    // Sync state when the parent rerenders with a new initialQuestion
    React.useEffect(() => {
        setQuestion(initialQuestion);
    }, [initialQuestion]);

    const wrappedUpdate = jest.fn(
        (questionId: string, updater: (q: QuestionState) => QuestionState) => {
            const updated = updater(question) as MatchingQuestion;
            setQuestion(updated);
            onUpdate(questionId, updater);
            return updated;
        },
    );

    return (
        <FetchDebugScope>
            <OsmMatchingQuestionDetailScreen
                question={question}
                updateQuestion={wrappedUpdate}
            />
        </FetchDebugScope>
    );
}

describe("OsmMatchingQuestionDetailScreen", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchMatchingFeaturesProgressive = jest.fn().mockResolvedValue({
            candidates: mockCandidates,
            source: "network",
            searchRadiusMeters: 1200,
        });
    });

    it("renders candidate list sorted by distance", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: mockCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("Nearest Park")).toBeTruthy();
            expect(screen.getByText("Farther Park")).toBeTruthy();
            expect(screen.getByText("Distant Park")).toBeTruthy();
        });
    });

    it("shows right-justified distance text for each candidate", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: mockCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("150 meters")).toBeTruthy();
            expect(screen.getByText("900 meters")).toBeTruthy();
            expect(screen.getByText("2.1 km")).toBeTruthy();
        });
    });

    it("highlights the selected candidate", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: mockCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: 2,
            selectedOsmType: "way",
            targetName: "Farther Park",
            targetOsmId: 2,
            targetOsmType: "way",
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            const selectedRow = screen.getByTestId("osm-matching-candidate-2");
            expect(selectedRow).toBeTruthy();
        });
    });

    it("tapping candidate selects it and syncs targetOsmId", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: mockCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn((questionId, updater) => {
            return updater(question);
        });

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("Farther Park")).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId("osm-matching-candidate-2"));

        await waitFor(() => {
            expect(onUpdate).toHaveBeenCalledWith(
                "matching-1",
                expect.any(Function),
            );
        });

        const lastCall =
            onUpdate.mock.results[onUpdate.mock.results.length - 1];
        const updated = lastCall.value as MatchingQuestion;
        expect(updated.selectedOsmId).toBe(2);
        expect(updated.selectedOsmType).toBe("way");
        expect(updated.targetOsmId).toBe(2);
        expect(updated.targetOsmType).toBe("way");
        expect(updated.targetName).toBe("Farther Park");
    });

    it("auto-selects nearest on load when candidates are empty", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: [],
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn((questionId, updater) => {
            return updater(question);
        });

        render(<TestScreen initialQuestion={question} onUpdate={onUpdate} />);

        await waitFor(() => {
            expect(mockSearchMatchingFeaturesProgressive).toHaveBeenCalled();
        });

        const lastCall =
            onUpdate.mock.results[onUpdate.mock.results.length - 1];
        const updated = lastCall.value as MatchingQuestion;
        expect(updated.candidates).toEqual(mockCandidates);
        expect(updated.selectedOsmId).toBe(1);
        expect(updated.selectedOsmType).toBe("node");
        expect(updated.targetOsmId).toBe(1);
        expect(updated.targetName).toBe("Nearest Park");
    });

    it("refresh button re-queries with forceRefresh and updates candidates", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: mockCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: 1,
            selectedOsmType: "node",
            targetName: "Nearest Park",
            targetOsmId: 1,
            targetOsmType: "node",
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId("osm-matching-refresh")).toBeTruthy();
        });

        mockSearchMatchingFeaturesProgressive.mockClear();
        const newCandidates = [
            {
                distanceMeters: 300,
                lat: 35.69,
                lon: 139.77,
                name: "Refreshed Park",
                osmId: 99,
                osmType: "node" as const,
                tags: {},
            },
        ];
        mockSearchMatchingFeaturesProgressive.mockResolvedValue({
            candidates: newCandidates,
            source: "network",
            searchRadiusMeters: 2400,
        });

        fireEvent.press(screen.getByTestId("osm-matching-refresh"));

        await waitFor(() => {
            expect(mockSearchMatchingFeaturesProgressive).toHaveBeenCalledWith(
                "park",
                mockPlayAreaCenter,
                600,
                mockPlayAreaBbox,
                expect.objectContaining({ forceRefresh: true }),
            );
        });
    });

    it("refresh button writes search results back to question state (regression: Bug 1)", async () => {
        // Bug: the Refresh button called performSearch(true) directly,
        // which fetched data but never wrote it to the question store.
        // Regression: pressing Refresh must update question.candidates,
        // targetName, targetOsmId, etc. with the fresh search results.
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: mockCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: 1,
            selectedOsmType: "node",
            targetName: "Nearest Park",
            targetOsmId: 1,
            targetOsmType: "node",
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        // Use a real updater so the question state actually changes.
        let currentQuestion = { ...question };
        const onUpdate = jest.fn(
            (
                _questionId: string,
                updater: (q: QuestionState) => QuestionState,
            ) => {
                currentQuestion = updater(currentQuestion) as MatchingQuestion;
                return currentQuestion;
            },
        );

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId("osm-matching-refresh")).toBeTruthy();
        });

        // Set up fresh search results different from the initial candidates.
        mockSearchMatchingFeaturesProgressive.mockClear();
        const freshCandidates = [
            {
                distanceMeters: 300,
                lat: 35.69,
                lon: 139.77,
                name: "Refreshed Spot",
                osmId: 99,
                osmType: "node" as const,
                tags: {},
            },
        ];
        mockSearchMatchingFeaturesProgressive.mockResolvedValue({
            candidates: freshCandidates,
            source: "network",
            searchRadiusMeters: 2400,
        });

        fireEvent.press(screen.getByTestId("osm-matching-refresh"));

        // The question must reflect the new search results — not the old ones.
        await waitFor(() => {
            expect(currentQuestion.candidates).toEqual(freshCandidates);
            expect(currentQuestion.targetName).toBe("Refreshed Spot");
            expect(currentQuestion.targetOsmId).toBe(99);
            expect(currentQuestion.targetOsmType).toBe("node");
        });
    });

    it("renders stale-cache banner when cache source is stale", async () => {
        mockSearchMatchingFeaturesProgressive.mockResolvedValue({
            candidates: mockCandidates,
            source: "stale",
            searchRadiusMeters: 1200,
        });

        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: [],
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId("osm-matching-stale")).toBeTruthy();
        });
    });

    it("clears stale candidates and target when center changes", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: mockCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: 1,
            selectedOsmType: "node",
            targetName: "Nearest Park",
            targetOsmId: 1,
            targetOsmType: "node",
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn((questionId, updater) => {
            return updater(question);
        });

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("Nearest Park")).toBeTruthy();
        });

        mockSearchMatchingFeaturesProgressive.mockClear();

        const movedQuestion: MatchingQuestion = {
            ...question,
            center: [139.8, 35.8],
        };

        screen.rerender(
            <TestScreen initialQuestion={movedQuestion} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(mockSearchMatchingFeaturesProgressive).toHaveBeenCalledWith(
                "park",
                [139.8, 35.8],
                600,
                mockPlayAreaBbox,
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
        });
    });

    // ─── Show 3 + "Show more" tests ──────────────────────────────────

    it("shows only first 3 candidates when more than 3 available", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: fiveCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("Nearest Park")).toBeTruthy();
            expect(screen.getByText("Farther Park")).toBeTruthy();
            expect(screen.getByText("Distant Park")).toBeTruthy();
            // Fourth and Fifth should NOT be visible in the main list
            expect(() => screen.getByText("Fourth Park")).toThrow();
            expect(() => screen.getByText("Fifth Park")).toThrow();
        });
    });

    it("shows 'Show more' button with correct count when > 3 candidates", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: fiveCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId("osm-matching-show-more")).toBeTruthy();
            expect(screen.getByText("Show more... (2 more)")).toBeTruthy();
        });
    });

    it("does not show 'Show more' when exactly 3 candidates", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: mockCandidates,
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("Distant Park")).toBeTruthy();
        });

        expect(() => screen.getByTestId("osm-matching-show-more")).toThrow();
    });

    it("progressive search is called with stationRadius and playArea bbox", async () => {
        const question: MatchingQuestion = {
            answer: "unanswered",
            candidates: [],
            category: "park",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: null,
            lineName: null,
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-30T00:00:00.000Z",
        };
        const onUpdate = jest.fn();

        render(<TestScreen initialQuestion={question} onUpdate={onUpdate} />);

        await waitFor(() => {
            expect(mockSearchMatchingFeaturesProgressive).toHaveBeenCalledWith(
                "park",
                mockPlayAreaCenter,
                600, // stationRadius from mocked useHidingZoneState
                mockPlayAreaBbox,
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
        });
    });
});

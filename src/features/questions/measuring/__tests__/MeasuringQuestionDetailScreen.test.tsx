import React from "react";
import {
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react-native";

import { FetchDebugScope } from "@/features/questions/matching/fetchDebug";
import { MeasuringQuestionDetailScreen } from "@/features/questions/measuring/MeasuringQuestionDetailScreen";
import type { MeasuringQuestion } from "@/features/questions/measuring/measuringTypes";
import type { QuestionState } from "@/features/questions/questionTypes";

const mockPlayAreaCenter: [number, number] = [139.75, 35.675];

const mockCandidates = [
    {
        distanceMeters: 1200,
        lat: 35.681,
        lon: 139.761,
        name: "Nearest Museum",
        osmId: 1,
        osmType: "node" as const,
        tags: {},
    },
    {
        distanceMeters: 2500,
        lat: 35.69,
        lon: 139.77,
        name: "Farther Museum",
        osmId: 2,
        osmType: "way" as const,
        tags: {},
    },
    {
        distanceMeters: 5000,
        lat: 35.71,
        lon: 139.79,
        name: "Distant Museum",
        osmId: 3,
        osmType: "relation" as const,
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
            bbox: [139.6, 35.55, 139.9, 35.8] as [
                number,
                number,
                number,
                number,
            ],
            center: [139.75, 35.675] as [number, number],
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
    initialQuestion: MeasuringQuestion;
    onUpdate: jest.Mock;
}) {
    const [question, setQuestion] =
        React.useState<MeasuringQuestion>(initialQuestion);

    React.useEffect(() => {
        setQuestion(initialQuestion);
    }, [initialQuestion]);

    const wrappedUpdate = jest.fn(
        (questionId: string, updater: (q: QuestionState) => QuestionState) => {
            const updated = updater(question) as MeasuringQuestion;
            setQuestion(updated);
            onUpdate(questionId, updater);
            return updated;
        },
    );

    return (
        <FetchDebugScope>
            <MeasuringQuestionDetailScreen
                question={question}
                updateQuestion={wrappedUpdate}
            />
        </FetchDebugScope>
    );
}

describe("MeasuringQuestionDetailScreen", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchMatchingFeaturesProgressive = jest.fn().mockResolvedValue({
            candidates: mockCandidates,
            source: "network",
            searchRadiusMeters: 6000,
        });
    });

    function makeQuestion(
        overrides: Partial<MeasuringQuestion> = {},
    ): MeasuringQuestion {
        return {
            answer: "unanswered",
            candidates: [],
            category: "museum",
            center: mockPlayAreaCenter,
            createdAt: "2026-05-30T00:00:00.000Z",
            id: "measuring-1",
            isLocked: false,
            seekerDistanceMeters: null,
            seekerDistanceUnit: "m",
            selectedOsmId: null,
            selectedOsmType: null,
            type: "measuring",
            updatedAt: "2026-05-30T00:00:00.000Z",
            ...overrides,
        };
    }

    it("renders the category picker with section labels", async () => {
        const question = makeQuestion();
        const onUpdate = jest.fn();

        render(<TestScreen initialQuestion={question} onUpdate={onUpdate} />);

        await waitFor(() => {
            // The current category "Museum" should appear in the picker
            expect(
                screen.getByTestId("measuring-category-museum"),
            ).toBeTruthy();
        });
    });

    it("shows the seeker position coordinates", async () => {
        const question = makeQuestion();
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId("measuring-center-summary")).toBeTruthy();
        });
    });

    it("auto-searches on mount and renders candidates sorted by distance", async () => {
        const question = makeQuestion();
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("Nearest Museum")).toBeTruthy();
            expect(screen.getByText("Farther Museum")).toBeTruthy();
            expect(screen.getByText("Distant Museum")).toBeTruthy();
        });
    });

    it("shows distance text for each candidate", async () => {
        const question = makeQuestion();
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("1.2 km")).toBeTruthy();
            expect(screen.getByText("2.5 km")).toBeTruthy();
            expect(screen.getByText("5.0 km")).toBeTruthy();
        });
    });

    it("highlights the selected candidate", async () => {
        const question = makeQuestion({
            candidates: mockCandidates,
            selectedOsmId: 2,
            selectedOsmType: "way",
            seekerDistanceMeters: 2500,
        });
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            const selectedRow = screen.getByTestId("measuring-candidate-2");
            expect(selectedRow).toBeTruthy();
        });
    });

    it("tapping candidate selects it and computes seekerDistanceMeters", async () => {
        const question = makeQuestion({ candidates: mockCandidates });
        const onUpdate = jest.fn((questionId, updater) => {
            return updater(question);
        });

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByText("Nearest Museum")).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId("measuring-candidate-1"));

        // The update should set selectedOsmId/Type and compute distance
        expect(onUpdate).toHaveBeenCalled();
        const lastCall = onUpdate.mock.calls.at(-1)!;
        const updater = lastCall[1];
        const result = updater(question) as MeasuringQuestion;
        expect(result.selectedOsmId).toBe(1);
        expect(result.selectedOsmType).toBe("node");
        expect(result.seekerDistanceMeters).toBeGreaterThan(0);
    });

    it("enables answer selector only when a POI is selected", async () => {
        const question = makeQuestion({
            candidates: mockCandidates,
            selectedOsmId: 1,
            selectedOsmType: "node",
            seekerDistanceMeters: 1200,
        });
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            // Answer selector buttons should not be disabled
            const closerButton = screen.getByTestId(
                "measuring-answer-option-positive",
            );
            expect(closerButton).toBeTruthy();
        });
    });

    it("disables answer selector when no POI is selected", async () => {
        const question = makeQuestion({ candidates: mockCandidates });
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            const closerButton = screen.getByTestId(
                "measuring-answer-option-positive",
            );
            expect(closerButton.props.accessibilityState.disabled).toBe(true);
        });
    });

    it("shows the planning phrase when a POI is selected", async () => {
        const question = makeQuestion({
            candidates: mockCandidates,
            selectedOsmId: 1,
            selectedOsmType: "node",
            seekerDistanceMeters: 1200,
        });
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            // Should contain the planning phrase text
            expect(screen.getByText(/I'm/)).toBeTruthy();
            expect(screen.getByText(/museum/)).toBeTruthy();
            expect(screen.getByText(/closer or farther/)).toBeTruthy();
        });
    });

    it("renders unit toggle buttons", async () => {
        const question = makeQuestion({
            candidates: mockCandidates,
            selectedOsmId: 1,
            selectedOsmType: "node",
            seekerDistanceMeters: 1200,
        });
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId("measuring-unit-m")).toBeTruthy();
            expect(screen.getByTestId("measuring-unit-km")).toBeTruthy();
            expect(screen.getByTestId("measuring-unit-mi")).toBeTruthy();
        });
    });

    it("unit toggle changes display unit without changing stored meters", async () => {
        const question = makeQuestion({
            candidates: mockCandidates,
            selectedOsmId: 1,
            selectedOsmType: "node",
            seekerDistanceMeters: 1200,
        });
        const onUpdate = jest.fn((questionId, updater) => {
            return updater(question);
        });

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId("measuring-unit-km")).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId("measuring-unit-km"));

        const lastCall = onUpdate.mock.calls.at(-1)!;
        const updater = lastCall[1];
        const result = updater(question) as MeasuringQuestion;
        expect(result.seekerDistanceUnit).toBe("km");
        // Meters should not change
        expect(result.seekerDistanceMeters).toBe(1200);
    });

    it("shows refresh button", async () => {
        const question = makeQuestion({ candidates: mockCandidates });
        const onUpdate = jest.fn();

        const screen = render(
            <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId("measuring-refresh")).toBeTruthy();
        });
    });
});

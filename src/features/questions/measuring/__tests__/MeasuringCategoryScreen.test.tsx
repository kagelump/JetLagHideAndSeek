import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";

import { defaultPlayArea } from "@/features/map/playArea";
import type { QuestionState } from "@/features/questions/questionTypes";
import { PlayAreaProvider, usePlayArea } from "@/state/playAreaStore";
import { QuestionProvider, useQuestions } from "@/state/questionStore";

import { MeasuringCategoryScreen } from "../MeasuringCategoryScreen";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRequestUserCoordinate = jest.fn();
jest.mock("@/shared/location", () => ({
    requestUserCoordinate: (...args: unknown[]) =>
        mockRequestUserCoordinate(...args),
}));

const mockGetLastKnownMapCenter = jest.fn();
jest.mock("@/features/map/mapCenter", () => ({
    getLastKnownMapCenter: (...args: unknown[]) =>
        mockGetLastKnownMapCenter(...args),
    setLastKnownMapCenter: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SetDefaultPlayArea() {
    const { importPlayArea } = usePlayArea();

    useEffect(() => {
        importPlayArea(defaultPlayArea);
    }, [importPlayArea]);

    return null;
}

function CurrentQuestionInspector({
    questionRef,
}: {
    questionRef: React.MutableRefObject<QuestionState | null>;
}) {
    const questions = useQuestions();

    useEffect(() => {
        questionRef.current = questions[questions.length - 1] ?? null;
    });

    return null;
}

function renderScreen() {
    const onNavigate = jest.fn();
    const questionRef = { current: null as QuestionState | null };

    const result = render(
        <PlayAreaProvider>
            <SetDefaultPlayArea />
            <QuestionProvider>
                <CurrentQuestionInspector questionRef={questionRef} />
                <MeasuringCategoryScreen onNavigate={onNavigate} />
            </QuestionProvider>
        </PlayAreaProvider>,
    );

    return { ...result, onNavigate, questionRef };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MeasuringCategoryScreen", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: no GPS coordinate, so the question keeps the play-area
        // fallback unless a test overrides this.
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: null,
            status: "denied" as const,
        });
        mockGetLastKnownMapCenter.mockReturnValue(null);
    });

    it("creates a measuring question with the selected category and navigates to question-detail", async () => {
        const { onNavigate, getByTestId, questionRef } = renderScreen();

        await act(async () => {
            fireEvent.press(getByTestId("measuring-category-museum"));
        });

        expect(onNavigate).toHaveBeenCalledWith("question-detail");
        expect(questionRef.current).toMatchObject({
            type: "measuring",
            category: "museum",
        });
    });

    it("uses the play-area center as the initial question center", async () => {
        // No GPS coordinate: the question should keep the play-area fallback.
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: null,
            status: "denied" as const,
        });

        const { getByTestId, questionRef } = renderScreen();

        await act(async () => {
            fireEvent.press(getByTestId("measuring-category-park"));
        });

        expect(questionRef.current).toMatchObject({
            type: "measuring",
            center: defaultPlayArea.center,
        });
    });

    it("patches the question center when requestUserCoordinate returns a coordinate", async () => {
        const gpsCoordinate: [number, number] = [139.7, 35.7];
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: gpsCoordinate,
            status: "granted" as const,
        });

        const { getByTestId, questionRef } = renderScreen();

        await act(async () => {
            fireEvent.press(getByTestId("measuring-category-library"));
        });

        await waitFor(() => {
            expect(questionRef.current).toMatchObject({
                center: gpsCoordinate,
            });
        });
    });
});

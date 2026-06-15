import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text, View } from "react-native";

import { ThermometerQuestionDetailScreen } from "@/features/questions/thermometer/ThermometerQuestionDetailScreen";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import {
    QuestionProvider,
    useQuestionActions,
    useQuestions,
} from "@/state/questionStore";

// ---------------------------------------------------------------------------
// Mock @/shared/location so tests control the GPS result deterministically.
// ---------------------------------------------------------------------------
const mockRequestUserCoordinate = jest.fn();

jest.mock("@/shared/location", () => ({
    requestUserCoordinate: (...args: unknown[]) =>
        mockRequestUserCoordinate(...args),
}));

// Mock useQuestionElimination — elimination math is tested separately.
jest.mock("@/features/questions/useQuestionElimination", () => ({
    useQuestionElimination: () => null,
}));

// Mock the spatial station lookup so the per-pin station label is deterministic.
const mockFindMatching = jest.fn();

jest.mock("@/features/questions/matching/osmMatchingCache", () => ({
    findMatchingFeaturesWithIndex: (...args: unknown[]) =>
        mockFindMatching(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeThermometerQuestion(
    overrides: Partial<ThermometerQuestion> = {},
): ThermometerQuestion {
    return {
        answer: "unanswered",
        createdAt: "2026-06-06T00:00:00.000Z",
        currentPosition: [139.72, 35.7],
        currentStation: null,
        id: "q-thermometer-1",
        isLocked: false,
        previousPosition: [139.7, 35.7],
        previousStation: null,
        type: "thermometer",
        updatedAt: "2026-06-06T00:00:00.000Z",
        ...overrides,
    };
}

function Probe() {
    const questions = useQuestions();
    const thermometerQuestion = questions.find(
        (q): q is ThermometerQuestion => q.type === "thermometer",
    );

    return (
        <View>
            {thermometerQuestion ? (
                <>
                    <Text testID="probe-question-answer">
                        {thermometerQuestion.answer}
                    </Text>
                    <Text testID="probe-start-lat">
                        {thermometerQuestion.previousPosition?.[1] ?? "null"}
                    </Text>
                    <Text testID="probe-start-lon">
                        {thermometerQuestion.previousPosition?.[0] ?? "null"}
                    </Text>
                </>
            ) : null}
        </View>
    );
}

function TestHarness({
    initialQuestion,
}: {
    initialQuestion: ThermometerQuestion;
}) {
    const { addImportedQuestion, updateQuestion, setActiveQuestionId } =
        useQuestionActions();
    const questions = useQuestions();
    const [seeded, setSeeded] = React.useState(false);

    React.useEffect(() => {
        if (!seeded) {
            const q = addImportedQuestion(initialQuestion);
            setActiveQuestionId(q.id);
            setSeeded(true);
        }
    }, [seeded, addImportedQuestion, setActiveQuestionId, initialQuestion]);

    const question = questions.find(
        (q): q is ThermometerQuestion => q.type === "thermometer",
    );

    if (!seeded || !question) {
        return null;
    }

    return (
        <>
            <ThermometerQuestionDetailScreen
                question={question}
                updateQuestion={updateQuestion}
            />
            <Probe />
        </>
    );
}

function renderWithProvider(initialQuestion: ThermometerQuestion) {
    return render(
        <QuestionProvider>
            <TestHarness initialQuestion={initialQuestion} />
        </QuestionProvider>,
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ThermometerQuestionDetailScreen", () => {
    beforeEach(() => {
        mockRequestUserCoordinate.mockReset();
        // Default: no station nearby. Individual tests override as needed.
        mockFindMatching.mockReset();
        mockFindMatching.mockResolvedValue({
            candidates: [],
            source: "memory",
        });
    });

    it("shows live distance between pins", async () => {
        const question = makeThermometerQuestion();
        const screen = renderWithProvider(question);

        await waitFor(() => {
            const distance = screen.getByTestId("thermometer-distance");
            expect(distance).toBeTruthy();
            const children = distance.props.children;
            const text = Array.isArray(children)
                ? children.join("")
                : String(children);
            expect(text).not.toContain("—");
            expect(text).toMatch(/\d+(\.\d+)?\s*km/);
        });
    });

    it("disables answer selector when degenerate", async () => {
        const question = makeThermometerQuestion({
            currentPosition: [139.7005, 35.7],
            previousPosition: [139.7, 35.7],
        });
        const screen = renderWithProvider(question);

        await waitFor(() => {
            expect(
                screen.getByTestId("thermometer-degenerate-warning"),
            ).toBeTruthy();
        });

        const positiveButton = screen.getByTestId(
            "thermometer-answer-option-positive",
        );
        expect(positiveButton.props.accessibilityState.disabled).toBe(true);
    });

    it("enables answer selector when not degenerate", async () => {
        const question = makeThermometerQuestion();
        const screen = renderWithProvider(question);

        await waitFor(() => {
            expect(
                screen.queryByTestId("thermometer-degenerate-warning"),
            ).toBeNull();
        });

        const positiveButton = screen.getByTestId(
            "thermometer-answer-option-positive",
        );
        expect(positiveButton.props.accessibilityState.disabled).toBeFalsy();
    });

    it("selecting Hotter updates the question answer", async () => {
        const question = makeThermometerQuestion();
        const screen = renderWithProvider(question);

        await waitFor(() => {
            expect(
                screen.getByTestId("thermometer-answer-option-positive"),
            ).toBeTruthy();
        });

        fireEvent.press(
            screen.getByTestId("thermometer-answer-option-positive"),
        );

        await waitFor(() => {
            expect(
                screen.getByTestId("probe-question-answer"),
            ).toHaveTextContent("positive");
        });

        const positiveButton = screen.getByTestId(
            "thermometer-answer-option-positive",
        );
        expect(positiveButton.props.accessibilityState.selected).toBe(true);
    });

    it("compact position display shows pin coordinates", async () => {
        const question = makeThermometerQuestion({
            previousPosition: [139.75, 35.75],
            currentPosition: [139.8, 35.8],
        });
        const screen = renderWithProvider(question);

        await waitFor(() => {
            expect(screen.getByTestId("thermometer-start-pos")).toBeTruthy();
            expect(screen.getByTestId("thermometer-end-pos")).toBeTruthy();
        });

        expect(screen.getByTestId("thermometer-start-pos")).toHaveTextContent(
            "(35.75000, 139.75000)",
        );
        expect(screen.getByTestId("thermometer-end-pos")).toHaveTextContent(
            "(35.80000, 139.80000)",
        );
    });

    it("shows the resolved station name and distance under each pin", async () => {
        mockFindMatching.mockResolvedValue({
            candidates: [{ name: "Shibuya", distanceMeters: 300 }],
            source: "memory",
        });
        const question = makeThermometerQuestion();
        const screen = renderWithProvider(question);

        await waitFor(() => {
            expect(
                screen.getByTestId("thermometer-start-station"),
            ).toHaveTextContent("Shibuya (300 m)");
            expect(
                screen.getByTestId("thermometer-end-station"),
            ).toHaveTextContent("Shibuya (300 m)");
        });
    });

    it("shows 'No station nearby' when the lookup finds nothing", async () => {
        // beforeEach already stubs an empty candidate list.
        const question = makeThermometerQuestion();
        const screen = renderWithProvider(question);

        await waitFor(() => {
            expect(
                screen.getByTestId("thermometer-start-station"),
            ).toHaveTextContent("No station nearby");
        });
    });
});

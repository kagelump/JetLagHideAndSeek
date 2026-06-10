import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text, View } from "react-native";

import { ThermometerQuestionDetailScreen } from "@/features/questions/thermometer/ThermometerQuestionDetailScreen";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import {
    QuestionProvider,
    useActivePinKey,
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
        id: "q-thermometer-1",
        isLocked: false,
        previousPosition: [139.7, 35.7],
        type: "thermometer",
        updatedAt: "2026-06-06T00:00:00.000Z",
        ...overrides,
    };
}

function Probe() {
    const activePinKey = useActivePinKey();
    const questions = useQuestions();
    const thermometerQuestion = questions.find(
        (q): q is ThermometerQuestion => q.type === "thermometer",
    );

    return (
        <View>
            <Text testID="probe-active-pin-key">{activePinKey ?? "null"}</Text>
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
    });

    it("renders both pin rows and toggles active pin", async () => {
        const question = makeThermometerQuestion();
        const screen = renderWithProvider(question);

        await waitFor(() => {
            expect(
                screen.getByTestId("thermometer-active-pin-start"),
            ).toBeTruthy();
            expect(
                screen.getByTestId("thermometer-active-pin-end"),
            ).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId("thermometer-active-pin-start"));
        await waitFor(() => {
            expect(
                screen.getByTestId("probe-active-pin-key"),
            ).toHaveTextContent("start");
        });

        fireEvent.press(screen.getByTestId("thermometer-active-pin-end"));
        await waitFor(() => {
            expect(
                screen.getByTestId("probe-active-pin-key"),
            ).toHaveTextContent("end");
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
            "35.7500, 139.7500",
        );
        expect(screen.getByTestId("thermometer-end-pos")).toHaveTextContent(
            "35.8000, 139.8000",
        );
    });
});

import React, { useEffect, useRef } from "react";
import { render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { loadHidingZonePresets } from "@/features/hidingZone/hidingZoneData";
import type { TransitLineQuestion } from "@/features/questions/transitLine/transitLineTypes";
import { AppStateProviders } from "@/state/AppStateProviders";
import { useQuestionActions, useQuestions } from "@/state/questionStore";
import { queryClient } from "@/state/queryClient";

import { TransitLineQuestionDetailScreen } from "../TransitLineQuestionDetailScreen";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTransitLineQuestion(
    center: [number, number] = [139.76, 35.68],
): TransitLineQuestion {
    return {
        answer: "unanswered",
        candidates: [],
        category: "transit-line",
        center,
        createdAt: new Date().toISOString(),
        id: "tl-1",
        isLocked: false,
        lineId: null,
        lineName: null,
        selectedOsmId: null,
        selectedOsmType: null,
        targetName: null,
        targetOsmId: null,
        targetOsmType: null,
        type: "matching",
        updatedAt: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Wrapper — imports the question on mount so the screen can find it.
// ---------------------------------------------------------------------------

function TransitLineScreenWrapper({
    question: initialQuestion,
}: {
    question: TransitLineQuestion;
}) {
    const { importQuestions, updateQuestion } = useQuestionActions();
    const questions = useQuestions();
    const didImport = useRef(false);

    useEffect(() => {
        if (!didImport.current) {
            didImport.current = true;
            importQuestions([initialQuestion]);
        }
    }, []);

    const question = questions.find((q) => q.id === initialQuestion.id);
    if (!question || question.type !== "matching") {
        return null;
    }

    return (
        <TransitLineQuestionDetailScreen
            question={question}
            updateQuestion={updateQuestion}
        />
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TransitLineQuestionDetailScreen", () => {
    beforeAll(() => loadHidingZonePresets());

    beforeEach(() => {
        jest.clearAllMocks();
        queryClient.clear();
    });

    it("renders the center coordinate and answer section", async () => {
        const question = makeTransitLineQuestion();
        const screen = render(
            <SafeAreaProvider
                initialMetrics={{
                    frame: { height: 844, width: 390, x: 0, y: 0 },
                    insets: { bottom: 34, left: 0, right: 0, top: 47 },
                }}
            >
                <AppStateProviders>
                    <TransitLineScreenWrapper question={question} />
                </AppStateProviders>
            </SafeAreaProvider>,
        );

        // The wrapper needs an effect cycle to import the question and
        // another to re-render with it found.  Wait for it.
        await screen.findByTestId("transit-line-center-summary");

        expect(
            screen.getByTestId("matching-answer-option-unanswered"),
        ).toBeTruthy();
        expect(
            screen.getByTestId("matching-answer-option-positive"),
        ).toBeTruthy();
        expect(
            screen.getByTestId("matching-answer-option-negative"),
        ).toBeTruthy();
    });

    it("disables answer options when no line is selected", async () => {
        const question = makeTransitLineQuestion();
        const screen = render(
            <SafeAreaProvider
                initialMetrics={{
                    frame: { height: 844, width: 390, x: 0, y: 0 },
                    insets: { bottom: 34, left: 0, right: 0, top: 47 },
                }}
            >
                <AppStateProviders>
                    <TransitLineScreenWrapper question={question} />
                </AppStateProviders>
            </SafeAreaProvider>,
        );

        await screen.findByTestId("matching-answer-option-positive");

        expect(
            screen.getByTestId("matching-answer-option-positive").props
                .accessibilityState,
        ).toEqual({ disabled: true, selected: false });
        expect(
            screen.getByTestId("matching-answer-option-negative").props
                .accessibilityState,
        ).toEqual({ disabled: true, selected: false });
    });

    it("does not show the set-to-location button", async () => {
        const question = makeTransitLineQuestion();
        const screen = render(
            <SafeAreaProvider
                initialMetrics={{
                    frame: { height: 844, width: 390, x: 0, y: 0 },
                    insets: { bottom: 34, left: 0, right: 0, top: 47 },
                }}
            >
                <AppStateProviders>
                    <TransitLineScreenWrapper question={question} />
                </AppStateProviders>
            </SafeAreaProvider>,
        );

        await screen.findByTestId("transit-line-center-summary");

        expect(
            screen.queryByTestId("transit-line-set-to-location-button"),
        ).toBeNull();
    });
});

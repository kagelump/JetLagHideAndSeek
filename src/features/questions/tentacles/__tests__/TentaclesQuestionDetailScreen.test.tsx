import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text, View } from "react-native";

import { TentaclesQuestionDetailScreen } from "@/features/questions/tentacles/TentaclesQuestionDetailScreen";
import type { TentaclesQuestion } from "@/features/questions/tentacles/tentaclesTypes";
import {
    QuestionProvider,
    useQuestionActions,
    useQuestions,
} from "@/state/questionStore";

// ---------------------------------------------------------------------------
// Mock useTentaclesSearch to return controlled data deterministically.
// ---------------------------------------------------------------------------
jest.mock("../useTentaclesSearch", () => ({
    useTentaclesSearch: jest.fn(() => ({
        isLoading: false,
        error: null,
        performSearch: jest.fn(async () => [
            {
                lat: 35.71,
                lon: 139.77,
                name: "Tokyo Museum",
                osmId: 1,
                osmType: "node" as const,
                tags: { tourism: "museum" },
                distanceMeters: 800,
            },
            {
                lat: 35.72,
                lon: 139.78,
                name: "Edo Museum",
                osmId: 2,
                osmType: "node" as const,
                tags: { tourism: "museum" },
                distanceMeters: 1100,
            },
        ]),
    })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(
    overrides: Partial<TentaclesQuestion> = {},
): TentaclesQuestion {
    return {
        answer: "unanswered",
        candidates: [],
        category: "museum",
        center: [139.76, 35.68],
        createdAt: "2026-06-07T00:00:00.000Z",
        distanceMeters: 2000,
        distanceOption: "2km",
        id: "q-tentacles-1",
        isLocked: false,
        selectedOsmId: null,
        selectedOsmType: null,
        selectedName: null,
        type: "tentacles",
        updatedAt: "2026-06-07T00:00:00.000Z",
        ...overrides,
    };
}

function Probe() {
    const questions = useQuestions();
    const tentaclesQuestion = questions.find(
        (q): q is TentaclesQuestion => q.type === "tentacles",
    );
    return (
        <View>
            <Text testID="probe-answer">
                {tentaclesQuestion?.answer ?? "none"}
            </Text>
            <Text testID="probe-selected-name">
                {tentaclesQuestion?.selectedName ?? "none"}
            </Text>
            <Text testID="probe-category">
                {tentaclesQuestion?.category ?? "none"}
            </Text>
            <Text testID="probe-distance-option">
                {tentaclesQuestion?.distanceOption ?? "none"}
            </Text>
            <Text testID="probe-candidates-count">
                {String(tentaclesQuestion?.candidates.length ?? 0)}
            </Text>
        </View>
    );
}

function TestHarness({
    initialQuestion,
}: {
    initialQuestion: TentaclesQuestion;
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
        (q): q is TentaclesQuestion => q.type === "tentacles",
    );

    if (!seeded || !question) {
        return null;
    }

    return (
        <>
            <TentaclesQuestionDetailScreen
                question={question}
                updateQuestion={updateQuestion}
            />
            <Probe />
        </>
    );
}

function renderWithProvider(initialQuestion: TentaclesQuestion) {
    return render(
        <QuestionProvider>
            <TestHarness initialQuestion={initialQuestion} />
        </QuestionProvider>,
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TentaclesQuestionDetailScreen", () => {
    it("renders category picker with all 8 categories", async () => {
        const q = makeQuestion();
        const screen = renderWithProvider(q);

        await waitFor(() => {
            expect(
                screen.getByTestId("tentacles-category-museum"),
            ).toBeTruthy();
            expect(
                screen.getByTestId("tentacles-category-library"),
            ).toBeTruthy();
            expect(screen.getByTestId("tentacles-category-zoo")).toBeTruthy();
            expect(
                screen.getByTestId("tentacles-category-transit-line"),
            ).toBeTruthy();
        });
    });

    it("picking a category sets distanceOption and distanceMeters", async () => {
        const q = makeQuestion();
        const screen = renderWithProvider(q);

        await waitFor(() => {
            expect(screen.getByTestId("tentacles-category-zoo")).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId("tentacles-category-zoo"));

        await waitFor(() => {
            expect(screen.getByTestId("probe-category")).toHaveTextContent(
                "zoo",
            );
            expect(
                screen.getByTestId("probe-distance-option"),
            ).toHaveTextContent("25km");
        });
    });

    it("shows 'Searching within' label with correct distance", () => {
        const q = makeQuestion();
        const screen = renderWithProvider(q);

        expect(screen.getByText(/Searching within/)).toBeTruthy();
    });

    it("renders candidate list as the answer affordance", async () => {
        const q = makeQuestion({
            candidates: [
                {
                    lat: 35.71,
                    lon: 139.77,
                    name: "Tokyo Museum",
                    osmId: 1,
                    osmType: "node",
                    tags: { tourism: "museum" },
                    distanceMeters: 800,
                },
            ],
        });
        const screen = renderWithProvider(q);

        await waitFor(() => {
            expect(screen.getByTestId("tentacles-candidate-1")).toBeTruthy();
            expect(screen.getByText("Tokyo Museum")).toBeTruthy();
        });
    });

    it("does NOT mount a QuestionAnswerSelector", () => {
        const q = makeQuestion();
        const screen = renderWithProvider(q);

        // The answer selector testIDs use a "question-answer-option-" prefix.
        // The tentacles screen should NOT render these.
        expect(
            screen.queryByTestId("tentacles-answer-option-positive"),
        ).toBeNull();
    });

    it("selecting a candidate sets selectedOsmId, selectedName, and answer", async () => {
        const q = makeQuestion({
            candidates: [
                {
                    lat: 35.71,
                    lon: 139.77,
                    name: "Tokyo Museum",
                    osmId: 1,
                    osmType: "node",
                    tags: { tourism: "museum" },
                    distanceMeters: 800,
                },
            ],
        });
        const screen = renderWithProvider(q);

        await waitFor(() => {
            expect(screen.getByTestId("tentacles-candidate-1")).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId("tentacles-candidate-1"));

        await waitFor(() => {
            expect(screen.getByTestId("probe-answer")).toHaveTextContent(
                "positive",
            );
            expect(screen.getByTestId("probe-selected-name")).toHaveTextContent(
                "Tokyo Museum",
            );
        });
    });

    it("selected candidate shows answer section with selectedName and Reset", async () => {
        const q = makeQuestion({
            candidates: [
                {
                    lat: 35.71,
                    lon: 139.77,
                    name: "Tokyo Museum",
                    osmId: 1,
                    osmType: "node",
                    tags: { tourism: "museum" },
                    distanceMeters: 800,
                },
            ],
        });
        const screen = renderWithProvider(q);

        // Select the candidate first (this calls selectTentaclesPoi).
        await waitFor(() => {
            expect(screen.getByTestId("tentacles-candidate-1")).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId("tentacles-candidate-1"));

        // Now the answer section should appear with the Reset button.
        await waitFor(() => {
            expect(screen.getByTestId("tentacles-reset-answer")).toBeTruthy();
        });

        // And the probe should reflect the selection.
        expect(screen.getByTestId("probe-answer")).toHaveTextContent(
            "positive",
        );
        expect(screen.getByTestId("probe-selected-name")).toHaveTextContent(
            "Tokyo Museum",
        );
    });

    it("reset clears selection and sets answer to unanswered", async () => {
        const q = makeQuestion({
            candidates: [
                {
                    lat: 35.71,
                    lon: 139.77,
                    name: "Tokyo Museum",
                    osmId: 1,
                    osmType: "node",
                    tags: { tourism: "museum" },
                    distanceMeters: 800,
                },
            ],
        });
        const screen = renderWithProvider(q);

        // Select a candidate first.
        await waitFor(() => {
            expect(screen.getByTestId("tentacles-candidate-1")).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId("tentacles-candidate-1"));

        // Wait for the reset button.
        await waitFor(() => {
            expect(screen.getByTestId("tentacles-reset-answer")).toBeTruthy();
        });

        // Now reset.
        fireEvent.press(screen.getByTestId("tentacles-reset-answer"));

        await waitFor(() => {
            expect(screen.getByTestId("probe-answer")).toHaveTextContent(
                "unanswered",
            );
            expect(screen.getByTestId("probe-selected-name")).toHaveTextContent(
                "none",
            );
        });
    });

    it("shows no-candidates message when candidates list is empty", () => {
        const q = makeQuestion({ candidates: [] });
        const screen = renderWithProvider(q);

        expect(
            screen.getByText("No candidates found within range."),
        ).toBeTruthy();
    });
});

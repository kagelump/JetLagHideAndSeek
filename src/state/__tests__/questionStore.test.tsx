import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, Text, View } from "react-native";

import { defaultPlayArea } from "@/features/map/playArea";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import { createAppStateV1 } from "@/state/appState";
import { AppStateProviders } from "@/state/AppStateProviders";
import { loadPersistedAppState, persistAppState } from "@/state/persistence";
import {
    updateRadarAnswer,
    updateRadarDistanceOption,
    updateQuestionCenter,
    updateThermometerPin,
    useGameMode,
    useQuestionActions,
    useQuestionDerived,
    useQuestionIds,
    useQuestionState,
    useQuestions,
} from "@/state/questionStore";

function Probe() {
    const { activeQuestionId, isRestored } = useQuestionState();
    const questions = useQuestions();
    const { activeQuestion } = useQuestionDerived();
    const {
        createQuestion,
        deleteQuestion,
        setActiveQuestionId,
        updateQuestion,
    } = useQuestionActions();

    return (
        <View>
            <Text testID="probe-restored">{String(isRestored)}</Text>
            <Text testID="probe-count">{questions.length}</Text>
            <Text testID="probe-active-id">{activeQuestionId ?? "none"}</Text>
            <Text testID="probe-question-ids">
                {questions.map((question) => question.id).join(",")}
            </Text>
            <Text testID="probe-distance">
                {activeQuestion?.type === "radar"
                    ? activeQuestion.distanceMeters
                    : "none"}
            </Text>
            <Text testID="probe-option">
                {activeQuestion?.type === "radar"
                    ? activeQuestion.distanceOption
                    : "none"}
            </Text>
            <Text testID="probe-answer">
                {activeQuestion?.type === "radar"
                    ? activeQuestion.answer
                    : "none"}
            </Text>
            <Text testID="probe-center">
                {activeQuestion && "center" in activeQuestion
                    ? activeQuestion.center.join(",")
                    : "none"}
            </Text>
            <Text testID="probe-matching-center">
                {activeQuestion?.type === "matching"
                    ? activeQuestion.center.join(",")
                    : "none"}
            </Text>
            <Text testID="probe-matching-candidates">
                {activeQuestion?.type === "matching"
                    ? JSON.stringify(activeQuestion.candidates)
                    : "none"}
            </Text>
            <Text testID="probe-matching-selected-osm-id">
                {activeQuestion?.type === "matching"
                    ? JSON.stringify(activeQuestion.selectedOsmId)
                    : "none"}
            </Text>
            <Text testID="probe-matching-selected-osm-type">
                {activeQuestion?.type === "matching"
                    ? JSON.stringify(activeQuestion.selectedOsmType)
                    : "none"}
            </Text>
            <Text testID="probe-first-answer">
                {questions[0]?.type === "radar" ? questions[0].answer : "none"}
            </Text>
            <Text testID="probe-first-type">
                {questions[0]?.type ?? "none"}
            </Text>
            <Text testID="probe-type">{activeQuestion?.type ?? "none"}</Text>
            <Text testID="probe-measuring-category">
                {activeQuestion?.type === "measuring"
                    ? activeQuestion.category
                    : "none"}
            </Text>
            <Text testID="probe-measuring-answer">
                {activeQuestion?.type === "measuring"
                    ? activeQuestion.answer
                    : "none"}
            </Text>
            <Text testID="probe-thermometer-answer">
                {activeQuestion?.type === "thermometer"
                    ? activeQuestion.answer
                    : "none"}
            </Text>
            <Text testID="probe-thermometer-previous-position">
                {activeQuestion?.type === "thermometer"
                    ? JSON.stringify(activeQuestion.previousPosition)
                    : "none"}
            </Text>
            <Text testID="probe-thermometer-current-position">
                {activeQuestion?.type === "thermometer"
                    ? JSON.stringify(activeQuestion.currentPosition)
                    : "none"}
            </Text>
            <Text testID="probe-thermometer-updated-at">
                {activeQuestion?.type === "thermometer"
                    ? activeQuestion.updatedAt
                    : "none"}
            </Text>
            <Text testID="probe-tentacles-category">
                {activeQuestion?.type === "tentacles"
                    ? activeQuestion.category
                    : "none"}
            </Text>
            <Text testID="probe-tentacles-answer">
                {activeQuestion?.type === "tentacles"
                    ? activeQuestion.answer
                    : "none"}
            </Text>
            <Text testID="probe-tentacles-candidates">
                {activeQuestion?.type === "tentacles"
                    ? JSON.stringify(activeQuestion.candidates)
                    : "none"}
            </Text>
            <Text testID="probe-tentacles-selected-osm-id">
                {activeQuestion?.type === "tentacles"
                    ? JSON.stringify(activeQuestion.selectedOsmId)
                    : "none"}
            </Text>
            <Text testID="probe-tentacles-selected-name">
                {activeQuestion?.type === "tentacles"
                    ? JSON.stringify(activeQuestion.selectedName)
                    : "none"}
            </Text>
            <Text testID="probe-tentacles-distance-meters">
                {activeQuestion?.type === "tentacles"
                    ? activeQuestion.distanceMeters
                    : "none"}
            </Text>
            <Text testID="probe-tentacles-distance-option">
                {activeQuestion?.type === "tentacles"
                    ? activeQuestion.distanceOption
                    : "none"}
            </Text>
            <Pressable
                accessibilityRole="button"
                testID="action-create"
                onPress={() =>
                    createQuestion("radar", { center: defaultPlayArea.center })
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-lock-question"
                onPress={() =>
                    activeQuestion
                        ? updateQuestion(activeQuestion.id, (q) => ({
                              ...q,
                              isLocked: true,
                              updatedAt: new Date().toISOString(),
                          }))
                        : null
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-create-matching"
                onPress={() =>
                    createQuestion("matching", {
                        center: defaultPlayArea.center,
                    })
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-create-measuring"
                onPress={() =>
                    createQuestion("measuring", {
                        center: defaultPlayArea.center,
                        category: "rail-station",
                    })
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-create-thermometer"
                onPress={() =>
                    createQuestion("thermometer", {
                        center: defaultPlayArea.center,
                    })
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-create-tentacles"
                onPress={() =>
                    createQuestion("tentacles", {
                        center: defaultPlayArea.center,
                        category: "museum",
                    })
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-delete-active"
                onPress={() =>
                    activeQuestion ? deleteQuestion(activeQuestion.id) : null
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-delete-first"
                onPress={() =>
                    questions[0] ? deleteQuestion(questions[0].id) : null
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-delete-unknown"
                onPress={() => deleteQuestion("q-missing")}
            />
            <Pressable
                accessibilityRole="button"
                testID="action-clear-active"
                onPress={() => setActiveQuestionId(null)}
            />
            <Pressable
                accessibilityRole="button"
                testID="action-option-1km"
                onPress={() =>
                    activeQuestion
                        ? updateQuestion(activeQuestion.id, (question) =>
                              question.type === "radar"
                                  ? updateRadarDistanceOption(question, "1km")
                                  : question,
                          )
                        : null
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-answer-hit"
                onPress={() =>
                    activeQuestion
                        ? updateQuestion(activeQuestion.id, (question) =>
                              question.type === "radar"
                                  ? updateRadarAnswer(question, "positive")
                                  : question,
                          )
                        : null
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-center-shibuya"
                onPress={() =>
                    activeQuestion
                        ? updateQuestion(activeQuestion.id, (question) =>
                              updateQuestionCenter(question, [139.7, 35.66]),
                          )
                        : null
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-update-thermometer-start"
                onPress={() =>
                    activeQuestion?.type === "thermometer"
                        ? updateQuestion(activeQuestion.id, (question) =>
                              updateThermometerPin(
                                  question as ThermometerQuestion,
                                  "start",
                                  [139.7, 35.66],
                              ),
                          )
                        : null
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-update-thermometer-end"
                onPress={() =>
                    activeQuestion?.type === "thermometer"
                        ? updateQuestion(activeQuestion.id, (question) =>
                              updateThermometerPin(
                                  question as ThermometerQuestion,
                                  "end",
                                  [139.701, 35.661],
                              ),
                          )
                        : null
                }
            />
        </View>
    );
}

function QuestionIdsProbe({
    onRender,
}: {
    onRender: (questionIds: string[]) => void;
}) {
    const questionIds = useQuestionIds();
    onRender(questionIds);
    return null;
}

function renderProvider() {
    return render(
        <AppStateProviders>
            <Probe />
        </AppStateProviders>,
    );
}

describe("QuestionProvider", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it("creates a default 500m radar question", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-distance")).toHaveTextContent("500");
        expect(screen.getByTestId("probe-option")).toHaveTextContent("500m");
        expect(screen.getByTestId("probe-answer")).toHaveTextContent(
            "unanswered",
        );
    });

    it("creates a transit line question at the provided center", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-matching"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-matching-center")).toHaveTextContent(
            defaultPlayArea.center.join(","),
        );
        expect(
            screen.getByTestId("probe-matching-candidates"),
        ).toHaveTextContent("[]");
        expect(
            screen.getByTestId("probe-matching-selected-osm-id"),
        ).toHaveTextContent("null");
        expect(
            screen.getByTestId("probe-matching-selected-osm-type"),
        ).toHaveTextContent("null");
    });

    it("updates question centers generically", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-matching"));
        });
        act(() => {
            fireEvent.press(screen.getByTestId("action-center-shibuya"));
        });

        expect(screen.getByTestId("probe-center")).toHaveTextContent(
            "139.7,35.66",
        );
    });

    it("keeps the question id subscription stable when one question changes", async () => {
        const onQuestionIdsRender = jest.fn();
        const screen = render(
            <AppStateProviders>
                <Probe />
                <QuestionIdsProbe onRender={onQuestionIdsRender} />
            </AppStateProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });
        const rendersAfterCreate = onQuestionIdsRender.mock.calls.length;
        const questionIdsAfterCreate = onQuestionIdsRender.mock
            .lastCall?.[0] as string[];

        act(() => {
            fireEvent.press(screen.getByTestId("action-option-1km"));
        });

        expect(onQuestionIdsRender).toHaveBeenCalledTimes(rendersAfterCreate);
        expect(onQuestionIdsRender.mock.lastCall?.[0]).toBe(
            questionIdsAfterCreate,
        );
    });

    it("updates preset radar distance options and persists questions", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });
        act(() => {
            fireEvent.press(screen.getByTestId("action-option-1km"));
        });

        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            const first = persisted?.questions[0];
            expect(
                first && first.type === "radar" ? first.distanceMeters : null,
            ).toBe(1000);
            expect(
                first && first.type === "radar" ? first.distanceOption : null,
            ).toBe("1km");
        });
    });

    it("updates radar answers and persists questions", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });
        act(() => {
            fireEvent.press(screen.getByTestId("action-answer-hit"));
        });

        expect(screen.getByTestId("probe-answer")).toHaveTextContent(
            "positive",
        );
        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            expect(persisted?.questions[0].answer).toBe("positive");
        });
    });

    it("restores persisted radar questions", async () => {
        await persistAppState(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: 600,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
                playArea: defaultPlayArea,
                questions: [
                    {
                        answer: "negative",
                        center: defaultPlayArea.center,
                        createdAt: "2026-05-18T00:00:00.000Z",
                        distanceMeters: 2000,
                        distanceOption: "2km",
                        distanceUnit: "m",
                        id: "q-1",
                        isLocked: false,
                        type: "radar",
                        updatedAt: "2026-05-18T00:00:00.000Z",
                    },
                ],
            }),
        );

        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-first-answer")).toHaveTextContent(
            "negative",
        );
    });

    it("restores external question ids without object-prototype collisions", async () => {
        await persistAppState(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: 600,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
                playArea: defaultPlayArea,
                questions: [
                    {
                        answer: "negative",
                        center: defaultPlayArea.center,
                        createdAt: "2026-05-18T00:00:00.000Z",
                        distanceMeters: 2000,
                        distanceOption: "2km",
                        distanceUnit: "m",
                        id: "__proto__",
                        isLocked: false,
                        type: "radar",
                        updatedAt: "2026-05-18T00:00:00.000Z",
                    },
                ],
            }),
        );

        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-question-ids")).toHaveTextContent(
            "__proto__",
        );
        expect(screen.getByTestId("probe-first-answer")).toHaveTextContent(
            "negative",
        );
    });

    it("deletes the active question and clears the active id", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });
        const questionId = screen.getByTestId("probe-active-id").props.children;

        act(() => {
            fireEvent.press(screen.getByTestId("action-delete-active"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("0");
        expect(screen.getByTestId("probe-active-id")).toHaveTextContent("none");
        expect(screen.getByTestId("probe-question-ids")).not.toHaveTextContent(
            questionId,
        );
    });

    it("preserves the active question when deleting a different question", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
            fireEvent.press(screen.getByTestId("action-create"));
        });
        const activeQuestionId =
            screen.getByTestId("probe-active-id").props.children;

        act(() => {
            fireEvent.press(screen.getByTestId("action-delete-first"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-active-id")).toHaveTextContent(
            activeQuestionId,
        );
    });

    it("ignores unknown question ids", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });
        const questionIds =
            screen.getByTestId("probe-question-ids").props.children;

        act(() => {
            fireEvent.press(screen.getByTestId("action-delete-unknown"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-question-ids")).toHaveTextContent(
            questionIds,
        );
    });

    it("persists deleted questions", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });
        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            expect(persisted?.questions).toHaveLength(1);
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-delete-active"));
        });

        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            expect(persisted?.questions).toEqual([]);
        });
    });

    it("persists per-question pin lock", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-lock-question"));
        });

        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            const first = persisted?.questions[0];
            expect(first && "isLocked" in first ? first.isLocked : null).toBe(
                true,
            );
        });
    });

    it("persists active-question navigation changes", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });
        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            expect(persisted?.questionSettings.activeQuestionId).not.toBeNull();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-clear-active"));
        });

        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            expect(persisted?.questionSettings.activeQuestionId).toBeNull();
        });
    });

    it("flushes pending persistence when the provider unmounts", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create"));
        });
        screen.unmount();

        await waitFor(async () => {
            await expect(loadPersistedAppState()).resolves.toMatchObject({
                questions: [{ type: "radar" }],
            });
        });
    });
});

// ---------------------------------------------------------------------------
// Task 01: measuring, thermometer, tentacles creation + updateQuestionCenter
// ---------------------------------------------------------------------------

describe("QuestionProvider – new question types", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it("creates a well-formed measuring question", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-measuring"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-type")).toHaveTextContent("measuring");
        expect(screen.getByTestId("probe-measuring-answer")).toHaveTextContent(
            "unanswered",
        );
        expect(
            screen.getByTestId("probe-measuring-category"),
        ).toHaveTextContent("rail-station");
        expect(screen.getByTestId("probe-center")).toHaveTextContent(
            defaultPlayArea.center.join(","),
        );
    });

    it("creates a thermometer question with co-located positions", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-thermometer"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-type")).toHaveTextContent(
            "thermometer",
        );
        expect(
            screen.getByTestId("probe-thermometer-answer"),
        ).toHaveTextContent("unanswered");
        const prevPos = JSON.parse(
            screen.getByTestId("probe-thermometer-previous-position").props
                .children,
        );
        const currPos = JSON.parse(
            screen.getByTestId("probe-thermometer-current-position").props
                .children,
        );
        expect(prevPos).toEqual(defaultPlayArea.center);
        expect(currPos[0]).toBeGreaterThan(defaultPlayArea.center[0]);
        expect(currPos[1]).toBeCloseTo(defaultPlayArea.center[1], 3);
    });

    it("creates a tentacles question with distance derived from category", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-tentacles"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-type")).toHaveTextContent("tentacles");
        expect(screen.getByTestId("probe-tentacles-answer")).toHaveTextContent(
            "unanswered",
        );
        expect(
            screen.getByTestId("probe-tentacles-candidates"),
        ).toHaveTextContent("[]");
        expect(
            screen.getByTestId("probe-tentacles-selected-osm-id"),
        ).toHaveTextContent("null");
        expect(
            screen.getByTestId("probe-tentacles-selected-name"),
        ).toHaveTextContent("null");
        expect(
            screen.getByTestId("probe-tentacles-category"),
        ).toHaveTextContent("museum");
        expect(
            screen.getByTestId("probe-tentacles-distance-option"),
        ).toHaveTextContent("2km");
        expect(
            screen.getByTestId("probe-tentacles-distance-meters"),
        ).toHaveTextContent("2000");
        expect(screen.getByTestId("probe-center")).toHaveTextContent(
            defaultPlayArea.center.join(","),
        );
    });

    it("updateQuestionCenter updates measuring center", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-measuring"));
        });
        act(() => {
            fireEvent.press(screen.getByTestId("action-center-shibuya"));
        });

        expect(screen.getByTestId("probe-center")).toHaveTextContent(
            "139.7,35.66",
        );
    });

    it("updateQuestionCenter updates tentacles center", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-tentacles"));
        });
        act(() => {
            fireEvent.press(screen.getByTestId("action-center-shibuya"));
        });

        expect(screen.getByTestId("probe-center")).toHaveTextContent(
            "139.7,35.66",
        );
    });

    it("updateQuestionCenter does not change thermometer", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-thermometer"));
        });
        act(() => {
            fireEvent.press(screen.getByTestId("action-center-shibuya"));
        });

        const prevPos = JSON.parse(
            screen.getByTestId("probe-thermometer-previous-position").props
                .children,
        );
        const currPos = JSON.parse(
            screen.getByTestId("probe-thermometer-current-position").props
                .children,
        );
        expect(prevPos).toEqual(defaultPlayArea.center);
        expect(currPos[0]).toBeGreaterThan(defaultPlayArea.center[0]);
        expect(currPos[1]).toBeCloseTo(defaultPlayArea.center[1], 3);
    });

    it("updateThermometerPin updates only the targeted pin and bumps updatedAt", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-create-thermometer"));
        });

        act(() => {
            fireEvent.press(
                screen.getByTestId("action-update-thermometer-end"),
            );
        });

        expect(
            screen.getByTestId("probe-thermometer-current-position"),
        ).toHaveTextContent("[139.701,35.661]");
        const prevPos = JSON.parse(
            screen.getByTestId("probe-thermometer-previous-position").props
                .children,
        );
        expect(prevPos).toEqual(defaultPlayArea.center);
        expect(
            screen.getByTestId("probe-thermometer-updated-at").props.children,
        ).not.toBe("none");
    });
});

// ---------------------------------------------------------------------------
// addImportedQuestion, gameMode, and importQuestionSettings
// ---------------------------------------------------------------------------

function GameModeProbe() {
    const gameMode = useGameMode();
    const questions = useQuestions();
    const { activeQuestion } = useQuestionDerived();
    const { addImportedQuestion, importQuestionSettings, setGameMode } =
        useQuestionActions();

    return (
        <View>
            <Text testID="probe-game-mode">{gameMode}</Text>
            <Text testID="probe-count">{questions.length}</Text>
            <Text testID="probe-active-id">{activeQuestion?.id ?? "none"}</Text>
            <Text testID="probe-question-ids">
                {questions.map((q) => q.id).join(",")}
            </Text>
            <Text testID="probe-first-answer">
                {questions[0]?.answer ?? "none"}
            </Text>
            <Text testID="probe-first-type">
                {questions[0]?.type ?? "none"}
            </Text>
            <Text testID="probe-tentacles-selected-osm-id">
                {questions[0]?.type === "tentacles"
                    ? JSON.stringify(questions[0].selectedOsmId)
                    : "none"}
            </Text>
            <Text testID="probe-tentacles-selected-name">
                {questions[0]?.type === "tentacles"
                    ? JSON.stringify(questions[0].selectedName)
                    : "none"}
            </Text>
            <Pressable
                accessibilityRole="button"
                testID="action-set-hider"
                onPress={() => setGameMode("hider")}
            />
            <Pressable
                accessibilityRole="button"
                testID="action-set-seeker"
                onPress={() => setGameMode("seeker")}
            />
            <Pressable
                accessibilityRole="button"
                testID="action-add-imported-radar"
                onPress={() =>
                    addImportedQuestion({
                        answer: "positive",
                        center: [139.7, 35.66],
                        createdAt: "2026-05-01T00:00:00.000Z",
                        distanceMeters: 2000,
                        distanceOption: "2km",
                        distanceUnit: "m",
                        id: "q-shared-1",
                        isLocked: false,
                        type: "radar",
                        updatedAt: "2026-05-01T00:00:00.000Z",
                    })
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-add-imported-tentacles-answered"
                onPress={() =>
                    addImportedQuestion({
                        answer: "positive" as const,
                        candidates: [],
                        category: "museum" as const,
                        center: [139.7, 35.66] as [number, number],
                        createdAt: "2026-05-01T00:00:00.000Z",
                        distanceMeters: 2000,
                        distanceOption: "2km" as const,
                        id: "q-shared-tentacles",
                        isLocked: false,
                        selectedOsmId: 123,
                        selectedOsmType: "node" as const,
                        selectedName: "Test POI",
                        type: "tentacles" as const,
                        updatedAt: "2026-05-01T00:00:00.000Z",
                    })
                }
            />
            <Pressable
                accessibilityRole="button"
                testID="action-import-settings-hider"
                onPress={() =>
                    importQuestionSettings({
                        activeQuestionId: null,
                        adminDivisionPack: [
                            {
                                osmLevel: "4",
                                labelNative: "",
                                labelEn: "",
                            },
                            {
                                osmLevel: "7",
                                labelNative: "",
                                labelEn: "",
                            },
                            {
                                osmLevel: "9",
                                labelNative: "",
                                labelEn: "",
                            },
                            {
                                osmLevel: "10",
                                labelNative: "",
                                labelEn: "",
                            },
                        ],
                        adminDivisionPresetName: "generic",
                        gameMode: "hider",
                        labelLanguage: "english",
                        seekingStartedAt: null,
                        unitSystem: "imperial",
                        unitSystemChosen: true,
                    })
                }
            />
        </View>
    );
}

function renderGameModeProvider() {
    return render(
        <AppStateProviders>
            <GameModeProbe />
        </AppStateProviders>,
    );
}

describe("addImportedQuestion", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it("appends an imported question with a fresh local id", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-add-imported-radar"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");

        // The local id should be fresh, not the shared id.
        const localId = screen.getByTestId("probe-active-id").props.children;
        expect(localId).not.toBe("q-shared-1");
        expect(localId).toMatch(/^q-/);

        // The shared id should NOT appear in the question list.
        expect(screen.getByTestId("probe-question-ids")).not.toHaveTextContent(
            "q-shared-1",
        );
    });

    it("resets answer to unanswered on import", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-add-imported-radar"));
        });

        // The shared question had answer "positive", but import resets to
        // "unanswered".
        expect(screen.getByTestId("probe-first-answer")).toHaveTextContent(
            "unanswered",
        );
    });

    it("preserves question type and domain fields on import", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-add-imported-radar"));
        });

        expect(screen.getByTestId("probe-first-type")).toHaveTextContent(
            "radar",
        );
    });

    it("appends rather than replacing existing questions", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-add-imported-radar"));
        });
        act(() => {
            fireEvent.press(screen.getByTestId("action-add-imported-radar"));
        });

        expect(screen.getByTestId("probe-count")).toHaveTextContent("2");
        // Both ids should be different (fresh per import).
        const ids = screen
            .getByTestId("probe-question-ids")
            .props.children.split(",");
        expect(ids).toHaveLength(2);
        expect(ids[0]).not.toBe(ids[1]);
    });

    it("resets selection on imported poi-model question (T2-1 fix)", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        act(() => {
            fireEvent.press(
                screen.getByTestId("action-add-imported-tentacles-answered"),
            );
        });

        // The imported tentacles question carried selectedOsmId: 123,
        // selectedName: "Test POI", and answer: "positive". The import should
        // clear all three selection fields AND derive answer: "unanswered".
        expect(screen.getByTestId("probe-count")).toHaveTextContent("1");
        expect(screen.getByTestId("probe-first-type")).toHaveTextContent(
            "tentacles",
        );
        expect(screen.getByTestId("probe-first-answer")).toHaveTextContent(
            "unanswered",
        );
        expect(
            screen.getByTestId("probe-tentacles-selected-osm-id"),
        ).toHaveTextContent("null");
        expect(
            screen.getByTestId("probe-tentacles-selected-name"),
        ).toHaveTextContent("null");
    });
});

describe("gameMode", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it("defaults to seeker mode", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        expect(screen.getByTestId("probe-game-mode")).toHaveTextContent(
            "seeker",
        );
    });

    it("toggles between hider and seeker", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-set-hider"));
        });
        expect(screen.getByTestId("probe-game-mode")).toHaveTextContent(
            "hider",
        );

        act(() => {
            fireEvent.press(screen.getByTestId("action-set-seeker"));
        });
        expect(screen.getByTestId("probe-game-mode")).toHaveTextContent(
            "seeker",
        );
    });

    it("persists gameMode changes", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-set-hider"));
        });

        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            expect(persisted?.questionSettings.gameMode).toBe("hider");
        });
    });
});

describe("importQuestionSettings", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it("restores gameMode from imported settings", async () => {
        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("action-import-settings-hider"));
        });

        expect(screen.getByTestId("probe-game-mode")).toHaveTextContent(
            "hider",
        );
    });

    it("defaults gameMode to seeker when missing from import", async () => {
        // Persist state with no gameMode set, then restore.
        await persistAppState(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: 600,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
                playArea: defaultPlayArea,
            }),
        );

        const screen = renderGameModeProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toBeTruthy();
        });

        // Should default to "seeker".
        expect(screen.getByTestId("probe-game-mode")).toHaveTextContent(
            "seeker",
        );
    });
});

// ---------------------------------------------------------------------------
// Task 02: Tentacles POI answer helpers — invariant & normalization tests
// ---------------------------------------------------------------------------

import { getQuestionAnswerStatus } from "@/features/questions/questionRegistry";
import {
    selectTentaclesPoi,
    resetTentaclesAnswer,
} from "@/state/questionStore";
import type { TentaclesQuestion } from "@/features/questions/tentacles/tentaclesTypes";

function makeTentaclesQuestion(
    overrides?: Partial<TentaclesQuestion>,
): TentaclesQuestion {
    return {
        answer: "unanswered",
        candidates: [],
        category: "museum",
        center: [139.7, 35.66],
        createdAt: "2026-01-01T00:00:00.000Z",
        distanceMeters: 2000,
        distanceOption: "2km",
        id: "q-tentacles-test",
        isLocked: false,
        selectedOsmId: null,
        selectedOsmType: null,
        selectedName: null,
        type: "tentacles",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("selectTentaclesPoi", () => {
    it("sets all selected fields and derives answer: positive", () => {
        const q = makeTentaclesQuestion();
        const result = selectTentaclesPoi(q, {
            osmId: 456,
            osmType: "node",
            name: "Tokyo National Museum",
        });

        expect(result.answer).toBe("positive");
        expect(result.selectedOsmId).toBe(456);
        expect(result.selectedOsmType).toBe("node");
        expect(result.selectedName).toBe("Tokyo National Museum");
        expect(getQuestionAnswerStatus(result)).toBe("answered");
    });

    it("bumps updatedAt", () => {
        const q = makeTentaclesQuestion();
        const result = selectTentaclesPoi(q, {
            osmId: 1,
            osmType: "way",
            name: "Test",
        });
        expect(result.updatedAt).not.toBe(q.updatedAt);
    });
});

describe("resetTentaclesAnswer", () => {
    it("clears all selected fields and sets answer: unanswered", () => {
        const q = makeTentaclesQuestion({
            answer: "positive",
            selectedOsmId: 456,
            selectedOsmType: "node",
            selectedName: "Tokyo National Museum",
        });
        const result = resetTentaclesAnswer(q);

        expect(result.answer).toBe("unanswered");
        expect(result.selectedOsmId).toBeNull();
        expect(result.selectedOsmType).toBeNull();
        expect(result.selectedName).toBeNull();
        expect(getQuestionAnswerStatus(result)).toBe("unanswered");
    });

    it("bumps updatedAt", () => {
        const q = makeTentaclesQuestion({
            answer: "positive",
            selectedOsmId: 1,
            selectedOsmType: "way",
            selectedName: "Test",
        });
        const result = resetTentaclesAnswer(q);
        expect(result.updatedAt).not.toBe(q.updatedAt);
    });
});

describe("anti-drift invariant", () => {
    it("(answer === positive) iff (selectedOsmId !== null) for all helper outputs", () => {
        const q = makeTentaclesQuestion();

        // Fresh — unanswered
        expect(q.answer === "positive").toBe(q.selectedOsmId !== null);

        // After select
        const selected = selectTentaclesPoi(q, {
            osmId: 789,
            osmType: "relation",
            name: "Test POI",
        });
        expect(selected.answer === "positive").toBe(
            selected.selectedOsmId !== null,
        );

        // After reset
        const reset = resetTentaclesAnswer(selected);
        expect(reset.answer === "positive").toBe(reset.selectedOsmId !== null);

        // Round-trip: reset → select again
        const reselected = selectTentaclesPoi(reset, {
            osmId: 999,
            osmType: "node",
            name: "Another POI",
        });
        expect(reselected.answer === "positive").toBe(
            reselected.selectedOsmId !== null,
        );
    });
});

describe("normalizeQuestionState repairs inconsistent poi payloads", () => {
    it("re-derives answer from selectedOsmId for tentacles", async () => {
        // Simulate loading a persisted state where answer drifted from selection.
        // The normalization code lives in questionStore.tsx.
        // We test it indirectly by persisting an inconsistent state and verifying
        // the loaded state is repaired.
        await AsyncStorage.clear();

        const inconsistentTentacles = {
            answer: "positive",
            candidates: [],
            category: "museum",
            center: [139.7, 35.66],
            createdAt: "2026-01-01T00:00:00.000Z",
            distanceMeters: 2000,
            distanceOption: "2km",
            id: "q-drifted",
            isLocked: false,
            selectedOsmId: null,
            selectedOsmType: null,
            selectedName: null,
            type: "tentacles",
            updatedAt: "2026-01-01T00:00:00.000Z",
        } as TentaclesQuestion;

        await persistAppState(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: 600,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
                playArea: defaultPlayArea,
                questions: [inconsistentTentacles],
            }),
        );

        const loaded = await loadPersistedAppState();
        const repaired = loaded?.questions[0];

        expect(repaired).toBeDefined();
        if (repaired && repaired.type === "tentacles") {
            // The drifted answer should be repaired to "unanswered"
            expect(repaired.answer).toBe("unanswered");
            expect(repaired.selectedOsmId).toBeNull();
            expect(getQuestionAnswerStatus(repaired)).toBe("unanswered");
        }
    });
});

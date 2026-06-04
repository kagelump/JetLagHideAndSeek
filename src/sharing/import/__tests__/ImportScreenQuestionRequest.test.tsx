import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, Text, View } from "react-native";

import { defaultPlayArea } from "@/features/map/playArea";
import type { QuestionState } from "@/features/questions/questionTypes";
import { buildQuestionRequestEnvelope } from "@/sharing/export/buildEnvelope";
import { ImportScreen } from "@/sharing/import/ImportScreen";
import { buildImportLink } from "@/sharing/links/buildLink";
import { AppStateProviders } from "@/state/AppStateProviders";
import { createAppStateV1 } from "@/state/appState";
import { persistAppState } from "@/state/persistence";
import {
    useGameMode,
    useQuestionActions,
    useQuestions,
} from "@/state/questionStore";

const { useLocalSearchParams, useRouter } = jest.requireMock("expo-router") as {
    useLocalSearchParams: jest.Mock;
    useRouter: jest.Mock;
};

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

function makeRadarQuestion(): QuestionState {
    return {
        answer: "unanswered",
        center: [139.69171, 35.6895],
        createdAt: "2026-06-05T00:00:00.000Z",
        distanceMeters: 5000,
        distanceOption: "5km",
        distanceUnit: "m",
        id: "q-radar-shared",
        type: "radar",
        updatedAt: "2026-06-05T00:00:00.000Z",
    };
}

function makeMatchingQuestion(): QuestionState {
    return {
        answer: "unanswered",
        candidates: [],
        category: "park",
        center: [139.7, 35.7],
        createdAt: "2026-06-05T00:00:00.000Z",
        id: "q-matching-shared",
        lineId: null,
        lineName: null,
        selectedOsmId: null,
        selectedOsmType: null,
        targetName: "Ueno Park",
        targetOsmId: 456,
        targetOsmType: "way",
        type: "matching",
        updatedAt: "2026-06-05T00:00:00.000Z",
    };
}

function setImportPayload(
    envelope: ReturnType<typeof buildQuestionRequestEnvelope>,
) {
    const link = buildImportLink({ envelope, mode: "custom-scheme" });
    const payload = new URL(link).searchParams.get("d")!;
    useLocalSearchParams.mockReturnValue({ d: payload });
}

function StoreProbe() {
    const gameMode = useGameMode();
    const questions = useQuestions();
    const { setGameMode } = useQuestionActions();

    return (
        <View>
            <Text testID="probe-game-mode">{gameMode}</Text>
            <Text testID="probe-question-count">{questions.length}</Text>
            <Pressable
                accessibilityRole="button"
                testID="probe-set-hider"
                onPress={() => setGameMode("hider")}
            />
        </View>
    );
}

describe("ImportScreen — question-request", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        useRouter.mockReturnValue({ replace: jest.fn() });
        mockRequestUserCoordinate.mockReset();
    });

    // -- Seeker mode (default) ---------------------------------------------

    it("shows the add button in seeker mode for a radar question", async () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });
        setImportPayload(envelope);

        const screen = render(
            <AppStateProviders>
                <ImportScreen />
                <StoreProbe />
            </AppStateProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId("question-request-import")).toBeTruthy();
        });

        // Seeker mode: should show "Shared Question" eyebrow and add button.
        expect(screen.getByTestId("question-request-add-button")).toBeTruthy();
        expect(
            screen.getByTestId("question-request-return-button"),
        ).toBeTruthy();

        // GPS should NOT have been requested.
        expect(mockRequestUserCoordinate).not.toHaveBeenCalled();
    });

    it("shows the add button in seeker mode for a matching question", async () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeMatchingQuestion(),
        });
        setImportPayload(envelope);

        const screen = render(
            <AppStateProviders>
                <ImportScreen />
                <StoreProbe />
            </AppStateProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId("question-request-import")).toBeTruthy();
        });

        expect(screen.getByTestId("question-request-add-button")).toBeTruthy();
        expect(mockRequestUserCoordinate).not.toHaveBeenCalled();
    });

    it("adds the question to the store when Add Question is pressed", async () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });
        setImportPayload(envelope);

        const routerReplace = jest.fn();
        useRouter.mockReturnValue({ replace: routerReplace });

        const screen = render(
            <AppStateProviders>
                <ImportScreen />
                <StoreProbe />
            </AppStateProviders>,
        );

        await waitFor(() => {
            expect(
                screen.getByTestId("question-request-add-button"),
            ).toBeTruthy();
        });

        act(() => {
            fireEvent.press(screen.getByTestId("question-request-add-button"));
        });

        // After adding, navigates back to map.
        expect(routerReplace).toHaveBeenCalledWith("/");

        // The question should be in the store with a fresh id.
        await waitFor(() => {
            expect(
                screen.getByTestId("probe-question-count"),
            ).toHaveTextContent("1");
        });
    });

    // -- Hider mode + radar → GPS answer -----------------------------------

    it("shows GPS answer when hider mode is on and question is radar", async () => {
        // Seed hider mode before rendering.
        await persistAppState(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: 600,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
                playArea: defaultPlayArea,
                questionSettings: {
                    activeQuestionId: null,
                    gameMode: "hider",
                    isPinLocked: false,
                    labelLanguage: "native",
                },
            }),
        );

        // Mock GPS to return a coordinate inside the radar distance.
        mockRequestUserCoordinate.mockImplementation(() =>
            Promise.resolve({
                coordinate: [139.692, 35.69] as [number, number],
                status: "granted" as const,
            }),
        );

        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });
        setImportPayload(envelope);

        const screen = render(
            <AppStateProviders>
                <ImportScreen />
                <StoreProbe />
            </AppStateProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId("probe-game-mode")).toHaveTextContent(
                "hider",
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId("question-request-import")).toBeTruthy();
        });

        // Should show the answer verdict ("Yes" — within range).
        // The answer View aggregates children text, so query for the Text node.
        await waitFor(() => {
            expect(screen.getByText("Yes")).toBeTruthy();
        });
        expect(screen.getByTestId("question-request-answer")).toBeTruthy();

        // The GPS mock should have been called.
        expect(mockRequestUserCoordinate).toHaveBeenCalled();
    });

    it('shows "No" when hider is outside radar range', async () => {
        await persistAppState(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: 600,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
                playArea: defaultPlayArea,
                questionSettings: {
                    activeQuestionId: null,
                    gameMode: "hider",
                    isPinLocked: false,
                    labelLanguage: "native",
                },
            }),
        );

        // Far away — ~300 km from the question center.
        mockRequestUserCoordinate.mockImplementation(() =>
            Promise.resolve({
                coordinate: [135.5, 34.7] as [number, number], // Osaka area
                status: "granted" as const,
            }),
        );

        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });
        setImportPayload(envelope);

        const screen = render(
            <AppStateProviders>
                <ImportScreen />
                <StoreProbe />
            </AppStateProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId("question-request-import")).toBeTruthy();
        });

        // The answer View aggregates children text, so query for the Text node.
        await waitFor(() => {
            expect(screen.getByText("No")).toBeTruthy();
        });
        expect(screen.getByTestId("question-request-answer")).toBeTruthy();
    });

    it("shows retry button when location permission is denied", async () => {
        await persistAppState(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: 600,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
                playArea: defaultPlayArea,
                questionSettings: {
                    activeQuestionId: null,
                    gameMode: "hider",
                    isPinLocked: false,
                    labelLanguage: "native",
                },
            }),
        );

        mockRequestUserCoordinate.mockImplementation(() =>
            Promise.resolve({
                coordinate: null as null,
                status: "denied" as const,
            }),
        );

        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });
        setImportPayload(envelope);

        const screen = render(
            <AppStateProviders>
                <ImportScreen />
                <StoreProbe />
            </AppStateProviders>,
        );

        // Wait for the import panel.
        await waitFor(() => {
            expect(screen.getByTestId("question-request-import")).toBeTruthy();
        });

        // Wait for the mock to have been called and the state to update.
        await waitFor(() => {
            expect(mockRequestUserCoordinate).toHaveBeenCalled();
        });

        // After the mock resolves, the component should transition from
        // "locating" to "denied", rendering both the answer text and retry button.
        await waitFor(() => {
            expect(
                screen.getByTestId("question-request-retry-button"),
            ).toBeTruthy();
        });

        expect(screen.getByTestId("question-request-answer")).toHaveTextContent(
            "Location permission is needed to answer this question.",
        );
    });

    // -- Hider mode + matching → add-only (no GPS) -------------------------

    it("shows add button for matching question even in hider mode", async () => {
        await persistAppState(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: 600,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
                playArea: defaultPlayArea,
                questionSettings: {
                    activeQuestionId: null,
                    gameMode: "hider",
                    isPinLocked: false,
                    labelLanguage: "native",
                },
            }),
        );

        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeMatchingQuestion(),
        });
        setImportPayload(envelope);

        const screen = render(
            <AppStateProviders>
                <ImportScreen />
                <StoreProbe />
            </AppStateProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId("question-request-import")).toBeTruthy();
        });

        // Matching questions are never auto-answered — add button always shown.
        expect(screen.getByTestId("question-request-add-button")).toBeTruthy();
        expect(mockRequestUserCoordinate).not.toHaveBeenCalled();
    });

    // -- Return to Map -----------------------------------------------------

    it("navigates back to map when Return to Map is pressed", async () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });
        setImportPayload(envelope);

        const routerReplace = jest.fn();
        useRouter.mockReturnValue({ replace: routerReplace });

        const screen = render(
            <AppStateProviders>
                <ImportScreen />
                <StoreProbe />
            </AppStateProviders>,
        );

        await waitFor(() => {
            expect(
                screen.getByTestId("question-request-return-button"),
            ).toBeTruthy();
        });

        act(() => {
            fireEvent.press(
                screen.getByTestId("question-request-return-button"),
            );
        });

        expect(routerReplace).toHaveBeenCalledWith("/");
    });
});

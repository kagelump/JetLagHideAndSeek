import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, waitFor } from "@testing-library/react-native";
import { Text, View } from "react-native";

import { clearOsmMatchingMemoryCache } from "@/features/questions/matching/osmMatchingCache";
import { AppStateProviders } from "@/state/AppStateProviders";
import { clearAppCaches, useResetGame } from "@/state/maintenance";
import { useHidingZoneState } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { queryClient } from "@/state/queryClient";
import { useQuestionDerived, useQuestions } from "@/state/questionStore";

// ─── Test probes ───────────────────────────────────────────────────────────

function ResetProbe({
    onResetReady,
}: {
    onResetReady: (fn: () => Promise<void>) => void;
}) {
    const resetGame = useResetGame();
    // Expose the callback to the test harness.
    onResetReady(resetGame);
    return <View testID="reset-probe" />;
}

function StateProbe() {
    const { playArea } = usePlayArea();
    const { radiusMeters, radiusUnit, selectedPresetIds } =
        useHidingZoneState();
    const questions = useQuestions();
    const { activeQuestion } = useQuestionDerived();

    return (
        <View>
            <Text testID="probe-play-area-label">{playArea.label}</Text>
            <Text testID="probe-play-area-osm-id">{playArea.osmId}</Text>
            <Text testID="probe-radius-meters">{radiusMeters}</Text>
            <Text testID="probe-radius-unit">{radiusUnit}</Text>
            <Text testID="probe-preset-count">{selectedPresetIds.length}</Text>
            <Text testID="probe-question-count">{questions.length}</Text>
            <Text testID="probe-active-question">
                {activeQuestion?.id ?? "none"}
            </Text>
        </View>
    );
}

type ResetFn = () => Promise<void>;

// ─── useResetGame ──────────────────────────────────────────────────────────

describe("useResetGame", () => {
    let resetGame: ResetFn | null = null;

    beforeEach(async () => {
        resetGame = null;
        await AsyncStorage.clear();
        queryClient.clear();
        clearOsmMatchingMemoryCache();
    });

    function renderProbe() {
        return render(
            <AppStateProviders>
                <ResetProbe
                    onResetReady={(fn) => {
                        resetGame = fn;
                    }}
                />
                <StateProbe />
            </AppStateProviders>,
        );
    }

    it("resets play area to unset", async () => {
        const screen = renderProbe();

        await waitFor(() => {
            expect(screen.getByTestId("probe-play-area-label")).toBeTruthy();
        });

        await act(async () => {
            await resetGame!();
        });

        expect(screen.getByTestId("probe-play-area-label")).toHaveTextContent(
            "",
        );
        expect(screen.getByTestId("probe-play-area-osm-id")).toHaveTextContent(
            "0",
        );
    });

    it("resets hiding zones to default", async () => {
        const screen = renderProbe();

        await waitFor(() => {
            expect(screen.getByTestId("probe-radius-meters")).toBeTruthy();
        });

        await act(async () => {
            await resetGame!();
        });

        expect(screen.getByTestId("probe-radius-meters")).toHaveTextContent(
            "600",
        );
        expect(screen.getByTestId("probe-radius-unit")).toHaveTextContent("m");
        expect(screen.getByTestId("probe-preset-count")).toHaveTextContent("0");
    });

    it("resets questions to empty", async () => {
        const screen = renderProbe();

        await waitFor(() => {
            expect(screen.getByTestId("probe-question-count")).toBeTruthy();
        });

        await act(async () => {
            await resetGame!();
        });

        expect(screen.getByTestId("probe-question-count")).toHaveTextContent(
            "0",
        );
        expect(screen.getByTestId("probe-active-question")).toHaveTextContent(
            "none",
        );
    });

    it("clears persisted app-state keys", async () => {
        // Simulate some persisted game state.
        await AsyncStorage.setItem("app-state:metadata:v1", "{}");
        await AsyncStorage.setItem("app-state:questions:v1", "[]");

        const screen = renderProbe();
        await waitFor(() => {
            expect(screen.getByTestId("probe-play-area-label")).toBeTruthy();
        });

        await act(async () => {
            await resetGame!();
        });

        const keys = await AsyncStorage.getAllKeys();
        expect(keys.some((k) => k.startsWith("app-state:"))).toBe(false);
    });
});

// ─── clearAppCaches ────────────────────────────────────────────────────────

describe("clearAppCaches", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        queryClient.clear();
        clearOsmMatchingMemoryCache();
    });

    it("removes the React Query persisted cache key", async () => {
        await AsyncStorage.setItem(
            "REACT_QUERY_OFFLINE_CACHE",
            JSON.stringify({ fake: true }),
        );

        const count = await clearAppCaches();
        // At least the RQ key plus possibly boundary orphans.
        expect(count).toBeGreaterThanOrEqual(1);

        const val = await AsyncStorage.getItem("REACT_QUERY_OFFLINE_CACHE");
        expect(val).toBeNull();
    });

    it("leaves app-state keys intact", async () => {
        await AsyncStorage.setItem("app-state:metadata:v1", "keep-me");
        await AsyncStorage.setItem("app-state:questions:v1", "keep-too");

        await clearAppCaches();

        expect(await AsyncStorage.getItem("app-state:metadata:v1")).toBe(
            "keep-me",
        );
        expect(await AsyncStorage.getItem("app-state:questions:v1")).toBe(
            "keep-too",
        );
    });

    it("returns 0 when nothing is cached", async () => {
        // No seeds — RQ key absent, OSM cache empty, no boundary orphans.
        const count = await clearAppCaches();
        expect(count).toBe(0);
    });
});

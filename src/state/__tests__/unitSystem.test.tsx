import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, Text, View } from "react-native";

import type { PlayArea } from "@/features/map/playArea";
import { AppStateProviders } from "@/state/AppStateProviders";
import { useHidingZoneState } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import {
    useQuestionActions,
    useQuestionDerived,
    useQuestionState,
} from "@/state/questionStore";

const CENTER: [number, number] = [139.7, 35.7];

function playAreaAt(center: [number, number]): PlayArea {
    return {
        bbox: [
            center[0] - 0.1,
            center[1] - 0.1,
            center[0] + 0.1,
            center[1] + 0.1,
        ],
        boundary: { type: "FeatureCollection", features: [] },
        center,
        label: "Test",
        osmId: 123,
        osmType: "R",
    };
}

const US_PLAY_AREA = playAreaAt([-122.42, 37.77]); // San Francisco
const NON_US_PLAY_AREA = playAreaAt(CENTER); // Tokyo

function Probe() {
    const { isRestored, unitSystem, unitSystemChosen } = useQuestionState();
    const { activeQuestion } = useQuestionDerived();
    const { createQuestion, setUnitSystem } = useQuestionActions();
    const { importPlayArea } = usePlayArea();
    const { radiusMeters, radiusUnit } = useHidingZoneState();

    return (
        <View>
            <Text testID="restored">{String(isRestored)}</Text>
            <Text testID="unit-system">{unitSystem}</Text>
            <Text testID="unit-chosen">{String(unitSystemChosen)}</Text>
            <Text testID="radius-unit">{radiusUnit}</Text>
            <Text testID="radius-meters">{radiusMeters}</Text>
            <Pressable
                testID="set-us-play-area"
                onPress={() => importPlayArea(US_PLAY_AREA)}
            />
            <Pressable
                testID="set-non-us-play-area"
                onPress={() => importPlayArea(NON_US_PLAY_AREA)}
            />
            <Text testID="active-option">
                {activeQuestion?.type === "radar"
                    ? activeQuestion.distanceOption
                    : "none"}
            </Text>
            <Text testID="active-unit">
                {activeQuestion?.type === "radar"
                    ? activeQuestion.distanceUnit
                    : activeQuestion?.type === "measuring"
                      ? activeQuestion.seekerDistanceUnit
                      : "none"}
            </Text>
            <Pressable
                testID="set-imperial"
                onPress={() => setUnitSystem("imperial")}
            />
            <Pressable
                testID="create-radar"
                onPress={() => createQuestion("radar", { center: CENTER })}
            />
            <Pressable
                testID="create-measuring"
                onPress={() => createQuestion("measuring", { center: CENTER })}
            />
        </View>
    );
}

async function renderRestored() {
    const utils = render(
        <AppStateProviders>
            <Probe />
        </AppStateProviders>,
    );
    await waitFor(() => {
        expect(utils.getByTestId("restored").props.children).toBe("true");
    });
    return utils;
}

describe("unit system preference", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it("defaults to metric and unchosen on a fresh install", async () => {
        const { getByTestId } = await renderRestored();
        expect(getByTestId("unit-system").props.children).toBe("metric");
        expect(getByTestId("unit-chosen").props.children).toBe("false");
    });

    it("creates metric radar questions by default", async () => {
        const { getByTestId } = await renderRestored();
        await act(async () => {
            fireEvent.press(getByTestId("create-radar"));
        });
        expect(getByTestId("active-option").props.children).toBe("500m");
        expect(getByTestId("active-unit").props.children).toBe("m");
    });

    it("creates imperial radar questions after choosing imperial", async () => {
        const { getByTestId } = await renderRestored();
        await act(async () => {
            fireEvent.press(getByTestId("set-imperial"));
        });
        expect(getByTestId("unit-system").props.children).toBe("imperial");
        expect(getByTestId("unit-chosen").props.children).toBe("true");

        await act(async () => {
            fireEvent.press(getByTestId("create-radar"));
        });
        expect(getByTestId("active-option").props.children).toBe("0.5mi");
        expect(getByTestId("active-unit").props.children).toBe("mi");
    });

    it("uses imperial seeker distance unit for new measuring questions", async () => {
        const { getByTestId } = await renderRestored();
        await act(async () => {
            fireEvent.press(getByTestId("set-imperial"));
        });
        await act(async () => {
            fireEvent.press(getByTestId("create-measuring"));
        });
        expect(getByTestId("active-unit").props.children).toBe("mi");
    });

    it("auto-selects imperial and a 0.25mi radius for a US play area", async () => {
        const { getByTestId } = await renderRestored();
        await act(async () => {
            fireEvent.press(getByTestId("set-us-play-area"));
        });
        await waitFor(() => {
            expect(getByTestId("unit-system").props.children).toBe("imperial");
        });
        // Auto-default must not mark it an explicit choice.
        expect(getByTestId("unit-chosen").props.children).toBe("false");
        expect(getByTestId("radius-unit").props.children).toBe("mi");
        expect(getByTestId("radius-meters").props.children).toBeCloseTo(
            0.25 * 1609.344,
            3,
        );
    });

    it("auto-selects metric for a non-US play area", async () => {
        const { getByTestId } = await renderRestored();
        await act(async () => {
            fireEvent.press(getByTestId("set-non-us-play-area"));
        });
        // Stays metric; no flip away from the default.
        expect(getByTestId("unit-system").props.children).toBe("metric");
        expect(getByTestId("radius-unit").props.children).toBe("m");
    });

    it("keeps a manual override when the play area changes", async () => {
        const { getByTestId } = await renderRestored();
        // Manually pick metric (marks it chosen).
        await act(async () => {
            fireEvent.press(getByTestId("set-imperial"));
        });
        expect(getByTestId("unit-chosen").props.children).toBe("true");

        // A non-US play area must not auto-revert the explicit imperial choice.
        await act(async () => {
            fireEvent.press(getByTestId("set-non-us-play-area"));
        });
        expect(getByTestId("unit-system").props.children).toBe("imperial");
    });

    it("persists and restores the unit-system choice", async () => {
        const first = await renderRestored();
        await act(async () => {
            fireEvent.press(first.getByTestId("set-imperial"));
        });
        // Allow the debounced persistence to flush.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 600));
        });
        first.unmount();

        const second = await renderRestored();
        expect(second.getByTestId("unit-system").props.children).toBe(
            "imperial",
        );
        expect(second.getByTestId("unit-chosen").props.children).toBe("true");
    });
});

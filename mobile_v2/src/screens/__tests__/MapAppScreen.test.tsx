import { fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import osmtogeojson from "osmtogeojson";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { clearPlayAreaMemoryCache } from "@/features/map/playAreaBoundary";

import { MapAppScreen } from "../MapAppScreen";

jest.mock("osmtogeojson", () => ({
    __esModule: true,
    default: jest.fn(),
}));

const mockedOsmToGeoJson = osmtogeojson as jest.MockedFunction<
    typeof osmtogeojson
>;

const osakaBoundary = {
    features: [
        {
            geometry: {
                coordinates: [
                    [
                        [135.35, 34.5],
                        [135.7, 34.5],
                        [135.7, 34.82],
                        [135.35, 34.82],
                        [135.35, 34.5],
                    ],
                ],
                type: "Polygon",
            },
            properties: { name: "Osaka" },
            type: "Feature",
        },
    ],
    type: "FeatureCollection",
};

function renderWithSafeArea(ui: ReactElement) {
    return render(
        <SafeAreaProvider
            initialMetrics={{
                frame: { height: 844, width: 390, x: 0, y: 0 },
                insets: { bottom: 34, left: 0, right: 0, top: 47 },
            }}
        >
            {ui as any}
        </SafeAreaProvider>,
    );
}

describe("MapAppScreen", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        clearPlayAreaMemoryCache();
        await AsyncStorage.clear();
        mockedOsmToGeoJson.mockReturnValue(osakaBoundary);
        globalThis.fetch = jest.fn().mockResolvedValue({
            json: jest.fn().mockResolvedValue({ elements: [] }),
            ok: true,
        });
    });

    it("renders the native map and bottom sheet", () => {
        const screen = renderWithSafeArea(<MapAppScreen />);

        expect(screen.getByTestId("native-map")).toBeTruthy();
        expect(screen.getByTestId("bottom-sheet")).toBeTruthy();
        expect(screen.getByText("Game Setup")).toBeTruthy();
    });

    it("keeps bottom-sheet navigation working", () => {
        const screen = renderWithSafeArea(<MapAppScreen />);

        fireEvent.press(screen.getByText("Questions"));
        expect(
            screen.getByText(
                "The question list will be wired once the state model exists.",
            ),
        ).toBeTruthy();

        fireEvent.press(screen.getByText("Back"));
        fireEvent.press(screen.getByText("Add Question"));
        expect(
            screen.getByText(
                "Question creation will land here in a later milestone.",
            ),
        ).toBeTruthy();

        fireEvent.press(screen.getByText("Back"));
        fireEvent.press(screen.getByTestId("main-settings-row"));
        expect(screen.getByText("Game Settings")).toBeTruthy();
        expect(screen.getByTestId("settings-play-area-row")).toBeTruthy();
    });

    it("applies an Osaka play area from a direct OSM relation ID", async () => {
        const screen = renderWithSafeArea(<MapAppScreen />);

        fireEvent.press(screen.getByTestId("main-settings-row"));
        fireEvent.press(screen.getByTestId("settings-play-area-row"));
        fireEvent.changeText(
            screen.getByTestId("play-area-relation-id-text-input"),
            "358674",
        );
        fireEvent.press(screen.getByTestId("play-area-apply-relation-button"));

        await waitFor(() => {
            expect(screen.getAllByText("Osaka").length).toBeGreaterThan(0);
            expect(screen.getByText("🗺️")).toBeTruthy();
            expect(screen.getByText("Relation 358674")).toBeTruthy();
        });
    });

    it("shows direct relation validation errors without fetching", async () => {
        const screen = renderWithSafeArea(<MapAppScreen />);

        fireEvent.press(screen.getByTestId("main-settings-row"));
        fireEvent.press(screen.getByTestId("settings-play-area-row"));
        fireEvent.changeText(
            screen.getByTestId("play-area-relation-id-text-input"),
            "not-a-relation",
        );
        fireEvent.press(screen.getByTestId("play-area-apply-relation-button"));

        await waitFor(() => {
            expect(
                screen.getByText("Enter a positive OSM relation ID."),
            ).toBeTruthy();
            expect(
                screen.getAllByText("Tokyo 23 Wards").length,
            ).toBeGreaterThan(0);
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("keeps Tokyo selected when relation loading fails", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 500,
        });
        const screen = renderWithSafeArea(<MapAppScreen />);

        fireEvent.press(screen.getByTestId("main-settings-row"));
        fireEvent.press(screen.getByTestId("settings-play-area-row"));
        fireEvent.changeText(
            screen.getByTestId("play-area-relation-id-text-input"),
            "999999",
        );
        fireEvent.press(screen.getByTestId("play-area-apply-relation-button"));

        await waitFor(() => {
            expect(screen.getByText("Overpass API error 500")).toBeTruthy();
            expect(
                screen.getAllByText("Tokyo 23 Wards").length,
            ).toBeGreaterThan(0);
            expect(screen.getByText("🗺️")).toBeTruthy();
        });
    });
});

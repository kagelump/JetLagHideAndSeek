import { fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Location from "expo-location";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NativeMap } from "../NativeMap";

const { __cameraMethods } = jest.requireMock(
    "@maplibre/maplibre-react-native",
) as {
    __cameraMethods: {
        fitBounds: jest.Mock;
        setCamera: jest.Mock;
    };
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

describe("NativeMap", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders the map, Tokyo boundary, and controls", () => {
        const screen = renderWithSafeArea(<NativeMap />);

        expect(screen.getByTestId("native-map")).toBeTruthy();
        expect(screen.getByText("Tokyo 23 Wards")).toBeTruthy();
        expect(screen.getByText("Fit Tokyo")).toBeTruthy();
        expect(screen.getByText("Locate me")).toBeTruthy();
        expect(screen.getByTestId("map-shape-source").props.id).toBe(
            "tokyo-boundary",
        );
        expect(screen.getByTestId("map-line-layer").props.id).toBe(
            "tokyo-boundary-line",
        );
    });

    it("fits the camera when the map finishes loading", () => {
        const screen = renderWithSafeArea(<NativeMap />);

        fireEvent(screen.getByTestId("native-map"), "onDidFinishLoadingMap");

        expect(__cameraMethods.setCamera).toHaveBeenCalledWith({
            animationDuration: 700,
            animationMode: "easeTo",
            bounds: {
                ne: [139.9189004, 35.8174937],
                paddingBottom: 405,
                paddingLeft: 40,
                paddingRight: 40,
                paddingTop: 167,
                sw: [139.5628986, 35.4816556],
            },
        });
    });

    it("locates the user and flies the camera to the mocked coordinate", async () => {
        const screen = renderWithSafeArea(<NativeMap />);

        fireEvent.press(screen.getByText("Locate me"));

        await waitFor(() => {
            expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
            expect(__cameraMethods.setCamera).toHaveBeenCalledWith({
                animationDuration: 700,
                animationMode: "flyTo",
                centerCoordinate: [139.6503, 35.6762],
                zoomLevel: 13,
            });
        });
    });
});

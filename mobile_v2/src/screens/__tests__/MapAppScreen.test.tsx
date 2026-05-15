import { fireEvent, render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MapAppScreen } from "../MapAppScreen";

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
        fireEvent.press(screen.getByText("Settings"));
        expect(
            screen.getByText("Play area, units, and sharing controls will live here."),
        ).toBeTruthy();
    });
});

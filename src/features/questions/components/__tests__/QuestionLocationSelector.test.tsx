import { act, fireEvent, render } from "@testing-library/react-native";

import { QuestionLocationSelector } from "../QuestionLocationSelector";

describe("QuestionLocationSelector", () => {
    const defaultCenter: [number, number] = [139.76, 35.68];

    it("renders the center coordinate with 5 decimal places", () => {
        const screen = render(
            <QuestionLocationSelector
                center={defaultCenter}
                onCenterChange={jest.fn()}
                setToLocationAccessibilityLabel="Set to location"
                testIDPrefix="test"
            />,
        );

        const summary = screen.getByTestId("test-center-summary");
        expect(summary.props.children).toEqual([
            "35.68000",
            ",",
            " ",
            "139.76000",
        ]);
    });

    it("renders the set-to-location button by default", () => {
        const screen = render(
            <QuestionLocationSelector
                center={defaultCenter}
                onCenterChange={jest.fn()}
                setToLocationAccessibilityLabel="Set to location"
                testIDPrefix="test"
            />,
        );

        expect(screen.getByTestId("test-set-to-location-button")).toBeTruthy();
        expect(screen.getByText("Set to My Location")).toBeTruthy();
    });

    it("uses a custom button label", () => {
        const screen = render(
            <QuestionLocationSelector
                buttonLabel="Move Pin Here"
                center={defaultCenter}
                onCenterChange={jest.fn()}
                setToLocationAccessibilityLabel="Set to location"
                testIDPrefix="test"
            />,
        );

        expect(screen.getByText("Move Pin Here")).toBeTruthy();
    });

    it("hides the button when showSetToLocationButton is false", () => {
        const screen = render(
            <QuestionLocationSelector
                center={defaultCenter}
                onCenterChange={jest.fn()}
                setToLocationAccessibilityLabel="Set to location"
                showSetToLocationButton={false}
                testIDPrefix="test"
            />,
        );

        expect(screen.queryByTestId("test-set-to-location-button")).toBeNull();
    });

    it("calls onCenterChange with the user location when the button is pressed", async () => {
        const onCenterChange = jest.fn();
        const screen = render(
            <QuestionLocationSelector
                center={defaultCenter}
                onCenterChange={onCenterChange}
                setToLocationAccessibilityLabel="Set to location"
                testIDPrefix="test"
            />,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId("test-set-to-location-button"));
        });

        // expo-location is mocked globally to return (139.6503, 35.6762).
        expect(onCenterChange).toHaveBeenCalledWith([139.6503, 35.6762]);
    });

    it("sets the accessibility label on the button", () => {
        const screen = render(
            <QuestionLocationSelector
                center={defaultCenter}
                onCenterChange={jest.fn()}
                setToLocationAccessibilityLabel="Move pin to current GPS position"
                testIDPrefix="test"
            />,
        );

        expect(
            screen.getByLabelText("Move pin to current GPS position"),
        ).toBeTruthy();
    });
});

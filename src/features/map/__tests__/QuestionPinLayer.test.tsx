import { render } from "@testing-library/react-native";

import { QuestionPinLayer } from "../QuestionPinLayer";

const mockPinDrag = {
    draftCoordinate: null,
    draggedPinKey: null,
    dragHandlers: {
        handleDragEnd: jest.fn(),
        handleDragFinalize: jest.fn(),
        handleDragStart: jest.fn(),
        handleDragUpdate: jest.fn(),
    },
    gesture: {} as any,
    isDragging: false,
    revision: 0,
};

describe("QuestionPinLayer", () => {
    it("renders a shape source with id question-pins even when empty", () => {
        const screen = render(
            <QuestionPinLayer
                canMove={false}
                pins={[]}
                pinDrag={mockPinDrag}
            />,
        );
        const source = screen.getByTestId("map-shape-source");
        expect(source.props.id).toBe("question-pins");
        expect(source.props.shape.features).toEqual([]);
    });

    it("renders a single pin", () => {
        const screen = render(
            <QuestionPinLayer
                canMove={true}
                pins={[{ key: "center", position: [139.7, 35.66] }]}
                pinDrag={mockPinDrag}
            />,
        );
        const source = screen.getByTestId("map-shape-source");
        expect(source.props.shape.features).toHaveLength(1);
        expect(source.props.shape.features[0].geometry.coordinates).toEqual([
            139.7, 35.66,
        ]);
        expect(source.props.shape.features[0].properties.pinKey).toBe("center");
        expect(source.props.shape.features[0].properties.isDragging).toBe(
            false,
        );
    });

    it("renders two pins for thermometer", () => {
        const screen = render(
            <QuestionPinLayer
                canMove={true}
                pins={[
                    { key: "start", position: [139.7, 35.66] },
                    { key: "end", position: [139.72, 35.66] },
                ]}
                pinDrag={mockPinDrag}
            />,
        );
        const source = screen.getByTestId("map-shape-source");
        expect(source.props.shape.features).toHaveLength(2);
        expect(source.props.shape.features[0].properties.pinKey).toBe("start");
        expect(source.props.shape.features[1].properties.pinKey).toBe("end");
    });

    it("uses draft coordinate for the dragged pin", () => {
        const screen = render(
            <QuestionPinLayer
                canMove={true}
                pins={[
                    { key: "start", position: [139.7, 35.66] },
                    { key: "end", position: [139.72, 35.66] },
                ]}
                pinDrag={{
                    ...mockPinDrag,
                    isDragging: true,
                    draggedPinKey: "end",
                    draftCoordinate: [139.75, 35.66],
                }}
            />,
        );
        const source = screen.getByTestId("map-shape-source");
        const features = source.props.shape.features;
        expect(features[0].geometry.coordinates).toEqual([139.7, 35.66]);
        expect(features[1].geometry.coordinates).toEqual([139.75, 35.66]);
        expect(features[0].properties.isDragging).toBe(false);
        expect(features[1].properties.isDragging).toBe(true);
    });

    it("renders base glow and drag glow circle layers", () => {
        const screen = render(
            <QuestionPinLayer
                canMove={true}
                pins={[{ key: "center", position: [139.7, 35.66] }]}
                pinDrag={mockPinDrag}
            />,
        );
        const baseGlow = screen
            .getAllByTestId("map-circle-layer")
            .find((l) => l.props.id === "question-pin-glow-base");
        expect(baseGlow).toBeTruthy();
        // Data-driven color: uses MapLibre expression
        expect(baseGlow?.props.style.circleColor).toEqual([
            "to-color",
            ["get", "pinColor"],
            "#e46f4d",
        ]);
        expect(baseGlow?.props.style.circleRadius).toBe(24);

        const dragGlow = screen
            .getAllByTestId("map-circle-layer")
            .find((l) => l.props.id === "question-pin-glow-drag");
        expect(dragGlow).toBeTruthy();
        expect(dragGlow?.props.style.circleColor).toBe("#ffffff");
        expect(dragGlow?.props.style.circleRadius).toBe(60);
        expect(dragGlow?.props.filter).toEqual(["==", "isDragging", true]);
    });

    it("uses blue glow color for thermometer start pin", () => {
        const screen = render(
            <QuestionPinLayer
                canMove={true}
                pins={[{ key: "start", position: [139.7, 35.66] }]}
                pinDrag={mockPinDrag}
            />,
        );
        const source = screen.getByTestId("map-shape-source");
        expect(source.props.shape.features[0].properties.pinColor).toBe(
            "#4a90d9",
        );
    });

    it("reduces glow opacity when canMove is false", () => {
        const screen = render(
            <QuestionPinLayer
                canMove={false}
                pins={[{ key: "center", position: [139.7, 35.66] }]}
                pinDrag={mockPinDrag}
            />,
        );
        const baseGlow = screen
            .getAllByTestId("map-circle-layer")
            .find((l) => l.props.id === "question-pin-glow-base");
        expect(baseGlow?.props.style.circleOpacity).toBe(0.15);

        const dragGlow = screen
            .getAllByTestId("map-circle-layer")
            .find((l) => l.props.id === "question-pin-glow-drag");
        expect(dragGlow?.props.style.circleOpacity).toBe(0.15);
    });

    it("renders the pin icon symbol layer", () => {
        const screen = render(
            <QuestionPinLayer
                canMove={true}
                pins={[{ key: "center", position: [139.7, 35.66] }]}
                pinDrag={mockPinDrag}
            />,
        );
        const iconLayer = screen
            .getAllByTestId("map-symbol-layer")
            .find((l) => l.props.id === "question-pin-icon");
        expect(iconLayer).toBeTruthy();
        // Data-driven icon: uses MapLibre match expression
        expect(iconLayer?.props.style.iconImage).toEqual([
            "match",
            ["get", "pinKey"],
            "start",
            "question-pin-start",
            "question-pin",
        ]);
    });
});

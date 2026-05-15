/// <reference types="jest" />

jest.mock("expo-location", () => ({
    Accuracy: {
        Balanced: 3,
    },
    getCurrentPositionAsync: jest.fn().mockResolvedValue({
        coords: { latitude: 35.6762, longitude: 139.6503 },
        timestamp: Date.now(),
    }),
    requestForegroundPermissionsAsync: jest
        .fn()
        .mockResolvedValue({ status: "granted" }),
}));

jest.mock("@maplibre/maplibre-react-native", () => {
    const React = require("react");
    const { View } = require("react-native");

    const cameraMethods = {
        fitBounds: jest.fn(),
        setCamera: jest.fn(),
    };

    const createMapComponent =
        (testID) =>
        ({ children, testID: providedTestID, ...props }) =>
            React.createElement(
                View,
                { ...props, testID: providedTestID ?? testID },
                children,
            );

    const Camera = React.forwardRef(({ children, ...props }, ref) => {
        React.useImperativeHandle(ref, () => cameraMethods);
        return React.createElement(
            View,
            { ...props, testID: "map-camera" },
            children,
        );
    });

    return {
        Camera,
        LineLayer: createMapComponent("map-line-layer"),
        MapView: createMapComponent("map-view"),
        ShapeSource: createMapComponent("map-shape-source"),
        UserLocation: createMapComponent("map-user-location"),
        __cameraMethods: cameraMethods,
        setAccessToken: jest.fn(),
    };
});

jest.mock("react-native-reanimated", () =>
    require("react-native-reanimated/mock"),
);

jest.mock("@gorhom/bottom-sheet", () => {
    const React = require("react");
    const { View } = require("react-native");

    const BottomSheet = React.forwardRef(({ children, ...props }, ref) =>
        React.createElement(View, { ...props, ref, testID: "bottom-sheet" }, children),
    );

    return {
        __esModule: true,
        BottomSheetView: ({ children, ...props }) =>
            React.createElement(
                View,
                { ...props, testID: "bottom-sheet-view" },
                children,
            ),
        default: BottomSheet,
    };
});

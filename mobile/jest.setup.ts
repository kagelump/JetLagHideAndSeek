// AsyncStorage is mocked via moduleNameMapper in jest.config.js

// Mock expo-location
jest.mock("expo-location", () => ({
    requestForegroundPermissionsAsync: jest
        .fn()
        .mockResolvedValue({ status: "granted" }),
    getCurrentPositionAsync: jest.fn().mockResolvedValue({
        coords: { latitude: 35.6762, longitude: 139.6503, accuracy: 5 },
        timestamp: Date.now(),
    }),
    watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
    Accuracy: {
        Lowest: 1,
        Low: 2,
        Balanced: 3,
        High: 4,
        Highest: 5,
        BestForNavigation: 6,
    },
}));

// Mock expo-clipboard
jest.mock("expo-clipboard", () => ({
    setStringAsync: jest.fn().mockResolvedValue(undefined),
    getStringAsync: jest.fn().mockResolvedValue(""),
}));

// Mock @maplibre/maplibre-react-native
jest.mock("@maplibre/maplibre-react-native", () => ({
    MapView: "MapView",
    Camera: "Camera",
    ShapeSource: "ShapeSource",
    FillLayer: "FillLayer",
    LineLayer: "LineLayer",
    SymbolLayer: "SymbolLayer",
    CircleLayer: "CircleLayer",
    RasterSource: "RasterSource",
    RasterLayer: "RasterLayer",
    PointAnnotation: "PointAnnotation",
    MarkerView: "MarkerView",
    UserLocation: "UserLocation",
    setAccessToken: jest.fn(),
}));

// Mock react-native-toast-message
jest.mock("react-native-toast-message", () => ({
    __esModule: true,
    default: {
        show: jest.fn(),
    },
}));

// Mock react-native-reanimated (using __mocks__ to avoid jest.mock factory scoping issues)
jest.mock("react-native-reanimated");

// Mock react-native-worklets to prevent native module init in tests
jest.mock("react-native-worklets", () => ({
    useSharedValue: (init: any) => ({ value: init }),
    useAnimatedStyle: (cb: any) => cb(),
    useAnimatedScrollHandler: () => () => {},
    withTiming: (toValue: any) => toValue,
    withSpring: (toValue: any) => toValue,
    runOnJS: (fn: any) => fn,
    interpolate: (value: any) => value,
    interpolateColor: (value: any) => value,
    cancelAnimation: () => {},
    Easing: {
        out: (t: any) => t,
        inOut: (t: any) => t,
        linear: (t: any) => t,
        bezier: () => (t: any) => t,
        bounce: (t: any) => t,
    },
}));

// Mock react-native-gesture-handler
jest.mock("react-native-gesture-handler", () => ({
    GestureHandlerRootView: "GestureHandlerRootView",
    PanGestureHandler: "PanGestureHandler",
    State: { ACTIVE: 4, END: 5 },
}));

// Mock @gorhom/bottom-sheet (native deps make it untestable in Jest)
jest.mock("@gorhom/bottom-sheet", () => ({
    __esModule: true,
    default: "BottomSheet",
    BottomSheet: "BottomSheet",
    BottomSheetBackdrop: "BottomSheetBackdrop",
    BottomSheetScrollView: "BottomSheetScrollView",
    BottomSheetTextInput: "BottomSheetTextInput",
    BottomSheetModal: "BottomSheetModal",
    BottomSheetModalProvider: "BottomSheetModalProvider",
}));

// Mock posthog-react-native
jest.mock("posthog-react-native", () => ({
    usePostHog: () => ({
        capture: jest.fn(),
        identify: jest.fn(),
    }),
    PostHogProvider: "PostHogProvider",
}));

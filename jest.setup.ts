/// <reference types="jest" />

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
    if (
        typeof args[0] === "string" &&
        args[0].includes("was not wrapped in act(...)")
    ) {
        return;
    }
    originalConsoleError(...args);
};

jest.mock("expo-location", () => ({
    Accuracy: {
        Balanced: 3,
    },
    getCurrentPositionAsync: jest.fn().mockResolvedValue({
        coords: { latitude: 35.6762, longitude: 139.6503 },
        timestamp: Date.now(),
    }),
    getForegroundPermissionsAsync: jest
        .fn()
        .mockResolvedValue({ granted: true, status: "granted" }),
    requestForegroundPermissionsAsync: jest
        .fn()
        .mockResolvedValue({ status: "granted" }),
}));

jest.mock("expo-router", () => ({
    Link: ({ children }: { children: React.ReactNode }) => children,
    Stack: ({ children }: { children?: React.ReactNode }) => children,
    useLocalSearchParams: jest.fn(() => ({})),
    useRouter: jest.fn(() => ({
        replace: jest.fn(),
    })),
}));

jest.mock("@react-native-async-storage/async-storage", () => {
    let store = {};
    return {
        __esModule: true,
        default: {
            clear: jest.fn(() => {
                store = {};
                return Promise.resolve();
            }),
            getItem: jest.fn((key) => Promise.resolve(store[key] ?? null)),
            getAllKeys: jest.fn(() => Promise.resolve(Object.keys(store))),
            multiGet: jest.fn((keys) =>
                Promise.resolve(keys.map((key) => [key, store[key] ?? null])),
            ),
            multiRemove: jest.fn((keys) => {
                keys.forEach((key) => {
                    delete store[key];
                });
                return Promise.resolve();
            }),
            multiSet: jest.fn((entries) => {
                entries.forEach(([key, value]) => {
                    store[key] = value;
                });
                return Promise.resolve();
            }),
            removeItem: jest.fn((key) => {
                delete store[key];
                return Promise.resolve();
            }),
            setItem: jest.fn((key, value) => {
                store[key] = value;
                return Promise.resolve();
            }),
        },
    };
});

jest.mock("@maplibre/maplibre-react-native", () => {
    const React = require("react");
    const { View } = require("react-native");

    const cameraMethods = {
        fitBounds: jest.fn(),
        setCamera: jest.fn(),
    };

    const mapMethods = {
        getCoordinateFromView: jest.fn(),
        getPointInView: jest.fn(),
    };

    const OfflineManager = {
        setMaximumAmbientCacheSize: jest.fn().mockResolvedValue(undefined),
    };

    const createMapComponent =
        (testID) =>
        ({ children, testID: providedTestID, ...props }) =>
            React.createElement(
                View,
                { ...props, testID: providedTestID ?? testID },
                children,
            );

    const MapView = React.forwardRef(
        ({ children, testID: passedTestID, ...props }: any, ref: any) => {
            React.useImperativeHandle(ref, () => mapMethods);
            return React.createElement(
                View,
                { ...props, testID: passedTestID ?? "map-view" },
                children,
            );
        },
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
        CircleLayer: createMapComponent("map-circle-layer"),
        FillLayer: createMapComponent("map-fill-layer"),
        Images: createMapComponent("map-images"),
        LineLayer: createMapComponent("map-line-layer"),
        MapView,
        OfflineManager,
        PointAnnotation: createMapComponent("map-point-annotation"),
        ShapeSource: createMapComponent("map-shape-source"),
        SymbolLayer: createMapComponent("map-symbol-layer"),
        UserLocation: createMapComponent("map-user-location"),
        __cameraMethods: cameraMethods,
        __mapMethods: mapMethods,
        setAccessToken: jest.fn(),
    };
});

jest.mock("react-native-reanimated", () => {
    const { View } = require("react-native");
    const noopFn = () => {};
    const noopAnimation = {
        duration: () => noopAnimation,
        start: noopFn,
        stop: noopFn,
    };
    const createAnimation = () => noopAnimation;
    createAnimation.duration = () => noopAnimation;

    return {
        __esModule: true,
        default: {
            View,
            Text: View,
            Image: View,
            ScrollView: View,
            createAnimatedComponent: (c) => c,
            addWhitelistedUIProps: noopFn,
        },
        useSharedValue: (init) => ({ value: init }),
        useDerivedValue: (fn) => ({ value: fn() }),
        useAnimatedProps: noopFn,
        useAnimatedStyle: () => ({}),
        useEvent: () => noopFn,
        useHandler: noopFn,
        withTiming: () => 0,
        withSpring: () => 0,
        withRepeat: () => 0,
        withSequence: () => 0,
        withDelay: () => 0,
        cancelAnimation: noopFn,
        runOnJS: (fn) => fn,
        runOnUI: (fn) => fn,
        SlideInLeft: createAnimation,
        SlideInRight: createAnimation,
        SlideOutLeft: createAnimation,
        SlideOutRight: createAnimation,
        FadeIn: createAnimation,
        FadeOut: createAnimation,
        LinearTransition: createAnimation,
    };
});

jest.mock("react-native-gesture-handler", () => {
    const RNGH: any = jest.requireActual("react-native-gesture-handler");

    const gestureCallbacksExposed: Record<string, jest.Mock> = {};

    function createGestureMocks() {
        return {
            Pan: () => {
                const gesture: Record<string, any> = {};
                let isDragGesture = false;

                const chainable =
                    (name: string) =>
                    (...args: any[]) => {
                        if (args.length > 0 && isDragGesture) {
                            gestureCallbacksExposed[name] = jest.fn(args[0]);
                        }
                        return gesture;
                    };

                gesture.activateAfterLongPress = () => {
                    isDragGesture = true;
                    return gesture;
                };
                gesture.enabled = () => gesture;
                gesture.activeOffsetX = () => gesture;
                gesture.onStart = chainable("onStart");
                gesture.onUpdate = chainable("onUpdate");
                gesture.onEnd = chainable("onEnd");
                gesture.onFinalize = chainable("onFinalize");

                return gesture;
            },
        };
    }

    return {
        ...RNGH,
        GestureDetector: ({ children }: { children: React.ReactNode }) =>
            children,
        GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
            children,
        Gesture: createGestureMocks(),
        __gestureCallbacks: gestureCallbacksExposed,
    };
});

jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
    const React = require("react");
    const { View } = require("react-native");

    return {
        __esModule: true,
        default: ({
            children,
            renderRightActions,
            ...props
        }: {
            children: React.ReactNode;
            renderRightActions?: () => React.ReactNode;
        }) =>
            React.createElement(
                View,
                { ...props, testID: "swipeable-row" },
                children,
                renderRightActions?.(),
            ),
    };
});

jest.mock("@gorhom/bottom-sheet", () => {
    const React = require("react");
    const { ScrollView, View } = require("react-native");

    const bottomSheetMethods = {
        snapToIndex: jest.fn(),
    };

    const BottomSheet = React.forwardRef(({ children, ...props }, ref) => {
        React.useImperativeHandle(ref, () => bottomSheetMethods);
        return React.createElement(
            View,
            { ...props, ref, testID: "bottom-sheet" },
            children,
        );
    });

    return {
        __esModule: true,
        BottomSheetView: ({ children, ...props }) =>
            React.createElement(
                View,
                { ...props, testID: "bottom-sheet-view" },
                children,
            ),
        BottomSheetScrollView: ({ children, ...props }) =>
            React.createElement(
                ScrollView,
                { ...props, testID: "bottom-sheet-scroll-view" },
                children,
            ),
        default: BottomSheet,
        __bottomSheetMethods: bottomSheetMethods,
    };
});

jest.mock("qrcode/lib/core/qrcode", () => ({
    create: () => ({
        modules: {
            data: [true, false, true, false],
            size: 2,
        },
    }),
}));

// In tests, load the transit preset JSON synchronously via require() so
// tests don't need dynamic import support. In the real app, the module uses
// the generated require-map (transitBundles.generated.ts) for lazy loading.
jest.mock("@/features/hidingZone/hidingZoneData", () => {
    let cached: any[] | null = null;
    let loadPromise: Promise<any[]> | null = null;

    function loadPresets(_bbox?: unknown) {
        void _bbox;
        if (!loadPromise) {
            loadPromise = Promise.resolve().then(() => {
                const raw = require("./assets/transit/japan-kanto.json");
                cached = raw.presets;
                return cached;
            });
        }
        return loadPromise;
    }

    return {
        __esModule: true,
        loadHidingZonePresets: (bbox?: any) => loadPresets(bbox),
        getHidingZonePresets: () => {
            if (!cached) throw new Error("Presets not loaded yet");
            return cached;
        },
        getHidingZonePresetsOrEmpty: () => cached ?? [],
        getTransitManifest: () => ({
            version: 1,
            bundles: [
                {
                    id: "japan-kanto",
                    bbox: [138.4, 34.8, 140.9, 37.1],
                    file: "japan-kanto.json",
                    presets: [
                        {
                            id: "tokyo-metro",
                            label: "Tokyo Metro",
                            bbox: [139.6, 35.6, 140.0, 35.8],
                        },
                        {
                            id: "toei-subway",
                            label: "Toei Subway",
                            bbox: [139.6, 35.5, 140.0, 35.9],
                        },
                    ],
                },
            ],
        }),
        clearTransitBundleCache: () => {
            cached = null;
            loadPromise = null;
        },
    };
});

// Mock the native-geometry Expo Module so Jest always falls back to the JS
// geometry backend (G0 seam). The native GEOS module cannot run in Jest.
// The module resolves on disk (modules/native-geometry/src/index.ts) via
// the pnpm workspace / symlink — without this mock, importing it would
// call requireNativeModule (no native runtime) and try to transform TS
// outside transformIgnorePatterns.
jest.mock("native-geometry", () => ({
    __esModule: true,
    isAvailable: () => false,
    geosVersion: () => "mock",
    bufferWKB: () => null,
    differenceWKB: () => null,
    unionWKB: () => null,
    intersectionWKB: () => null,
    unaryUnionWKB: () => null,
}));

// Mock setupPersister globally — the persister's subscription and 30-day
// maxAge timer (BOUNDARY_CACHE_TTL_MS) bleed past fake-timer boundaries
// and the 30-day value overflows Node's 32-bit setTimeout. The real
// queryClient singleton is still used; only the AsyncStorage-backed
// persistence setup is stubbed.
jest.mock("@/state/queryClient", () => {
    const actual = jest.requireActual<typeof import("@/state/queryClient")>(
        "@/state/queryClient",
    );
    return {
        __esModule: true,
        ...actual,
        setupPersister: jest.fn(() => Promise.resolve()),
    };
});

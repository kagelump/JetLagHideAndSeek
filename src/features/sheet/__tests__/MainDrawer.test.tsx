import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ANIMATION } from "@/config/appConfig";
import { MainDrawer } from "@/features/sheet/MainDrawer";
import { AppStateProviders } from "@/state/AppStateProviders";

// Override the global reanimated mock with a stable useSharedValue so that
// useCallback/useEffect deps that depend on shared values don't churn on
// every render. The global mock returns a fresh {value} object per call,
// which destabilises beginTransition → handleNavigate → all effects.
jest.mock("react-native-reanimated", () => {
    const RN = require("react-native");
    const React = require("react");
    const noopFn = () => {};

    return {
        __esModule: true,
        default: {
            View: RN.View,
            Text: RN.View,
            Image: RN.View,
            ScrollView: RN.View,
            createAnimatedComponent: (c: any) => c,
            addWhitelistedUIProps: noopFn,
        },
        useSharedValue: (init: number) => {
            const ref = React.useRef({ value: init });
            return ref.current;
        },
        useDerivedValue: (fn: () => any) => ({ value: fn() }),
        useAnimatedProps: noopFn,
        useAnimatedStyle: () => ({}),
        useEvent: () => noopFn,
        useHandler: noopFn,
        withTiming: (toValue: number) => toValue,
        withSpring: (toValue: number) => toValue,
        withRepeat: () => 0,
        withSequence: () => 0,
        withDelay: () => 0,
        cancelAnimation: noopFn,
        runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
        runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
        SlideInLeft: noopFn,
        SlideInRight: noopFn,
        SlideOutLeft: noopFn,
        SlideOutRight: noopFn,
        FadeIn: noopFn,
        FadeOut: noopFn,
        LinearTransition: noopFn,
    };
});

// ─── Lifecycle-tracking mock screens ──────────────────────────────────

const mockMountLog: Record<string, string[]> = {
    main: [],
    settings: [],
};

jest.mock("@/features/sheet/MainSheetContent", () => {
    const R = require("react");
    const RN = require("react-native");
    return {
        MainSheetContent: ({ onNavigate }: any) => {
            R.useEffect(() => {
                mockMountLog.main.push("mount");
                return () => {
                    mockMountLog.main.push("unmount");
                };
            }, []);
            return (
                <RN.View testID="mock-main">
                    <RN.Pressable
                        testID="nav-settings"
                        onPress={() => onNavigate("settings")}
                    >
                        <RN.Text>Settings</RN.Text>
                    </RN.Pressable>
                </RN.View>
            );
        },
    };
});

jest.mock("@/features/sheet/SettingsScreen", () => {
    const R = require("react");
    const RN = require("react-native");
    return {
        SettingsScreen: ({ onNavigate }: any) => {
            R.useEffect(() => {
                mockMountLog.settings.push("mount");
                return () => {
                    mockMountLog.settings.push("unmount");
                };
            }, []);
            return (
                <RN.View testID="mock-settings">
                    <RN.Pressable
                        testID="nav-back-main"
                        onPress={() => onNavigate("main")}
                    >
                        <RN.Text>Back</RN.Text>
                    </RN.Pressable>
                </RN.View>
            );
        },
    };
});

const SAFE_AREA = {
    frame: { height: 844, width: 390, x: 0, y: 0 },
    insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

function renderDrawer(initialRoute: "main" | "settings" = "main") {
    const onNavigate = jest.fn();
    const result = render(
        <SafeAreaProvider initialMetrics={SAFE_AREA}>
            <AppStateProviders>
                <MainDrawer route={initialRoute} onNavigate={onNavigate} />
            </AppStateProviders>
        </SafeAreaProvider>,
    );
    return { ...result, onNavigate };
}

function completeTransition() {
    act(() => {
        jest.advanceTimersByTime(ANIMATION.sheetTransitionMs + 50);
    });
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("MainDrawer transitions", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockMountLog.main = [];
        mockMountLog.settings = [];
    });
    afterEach(() => jest.useRealTimers());

    it("mounts initial route content exactly once", () => {
        renderDrawer();
        expect(mockMountLog.main).toEqual(["mount"]);
        expect(mockMountLog.settings).toEqual([]);
    });

    it("does not remount leaving content during a forward transition", () => {
        const { getByTestId } = renderDrawer();

        fireEvent.press(getByTestId("nav-settings"));

        expect(mockMountLog.main).toEqual(["mount"]);
        expect(mockMountLog.settings).toEqual(["mount"]);
        expect(getByTestId("mock-main")).toBeTruthy();
        expect(getByTestId("mock-settings")).toBeTruthy();
    });

    it("unmounts leaving content after transition completes", () => {
        const { queryByTestId, getByTestId } = renderDrawer();

        fireEvent.press(getByTestId("nav-settings"));
        completeTransition();

        expect(mockMountLog.main).toEqual(["mount", "unmount"]);
        expect(queryByTestId("mock-main")).toBeNull();
        expect(queryByTestId("mock-settings")).toBeTruthy();
    });

    it("does not remount leaving content during a back transition", () => {
        const { getByTestId } = renderDrawer();

        fireEvent.press(getByTestId("nav-settings"));
        completeTransition();

        mockMountLog.main = [];
        mockMountLog.settings = [];

        fireEvent.press(getByTestId("nav-back-main"));

        expect(mockMountLog.settings).toEqual([]);
        expect(mockMountLog.main).toEqual(["mount"]);
        expect(getByTestId("mock-main")).toBeTruthy();
        expect(getByTestId("mock-settings")).toBeTruthy();
    });

    it("cleans up after a back transition", () => {
        const { getByTestId, queryByTestId } = renderDrawer();

        fireEvent.press(getByTestId("nav-settings"));
        completeTransition();

        mockMountLog.main = [];
        mockMountLog.settings = [];

        fireEvent.press(getByTestId("nav-back-main"));
        completeTransition();

        expect(mockMountLog.settings).toEqual(["unmount"]);
        expect(queryByTestId("mock-settings")).toBeNull();
        expect(queryByTestId("mock-main")).toBeTruthy();
    });
});

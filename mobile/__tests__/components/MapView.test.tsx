/// <reference path="../../../node_modules/@types/jest/index.d.ts" />
import { act, render } from "@testing-library/react-native";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Wrapper that provides SafeAreaContext needed by useSafeAreaInsets()
const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <SafeAreaProvider
        initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
    >
        {children}
    </SafeAreaProvider>
);

const renderWithSafeArea = (ui: React.ReactElement) =>
    render(ui, { wrapper: Wrapper });

// Mock heavy hooks before importing MapView
jest.mock("../../hooks/useZoneBoundary", () => ({
    useZoneBoundary: jest.fn().mockReturnValue({ isLoadingZone: false }),
}));

jest.mock("../../hooks/useEliminationMask", () => ({
    useEliminationMask: jest.fn().mockReturnValue({
        eliminationMask: null,
        zoneBoundary: null,
        radiusRegions: [],
        thermometerRegions: [],
        tentaclesRegions: [],
        matchingRegions: [],
        measuringRegions: [],
        isComputingLayers: false,
    }),
}));

jest.mock("../../hooks/useHidingZones", () => ({
    useHidingZones: jest.fn().mockReturnValue({
        hidingZoneCircles: [],
        hidingZoneMask: null,
        hidingZonePois: null,
        isLoading: false,
    }),
}));

jest.mock("../../hooks/useUserLocation", () => ({
    useUserLocation: jest.fn().mockReturnValue({
        userCoord: null,
        hasLocationPermission: false,
        locateMode: false,
        onLocatePress: jest.fn(),
        handleLocationUpdate: jest.fn(),
    }),
}));

jest.mock("../../hooks/useThunderforestBudget", () => ({
    useThunderforestBudget: jest.fn().mockReturnValue({
        overLimit: false,
        handleRegionDidChange: jest.fn(),
    }),
}));

jest.mock("../../hooks/useUpdateCheck", () => ({
    useUpdateCheck: jest.fn().mockReturnValue({
        hasUpdate: false,
        latestVersion: "1.0.0",
        storeUrl: "",
    }),
}));

// Import after mocks are set up
import { AppMapView } from "../../components/MapView";
import { mapGeoJSON } from "../../lib/context";

describe("AppMapView", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mapGeoJSON.set(null);
    });

    it("renders without crashing", async () => {
        expect(() => renderWithSafeArea(<AppMapView />)).not.toThrow();
    });

    it("shows loading overlay when mapGeoJSON is null", async () => {
        const { getByText } = renderWithSafeArea(<AppMapView />);
        expect(getByText("Fetching zone boundary from OpenStreetMap…")).toBeTruthy();
    });

    it("hides loading overlay when mapGeoJSON is populated", async () => {
        mapGeoJSON.set({
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    geometry: {
                        type: "Polygon",
                        coordinates: [
                            [
                                [139, 35],
                                [140, 35],
                                [140, 36],
                                [139, 36],
                                [139, 35],
                            ],
                        ],
                    },
                    properties: {},
                },
            ],
        });

        const { queryByText } = renderWithSafeArea(<AppMapView />);
        expect(queryByText("Fetching zone boundary from OpenStreetMap…")).toBeNull();
    });
});

// Stub loadPlayAreaByRelationId for Osaka (358674) so the persistence
// test doesn't hit Overpass. Osaka was previously bundled; after bundle
// removal it resolves via network which is not mocked in Jest.
jest.mock("@/features/map/playAreaBoundary", () => {
    const actual = jest.requireActual<
        typeof import("@/features/map/playAreaBoundary")
    >("@/features/map/playAreaBoundary");
    return {
        ...actual,
        loadPlayAreaByRelationId: jest.fn(async (relationId: number) => {
            if (relationId === 358674) {
                return {
                    cacheSource: "bundled" as const,
                    playArea: {
                        osmId: 358674,
                        osmType: "R" as const,
                        label: "Osaka",
                        bbox: [135.3, 34.6, 135.7, 34.8] as [
                            number,
                            number,
                            number,
                            number,
                        ],
                        center: [135.5, 34.7] as [number, number],
                        boundary: {
                            type: "FeatureCollection" as const,
                            features: [],
                        },
                    },
                };
            }
            return actual.loadPlayAreaByRelationId(relationId);
        }),
    };
});

import { act, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Text, View } from "react-native";

import { defaultPlayArea } from "@/features/map/playArea";
import { loadPlayAreaByRelationId } from "@/features/map/playAreaBoundary";
import { createAppStateV1 } from "@/state/appState";
import { AppStateProviders } from "@/state/AppStateProviders";
import { loadPersistedAppState, persistAppState } from "@/state/persistence";
import { queryClient } from "@/state/queryClient";
import { usePlayArea } from "@/state/playAreaStore";

function Probe() {
    const { playArea, isRestored } = usePlayArea();
    return (
        <View>
            <Text testID="probe-label">{playArea.label}</Text>
            <Text testID="probe-osm-id">{playArea.osmId}</Text>
            <Text testID="probe-restored">{String(isRestored)}</Text>
        </View>
    );
}

function renderProvider(children = <Probe />) {
    return render(<AppStateProviders>{children}</AppStateProviders>);
}

function makeAppState(playArea = defaultPlayArea) {
    return createAppStateV1({
        hidingZones: {
            radiusMeters: 600,
            radiusUnit: "m",
            selectedPresetIds: [],
        },
        now: new Date("2026-05-18T00:00:00.000Z"),
        playArea,
    });
}

describe("PlayAreaProvider app-state persistence", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        queryClient.clear();
    });

    it("uses default play area when nothing is persisted", async () => {
        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        expect(screen.getByTestId("probe-label")).toHaveTextContent(
            "Tokyo 23 Wards",
        );
    });

    it("restores a persisted full play-area snapshot on mount", async () => {
        const { playArea: osaka } = await loadPlayAreaByRelationId(358674);
        await persistAppState(makeAppState(osaka));

        const screen = renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        expect(screen.getByTestId("probe-label")).toHaveTextContent("Osaka");
        expect(screen.getByTestId("probe-osm-id")).toHaveTextContent("358674");
    });

    it("persists default app state after initial restore completes", async () => {
        renderProvider();

        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            expect(persisted?.playArea.osmId).toBe(19631009);
            expect(persisted?.questions).toEqual([]);
        });
    });

    it("persists play-area changes via importPlayArea", async () => {
        let importPlayAreaFn:
            | ReturnType<typeof usePlayArea>["importPlayArea"]
            | null = null;

        function ActionProbe() {
            const ctx = usePlayArea();
            importPlayAreaFn = ctx.importPlayArea;
            return <Probe />;
        }

        const screen = renderProvider(<ActionProbe />);

        await waitFor(() => {
            expect(screen.getByTestId("probe-restored")).toHaveTextContent(
                "true",
            );
        });

        expect(importPlayAreaFn).not.toBeNull();
        act(() => {
            importPlayAreaFn!({
                bbox: [139.7, 35.6, 139.8, 35.7],
                boundary: {
                    features: [],
                    type: "FeatureCollection",
                },
                center: [139.75, 35.65],
                label: "Imported Area",
                osmId: 888888,
                osmType: "R",
            });
        });

        await waitFor(async () => {
            const persisted = await loadPersistedAppState();
            expect(persisted?.playArea.osmId).toBe(888888);
            expect(persisted?.questions).toEqual([]);
        });
    });
});

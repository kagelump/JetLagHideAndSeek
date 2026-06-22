import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { AppState } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";

import {
    appStateHidingZonesToImportState,
    appStatePlayAreaToImportState,
    appStateQuestionSettingsToImportState,
    createAppStateV1,
} from "@/state/appState";
import {
    DEFAULT_RADIUS_IMPERIAL_MI,
    DEFAULT_RADIUS_METERS,
    HidingZoneProvider,
    useHidingZoneActions,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import { isPlayAreaSet } from "@/features/map/playArea";
import { cleanOrphanedBoundaryKeys } from "@/features/map/playAreaBoundary";
import { METERS_PER_MILE } from "@/shared/distanceUnits";
import { defaultUnitSystemForPlayArea } from "@/shared/unitSystemDefaults";
import { loadInstalledPacks } from "@/features/offline/regionPacks";
import { persistDebounceMs } from "@/state/debounceConfig";
import { loadPersistedAppState, persistAppState } from "@/state/persistence";
import { PlayAreaProvider, usePlayArea } from "@/state/playAreaStore";
import { queryClient, setupPersister } from "@/state/queryClient";
import {
    QuestionProvider,
    useQuestionActions,
    useQuestionState,
    useQuestions,
} from "@/state/questionStore";
import { createLogger } from "@/shared/logger";
import { installE2eFixturePack } from "@/testing/e2e/installE2eFixturePack";

const log = createLogger("appStateProviders");

// ---------------------------------------------------------------------------
// Restoration context — consumed by the root layout to gate the splash screen
// ---------------------------------------------------------------------------

type AppReadinessValue = {
    isMapReady: boolean;
    isRestored: boolean;
    markMapReady: () => void;
};

const AppReadinessContext = createContext<AppReadinessValue>({
    isMapReady: false,
    isRestored: false,
    markMapReady: () => {},
});

/**
 * Returns `true` once all provider slices have been restored from persisted
 * state (or defaulted). The root layout uses this to hold the splash screen
 * until the first meaningful frame is ready.
 */
export function useAppIsRestored(): boolean {
    return useContext(AppReadinessContext).isRestored;
}

export function useAppIsReady(): boolean {
    const { isMapReady, isRestored } = useContext(AppReadinessContext);
    return isMapReady && isRestored;
}

export function useMarkAppMapReady(): () => void {
    return useContext(AppReadinessContext).markMapReady;
}

export function AppStateProviders({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            <PlayAreaProvider>
                <HidingZoneProvider>
                    <QuestionProvider>
                        <AppStatePersistenceCoordinator>
                            {children}
                        </AppStatePersistenceCoordinator>
                    </QuestionProvider>
                </HidingZoneProvider>
            </PlayAreaProvider>
        </QueryClientProvider>
    );
}

function AppStatePersistenceCoordinator({ children }: { children: ReactNode }) {
    const playAreaStore = usePlayArea();
    const hidingZoneState = useHidingZoneState();
    const hidingZoneActions = useHidingZoneActions();
    const questionState = useQuestionState();
    const questionActions = useQuestionActions();
    const questions = useQuestions();
    const isRestored =
        playAreaStore.isRestored &&
        hidingZoneState.isRestored &&
        questionState.isRestored;
    const createdAtRef = useRef<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);
    const pendingPersistRef = useRef<
        ReturnType<typeof createAppStateV1> | undefined
    >(undefined);

    const flushPersist = useCallback(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }

        const pendingState = pendingPersistRef.current;
        if (!pendingState) return;

        pendingPersistRef.current = undefined;
        void persistAppState(pendingState);
    }, []);

    const debouncedPersist = useCallback(
        (state: ReturnType<typeof createAppStateV1>) => {
            pendingPersistRef.current = state;
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            debounceRef.current = setTimeout(flushPersist, persistDebounceMs);
        },
        [flushPersist],
    );
    const markMapReady = useCallback(() => {
        setIsMapReady(true);
    }, []);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            // Set up the persister and wait for it to rehydrate the query
            // cache from AsyncStorage so that boundary lookups during
            // app-state restore resolve without a network call.
            const persisterPromise = setupPersister();
            await persisterPromise;

            if (cancelled) return;

            const persisted = await loadPersistedAppState();
            if (cancelled) return;

            if (persisted) {
                createdAtRef.current = persisted.metadata.createdAt;
                playAreaStore.importPlayArea(
                    appStatePlayAreaToImportState(persisted.playArea),
                );
                hidingZoneActions.replaceSetup(
                    appStateHidingZonesToImportState(persisted.hidingZones),
                );
                questionActions.importQuestions(persisted.questions);
                questionActions.importQuestionSettings(
                    appStateQuestionSettingsToImportState(
                        persisted.questionSettings,
                    ),
                );
            }

            playAreaStore.markRestored();
            hidingZoneActions.markRestored();
            questionActions.markRestored();

            // Clean up orphaned pre-migration boundary cache keys in the
            // background — non-blocking.
            cleanOrphanedBoundaryKeys();

            // Restore installed POI packs from the filesystem so matching
            // resolves locally across app restarts (non-blocking).
            // On E2E runs, pre-install the committed fixture pack so scenarios have real
            // stations without downloading anything. Failures are logged and non-fatal —
            // the normal installed-packs path still runs.
            void (async () => {
                try {
                    await installE2eFixturePack();
                } catch (err) {
                    log.error("E2E fixture pack install failed", err);
                }
                await loadInstalledPacks();
            })();
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (state !== "active") {
                flushPersist();
            }
        });

        return () => {
            subscription.remove();
            flushPersist();
        };
    }, [flushPersist]);

    // Auto-pick the unit system from the play area's geography (imperial in the
    // US, metric elsewhere) until the player overrides it in Settings. Seeds the
    // matching hiding-zone radius default while the radius is still untouched.
    const playArea = playAreaStore.playArea;
    const { radiusMeters, radiusUnit } = hidingZoneState;
    const { applyDefaultUnitSystem } = questionActions;
    const { setRadius } = hidingZoneActions;
    useEffect(() => {
        if (!isRestored) return;
        if (questionState.unitSystemChosen) return;
        if (!isPlayAreaSet(playArea)) return;

        const next = defaultUnitSystemForPlayArea(playArea);
        if (next === questionState.unitSystem) return;

        applyDefaultUnitSystem(next);

        // Convert the radius default to match, but only when it's still at
        // either system's untouched default (don't clobber a custom radius).
        const imperialMeters = DEFAULT_RADIUS_IMPERIAL_MI * METERS_PER_MILE;
        const radiusUntouched =
            (radiusUnit === "m" && radiusMeters === DEFAULT_RADIUS_METERS) ||
            (radiusUnit === "mi" &&
                Math.abs(radiusMeters - imperialMeters) < 0.5);
        if (radiusUntouched) {
            if (next === "imperial") {
                setRadius(String(DEFAULT_RADIUS_IMPERIAL_MI), "mi");
            } else {
                setRadius(String(DEFAULT_RADIUS_METERS), "m");
            }
        }
    }, [
        applyDefaultUnitSystem,
        isRestored,
        playArea,
        questionState.unitSystem,
        questionState.unitSystemChosen,
        radiusMeters,
        radiusUnit,
        setRadius,
    ]);

    useEffect(() => {
        if (!isRestored) return;

        const now = new Date();
        const createdAt = createdAtRef.current ?? now.toISOString();
        createdAtRef.current = createdAt;

        debouncedPersist(
            createAppStateV1({
                hidingZones: {
                    radiusMeters: hidingZoneState.radiusMeters,
                    radiusUnit: hidingZoneState.radiusUnit,
                    selectedPresetIds: hidingZoneState.selectedPresetIds,
                },
                metadata: {
                    createdAt,
                    updatedAt: now.toISOString(),
                },
                playArea: playAreaStore.playArea,
                questionSettings: {
                    activeQuestionId: questionState.activeQuestionId,
                    adminDivisionPack: questionState.adminDivisionPack,
                    adminDivisionPresetName:
                        questionState.adminDivisionPresetName,
                    gameMode: questionState.gameMode,
                    labelLanguage: questionState.labelLanguage,
                    seekingStartedAt: questionState.seekingStartedAt,
                    unitSystem: questionState.unitSystem,
                    unitSystemChosen: questionState.unitSystemChosen,
                },
                questions,
            }),
        );
    }, [
        hidingZoneState.radiusMeters,
        hidingZoneState.radiusUnit,
        hidingZoneState.selectedPresetIds,
        isRestored,
        playAreaStore.playArea,
        questionState.activeQuestionId,
        questionState.adminDivisionPack,
        questionState.adminDivisionPresetName,
        questionState.gameMode,
        questionState.labelLanguage,
        questionState.seekingStartedAt,
        questionState.unitSystem,
        questionState.unitSystemChosen,
        questions,
    ]);

    const readinessValue = useMemo<AppReadinessValue>(
        () => ({ isMapReady, isRestored, markMapReady }),
        [isMapReady, isRestored, markMapReady],
    );

    return (
        <AppReadinessContext.Provider value={readinessValue}>
            {children}
        </AppReadinessContext.Provider>
    );
}

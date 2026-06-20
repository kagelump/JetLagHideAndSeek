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

import {
    getHidingZonePresetsOrEmpty,
    loadHidingZonePresets,
    onPackSourcesChanged,
} from "@/features/hidingZone/hidingZoneData";
import { useLabelLanguage } from "@/state/labelLanguage";
import {
    buildHidingZoneFeatureCollection,
    buildRouteFeatureCollection,
    buildStationFeatureCollection,
    getFilteredSelectedStations,
    getSelectedPresets,
    getSelectedRoutes,
    getSuggestedPresetIds,
} from "@/features/hidingZone/hidingZone";
import type {
    HidingZonePreset,
    HidingZoneUnit,
    RouteFeatureCollection,
    StationFeatureCollection,
    TransitRoute,
    TransitStation,
    ZoneFeatureCollection,
} from "@/features/hidingZone/hidingZoneTypes";
import { usePlayArea } from "@/state/playAreaStore";
import { fromMeters, toMeters } from "@/shared/distanceUnits";
import { HIDING_ZONE } from "@/config/appConfig";

export const DEFAULT_RADIUS_METERS = HIDING_ZONE.defaultRadiusM;
/** Imperial-default radius (miles) applied when a player chooses imperial units. */
export const DEFAULT_RADIUS_IMPERIAL_MI = HIDING_ZONE.defaultRadiusImperialMi;
const ZONE_GEOMETRY_DEBOUNCE_MS = 300;

export type HidingZoneImportState = {
    radiusMeters: number;
    radiusUnit: HidingZoneUnit;
    selectedPresetIds: string[];
};

// ---------------------------------------------------------------------------
// State context — scalar values that change frequently
// ---------------------------------------------------------------------------

type HidingZoneStateValue = {
    isRestored: boolean;
    radiusDisplayValue: string;
    radiusMeters: number;
    radiusUnit: HidingZoneUnit;
    selectedPresetIds: string[];
    selectedRouteIds: Record<string, string[]>;
};

const HidingZoneStateContext = createContext<HidingZoneStateValue | null>(null);

export function useHidingZoneState(): HidingZoneStateValue {
    const context = useContext(HidingZoneStateContext);
    if (!context) {
        throw new Error(
            "useHidingZoneState must be used within HidingZoneProvider.",
        );
    }
    return context;
}

// ---------------------------------------------------------------------------
// Actions context — stable callbacks
// ---------------------------------------------------------------------------

type HidingZoneActionsValue = {
    addPreset: (presetId: string) => void;
    markRestored: () => void;
    removePreset: (presetId: string) => void;
    replaceSetup: (nextSetup: HidingZoneImportState) => void;
    setOperatorRouteSelection: (
        presetId: string,
        routeIds: string[] | null,
    ) => void;
    setRadiusDisplayValue: (value: string) => void;
    // Sets the display value and unit together (meters derived from both).
    // Use when changing both atomically, e.g. applying a unit-system default.
    setRadius: (value: string, unit: HidingZoneUnit) => void;
    setRadiusUnit: (unit: HidingZoneUnit) => void;
    togglePreset: (presetId: string) => void;
};

const HidingZoneActionsContext = createContext<HidingZoneActionsValue | null>(
    null,
);

export function useHidingZoneActions(): HidingZoneActionsValue {
    const context = useContext(HidingZoneActionsContext);
    if (!context) {
        throw new Error(
            "useHidingZoneActions must be used within HidingZoneProvider.",
        );
    }
    return context;
}

// ---------------------------------------------------------------------------
// Derived context — computed GeoJSON / feature collections
// ---------------------------------------------------------------------------

type HidingZoneDerivedValue = {
    presets: HidingZonePreset[];
    routeFeatures: RouteFeatureCollection;
    selectedPresets: HidingZonePreset[];
    selectedRoutes: TransitRoute[];
    selectedStations: TransitStation[];
    stationFeatures: StationFeatureCollection;
    suggestedPresetIds: string[];
    zoneFeatures: ZoneFeatureCollection;
};

const HidingZoneDerivedContext = createContext<HidingZoneDerivedValue | null>(
    null,
);

export function useHidingZoneDerived(): HidingZoneDerivedValue {
    const context = useContext(HidingZoneDerivedContext);
    if (!context) {
        throw new Error(
            "useHidingZoneDerived must be used within HidingZoneProvider.",
        );
    }
    return context;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function HidingZoneProvider({ children }: { children: ReactNode }) {
    const { playArea } = usePlayArea();
    const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
    const [selectedRouteIds, setSelectedRouteIds] = useState<
        Record<string, string[]>
    >({});
    const [radiusMeters, setRadiusMeters] = useState<number>(
        DEFAULT_RADIUS_METERS,
    );
    const [zoneGeometryRadiusMeters, setZoneGeometryRadiusMeters] =
        useState<number>(DEFAULT_RADIUS_METERS);
    const [radiusUnit, setRadiusUnitState] = useState<HidingZoneUnit>("m");
    const [radiusDisplayValue, setRadiusDisplayValueState] = useState("600");
    const [isRestored, setIsRestored] = useState(false);
    const [presetsRevision, setPresetsRevision] = useState(0);
    const radiusMetersRef = useRef<number>(DEFAULT_RADIUS_METERS);
    const zoneGeometryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    // Load transit preset bundles lazily by play-area bbox.  Previously
    // loaded bundles are cached; changing the play area loads any newly
    // intersecting bundles.
    useEffect(() => {
        let cancelled = false;
        loadHidingZonePresets(playArea.bbox)
            .then(() => {
                if (!cancelled) setPresetsRevision((n) => n + 1);
            })
            .catch(() => {
                // Keep the app usable without preset suggestions if the
                // bundled dataset cannot be loaded.
            });
        return () => {
            cancelled = true;
        };
    }, [playArea.bbox]);

    // Reload presets when pack transit sources are registered or removed
    // (e.g. after a pack install completes, or on app-start restore).
    useEffect(() => {
        const cancelled = false;
        return onPackSourcesChanged(() => {
            if (cancelled) return;
            loadHidingZonePresets(playArea.bbox)
                .then(() => {
                    if (!cancelled) setPresetsRevision((n) => n + 1);
                })
                .catch(() => {});
        });
    }, [playArea.bbox]);

    const presets = getHidingZonePresetsOrEmpty();

    const suggestedPresetIds = useMemo(
        () => getSuggestedPresetIds(presets, playArea.bbox),
        // Recompute when presets finish loading (revision bump) or bbox changes.
        [playArea.bbox, presetsRevision],
    );

    const selectedPresets = useMemo(
        () => getSelectedPresets(presets, selectedPresetIds),
        [selectedPresetIds, presetsRevision],
    );
    const selectedRoutes = useMemo(
        () => getSelectedRoutes(selectedPresets),
        [selectedPresets],
    );
    const selectedStations = useMemo(
        () =>
            getFilteredSelectedStations(
                selectedPresets,
                selectedRouteIds,
                presets,
            ),
        [selectedPresets, selectedRouteIds, presetsRevision],
    );
    const labelLanguage = useLabelLanguage();
    const routeFeatures = useMemo(
        () => buildRouteFeatureCollection(selectedPresets, labelLanguage),
        [selectedPresets, labelLanguage],
    );
    const stationFeatures = useMemo(
        () => buildStationFeatureCollection(selectedStations, labelLanguage),
        [selectedStations, labelLanguage],
    );
    const zoneFeatures = useMemo(
        () =>
            buildHidingZoneFeatureCollection(
                selectedStations,
                zoneGeometryRadiusMeters,
            ),
        [selectedStations, zoneGeometryRadiusMeters],
    );

    const syncZoneGeometryRadius = useCallback((nextRadiusMeters: number) => {
        if (zoneGeometryTimerRef.current) {
            clearTimeout(zoneGeometryTimerRef.current);
            zoneGeometryTimerRef.current = null;
        }
        setZoneGeometryRadiusMeters(nextRadiusMeters);
    }, []);

    const addPreset = useCallback(
        (presetId: string) => {
            syncZoneGeometryRadius(radiusMetersRef.current);
            setSelectedPresetIds((current) =>
                current.includes(presetId) ? current : [...current, presetId],
            );
        },
        [syncZoneGeometryRadius],
    );

    const removePreset = useCallback(
        (presetId: string) => {
            syncZoneGeometryRadius(radiusMetersRef.current);
            setSelectedPresetIds((current) =>
                current.filter((id) => id !== presetId),
            );
            setSelectedRouteIds((current) => {
                const next = { ...current };
                delete next[presetId];
                return next;
            });
        },
        [syncZoneGeometryRadius],
    );

    const replaceSetup = useCallback(
        (nextSetup: HidingZoneImportState) => {
            syncZoneGeometryRadius(nextSetup.radiusMeters);
            radiusMetersRef.current = nextSetup.radiusMeters;
            setSelectedPresetIds(nextSetup.selectedPresetIds);
            setRadiusMeters(nextSetup.radiusMeters);
            setRadiusUnitState(nextSetup.radiusUnit);
            setRadiusDisplayValueState(
                fromMeters(nextSetup.radiusMeters, nextSetup.radiusUnit),
            );
        },
        [syncZoneGeometryRadius],
    );

    const togglePreset = useCallback(
        (presetId: string) => {
            if (selectedPresetIds.includes(presetId)) removePreset(presetId);
            else addPreset(presetId);
        },
        [addPreset, removePreset, selectedPresetIds],
    );

    const setOperatorRouteSelection = useCallback(
        (presetId: string, routeIds: string[] | null) => {
            setSelectedRouteIds((current) => {
                if (routeIds === null) {
                    const next = { ...current };
                    delete next[presetId];
                    return next;
                }
                return { ...current, [presetId]: routeIds };
            });
        },
        [],
    );

    const setRadiusDisplayValue = useCallback(
        (value: string) => {
            setRadiusDisplayValueState(value);
            const meters = toMeters(value, radiusUnit);
            if (meters === null) return;

            radiusMetersRef.current = meters;
            setRadiusMeters(meters);
            if (zoneGeometryTimerRef.current) {
                clearTimeout(zoneGeometryTimerRef.current);
            }
            zoneGeometryTimerRef.current = setTimeout(() => {
                zoneGeometryTimerRef.current = null;
                setZoneGeometryRadiusMeters(meters);
            }, ZONE_GEOMETRY_DEBOUNCE_MS);
        },
        [radiusUnit],
    );

    const setRadiusUnit = useCallback((unit: HidingZoneUnit) => {
        setRadiusUnitState(unit);
        setRadiusDisplayValueState(fromMeters(radiusMetersRef.current, unit));
    }, []);

    const setRadius = useCallback((value: string, unit: HidingZoneUnit) => {
        setRadiusUnitState(unit);
        setRadiusDisplayValueState(value);
        const meters = toMeters(value, unit);
        if (meters === null) return;
        radiusMetersRef.current = meters;
        setRadiusMeters(meters);
        if (zoneGeometryTimerRef.current) {
            clearTimeout(zoneGeometryTimerRef.current);
            zoneGeometryTimerRef.current = null;
        }
        setZoneGeometryRadiusMeters(meters);
    }, []);

    const markRestored = useCallback(() => {
        setIsRestored(true);
    }, []);

    useEffect(() => {
        return () => {
            if (zoneGeometryTimerRef.current) {
                clearTimeout(zoneGeometryTimerRef.current);
            }
        };
    }, []);

    const stateValue = useMemo<HidingZoneStateValue>(
        () => ({
            isRestored,
            radiusDisplayValue,
            radiusMeters,
            radiusUnit,
            selectedPresetIds,
            selectedRouteIds,
        }),
        [
            isRestored,
            radiusDisplayValue,
            radiusMeters,
            radiusUnit,
            selectedPresetIds,
            selectedRouteIds,
        ],
    );

    const actionsValue = useMemo<HidingZoneActionsValue>(
        () => ({
            addPreset,
            markRestored,
            removePreset,
            replaceSetup,
            setOperatorRouteSelection,
            setRadius,
            setRadiusDisplayValue,
            setRadiusUnit,
            togglePreset,
        }),
        [
            addPreset,
            markRestored,
            removePreset,
            replaceSetup,
            setOperatorRouteSelection,
            setRadius,
            setRadiusDisplayValue,
            setRadiusUnit,
            togglePreset,
        ],
    );

    const derivedValue = useMemo<HidingZoneDerivedValue>(
        () => ({
            presets,
            routeFeatures,
            selectedPresets,
            selectedRoutes,
            selectedStations,
            stationFeatures,
            suggestedPresetIds,
            zoneFeatures,
        }),
        [
            routeFeatures,
            selectedPresets,
            selectedRoutes,
            selectedStations,
            stationFeatures,
            suggestedPresetIds,
            zoneFeatures,
        ],
    );

    return (
        <HidingZoneStateContext.Provider value={stateValue}>
            <HidingZoneActionsContext.Provider value={actionsValue}>
                <HidingZoneDerivedContext.Provider value={derivedValue}>
                    {children}
                </HidingZoneDerivedContext.Provider>
            </HidingZoneActionsContext.Provider>
        </HidingZoneStateContext.Provider>
    );
}

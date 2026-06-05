import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";

import { cleanOrphanedBoundaryKeys } from "@/features/map/playAreaBoundary";
import { defaultPlayArea } from "@/features/map/playArea";
import {
    DEFAULT_ADMIN_DIVISION_PACK,
    DEFAULT_ADMIN_DIVISION_PRESET_NAME,
} from "@/features/questions/matching/adminDivisionConfig";
import { clearOsmMatchingCache } from "@/features/questions/matching/osmMatchingCache";
import {
    DEFAULT_RADIUS_METERS,
    useHidingZoneActions,
} from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { clearPersistedAppState } from "@/state/persistence";
import { queryClient } from "@/state/queryClient";
import { useQuestionActions } from "@/state/questionStore";

// ─── Default state factories (mirror store initial values) ─────────────────

const defaultHidingZoneSetup = {
    radiusMeters: DEFAULT_RADIUS_METERS,
    radiusUnit: "m" as const,
    selectedPresetIds: [] as string[],
};

const defaultQuestionSettings = {
    activeQuestionId: null as string | null,
    adminDivisionPack: DEFAULT_ADMIN_DIVISION_PACK,
    adminDivisionPresetName: DEFAULT_ADMIN_DIVISION_PRESET_NAME,
    gameMode: "seeker" as const,
    isPinLocked: false,
    labelLanguage: "native" as const,
};

// ─── Reset Game ────────────────────────────────────────────────────────────

/**
 * Returns a callback that resets the app to a fresh-install state: empties
 * questions, restores the default play area and hiding-zone configuration,
 * clears persisted game state, and drops the OSM matching cache.
 *
 * Offline region packs are kept (expensive to re-download; not part of "the
 * game"). Mirrors `applyImport` so the two paths can't drift.
 */
export function useResetGame(): () => Promise<void> {
    const { importPlayArea } = usePlayArea();
    const { replaceSetup } = useHidingZoneActions();
    const { importQuestions, importQuestionSettings } = useQuestionActions();

    return useCallback(async () => {
        // 1. Reset in-memory stores to defaults.
        importQuestions([]);
        importQuestionSettings(defaultQuestionSettings);
        replaceSetup(defaultHidingZoneSetup);
        importPlayArea(defaultPlayArea);

        // 2. Clear persisted game state so a kill-before-debounce doesn't
        //    resurrect the old state on next launch.
        await clearPersistedAppState();

        // 3. Drop the OSM matching cache — stale cached features won't make
        //    sense for a different play area.
        await clearOsmMatchingCache();
    }, [importPlayArea, replaceSetup, importQuestions, importQuestionSettings]);
}

// ─── Clear Cache ───────────────────────────────────────────────────────────

const REACT_QUERY_CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE";

/**
 * Drops all derived / fetched data without touching game setup or downloaded
 * offline packs. Returns the number of persisted keys removed.
 *
 * Covers:
 * - OSM matching cache (memory + AsyncStorage)
 * - React Query cache (memory + persisted)
 * - Play-area boundary orphan keys
 */
export async function clearAppCaches(): Promise<number> {
    let count = 0;

    // 1. OSM matching cache — memory + disk.
    count += await clearOsmMatchingCache();

    // 2. React Query — memory.
    queryClient.clear();
    // React Query — persisted cache (only count if the key actually existed).
    try {
        const had = await AsyncStorage.getItem(REACT_QUERY_CACHE_KEY);
        if (had !== null) {
            await AsyncStorage.removeItem(REACT_QUERY_CACHE_KEY);
            count++;
        }
    } catch {
        // Storage may be unavailable.
    }

    // 3. Play-area boundary orphan keys.
    await cleanOrphanedBoundaryKeys();

    return count;
}

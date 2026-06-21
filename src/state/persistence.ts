import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    ensurePlayAreaBoundaryCached,
    loadCachedPlayAreaByRelationId,
} from "@/features/map/playAreaBoundary";
import { unsetPlayArea } from "@/features/map/playArea";
import {
    migratePersistedAppState,
    safeParseHidingZones,
    safeParsePlayArea,
    safeParseQuestionSettings,
    safeParseQuestions,
    type AppStateV1,
} from "@/state/appState";
import { createLogger } from "@/shared/logger";

const log = createLogger("persistence");

const LEGACY_APP_STATE_KEY = "app-state:v1";
const APP_STATE_METADATA_KEY = "app-state:metadata:v1";
const APP_STATE_PLAY_AREA_KEY = "app-state:play-area:v1";
const APP_STATE_HIDING_ZONES_KEY = "app-state:hiding-zones:v1";
const APP_STATE_QUESTION_SETTINGS_KEY = "app-state:question-settings:v1";
const APP_STATE_QUESTIONS_KEY = "app-state:questions:v1";
const APP_STATE_SLICE_KEYS = [
    APP_STATE_METADATA_KEY,
    APP_STATE_PLAY_AREA_KEY,
    APP_STATE_HIDING_ZONES_KEY,
    APP_STATE_QUESTION_SETTINGS_KEY,
    APP_STATE_QUESTIONS_KEY,
] as const;

export async function loadPersistedAppState(): Promise<AppStateV1 | null> {
    const splitState = await loadSplitPersistedAppState();
    if (splitState) return splitState;

    const raw = await readJson(LEGACY_APP_STATE_KEY);
    if (raw === null) return null;

    const migrated = migratePersistedAppState(raw);
    if (migrated) return migrated;

    await removeItem(LEGACY_APP_STATE_KEY);
    return null;
}

export async function persistAppState(state: AppStateV1): Promise<void> {
    try {
        await ensurePlayAreaBoundaryCached(state.playArea);

        await AsyncStorage.multiSet(serializeSlices(state));
        await AsyncStorage.removeItem(LEGACY_APP_STATE_KEY);
    } catch (e) {
        if (__DEV__) log.warn("Failed to persist app state:", e);
    }
}

/**
 * Clear ALL persisted state keys.
 *
 * Intentionally aggressive: removes everything (legacy key + all split-state
 * slices). Used for explicit user-initiated reset ("Clear All Data"), NOT for
 * per-slice recovery. Per-slice validation failures in
 * `loadSplitPersistedAppState` only clear the individual corrupt key, not the
 * entire set.
 */
export async function clearPersistedAppState(): Promise<void> {
    try {
        await AsyncStorage.multiRemove([
            LEGACY_APP_STATE_KEY,
            ...APP_STATE_SLICE_KEYS,
        ]);
    } catch (e) {
        if (__DEV__) log.warn("Failed to clear persisted state:", e);
    }
}

async function loadSplitPersistedAppState(): Promise<AppStateV1 | null> {
    let entries: readonly (readonly [string, string | null])[];
    try {
        entries = await AsyncStorage.multiGet([...APP_STATE_SLICE_KEYS]);
    } catch (e) {
        if (__DEV__) log.warn("Failed to read persisted state slices:", e);
        return null;
    }

    const entryMap = Object.fromEntries(entries) as Record<
        string,
        string | null
    >;

    // Nothing persisted — return null so the caller tries the legacy key.
    if (Object.values(entryMap).every((v) => v === null)) return null;

    // ── Validate each slice independently ────────────────────────────────
    // Per-slice resilience: a corrupt or missing slice gets a sensible
    // default and a __DEV__ warning, but does NOT wipe the other slices.

    const now = new Date().toISOString();

    // Metadata (simple object, validated inline)
    const rawMetadata = tryParseJson(
        entryMap[APP_STATE_METADATA_KEY],
        APP_STATE_METADATA_KEY,
    );
    const metadata =
        rawMetadata !== null
            ? safeParseMetadata(rawMetadata)
            : { createdAt: now, updatedAt: now };

    // Hiding zones — validate against its schema
    const rawHidingZones = tryParseJson(
        entryMap[APP_STATE_HIDING_ZONES_KEY],
        APP_STATE_HIDING_ZONES_KEY,
    );
    const hidingZones = safeParseHidingZones(rawHidingZones);

    // Question settings — validate against its schema
    const rawQuestionSettings = tryParseJson(
        entryMap[APP_STATE_QUESTION_SETTINGS_KEY],
        APP_STATE_QUESTION_SETTINGS_KEY,
    );
    const questionSettings = safeParseQuestionSettings(rawQuestionSettings);

    // Questions — use per-question safe parsing
    const rawQuestions = tryParseJson(
        entryMap[APP_STATE_QUESTIONS_KEY],
        APP_STATE_QUESTIONS_KEY,
    );
    const questions = safeParseQuestions(rawQuestions);

    // Play area is stored as a reference ({ osmId }) and resolved via cache.
    const playArea = await resolvePlayAreaSlice(
        entryMap[APP_STATE_PLAY_AREA_KEY],
    );

    return {
        hidingZones,
        metadata,
        playArea,
        questionSettings,
        questions,
        version: 1,
    };
}

/**
 * Attempt to JSON-parse a stored slice value. Returns the parsed value on
 * success, or `null` if the key was absent or the JSON was corrupt.
 * Does NOT clean up any keys — that is the caller's responsibility.
 */
function tryParseJson(raw: string | null, label: string): unknown | null {
    if (raw === null) return null;
    try {
        return JSON.parse(raw) as unknown;
    } catch (e) {
        if (__DEV__) {
            log.warn(`Invalid JSON in slice "${label}", using default:`, e);
        }
        return null;
    }
}

/**
 * Validate a raw unknown value as metadata, falling back to fresh timestamps.
 */
function safeParseMetadata(value: unknown): {
    createdAt: string;
    updatedAt: string;
} {
    if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as Record<string, unknown>).createdAt === "string" &&
        typeof (value as Record<string, unknown>).updatedAt === "string"
    ) {
        const v = value as { createdAt: string; updatedAt: string };
        return { createdAt: v.createdAt, updatedAt: v.updatedAt };
    }
    const now = new Date().toISOString();
    if (__DEV__) log.warn("Invalid metadata, using current timestamp");
    return { createdAt: now, updatedAt: now };
}

/**
 * Resolve the play area from a stored reference ({ osmId }).
 * If the reference is missing or corrupt, clear only its AsyncStorage key
 * and return the unset play area.
 */
async function resolvePlayAreaSlice(
    raw: string | null,
): Promise<AppStateV1["playArea"]> {
    if (raw === null) {
        if (__DEV__)
            log.warn("Play area reference is missing, using unset play area");
        return { ...unsetPlayArea };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        if (__DEV__) {
            log.warn("Invalid JSON in play area reference, using default:", e);
        }
        await removeItem(APP_STATE_PLAY_AREA_KEY);
        return { ...unsetPlayArea };
    }

    if (isPlayAreaReference(parsed)) {
        const cached = await loadCachedPlayAreaByRelationId(parsed.osmId);
        if (cached) return safeParsePlayArea(cached.playArea);
        return { ...unsetPlayArea };
    }

    // Data is valid JSON but not a valid play area reference — clear the key
    if (__DEV__) {
        log.warn("Invalid play area reference shape, using unset play area");
    }
    await removeItem(APP_STATE_PLAY_AREA_KEY);
    return { ...unsetPlayArea };
}

function serializeSlices(state: AppStateV1): [string, string][] {
    return [
        [APP_STATE_METADATA_KEY, JSON.stringify(state.metadata)],
        [
            APP_STATE_PLAY_AREA_KEY,
            JSON.stringify({ osmId: state.playArea.osmId }),
        ],
        [APP_STATE_HIDING_ZONES_KEY, JSON.stringify(state.hidingZones)],
        [
            APP_STATE_QUESTION_SETTINGS_KEY,
            JSON.stringify(state.questionSettings),
        ],
        [APP_STATE_QUESTIONS_KEY, JSON.stringify(state.questions)],
    ];
}

function isPlayAreaReference(value: unknown): value is { osmId: number } {
    return (
        typeof value === "object" &&
        value !== null &&
        "osmId" in value &&
        typeof value.osmId === "number" &&
        Number.isSafeInteger(value.osmId) &&
        value.osmId > 0
    );
}

async function readJson(key: string): Promise<unknown | null> {
    try {
        const raw = await AsyncStorage.getItem(key);
        if (raw === null || raw === undefined) return null;
        return JSON.parse(raw) as unknown;
    } catch (e) {
        if (__DEV__) log.warn(`Failed to read JSON from key "${key}":`, e);
        await removeItem(key);
        return null;
    }
}

async function removeItem(key: string) {
    try {
        await AsyncStorage.removeItem(key);
    } catch (e) {
        if (__DEV__) log.warn(`Failed to remove key "${key}":`, e);
    }
}

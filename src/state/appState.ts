import { z } from "zod";

import { unsetPlayArea } from "@/features/map/playArea";
import {
    DEFAULT_ADMIN_DIVISION_PACK,
    clonePack,
} from "@/features/questions/matching/adminDivisionConfig";
import type { QuestionsImportState } from "@/features/questions/questionTypes";
import {
    bboxSchema,
    featureCollectionSchema,
    positionSchema,
    questionSchema,
} from "@/sharing/wire/questionSchemas";
import type { HidingZoneImportState } from "@/state/hidingZoneStore";
import type { PlayAreaImportState } from "@/state/playAreaStore";
import type { QuestionSettingsImportState } from "@/state/questionStore";
import { createLogger } from "@/shared/logger";

const log = createLogger("appState");

export const appStatePlayAreaSchema = z.object({
    bbox: bboxSchema,
    boundary: featureCollectionSchema,
    center: positionSchema,
    label: z.string().min(1),
    osmId: z.number().int().positive(),
    osmType: z.literal("R"),
});

export const appStateHidingZonesSchema = z.object({
    radiusMeters: z.number().positive(),
    radiusUnit: z.enum(["m", "km", "mi"]),
    selectedPresetIds: z.array(z.string()),
    eliminatedStationIds: z.array(z.string()).default([]),
});

export const appStateQuestionsSchema = z.array(questionSchema);

const adminDivisionLevelEntrySchema = z.object({
    labelEn: z.string(),
    labelNative: z.string(),
    osmLevel: z.string(),
});

const adminDivisionPackSchema = z.tuple([
    adminDivisionLevelEntrySchema,
    adminDivisionLevelEntrySchema,
    adminDivisionLevelEntrySchema,
    adminDivisionLevelEntrySchema,
]);

const adminDivisionPresetNameSchema = z.enum(["generic", "japan"]);

export const appStateQuestionSettingsSchema = z.object({
    activeQuestionId: z.string().nullable().default(null),
    adminDivisionPack: adminDivisionPackSchema.default(() =>
        clonePack(DEFAULT_ADMIN_DIVISION_PACK),
    ),
    adminDivisionPresetName: adminDivisionPresetNameSchema.default("generic"),
    gameMode: z.enum(["hider", "seeker"]).default("seeker"),
    labelLanguage: z.enum(["native", "english"]).default("native"),
    seekingStartedAt: z.number().nullable().default(null),
    unitSystem: z.enum(["metric", "imperial"]).default("metric"),
    // Whether the player explicitly overrode the unit system in Settings. Once
    // true, the play-area-geography auto-default stops applying.
    unitSystemChosen: z.boolean().default(false),
});

const metadataSchema = z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
});

const DEFAULT_HIDING_ZONES: AppStateV1["hidingZones"] = {
    radiusMeters: 500,
    radiusUnit: "m",
    selectedPresetIds: [],
    eliminatedStationIds: [],
};

/**
 * Parse each question individually and filter out invalid ones instead of
 * failing the whole array. Unknown/unparseable question types are skipped.
 * Logs a warning in __DEV__ when dropping individual questions.
 */
export function safeParseQuestions(
    questions: unknown,
): AppStateV1["questions"] {
    if (!Array.isArray(questions)) {
        if (__DEV__) log.warn("Questions is not an array, defaulting to empty");
        return [];
    }

    const valid: AppStateV1["questions"] = [];
    for (const q of questions) {
        const result = questionSchema.safeParse(q);
        if (result.success) {
            valid.push(result.data);
        } else if (__DEV__) {
            const id =
                typeof q === "object" && q !== null && "id" in q
                    ? String(q.id)
                    : "unknown";
            log.warn(
                `Dropping invalid question (id=${id}):`,
                result.error.issues,
            );
        }
    }
    return valid;
}

/**
 * Validate hiding zones independently, returning a sensible default on failure.
 */
export function safeParseHidingZones(
    value: unknown,
): AppStateV1["hidingZones"] {
    const result = appStateHidingZonesSchema.safeParse(value);
    if (result.success) return result.data;
    if (__DEV__) {
        log.warn("Invalid hiding zones, using default:", result.error.issues);
    }
    return { ...DEFAULT_HIDING_ZONES };
}

/**
 * Validate play area independently, returning an unset play area on failure.
 */
export function safeParsePlayArea(value: unknown): AppStateV1["playArea"] {
    const result = appStatePlayAreaSchema.safeParse(value);
    if (result.success) return result.data;
    if (__DEV__) {
        log.warn("Invalid play area, using default:", result.error.issues);
    }
    return { ...unsetPlayArea };
}

/**
 * Validate question settings independently, returning defaults on failure.
 */
export function safeParseQuestionSettings(
    value: unknown,
): AppStateV1["questionSettings"] {
    const result = appStateQuestionSettingsSchema.safeParse(value);
    if (result.success) return result.data;
    if (__DEV__) {
        log.warn(
            "Invalid question settings, using defaults:",
            result.error.issues,
        );
    }
    // All question-settings fields have defaults — parse({}) always succeeds.
    return appStateQuestionSettingsSchema.parse({});
}

/** Validate metadata independently, returning fresh timestamps on failure. */
function safeParseMetadata(value: unknown): {
    createdAt: string;
    updatedAt: string;
} {
    const result = metadataSchema.safeParse(value);
    if (result.success) return result.data;
    const now = new Date().toISOString();
    if (__DEV__) {
        log.warn(
            "Invalid metadata, using current timestamp:",
            result.error.issues,
        );
    }
    return { createdAt: now, updatedAt: now };
}

export const appStateV1Schema = z.object({
    hidingZones: appStateHidingZonesSchema,
    metadata: metadataSchema,
    playArea: appStatePlayAreaSchema,
    questionSettings: appStateQuestionSettingsSchema,
    questions: appStateQuestionsSchema,
    version: z.literal(1),
});

export type AppStateV1 = z.infer<typeof appStateV1Schema>;
export type AppStateHidingZonesV1 = z.infer<typeof appStateHidingZonesSchema>;
export type AppStatePlayAreaV1 = z.infer<typeof appStatePlayAreaSchema>;
export type AppStateQuestionSettingsV1 = z.infer<
    typeof appStateQuestionSettingsSchema
>;

export function createAppStateV1({
    hidingZones,
    metadata,
    now = new Date(),
    playArea,
    questionSettings,
    questions,
}: {
    hidingZones: HidingZoneImportState;
    metadata?: {
        createdAt?: string;
        updatedAt?: string;
    };
    now?: Date;
    playArea: PlayAreaImportState;
    questionSettings?: QuestionSettingsImportState;
    questions?: QuestionsImportState;
}): AppStateV1 {
    const timestamp = now.toISOString();
    return {
        hidingZones: {
            radiusMeters: hidingZones.radiusMeters,
            radiusUnit: hidingZones.radiusUnit,
            selectedPresetIds: [...hidingZones.selectedPresetIds],
            eliminatedStationIds: [...(hidingZones.eliminatedStationIds ?? [])],
        },
        metadata: {
            createdAt: metadata?.createdAt ?? timestamp,
            updatedAt: metadata?.updatedAt ?? timestamp,
        },
        playArea: {
            bbox: playArea.bbox,
            boundary: playArea.boundary,
            center: playArea.center,
            label: playArea.label,
            osmId: playArea.osmId,
            osmType: playArea.osmType,
        },
        questionSettings: {
            activeQuestionId: questionSettings?.activeQuestionId ?? null,
            adminDivisionPack:
                questionSettings?.adminDivisionPack ??
                DEFAULT_ADMIN_DIVISION_PACK,
            adminDivisionPresetName:
                questionSettings?.adminDivisionPresetName ?? "generic",
            gameMode: questionSettings?.gameMode ?? "seeker",
            labelLanguage: questionSettings?.labelLanguage ?? "native",
            seekingStartedAt: questionSettings?.seekingStartedAt ?? null,
            unitSystem: questionSettings?.unitSystem ?? "metric",
            unitSystemChosen: questionSettings?.unitSystemChosen ?? false,
        },
        questions: questions ? [...questions] : [],
        version: 1,
    };
}

/**
 * Migrate a persisted app-state value to `AppStateV1`, recovering partial state
 * instead of failing entirely on a single corrupt slice.
 *
 * Each slice is validated independently against its own schema. If a slice
 * fails validation, a sensible default (matching what `createAppStateV1` would
 * produce) is used instead. Warnings are logged in `__DEV__` for dropped slices.
 *
 * Returns `null` only when the value is not a record or the version is not 1
 * (unrecognized format — caller should remove the key).
 */
export function migratePersistedAppState(value: unknown): AppStateV1 | null {
    if (!isRecord(value)) return null;
    if (value.version !== 1) return null;

    const enhanced = addMissingV1Slices(value) as Record<string, unknown>;

    // Validate each slice independently so a single corrupt field or question
    // does not wipe all persisted state.
    return {
        hidingZones: safeParseHidingZones(enhanced.hidingZones),
        metadata: safeParseMetadata(enhanced.metadata),
        playArea: safeParsePlayArea(enhanced.playArea),
        questionSettings: safeParseQuestionSettings(enhanced.questionSettings),
        questions: safeParseQuestions(enhanced.questions),
        version: 1,
    };
}

function addMissingV1Slices(value: unknown): unknown {
    if (!isRecord(value)) return value;
    if (value.version !== 1) return value;
    const playAreaCenter = getPlayAreaCenter(value);
    const questions =
        "questions" in value
            ? addMissingQuestionCenters(value.questions, playAreaCenter)
            : [];

    return {
        ...value,
        questionSettings:
            "questionSettings" in value
                ? value.questionSettings
                : {
                      activeQuestionId: null,
                      adminDivisionPack: DEFAULT_ADMIN_DIVISION_PACK,
                      adminDivisionPresetName: "generic",
                      gameMode: "seeker",
                      labelLanguage: "native",
                      unitSystem: "metric",
                      unitSystemChosen: false,
                  },
        questions,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addMissingQuestionCenters(
    questions: unknown,
    fallbackCenter: unknown,
): unknown {
    if (!Array.isArray(questions)) return questions;
    return questions.map((question) => {
        if (
            !isRecord(question) ||
            question.type !== "matching" ||
            "center" in question ||
            !isPosition(fallbackCenter)
        ) {
            return question;
        }
        return {
            ...question,
            center: fallbackCenter,
        };
    });
}

function getPlayAreaCenter(value: Record<string, unknown>): unknown {
    const playArea = value.playArea;
    return isRecord(playArea) ? playArea.center : null;
}

function isPosition(value: unknown): value is [number, number] {
    return (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "number" &&
        typeof value[1] === "number"
    );
}

export function appStatePlayAreaToImportState(
    playArea: AppStatePlayAreaV1,
): PlayAreaImportState {
    return {
        bbox: playArea.bbox,
        boundary: playArea.boundary,
        center: playArea.center,
        label: playArea.label,
        osmId: playArea.osmId,
        osmType: playArea.osmType,
    };
}

export function appStateHidingZonesToImportState(
    hidingZones: AppStateHidingZonesV1,
): HidingZoneImportState {
    return {
        radiusMeters: hidingZones.radiusMeters,
        radiusUnit: hidingZones.radiusUnit,
        selectedPresetIds: [...hidingZones.selectedPresetIds],
        eliminatedStationIds: [...(hidingZones.eliminatedStationIds ?? [])],
    };
}

export function appStateQuestionSettingsToImportState(
    questionSettings: AppStateQuestionSettingsV1,
): QuestionSettingsImportState {
    return {
        activeQuestionId: questionSettings.activeQuestionId,
        adminDivisionPack: questionSettings.adminDivisionPack,
        adminDivisionPresetName: questionSettings.adminDivisionPresetName,
        gameMode: questionSettings.gameMode,
        labelLanguage: questionSettings.labelLanguage,
        seekingStartedAt: questionSettings.seekingStartedAt ?? null,
        unitSystem: questionSettings.unitSystem,
        unitSystemChosen: questionSettings.unitSystemChosen,
    };
}

import { z } from "zod";

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
});

export const appStateV1Schema = z.object({
    hidingZones: appStateHidingZonesSchema,
    metadata: z.object({
        createdAt: z.string().min(1),
        updatedAt: z.string().min(1),
    }),
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
        },
        questions: questions ? [...questions] : [],
        version: 1,
    };
}

export function migratePersistedAppState(value: unknown): AppStateV1 | null {
    const parsed = appStateV1Schema.safeParse(addMissingV1Slices(value));
    return parsed.success ? parsed.data : null;
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
    };
}

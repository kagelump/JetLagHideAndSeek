import { z } from "zod";

import type { MeasuringCategory } from "@/features/questions/measuring/measuringTypes";
import { derivePoiAnswer } from "@/features/questions/questionRegistry";
import type { TentaclesCategory } from "@/features/questions/tentacles/tentaclesTypes";
import { normalizeTransitLineQuestion } from "@/features/questions/transitLine/transitLineNormalization";

import type {
    AppStateEnvelopeV1,
    QuestionRequestEnvelopeV1,
    QuestionWireV1,
    RadarQuestionWireV1,
    WireEnvelope,
} from "./schema";

export const FIELD_MAP = {
    adminDivisions: "ad",
    adminLevels: "al",
    adminPack: "ap",
    answer: "e",
    candidates: "cd",
    category: "b",
    center: "n",
    createdAt: "c",
    // Reused for measuring seekerDistanceUnit and radar/Tentacles distanceUnit.
    distanceUnit: "du",
    gameId: "g",
    hidingZones: "h",
    id: "i",
    kind: "k",
    label: "l",
    metadata: "m",
    osmId: "o",
    payload: "p",
    playArea: "a",
    // Thermometer previous/current positions.
    previousPosition: "pp",
    currentPosition: "cp",
    questions: "q",
    question: "qq",
    requestId: "rq",
    // Reused for measuring seekerDistanceMeters and radar/Tentacles distanceMeters.
    radiusMeters: "r",
    radiusOption: "d",
    questionType: "t",
    lineId: "x",
    lineName: "y",
    // Tentacles selected POI name — the human-readable answer.
    selectedName: "sn",
    selectedOsmId: "f",
    selectedOsmType: "j",
    selectedPresetIds: "s",
    targetName: "u",
    targetOsmId: "w",
    targetOsmType: "z",
    version: "v",
} as const;

type ForwardKey = keyof typeof FIELD_MAP;
type ReverseKey = (typeof FIELD_MAP)[ForwardKey];

const REVERSE_FIELD_MAP: Record<ReverseKey, ForwardKey> = {} as Record<
    ReverseKey,
    ForwardKey
>;
for (const [full, min] of Object.entries(FIELD_MAP)) {
    REVERSE_FIELD_MAP[min as ReverseKey] = full as ForwardKey;
}

export const COORD_FACTOR = 1e6;

const compactCoordSchema = z.tuple([z.number().int(), z.number().int()]);

const playAreaMinifiedSchema = z.object({
    [FIELD_MAP.center]: compactCoordSchema,
    [FIELD_MAP.label]: z.string().min(1),
    [FIELD_MAP.osmId]: z.number(),
});

const hidingZonesMinifiedSchema = z.object({
    [FIELD_MAP.radiusMeters]: z.number().nonnegative(),
    [FIELD_MAP.selectedPresetIds]: z.array(z.string()),
});

const adminDivisionsMinifiedSchema = z.object({
    [FIELD_MAP.adminPack]: z.enum(["generic", "japan"]),
    [FIELD_MAP.adminLevels]: z.tuple([
        z.string(),
        z.string(),
        z.string(),
        z.string(),
    ]),
});

const radarQuestionMinifiedSchema = z.object({
    [FIELD_MAP.answer]: z.enum(["p", "n"]).optional(),
    [FIELD_MAP.center]: compactCoordSchema,
    [FIELD_MAP.id]: z.string().min(1).optional(),
    [FIELD_MAP.questionType]: z.literal("r").optional(),
    [FIELD_MAP.radiusMeters]: z.number().positive(),
    [FIELD_MAP.radiusOption]: z
        .enum([
            "500m",
            "1km",
            "2km",
            "5km",
            "10km",
            "15km",
            "40km",
            "80km",
            "150km",
            "other",
        ])
        .optional(),
});

const compactCandidateSchema = z.object({
    [FIELD_MAP.center]: compactCoordSchema,
    [FIELD_MAP.osmId]: z.number().int().positive(),
    name: z.string().min(1),
    osmType: z.enum(["node", "way", "relation"]),
});

const matchingQuestionMinifiedSchema = z.object({
    [FIELD_MAP.answer]: z.enum(["p", "n"]).optional(),
    [FIELD_MAP.candidates]: z.array(compactCandidateSchema).optional(),
    [FIELD_MAP.category]: z.string().min(1),
    [FIELD_MAP.center]: compactCoordSchema.optional(),
    [FIELD_MAP.id]: z.string().min(1).optional(),
    [FIELD_MAP.questionType]: z.literal("m"),
    [FIELD_MAP.lineId]: z.string().min(1).nullable(),
    [FIELD_MAP.lineName]: z.string().min(1).nullable(),
    [FIELD_MAP.selectedOsmId]: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional(),
    [FIELD_MAP.selectedOsmType]: z
        .enum(["node", "way", "relation"])
        .nullable()
        .optional(),
    [FIELD_MAP.targetName]: z.string().min(1).nullable().optional(),
    [FIELD_MAP.targetOsmId]: z.number().int().positive().nullable().optional(),
    [FIELD_MAP.targetOsmType]: z
        .enum(["node", "way", "relation"])
        .nullable()
        .optional(),
});

// ── Measuring ────────────────────────────────────────────────────────────

const measuringQuestionMinifiedSchema = z.object({
    [FIELD_MAP.answer]: z.enum(["p", "n"]).optional(),
    [FIELD_MAP.candidates]: z.array(compactCandidateSchema).optional(),
    [FIELD_MAP.category]: z.string().min(1),
    [FIELD_MAP.center]: compactCoordSchema,
    [FIELD_MAP.distanceUnit]: z.enum(["m", "km", "mi"]).optional(),
    [FIELD_MAP.id]: z.string().min(1).optional(),
    [FIELD_MAP.questionType]: z.literal("g"),
    [FIELD_MAP.radiusMeters]: z.number().nullable().optional(),
    [FIELD_MAP.selectedOsmId]: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional(),
    [FIELD_MAP.selectedOsmType]: z
        .enum(["node", "way", "relation"])
        .nullable()
        .optional(),
});

// ── Thermometer ──────────────────────────────────────────────────────────

const thermometerQuestionMinifiedSchema = z.object({
    [FIELD_MAP.answer]: z.enum(["p", "n"]).optional(),
    [FIELD_MAP.id]: z.string().min(1).optional(),
    [FIELD_MAP.previousPosition]: compactCoordSchema.nullable().optional(),
    [FIELD_MAP.currentPosition]: compactCoordSchema.nullable().optional(),
    [FIELD_MAP.questionType]: z.literal("h"),
});

// ── Tentacles ────────────────────────────────────────────────────────────

const tentaclesQuestionMinifiedSchema = z.object({
    [FIELD_MAP.answer]: z.enum(["p"]).optional(),
    [FIELD_MAP.candidates]: z.array(compactCandidateSchema).optional(),
    [FIELD_MAP.category]: z.string().min(1),
    [FIELD_MAP.center]: compactCoordSchema,
    [FIELD_MAP.id]: z.string().min(1).optional(),
    [FIELD_MAP.questionType]: z.literal("c"),
    [FIELD_MAP.radiusMeters]: z.number().positive(),
    [FIELD_MAP.radiusOption]: z.enum(["2km", "25km"]).optional(),
    [FIELD_MAP.selectedName]: z.string().nullable().optional(),
    [FIELD_MAP.selectedOsmId]: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional(),
    [FIELD_MAP.selectedOsmType]: z
        .enum(["node", "way", "relation"])
        .nullable()
        .optional(),
});

const questionMinifiedSchema = z.union([
    radarQuestionMinifiedSchema,
    matchingQuestionMinifiedSchema,
    measuringQuestionMinifiedSchema,
    thermometerQuestionMinifiedSchema,
    tentaclesQuestionMinifiedSchema,
]);

const metadataMinifiedSchema = z.object({
    [FIELD_MAP.createdAt]: z.string().min(1),
});

const appStatePayloadMinifiedSchema = z.object({
    [FIELD_MAP.adminDivisions]: adminDivisionsMinifiedSchema.optional(),
    [FIELD_MAP.gameId]: z.string().min(1),
    [FIELD_MAP.hidingZones]: hidingZonesMinifiedSchema.optional(),
    [FIELD_MAP.metadata]: metadataMinifiedSchema,
    [FIELD_MAP.playArea]: playAreaMinifiedSchema.optional(),
    [FIELD_MAP.questions]: z.array(questionMinifiedSchema).optional(),
});

const appStateEnvelopeMinifiedSchema = z.object({
    [FIELD_MAP.kind]: z.literal("app-state"),
    [FIELD_MAP.version]: z.literal(1),
    [FIELD_MAP.payload]: appStatePayloadMinifiedSchema,
});

const questionRequestPayloadMinifiedSchema = z.object({
    [FIELD_MAP.createdAt]: z.string().min(1),
    [FIELD_MAP.question]: questionMinifiedSchema,
    [FIELD_MAP.requestId]: z.string().min(1),
});

const questionRequestEnvelopeMinifiedSchema = z.object({
    [FIELD_MAP.kind]: z.literal("question-request"),
    [FIELD_MAP.version]: z.literal(1),
    [FIELD_MAP.payload]: questionRequestPayloadMinifiedSchema,
});

export const wireEnvelopeMinifiedSchema = z.discriminatedUnion(FIELD_MAP.kind, [
    appStateEnvelopeMinifiedSchema,
    questionRequestEnvelopeMinifiedSchema,
]);

export type CompactCoord = z.infer<typeof compactCoordSchema>;
export type AppStatePayloadMinified = z.infer<
    typeof appStatePayloadMinifiedSchema
>;
export type AppStateEnvelopeMinified = z.infer<
    typeof appStateEnvelopeMinifiedSchema
>;
export type QuestionRequestEnvelopeMinified = z.infer<
    typeof questionRequestEnvelopeMinifiedSchema
>;
export type WireEnvelopeMinified = z.infer<typeof wireEnvelopeMinifiedSchema>;

export function compactCoord(lon: number, lat: number): CompactCoord {
    return [Math.round(lon * COORD_FACTOR), Math.round(lat * COORD_FACTOR)];
}

export function uncompactCoord(
    lonInt: number,
    latInt: number,
): [number, number] {
    return [lonInt / COORD_FACTOR, latInt / COORD_FACTOR];
}

export function compactCandidate(candidate: {
    lat: number;
    lon: number;
    name: string;
    osmId: number;
    osmType: "node" | "way" | "relation";
}): z.infer<typeof compactCandidateSchema> {
    return {
        [FIELD_MAP.center]: compactCoord(candidate.lon, candidate.lat),
        [FIELD_MAP.osmId]: candidate.osmId,
        name: candidate.name,
        osmType: candidate.osmType,
    };
}

export function uncompactCandidate(
    mini: z.infer<typeof compactCandidateSchema>,
): {
    lat: number;
    lon: number;
    name: string;
    osmId: number;
    osmType: "node" | "way" | "relation";
    tags: Record<string, string>;
} {
    const [lon, lat] = uncompactCoord(
        mini[FIELD_MAP.center][0],
        mini[FIELD_MAP.center][1],
    );
    return {
        lat,
        lon,
        name: mini.name,
        osmId: mini[FIELD_MAP.osmId],
        osmType: mini.osmType,
        tags: {},
    };
}

const POLYLINE_HEADER_SIZE = 3;
const POLYLINE_BASE_LON = 0;
const POLYLINE_BASE_LAT = 1;
const POLYLINE_COUNT = 2;
const ANSWER_TO_MINIFIED = {
    negative: "n",
    positive: "p",
} as const;
const ANSWER_FROM_MINIFIED = {
    n: "negative",
    p: "positive",
} as const;

export type CompactPolyline = number[];

export function compactPolyline(coords: [number, number][]): CompactPolyline {
    if (coords.length === 0) return [0, 0, 0];

    const ints = coords.map(([lon, lat]) => compactCoord(lon, lat));
    const result: number[] = [ints[0][0], ints[0][1], ints.length];

    for (let i = 1; i < ints.length; i++) {
        result.push(ints[i][0] - ints[i - 1][0]);
        result.push(ints[i][1] - ints[i - 1][1]);
    }

    return result;
}

export function uncompactPolyline(
    encoded: CompactPolyline,
): [number, number][] {
    if (
        encoded.length < POLYLINE_HEADER_SIZE ||
        encoded[POLYLINE_COUNT] === 0
    ) {
        return [];
    }

    const result: [number, number][] = [
        uncompactCoord(encoded[POLYLINE_BASE_LON], encoded[POLYLINE_BASE_LAT]),
    ];

    let lon = encoded[POLYLINE_BASE_LON];
    let lat = encoded[POLYLINE_BASE_LAT];
    const count = encoded[POLYLINE_COUNT];

    for (
        let i = POLYLINE_HEADER_SIZE;
        i < POLYLINE_HEADER_SIZE + (count - 1) * 2;
        i += 2
    ) {
        lon += encoded[i];
        lat += encoded[i + 1];
        result.push(uncompactCoord(lon, lat));
    }

    return result;
}

function minifyQuestion(question: QuestionWireV1): Record<string, unknown> {
    if (question.type === "radar") {
        const result: Record<string, unknown> = {
            [FIELD_MAP.center]: compactCoord(
                question.center[0],
                question.center[1],
            ),
            [FIELD_MAP.id]: question.id,
            [FIELD_MAP.questionType]: "r",
            [FIELD_MAP.radiusMeters]: question.distanceMeters,
            [FIELD_MAP.radiusOption]: question.distanceOption,
        };

        if (question.answer !== "unanswered") {
            result[FIELD_MAP.answer] = ANSWER_TO_MINIFIED[question.answer];
        }

        return result;
    }

    if (question.type === "measuring") {
        const result: Record<string, unknown> = {
            [FIELD_MAP.category]: question.category,
            [FIELD_MAP.center]: compactCoord(
                question.center[0],
                question.center[1],
            ),
            [FIELD_MAP.id]: question.id,
            [FIELD_MAP.questionType]: "g",
        };

        if (question.answer !== "unanswered") {
            result[FIELD_MAP.answer] = ANSWER_TO_MINIFIED[question.answer];
        }

        if (question.candidates.length > 0) {
            result[FIELD_MAP.candidates] =
                question.candidates.map(compactCandidate);
        }

        if (question.seekerDistanceMeters !== null) {
            result[FIELD_MAP.radiusMeters] = question.seekerDistanceMeters;
        }

        if (question.seekerDistanceUnit !== "m") {
            result[FIELD_MAP.distanceUnit] = question.seekerDistanceUnit;
        }

        if (question.selectedOsmId !== null) {
            result[FIELD_MAP.selectedOsmId] = question.selectedOsmId;
        }

        if (question.selectedOsmType !== null) {
            result[FIELD_MAP.selectedOsmType] = question.selectedOsmType;
        }

        return result;
    }

    if (question.type === "thermometer") {
        const result: Record<string, unknown> = {
            [FIELD_MAP.id]: question.id,
            [FIELD_MAP.questionType]: "h",
        };

        if (question.answer !== "unanswered") {
            result[FIELD_MAP.answer] = ANSWER_TO_MINIFIED[question.answer];
        }

        if (question.previousPosition !== null) {
            result[FIELD_MAP.previousPosition] = compactCoord(
                question.previousPosition[0],
                question.previousPosition[1],
            );
        }

        if (question.currentPosition !== null) {
            result[FIELD_MAP.currentPosition] = compactCoord(
                question.currentPosition[0],
                question.currentPosition[1],
            );
        }

        return result;
    }

    if (question.type === "tentacles") {
        const result: Record<string, unknown> = {
            [FIELD_MAP.category]: question.category,
            [FIELD_MAP.center]: compactCoord(
                question.center[0],
                question.center[1],
            ),
            [FIELD_MAP.id]: question.id,
            [FIELD_MAP.questionType]: "c",
            [FIELD_MAP.radiusMeters]: question.distanceMeters,
            [FIELD_MAP.radiusOption]: question.distanceOption,
        };

        if (question.answer !== "unanswered") {
            result[FIELD_MAP.answer] = ANSWER_TO_MINIFIED[question.answer];
        }

        if (question.candidates.length > 0) {
            result[FIELD_MAP.candidates] =
                question.candidates.map(compactCandidate);
        }

        if (question.selectedOsmId !== null) {
            result[FIELD_MAP.selectedOsmId] = question.selectedOsmId;
        }

        if (question.selectedOsmType !== null) {
            result[FIELD_MAP.selectedOsmType] = question.selectedOsmType;
        }

        if (question.selectedName !== null) {
            result[FIELD_MAP.selectedName] = question.selectedName;
        }

        return result;
    }

    // matching
    const result: Record<string, unknown> = {
        [FIELD_MAP.category]: question.category,
        [FIELD_MAP.center]: compactCoord(
            question.center[0],
            question.center[1],
        ),
        [FIELD_MAP.id]: question.id,
        [FIELD_MAP.questionType]: "m",
        [FIELD_MAP.lineId]: question.lineId,
        [FIELD_MAP.lineName]: question.lineName,
    };

    if (question.answer !== "unanswered") {
        result[FIELD_MAP.answer] = ANSWER_TO_MINIFIED[question.answer];
    }

    if (question.selectedOsmId !== null) {
        result[FIELD_MAP.selectedOsmId] = question.selectedOsmId;
    }

    if (question.selectedOsmType !== null) {
        result[FIELD_MAP.selectedOsmType] = question.selectedOsmType;
    }

    if (question.targetName !== null) {
        result[FIELD_MAP.targetName] = question.targetName;
    }

    if (question.targetOsmId !== null) {
        result[FIELD_MAP.targetOsmId] = question.targetOsmId;
    }

    if (question.targetOsmType !== null) {
        result[FIELD_MAP.targetOsmType] = question.targetOsmType;
    }

    if (question.candidates.length > 0) {
        result[FIELD_MAP.candidates] =
            question.candidates.map(compactCandidate);
    }

    return result;
}

export function minifyEnvelope(env: WireEnvelope): WireEnvelopeMinified {
    if (env.kind === "question-request") {
        return minifyQuestionRequest(env);
    }
    return minifyAppState(env);
}

function minifyQuestionRequest(
    env: QuestionRequestEnvelopeV1,
): WireEnvelopeMinified {
    const mini: Record<string, unknown> = {
        [FIELD_MAP.kind]: env.kind,
        [FIELD_MAP.payload]: {
            [FIELD_MAP.createdAt]: env.payload.createdAt,
            [FIELD_MAP.question]: minifyQuestion(env.payload.question),
            [FIELD_MAP.requestId]: env.payload.requestId,
        },
        [FIELD_MAP.version]: env.version,
    };
    return mini as unknown as WireEnvelopeMinified;
}

function minifyAppState(appState: AppStateEnvelopeV1): WireEnvelopeMinified {
    const p = appState.payload;
    const mini: Record<string, unknown> = {};

    mini[FIELD_MAP.kind] = appState.kind;
    mini[FIELD_MAP.version] = appState.version;

    const payload: Record<string, unknown> = {};
    payload[FIELD_MAP.gameId] = p.gameId;
    payload[FIELD_MAP.metadata] = {
        [FIELD_MAP.createdAt]: p.metadata.createdAt,
    };

    if (p.hidingZones) {
        payload[FIELD_MAP.hidingZones] = {
            [FIELD_MAP.radiusMeters]: p.hidingZones.radiusMeters,
            [FIELD_MAP.selectedPresetIds]: p.hidingZones.selectedPresetIds,
        };
    }

    if (p.playArea) {
        payload[FIELD_MAP.playArea] = {
            [FIELD_MAP.center]: compactCoord(
                p.playArea.center[0],
                p.playArea.center[1],
            ),
            [FIELD_MAP.label]: p.playArea.label,
            [FIELD_MAP.osmId]: p.playArea.osmId,
        };
    }

    if (p.questions && p.questions.length > 0) {
        payload[FIELD_MAP.questions] = p.questions.map(minifyQuestion);
    }

    if (p.adminDivisions) {
        payload[FIELD_MAP.adminDivisions] = {
            [FIELD_MAP.adminPack]: p.adminDivisions.pack,
            [FIELD_MAP.adminLevels]: p.adminDivisions.levels,
        };
    }

    mini[FIELD_MAP.payload] = payload;
    return mini as unknown as WireEnvelopeMinified;
}

function unminifyQuestion(
    question: unknown,
    options: {
        createdAt: string;
        fallbackCenter?: [number, number];
        index: number;
    },
): QuestionWireV1 {
    const { createdAt, fallbackCenter, index } = options;
    const q = question as Record<string, unknown>;
    const answer = q[FIELD_MAP.answer] as
        | keyof typeof ANSWER_FROM_MINIFIED
        | undefined;
    const resolvedAnswer = answer ? ANSWER_FROM_MINIFIED[answer] : "unanswered";
    const questionType =
        (q[FIELD_MAP.questionType] as string | undefined) ?? "r";

    if (questionType === "m") {
        const compactCenter = q[FIELD_MAP.center] as
            | [number, number]
            | undefined;
        const center = compactCenter
            ? uncompactCoord(compactCenter[0], compactCenter[1])
            : (fallbackCenter ?? [0, 0]);
        const compactCandidates = q[FIELD_MAP.candidates] as
            | z.infer<typeof compactCandidateSchema>[]
            | undefined;
        return normalizeTransitLineQuestion({
            answer: resolvedAnswer,
            candidates: compactCandidates?.map(uncompactCandidate) ?? [],
            category:
                (q[FIELD_MAP.category] as
                    | ReturnType<
                          typeof normalizeTransitLineQuestion
                      >["category"]
                    | undefined) ?? "transit-line",
            center,
            createdAt,
            id:
                (q[FIELD_MAP.id] as string | undefined) ??
                `q-imported-${index + 1}`,
            lineId: (q[FIELD_MAP.lineId] as string | null | undefined) ?? null,
            lineName:
                (q[FIELD_MAP.lineName] as string | null | undefined) ?? null,
            selectedOsmId:
                (q[FIELD_MAP.selectedOsmId] as number | null | undefined) ??
                null,
            selectedOsmType:
                (q[FIELD_MAP.selectedOsmType] as
                    | "node"
                    | "way"
                    | "relation"
                    | null
                    | undefined) ?? null,
            targetName:
                (q[FIELD_MAP.targetName] as string | null | undefined) ?? null,
            targetOsmId:
                (q[FIELD_MAP.targetOsmId] as number | null | undefined) ?? null,
            targetOsmType:
                (q[FIELD_MAP.targetOsmType] as
                    | "node"
                    | "way"
                    | "relation"
                    | null
                    | undefined) ?? null,
            type: "matching",
            updatedAt: createdAt,
        });
    }

    if (questionType === "g") {
        // measuring
        const compactCenter = q[FIELD_MAP.center] as
            | [number, number]
            | undefined;
        const compactCandidates = q[FIELD_MAP.candidates] as
            | z.infer<typeof compactCandidateSchema>[]
            | undefined;
        return {
            answer: resolvedAnswer,
            candidates: compactCandidates?.map(uncompactCandidate) ?? [],
            category: ((q[FIELD_MAP.category] as string | undefined) ??
                "rail-station") as MeasuringCategory,
            center: compactCenter
                ? uncompactCoord(compactCenter[0], compactCenter[1])
                : (fallbackCenter ?? [0, 0]),
            createdAt,
            id:
                (q[FIELD_MAP.id] as string | undefined) ??
                `q-imported-${index + 1}`,
            seekerDistanceMeters:
                (q[FIELD_MAP.radiusMeters] as number | null | undefined) ??
                null,
            seekerDistanceUnit:
                (q[FIELD_MAP.distanceUnit] as "m" | "km" | "mi" | undefined) ??
                "m",
            selectedOsmId:
                (q[FIELD_MAP.selectedOsmId] as number | null | undefined) ??
                null,
            selectedOsmType:
                (q[FIELD_MAP.selectedOsmType] as
                    | "node"
                    | "way"
                    | "relation"
                    | null
                    | undefined) ?? null,
            type: "measuring",
            updatedAt: createdAt,
        };
    }

    if (questionType === "h") {
        // thermometer
        const prevPos = q[FIELD_MAP.previousPosition] as
            | [number, number]
            | null
            | undefined;
        const currPos = q[FIELD_MAP.currentPosition] as
            | [number, number]
            | null
            | undefined;
        return {
            answer: resolvedAnswer,
            previousPosition:
                prevPos && prevPos.length === 2
                    ? uncompactCoord(prevPos[0], prevPos[1])
                    : null,
            currentPosition:
                currPos && currPos.length === 2
                    ? uncompactCoord(currPos[0], currPos[1])
                    : null,
            createdAt,
            id:
                (q[FIELD_MAP.id] as string | undefined) ??
                `q-imported-${index + 1}`,
            type: "thermometer",
            updatedAt: createdAt,
        };
    }

    if (questionType === "c") {
        // tentacles
        const compactCenter = q[FIELD_MAP.center] as
            | [number, number]
            | undefined;
        const compactCandidates = q[FIELD_MAP.candidates] as
            | z.infer<typeof compactCandidateSchema>[]
            | undefined;
        // Re-derive `answer` from the canonical `selectedOsmId` so a minified
        // payload that says `e:"p"` without a `selectedOsmId` is repaired to
        // `unanswered` on decode — symmetry with the zod transforms on the
        // full-key schemas and `normalizeQuestionState` in the store.
        const selectedOsmId: number | null | undefined = q[
            FIELD_MAP.selectedOsmId
        ] as number | null | undefined;
        return {
            answer: derivePoiAnswer(selectedOsmId ?? null),
            candidates: compactCandidates?.map(uncompactCandidate) ?? [],
            category: ((q[FIELD_MAP.category] as string | undefined) ??
                "museum") as TentaclesCategory,
            center: compactCenter
                ? uncompactCoord(compactCenter[0], compactCenter[1])
                : (fallbackCenter ?? [0, 0]),
            createdAt,
            distanceMeters:
                (q[FIELD_MAP.radiusMeters] as number | undefined) ?? 2000,
            distanceOption:
                (q[FIELD_MAP.radiusOption] as "2km" | "25km" | undefined) ??
                "2km",
            id:
                (q[FIELD_MAP.id] as string | undefined) ??
                `q-imported-${index + 1}`,
            selectedOsmId: selectedOsmId ?? null,
            selectedOsmType:
                (q[FIELD_MAP.selectedOsmType] as
                    | "node"
                    | "way"
                    | "relation"
                    | null
                    | undefined) ?? null,
            selectedName:
                (q[FIELD_MAP.selectedName] as string | null | undefined) ??
                null,
            type: "tentacles",
            updatedAt: createdAt,
        };
    }

    // Radar fallback (questionType undefined or "r")
    const compactCenter = q[FIELD_MAP.center] as [number, number];
    const radar: RadarQuestionWireV1 = {
        answer: resolvedAnswer,
        center: uncompactCoord(compactCenter[0], compactCenter[1]),
        createdAt,
        distanceMeters: q[FIELD_MAP.radiusMeters] as number,
        distanceOption:
            (q[FIELD_MAP.radiusOption] as
                | RadarQuestionWireV1["distanceOption"]
                | undefined) ?? "other",
        distanceUnit: "m",
        id:
            (q[FIELD_MAP.id] as string | undefined) ??
            `q-imported-${index + 1}`,
        type: "radar",
        updatedAt: createdAt,
    };
    return radar;
}

export function unminifyEnvelope(mini: WireEnvelopeMinified): WireEnvelope {
    if (mini[FIELD_MAP.kind] === "question-request") {
        return unminifyQuestionRequest(mini);
    }
    return unminifyAppState(mini);
}

function unminifyQuestionRequest(
    mini: WireEnvelopeMinified,
): QuestionRequestEnvelopeV1 {
    const payload = mini[
        FIELD_MAP.payload
    ] as QuestionRequestEnvelopeMinified[typeof FIELD_MAP.payload];
    const createdAt = payload[FIELD_MAP.createdAt];
    return {
        kind: "question-request",
        payload: {
            createdAt,
            question: unminifyQuestion(payload[FIELD_MAP.question], {
                createdAt,
                index: 0,
            }),
            requestId: payload[FIELD_MAP.requestId],
        },
        version: 1,
    };
}

function unminifyAppState(mini: WireEnvelopeMinified): AppStateEnvelopeV1 {
    const p = mini[FIELD_MAP.payload] as AppStatePayloadMinified;
    const full: Record<string, unknown> = {};

    full.kind = mini[FIELD_MAP.kind];
    full.version = mini[FIELD_MAP.version];

    const metadata = p[FIELD_MAP.metadata];
    const createdAt = metadata[FIELD_MAP.createdAt];

    const payload: Record<string, unknown> = {
        gameId: p[FIELD_MAP.gameId],
        metadata: {
            createdAt,
            updatedAt: createdAt,
        },
    };

    if (p[FIELD_MAP.hidingZones]) {
        const hz = p[FIELD_MAP.hidingZones]!;
        payload.hidingZones = {
            radiusMeters: hz[FIELD_MAP.radiusMeters],
            radiusUnit: "m",
            selectedPresetIds: hz[FIELD_MAP.selectedPresetIds],
        };
    }

    if (p[FIELD_MAP.playArea]) {
        const pa = p[FIELD_MAP.playArea]!;
        const [lon, lat] = uncompactCoord(
            pa[FIELD_MAP.center][0],
            pa[FIELD_MAP.center][1],
        );
        payload.playArea = {
            bbox: [0, 0, 0, 0],
            center: [lon, lat],
            label: pa[FIELD_MAP.label],
            osmId: pa[FIELD_MAP.osmId],
            osmType: "R",
        };
    }

    if (p[FIELD_MAP.questions]) {
        const fallbackCenter = (
            payload.playArea as { center?: [number, number] } | undefined
        )?.center;
        payload.questions = p[FIELD_MAP.questions]!.map((question, index) =>
            unminifyQuestion(question, {
                createdAt,
                fallbackCenter,
                index,
            }),
        );
    }

    if (p[FIELD_MAP.adminDivisions]) {
        const ad = p[FIELD_MAP.adminDivisions]!;
        payload.adminDivisions = {
            pack: ad[FIELD_MAP.adminPack],
            levels: ad[FIELD_MAP.adminLevels],
        };
    }

    full.payload = payload;
    return full as unknown as AppStateEnvelopeV1;
}

// Full-key schemas for internal use.
// The wire format uses minified keys. See ../minified.ts
// for the FIELD_MAP and minified schemas.
import { z } from "zod";

import type { GeoJsonFeatureCollection } from "@/features/map/geojsonTypes";
import { derivePoiAnswer } from "@/features/questions/questionRegistry";
import { normalizeTransitLineQuestion } from "@/features/questions/transitLine/transitLineNormalization";

const positionSchema = z.tuple([z.number(), z.number()]);
const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const featureCollectionSchema = z
    .object({
        features: z.array(z.unknown()),
        type: z.literal("FeatureCollection"),
    })
    .passthrough() as z.ZodType<GeoJsonFeatureCollection>;

export const playAreaWireSchema = z.object({
    bbox: bboxSchema,
    boundary: featureCollectionSchema.optional(),
    center: positionSchema,
    label: z.string().min(1),
    osmId: z.number(),
    osmType: z.literal("R"),
});

export const hidingZonesWireSchema = z.object({
    radiusMeters: z.number().nonnegative(),
    radiusUnit: z.enum(["m", "km", "mi"]),
    selectedPresetIds: z.array(z.string()),
});

const radarDistanceOptionSchema = z.enum([
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
]);
const questionAnswerSchema = z
    .enum(["unanswered", "positive", "negative"])
    .default("unanswered");

export const radarQuestionWireSchema = z.object({
    answer: questionAnswerSchema,
    center: positionSchema,
    createdAt: z.string().min(1),
    distanceMeters: z.number().positive(),
    distanceOption: radarDistanceOptionSchema,
    distanceUnit: z.enum(["m", "km", "mi"]),
    id: z.string().min(1),
    isLocked: z.boolean().default(false),
    type: z.literal("radar"),
    updatedAt: z.string().min(1),
});
const matchingCategorySchema = z.enum([
    "transit-line",
    "station-name-length",
    "commercial-airport",
    "admin-1st",
    "admin-2nd",
    "admin-3rd",
    "admin-4th",
    "mountain",
    "landmark",
    "park",
    "amusement-park",
    "zoo",
    "aquarium",
    "golf-course",
    "museum",
    "movie-theater",
    "hospital",
    "library",
    "foreign-consulate",
]);

export const matchingQuestionWireSchema = z
    .object({
        answer: questionAnswerSchema,
        candidates: z
            .array(
                z.object({
                    lat: z.number(),
                    lon: z.number(),
                    name: z.string(),
                    osmId: z.number(),
                    osmType: z.enum(["node", "way", "relation"]),
                    tags: z.record(z.string()),
                }),
            )
            .default([]),
        category: matchingCategorySchema.default("transit-line"),
        center: positionSchema,
        createdAt: z.string().min(1),
        id: z.string().min(1),
        isLocked: z.boolean().default(false),
        lineId: z.string().min(1).nullable(),
        lineName: z.string().min(1).nullable(),
        selectedOsmId: z.number().int().positive().nullable().default(null),
        selectedOsmType: z
            .enum(["node", "way", "relation"])
            .nullable()
            .default(null),
        targetName: z.string().min(1).nullable().default(null),
        targetOsmId: z.number().int().positive().nullable().default(null),
        targetOsmType: z
            .enum(["node", "way", "relation"])
            .nullable()
            .default(null),
        type: z.literal("matching"),
        updatedAt: z.string().min(1),
    })
    .transform(normalizeTransitLineQuestion);

const legacyRadiusQuestionWireSchema = z
    .object({
        center: positionSchema,
        createdAt: z.string().min(1),
        id: z.string().min(1),
        radiusMeters: z.number().positive(),
        radiusOption: radarDistanceOptionSchema,
        radiusUnit: z.enum(["m", "km", "mi"]),
        type: z.literal("radius"),
        updatedAt: z.string().min(1),
    })
    .transform((question) => ({
        answer: "unanswered" as const,
        center: question.center,
        createdAt: question.createdAt,
        distanceMeters: question.radiusMeters,
        distanceOption: question.radiusOption,
        distanceUnit: question.radiusUnit,
        id: question.id,
        isLocked: false,
        type: "radar" as const,
        updatedAt: question.updatedAt,
    }));

const measuringCategorySchema = z.enum([
    "commercial-airport",
    "high-speed-rail",
    "rail-station",
    "admin-1st-border",
    "admin-2nd-border",
    "body-of-water",
    "coastline",
    "mountain",
    "park",
    "amusement-park",
    "zoo",
    "aquarium",
    "golf-course",
    "museum",
    "movie-theater",
    "hospital",
    "library",
    "foreign-consulate",
]);

const measuringQuestionWireSchema = z.object({
    answer: questionAnswerSchema,
    category: measuringCategorySchema,
    center: positionSchema,
    createdAt: z.string().min(1),
    id: z.string().min(1),
    isLocked: z.boolean().default(false),
    seekerDistanceUnit: z.enum(["m", "km", "mi"]).default("m"),
    type: z.literal("measuring"),
    updatedAt: z.string().min(1),
});

const thermometerQuestionWireSchema = z.object({
    answer: questionAnswerSchema,
    createdAt: z.string().min(1),
    previousPosition: positionSchema.nullable().default(null),
    currentPosition: positionSchema.nullable().default(null),
    id: z.string().min(1),
    isLocked: z.boolean().default(false),
    type: z.literal("thermometer"),
    updatedAt: z.string().min(1),
});

const tentaclesCategorySchema = z.enum([
    "museum",
    "library",
    "movie-theater",
    "hospital",
    "transit-line",
    "zoo",
    "aquarium",
    "amusement-park",
]);

const tentaclesDistanceOptionSchema = z.enum(["2km", "25km"]);

const tentaclesQuestionWireSchema = z
    .object({
        answer: z
            .enum(["unanswered", "positive", "negative"])
            .default("unanswered"),
        candidates: z
            .array(
                z.object({
                    lat: z.number(),
                    lon: z.number(),
                    name: z.string(),
                    osmId: z.number(),
                    osmType: z.enum(["node", "way", "relation"]),
                    tags: z.record(z.string()),
                }),
            )
            .default([]),
        category: tentaclesCategorySchema,
        center: positionSchema,
        createdAt: z.string().min(1),
        distanceMeters: z.number().positive(),
        distanceOption: tentaclesDistanceOptionSchema,
        id: z.string().min(1),
        isLocked: z.boolean().default(false),
        selectedOsmId: z.number().int().positive().nullable().default(null),
        selectedOsmType: z
            .enum(["node", "way", "relation"])
            .nullable()
            .default(null),
        selectedName: z.string().nullable().default(null),
        type: z.literal("tentacles"),
        updatedAt: z.string().min(1),
    })
    .transform((q) => {
        // Re-derive answer from canonical selectedOsmId so any historically
        // inconsistent persisted/shared payload is repaired on decode.
        const derivedAnswer = derivePoiAnswer(q.selectedOsmId);
        if (q.answer !== derivedAnswer) {
            return { ...q, answer: derivedAnswer };
        }
        return q;
    });

export const questionWireSchema = z.union([
    radarQuestionWireSchema,
    legacyRadiusQuestionWireSchema,
    matchingQuestionWireSchema,
    measuringQuestionWireSchema,
    thermometerQuestionWireSchema,
    tentaclesQuestionWireSchema,
]);

export const adminDivisionsWireSchema = z.object({
    pack: z.enum(["generic", "japan"]),
    levels: z.tuple([z.string(), z.string(), z.string(), z.string()]),
});

export const appStatePayloadSchema = z.object({
    adminDivisions: adminDivisionsWireSchema.optional(),
    gameId: z.string().min(1),
    hidingZones: hidingZonesWireSchema.optional(),
    metadata: z.object({
        createdAt: z.string().min(1),
        updatedAt: z.string().min(1),
    }),
    playArea: playAreaWireSchema.optional(),
    questions: z.array(questionWireSchema).optional(),
});

export const questionRequestPayloadSchema = z.object({
    createdAt: z.string().min(1),
    question: questionWireSchema,
    requestId: z.string().min(1),
});

export const appStateEnvelopeSchema = z.object({
    kind: z.literal("app-state"),
    payload: appStatePayloadSchema,
    version: z.literal(1),
});

export const questionRequestEnvelopeSchema = z.object({
    kind: z.literal("question-request"),
    payload: questionRequestPayloadSchema,
    version: z.literal(1),
});

export const wireEnvelopeSchema = z.discriminatedUnion("kind", [
    appStateEnvelopeSchema,
    questionRequestEnvelopeSchema,
]);

export type AppStateEnvelopeV1 = z.infer<typeof appStateEnvelopeSchema>;
export type AppStatePayloadV1 = z.infer<typeof appStatePayloadSchema>;
export type HidingZonesWireV1 = z.infer<typeof hidingZonesWireSchema>;
export type PlayAreaWireV1 = z.infer<typeof playAreaWireSchema>;
export type QuestionWireV1 = z.infer<typeof questionWireSchema>;
export type QuestionRequestPayloadV1 = z.infer<
    typeof questionRequestPayloadSchema
>;
export type QuestionRequestEnvelopeV1 = z.infer<
    typeof questionRequestEnvelopeSchema
>;
export type RadarQuestionWireV1 = z.infer<typeof radarQuestionWireSchema>;
export type AdminDivisionsWireV1 = z.infer<typeof adminDivisionsWireSchema>;
export type WireEnvelope = z.infer<typeof wireEnvelopeSchema>;

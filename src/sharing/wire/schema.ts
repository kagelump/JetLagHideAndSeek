// Full-key schemas for internal use.
// The wire format uses minified keys. See ../minified.ts
// for the FIELD_MAP and minified schemas.
//
// The per-question schemas + normalizations are the shared single source of
// truth in ./questionSchemas — persistence, this wire format, and the minified
// codec all derive from there. Only the wire-specific envelope/payload schemas
// live in this file.
import { z } from "zod";

import {
    bboxSchema,
    featureCollectionSchema,
    positionSchema,
    questionSchema,
    radarQuestionSchema,
} from "@/sharing/wire/questionSchemas";

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

export const questionWireSchema = questionSchema;

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
export type RadarQuestionWireV1 = z.infer<typeof radarQuestionSchema>;
export type AdminDivisionsWireV1 = z.infer<typeof adminDivisionsWireSchema>;
export type WireEnvelope = z.infer<typeof wireEnvelopeSchema>;

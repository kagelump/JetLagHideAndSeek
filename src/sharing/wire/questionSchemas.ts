// Single source of truth for the per-question Zod schemas + normalizations.
//
// Persistence (`src/state/appState.ts`), the full-key wire format
// (`src/sharing/wire/schema.ts`), and the minified codec
// (`src/sharing/wire/minified.ts`) all derive from these definitions so a
// category/field added here can never drift across the three copies (the
// "schema triplication" critical finding in the June 2026 audit).
//
// The Zod `.transform`s here are the ONLY question normalizer — the store's
// import paths run through `appStateQuestionsSchema.parse` rather than a
// bespoke imperative copy.
import { z } from "zod";

import type { GeoJsonFeatureCollection } from "@/features/map/geojsonTypes";
import { derivePoiAnswer } from "@/features/questions/questionRegistry";
import { normalizeTransitLineQuestion } from "@/features/questions/transitLine/transitLineNormalization";

// ── Shared leaf schemas ────────────────────────────────────────────────────

export const positionSchema = z.tuple([z.number(), z.number()]);
export const bboxSchema = z.tuple([
    z.number(),
    z.number(),
    z.number(),
    z.number(),
]);

export const featureCollectionSchema = z
    .object({
        features: z.array(z.unknown()),
        type: z.literal("FeatureCollection"),
    })
    .passthrough() as z.ZodType<GeoJsonFeatureCollection>;

export const radarDistanceOptionSchema = z.enum([
    "500m",
    "1km",
    "2km",
    "5km",
    "10km",
    "15km",
    "40km",
    "80km",
    "150km",
    "0.5mi",
    "1mi",
    "2mi",
    "5mi",
    "10mi",
    "15mi",
    "25mi",
    "50mi",
    "100mi",
    "other",
]);

export const questionAnswerSchema = z
    .enum(["unanswered", "positive", "negative"])
    .default("unanswered");

export const matchingCategorySchema = z.enum([
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

export const measuringCategorySchema = z.enum([
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

export const tentaclesCategorySchema = z.enum([
    "museum",
    "library",
    "movie-theater",
    "hospital",
    "transit-line",
    "zoo",
    "aquarium",
    "amusement-park",
]);

export const tentaclesDistanceOptionSchema = z.enum(["2km", "25km"]);

export const candidateSchema = z.object({
    lat: z.number(),
    lon: z.number(),
    name: z.string(),
    osmId: z.number(),
    osmType: z.enum(["node", "way", "relation"]),
    tags: z.record(z.string()),
});

const thermometerStationSchema = z.object({
    name: z.string().nullable().default(null),
    distanceMeters: z.number().nullable().default(null),
});

// ── Shared normalizations ──────────────────────────────────────────────────

/**
 * Re-derive a POI-model question's `answer` from its canonical `selectedOsmId`
 * so any historically-inconsistent persisted/shared payload is repaired on
 * load. An explicit `"negative"` (e.g. tentacles "None") is a valid answered
 * state with no POI selection to drift from, so it is **preserved**.
 *
 * This is the single authoritative implementation — the store's old
 * `normalizeQuestionState` and the inline copies in the wire/minified codecs
 * disagreed on the `"negative"` case, which silently dropped a tentacles "None"
 * answer on reload/import.
 */
export function normalizePoiAnswer<
    T extends {
        answer: "unanswered" | "positive" | "negative";
        selectedOsmId: number | null;
    },
>(question: T): T {
    if (question.answer === "negative") {
        return question;
    }
    const derivedAnswer = derivePoiAnswer(question.selectedOsmId);
    if (question.answer !== derivedAnswer) {
        return { ...question, answer: derivedAnswer };
    }
    return question;
}

// ── Per-question schemas ────────────────────────────────────────────────────

export const radarQuestionSchema = z.object({
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

export const matchingQuestionSchema = z
    .object({
        answer: questionAnswerSchema,
        candidates: z.array(candidateSchema).default([]),
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

export const legacyRadiusQuestionSchema = z
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

export const measuringQuestionSchema = z.object({
    answer: questionAnswerSchema,
    category: measuringCategorySchema,
    center: positionSchema,
    createdAt: z.string().min(1),
    id: z.string().min(1),
    isLocked: z.boolean().default(false),
    nearestPoiName: z.string().nullable().default(null),
    seekerDistanceMeters: z.number().nullable().default(null),
    seekerDistanceUnit: z.enum(["m", "km", "mi"]).default("m"),
    type: z.literal("measuring"),
    updatedAt: z.string().min(1),
});

export const thermometerQuestionSchema = z.object({
    answer: questionAnswerSchema,
    createdAt: z.string().min(1),
    previousPosition: positionSchema.nullable().default(null),
    currentPosition: positionSchema.nullable().default(null),
    previousStation: thermometerStationSchema.nullable().default(null),
    currentStation: thermometerStationSchema.nullable().default(null),
    id: z.string().min(1),
    isLocked: z.boolean().default(false),
    type: z.literal("thermometer"),
    updatedAt: z.string().min(1),
});

export const tentaclesQuestionSchema = z
    .object({
        answer: questionAnswerSchema,
        candidates: z.array(candidateSchema).default([]),
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
    .transform(normalizePoiAnswer);

/**
 * The full-key question union, shared by persistence (`appStateQuestionsSchema`)
 * and the wire format (`questionWireSchema`). The legacy `radius` member
 * normalizes to `radar` via its transform.
 */
export const questionSchema = z.union([
    radarQuestionSchema,
    legacyRadiusQuestionSchema,
    matchingQuestionSchema,
    measuringQuestionSchema,
    thermometerQuestionSchema,
    tentaclesQuestionSchema,
]);

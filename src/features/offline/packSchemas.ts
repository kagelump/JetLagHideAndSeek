/**
 * Zod schemas for pack-related data at the network boundary.
 *
 * These schemas validate data that crosses the network boundary:
 * the installed-pack index (AsyncStorage), and downloaded artifact
 * payloads (boundaries, transit, meta). Payloads have already passed
 * SHA-256 integrity checks — schema validation here is defense-in-depth.
 *
 * Schemas are intentionally lenient (`.passthrough()`) so unknown
 * fields don't cause rejection.
 */

import { z } from "zod";

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const artifactKindSchema = z.enum([
    "poi",
    "measuring",
    "boundaries",
    "transit",
    "meta",
]);

// ─── Installed index schemas ────────────────────────────────────────────────
// These validate the installed-pack index persisted in AsyncStorage.

export const installedArtifactSchema = z
    .object({
        kind: artifactKindSchema,
        category: z.string().optional(),
        bytes: z.number().int().nonnegative(),
        status: z.enum(["installed", "failed"]),
    })
    .passthrough();

export const installedPackSchema = z
    .object({
        id: z.string().min(1),
        osmSnapshot: z.string().min(1),
        installedAt: z.string().min(1),
        bbox: bboxSchema.optional(),
        artifacts: z.array(installedArtifactSchema),
    })
    .passthrough();

export const installedIndexSchema = z.record(installedPackSchema);

// ─── Artifact payload schemas ───────────────────────────────────────────────
// These validate downloaded artifact payloads (after decompression).

const boundaryIndexEntrySchema = z.object({
    relationId: z.number(),
    name: z.string(),
    nameEn: z.string().optional(),
    normalized: z.array(z.string()).optional(),
    adminLevel: z.number(),
    centroid: z.tuple([z.number(), z.number()]),
    bbox: bboxSchema,
    areaKm2: z.number(),
});

/**
 * Meta artifact payload schema.
 *
 * The meta payload is the primary source of pack metadata. Only
 * `label`, `bbox`, and `adminLevels.matching` are consumed at
 * registration time — the rest is metadata for debugging / display.
 */
export const metaPayloadSchema = z
    .object({
        schemaVersion: z.number(),
        regionId: z.string().optional(),
        label: z.string().optional(),
        regionPath: z.array(z.string()).optional(),
        bbox: bboxSchema.optional(),
        osmSnapshot: z.string().optional(),
        adminLevels: z
            .object({
                matching: z.array(z.number()).optional(),
                extract: z.array(z.number()).optional(),
            })
            .passthrough()
            .optional(),
        categories: z.unknown().optional(),
        attribution: z.unknown().optional(),
        artifacts: z.array(z.string()).optional(),
    })
    .passthrough();

/**
 * Boundaries artifact payload (combined, pre-split).
 *
 * Contains both the index (searched eagerly) and delta-encoded
 * polygon data (loaded lazily). The installer splits this into
 * separate index + polygons files.
 */
export const boundariesPayloadSchema = z
    .object({
        schemaVersion: z.number(),
        regionId: z.string(),
        index: z.array(boundaryIndexEntrySchema),
        polygons: z.record(z.array(z.number())),
        levels: z.array(z.number()),
    })
    .passthrough();

/**
 * Boundaries index payload (post-split).
 *
 * Written during install from the combined artifact. Read on app
 * restart to re-register the boundary source without re-downloading.
 */
export const boundariesIndexPayloadSchema = z
    .object({
        schemaVersion: z.number(),
        regionId: z.string(),
        levels: z.array(z.number()),
        index: z.array(boundaryIndexEntrySchema),
    })
    .passthrough();

/**
 * Transit artifact payload schema.
 *
 * Contains preset summaries (id, label, bbox, optional kind) that
 * the app uses to register transit sources for hiding-zone suggestions.
 */
export const transitPayloadSchema = z
    .object({
        schemaVersion: z.number(),
        regionId: z.string().optional(),
        presets: z.array(
            z.object({
                id: z.string(),
                label: z.string(),
                bbox: bboxSchema,
                kind: z.string().optional(),
            }),
        ),
    })
    .passthrough();

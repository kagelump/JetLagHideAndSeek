import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { OFFLINE } from "@/config/appConfig";

// ─── Zod schemas ─────────────────────────────────────────────────────────

const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const artifactKindSchema = z.enum([
    "poi",
    "measuring",
    "boundaries",
    "transit",
    "meta",
]);

export const artifactSchema = z.object({
    kind: artifactKindSchema,
    category: z.string().optional(),
    url: z.string().min(1),
    bytes: z.number().positive().int(),
    md5: z.string().min(1),
    sha256: z.string().min(1),
    schemaVersion: z.number().positive().int(),
});

export const catalogPackSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    regionPath: z.array(z.string().min(1)).min(1),
    bbox: bboxSchema,
    osmSnapshot: z.string().min(1),
    totalBytes: z.number().positive().int(),
    artifacts: z.array(artifactSchema).min(1),
});

export const catalogSchema = z.object({
    schemaVersion: z.literal(2),
    generatedAt: z.string().min(1),
    attributionUrl: z.string().min(1).optional(),
    packs: z.array(catalogPackSchema),
});

// ─── Inferred types ──────────────────────────────────────────────────────

export type CatalogPack = z.infer<typeof catalogPackSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type Artifact = z.infer<typeof artifactSchema>;

// ─── Fetch function ──────────────────────────────────────────────────────

async function fetchCatalog(url: string): Promise<Catalog> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Catalog fetch failed for ${url}: HTTP ${response.status}`,
        );
    }
    const raw = await response.json();
    return catalogSchema.parse(raw);
}

// ─── TanStack Query hook ─────────────────────────────────────────────────

export function usePackCatalog() {
    return useQuery({
        queryKey: ["offline-catalog"],
        queryFn: () => fetchCatalog(OFFLINE.catalogUrl),
        staleTime: OFFLINE.catalogStaleTimeMs,
    });
}

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { OFFLINE } from "@/config/appConfig";
import { createLogger } from "@/shared/logger";

const log = createLogger("packCatalog");

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
    category: z.preprocess(
        (v) => (v === null ? undefined : v),
        z.string().optional(),
    ),
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
    // Cache-bust with a timestamp so a manual refresh (or app revisit) always
    // sees the latest published catalog rather than a CDN/HTTP-cached copy —
    // GitHub Pages serves catalog.json with its own Cache-Control, so a plain
    // refetch can otherwise return stale bytes after a republish. The query
    // param is the portable guarantee; `cache: "no-store"` is belt-and-braces.
    const bustUrl = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    log.debug("Fetching catalog from:", bustUrl);
    const response = await fetch(bustUrl, { cache: "no-store" });
    if (!response.ok) {
        log.error(`Catalog fetch failed: HTTP ${response.status} from ${url}`);
        throw new Error(
            `Catalog fetch failed for ${url}: HTTP ${response.status}`,
        );
    }
    const raw = await response.json();
    try {
        return catalogSchema.parse(raw);
    } catch (err) {
        log.error("Catalog schema validation failed:", err);
        throw err;
    }
}

// ─── TanStack Query hook ─────────────────────────────────────────────────

export function usePackCatalog() {
    return useQuery({
        queryKey: ["offline-catalog"],
        queryFn: () => fetchCatalog(OFFLINE.catalogUrl),
        staleTime: OFFLINE.catalogStaleTimeMs,
    });
}

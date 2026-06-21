import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { digestStringAsync } from "expo-crypto";
import { CryptoDigestAlgorithm } from "expo-crypto";
import { gunzipSync, strFromU8 } from "fflate";
import { Directory, File, Paths, type InfoOptions } from "expo-file-system";
import {
    registerRegion,
    unregisterRegion,
} from "@/features/questions/matching/bundledPois";
import {
    registerMeasuringSource,
    unregisterMeasuringSources,
} from "@/features/questions/measuring/lineBundleLoader";
import {
    registerBoundarySource,
    unregisterBoundarySource,
} from "@/features/offline/boundaryStore";
import type { BoundaryIndexEntry } from "@/features/offline/boundaryStore";
import {
    registerTransitSource,
    unregisterTransitSource,
} from "@/features/hidingZone/hidingZoneData";
import type { PackAdminLevelInfo } from "@/features/offline/adminLevelDefaults";
import {
    registerPackAdminLevels,
    unregisterPackAdminLevels,
} from "@/features/offline/adminLevelDefaults";
import { OFFLINE } from "@/config/appConfig";
import type { Bbox } from "@/shared/geojson";
import type { Artifact, ArtifactKind, CatalogPack } from "./packCatalog";
import type { MeasuringCategory } from "@/features/questions/measuring/measuringTypes";
import {
    installedIndexSchema,
    boundariesPayloadSchema,
    boundariesIndexPayloadSchema,
    transitPayloadSchema,
    metaPayloadSchema,
} from "./packSchemas";
import { createLogger } from "@/shared/logger";

const log = createLogger("regionPacks");

// ─── Types ─────────────────────────────────────────────────────────────────

export type InstalledArtifact = {
    kind: ArtifactKind;
    category?: string;
    bytes: number;
    status: "installed" | "failed";
    /** Failure message (present when status === "failed"). */
    error?: string;
    /**
     * Whether re-downloading could fix the failure. `false` =
     * integrity/validation failure (bad blob or catalog) that Retry can never
     * resolve — surfaced as a bundle error to report. Undefined on success.
     */
    retryable?: boolean;
};

export type InstalledPack = {
    id: string;
    osmSnapshot: string;
    installedAt: string;
    /** Pack bbox from meta.json — persisted so coverage works without catalog. */
    bbox?: Bbox;
    artifacts: InstalledArtifact[];
};

type InstalledIndex = Record<string, InstalledPack>;

// ─── Constants ────────────────────────────────────────────────────────────

const INSTALLED_INDEX_KEY = OFFLINE.installedIndexKey;
const MD5_INFO_OPTS: InfoOptions = { md5: true };

// Lazy — defers the expo-file-system module access so tests that don't
// exercise region packs don't need to mock expo-file-system.
let _packsDir: Directory | null = null;
function packsDir(): Directory {
    if (!_packsDir) {
        _packsDir = new Directory(Paths.document, "packs");
    }
    return _packsDir;
}

// ─── Safety validation ────────────────────────────────────────────────────

/** Pack IDs must be alphanumeric + hyphens, starting with a letter or digit. */
const VALID_PACK_ID = /^[a-z0-9][a-z0-9-]*$/i;

function validatePackId(id: string): void {
    if (!VALID_PACK_ID.test(id)) {
        throw new Error(
            `Invalid pack id "${id}" — must match ${VALID_PACK_ID}`,
        );
    }
}

/** Detect HTTP 404 from expo-file-system download errors. */
function isHttpNotFound(err: Error): boolean {
    return err.message.includes("status 404") || err.message.includes("404");
}

/**
 * A pack artifact failure. `retryable === false` marks an integrity/validation
 * failure (size/hash/schemaVersion/payload) where the released blob or catalog
 * is bad — re-downloading the same blob always fails identically, so the UI
 * surfaces it as a bundle error to report rather than offering Retry. Network
 * and IO errors stay plain Errors and are treated as retryable.
 */
class PackArtifactError extends Error {
    readonly retryable: boolean;
    constructor(message: string, retryable: boolean) {
        super(message);
        this.name = "PackArtifactError";
        this.retryable = retryable;
    }
}

/**
 * Delete the partial download (best-effort) and throw a non-retryable bundle
 * error. Centralizes the repeated "delete .gz then throw" integrity-failure
 * pattern so every such failure is classified consistently.
 */
function bundleErrorFail(
    downloaded: { delete: () => void } | undefined,
    message: string,
): never {
    if (downloaded) {
        try {
            downloaded.delete();
        } catch {
            /* best-effort */
        }
    }
    throw new PackArtifactError(message, false);
}

// ─── File helpers ─────────────────────────────────────────────────────────

function packDir(id: string): Directory {
    return new Directory(packsDir(), id);
}

function gzFileName(kind: ArtifactKind, category?: string): string {
    return category ? `${kind}-${category}.json.gz` : `${kind}.json.gz`;
}

function jsonFileName(kind: ArtifactKind, category?: string): string {
    return category ? `${kind}-${category}.json` : `${kind}.json`;
}

function gzFile(id: string, kind: ArtifactKind, category?: string): File {
    return new File(packDir(id), gzFileName(kind, category));
}

function jsonFile(id: string, kind: ArtifactKind, category?: string): File {
    return new File(packDir(id), jsonFileName(kind, category));
}

// ─── Installed-pack index (AsyncStorage) ──────────────────────────────────

// Serializes index mutations — avoids lost-update races between concurrent
// install/remove (low-likelihood but user-driven).
let indexMutex: Promise<void> = Promise.resolve();

function withIndexMutex<T>(fn: () => Promise<T>): Promise<T> {
    const prev = indexMutex;
    let release: () => void;
    indexMutex = new Promise<void>((resolve) => {
        release = resolve;
    });
    return prev.then(fn).finally(() => release!());
}

async function getInstalledIndex(): Promise<InstalledIndex> {
    const raw = await AsyncStorage.getItem(INSTALLED_INDEX_KEY);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        const result = installedIndexSchema.safeParse(parsed);
        if (!result.success) {
            if (__DEV__) {
                log.warn(
                    "Installed index validation failed:",
                    result.error.issues,
                );
            }
            return {};
        }
        return result.data as InstalledIndex;
    } catch {
        return {};
    }
}

async function setInstalledIndex(index: InstalledIndex): Promise<void> {
    await AsyncStorage.setItem(INSTALLED_INDEX_KEY, JSON.stringify(index));
}

// ─── Per-kind registration ────────────────────────────────────────────────

function registerArtifact(
    packId: string,
    kind: ArtifactKind,
    category: string | undefined,
    raw: unknown,
): void {
    switch (kind) {
        case "poi": {
            registerRegion(packId, raw as Parameters<typeof registerRegion>[1]);
            break;
        }
        case "measuring": {
            if (category) {
                // After Phase 1, packs no longer ship admin border measuring
                // artifacts. Admin border data comes from the boundaries
                // artifact; skip registration defensively.
                if (
                    category === "admin-1st-border" ||
                    category === "admin-2nd-border"
                ) {
                    break;
                }
                const metPath = jsonFile(packId, kind, category).uri;
                registerMeasuringSource(
                    packId,
                    category as MeasuringCategory,
                    metPath,
                );
            }
            break;
        }
        case "boundaries": {
            // Validate payload before processing.
            const parsed = boundariesPayloadSchema.safeParse(raw);
            if (!parsed.success) {
                throw new Error(
                    `Pack ${packId}/boundaries: payload validation failed: ` +
                        parsed.error.issues.map((i) => i.message).join("; "),
                );
            }
            const data = parsed.data;

            // Split the combined artifact: write boundaries-index.json
            // (small, fast read for search) and boundaries-polygons.json
            // (large, delta-encoded, lazy-loaded), then delete the combined file.
            const indexPath = jsonFile(packId, kind, "index");
            indexPath.create({ overwrite: true });
            indexPath.write(
                JSON.stringify({
                    schemaVersion: data.schemaVersion,
                    regionId: data.regionId,
                    levels: data.levels,
                    index: data.index,
                }),
            );

            // Write boundaries-polygons.json.
            const polygonsPath = jsonFile(packId, kind, "polygons");
            polygonsPath.create({ overwrite: true });
            polygonsPath.write(
                JSON.stringify({
                    schemaVersion: data.schemaVersion,
                    regionId: data.regionId,
                    polygons: data.polygons,
                }),
            );

            // Delete the combined boundaries.json (no longer needed).
            try {
                jsonFile(packId, kind).delete();
            } catch {
                /* best-effort */
            }

            registerBoundarySource(
                packId,
                indexPath.uri,
                polygonsPath.uri,
                data.index as BoundaryIndexEntry[],
                data.levels,
            );
            break;
        }
        case "transit": {
            const parsed = transitPayloadSchema.safeParse(raw);
            if (!parsed.success) {
                throw new Error(
                    `Pack ${packId}/transit: payload validation failed: ` +
                        parsed.error.issues.map((i) => i.message).join("; "),
                );
            }
            const data = parsed.data;
            const presetSummaries = data.presets.map((p) => ({
                id: p.id,
                label: p.label,
                bbox: p.bbox,
                kind: p.kind,
            }));
            if (__DEV__) {
                log.debug(
                    `registerArtifact transit ${packId}: ` +
                        `${presetSummaries.length} preset summaries ` +
                        `(first bbox: ${presetSummaries[0]?.bbox?.join(",") ?? "none"})`,
                );
            }
            registerTransitSource(
                packId,
                jsonFile(packId, kind).uri,
                presetSummaries,
            );
            break;
        }
        case "meta": {
            const parsed = metaPayloadSchema.safeParse(raw);
            if (!parsed.success) {
                throw new Error(
                    `Pack ${packId}/meta: payload validation failed: ` +
                        parsed.error.issues.map((i) => i.message).join("; "),
                );
            }
            const data = parsed.data;
            if (data.adminLevels?.matching && data.bbox) {
                registerPackAdminLevels({
                    packId,
                    label: data.label ?? packId,
                    bbox: data.bbox,
                    matchingLevels: data.adminLevels.matching.slice(0, 4) as [
                        number,
                        number,
                        number,
                        number,
                    ],
                    ...(data.adminLevels.labels
                        ? {
                              labels: data.adminLevels
                                  .labels as unknown as PackAdminLevelInfo["labels"],
                          }
                        : {}),
                });
            }
            break;
        }
    }
}

function unregisterArtifacts(packId: string): void {
    // Unregister POI region.
    unregisterRegion(packId);
    // Unregister measuring sources.
    unregisterMeasuringSources(packId);
    // Unregister boundaries.
    unregisterBoundarySource(packId);
    // Unregister transit.
    unregisterTransitSource(packId);
    // Unregister admin levels.
    unregisterPackAdminLevels(packId);
}

// ─── Payload validation ────────────────────────────────────────────────────

/**
 * Validate a parsed artifact payload against its kind's Zod schema.
 * Throws on failure; optionally deletes `downloaded` first (for gzip path).
 */
function validateParsedPayload(
    packId: string,
    kind: ArtifactKind,
    raw: unknown,
    downloaded?: { delete: () => void },
): void {
    let result: {
        success: boolean;
        error: { issues: Array<{ message: string }> };
    };
    switch (kind) {
        case "boundaries":
            result = boundariesPayloadSchema.safeParse(raw) as typeof result;
            break;
        case "transit":
            result = transitPayloadSchema.safeParse(raw) as typeof result;
            break;
        case "meta":
            result = metaPayloadSchema.safeParse(raw) as typeof result;
            break;
        default:
            return; // poi and measuring have their own validation
    }
    if (!result.success) {
        bundleErrorFail(
            downloaded,
            `Pack ${packId}/${kind} payload validation failed: ` +
                result.error.issues.map((i) => i.message).join("; "),
        );
    }
}

// ─── Install pack ──────────────────────────────────────────────────────────

function ensurePackDir(id: string): void {
    const dir = packDir(id);
    if (!dir.exists) {
        dir.create({ intermediates: true });
    }
}

export type InstallProgress = {
    done: number;
    total: number;
    currentKind: ArtifactKind;
};

/**
 * Install all artifacts in a pack. Sequential loop for deterministic behavior.
 * Returns the list of installed artifacts with their status.
 */
async function installPackInternal(
    pack: CatalogPack,
    progress?: (p: InstallProgress) => void,
): Promise<InstalledArtifact[]> {
    validatePackId(pack.id);
    ensurePackDir(pack.id);

    // Install meta first — later steps may want adminLevels.
    const metaArtifact = pack.artifacts.find((a) => a.kind === "meta");
    const otherArtifacts = pack.artifacts.filter((a) => a.kind !== "meta");
    const ordered = metaArtifact
        ? [metaArtifact, ...otherArtifacts]
        : otherArtifacts;

    const results: InstalledArtifact[] = [];
    let done = 0;

    for (const artifact of ordered) {
        progress?.({ done, total: ordered.length, currentKind: artifact.kind });

        try {
            await installSingleArtifact(pack.id, artifact);
            results.push({
                kind: artifact.kind,
                category: artifact.category,
                bytes: artifact.bytes,
                status: "installed",
            });
        } catch (err) {
            log.warn(
                `Artifact ${artifact.kind}${artifact.category ? `-${artifact.category}` : ""} ` +
                    `in pack "${pack.id}" failed:`,
                err,
            );
            results.push({
                kind: artifact.kind,
                category: artifact.category,
                bytes: artifact.bytes,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                retryable:
                    err instanceof PackArtifactError ? err.retryable : true,
            });
        }

        done++;
    }

    progress?.({
        done: ordered.length,
        total: ordered.length,
        currentKind: "meta",
    });

    // Persist installed-pack index (mutex-guarded).
    // Include the pack bbox from meta so coverage works without catalog.
    let packBbox: Bbox | undefined;
    try {
        const metaFile = jsonFile(pack.id, "meta");
        if (metaFile.exists) {
            const metaJson = JSON.parse(await metaFile.text());
            if (
                Array.isArray(metaJson.bbox) &&
                metaJson.bbox.length === 4 &&
                metaJson.bbox.every((v: unknown) => typeof v === "number")
            ) {
                packBbox = metaJson.bbox as Bbox;
            }
        }
    } catch {
        // Best-effort — coverage will fall back to catalog bbox.
    }

    await withIndexMutex(async () => {
        const index = await getInstalledIndex();
        index[pack.id] = {
            id: pack.id,
            osmSnapshot: pack.osmSnapshot,
            installedAt: new Date().toISOString(),
            bbox: packBbox,
            artifacts: results,
        };
        await setInstalledIndex(index);
    });

    return results;
}

async function installSingleArtifact(
    packId: string,
    artifact: Artifact,
): Promise<void> {
    const dest = gzFile(packId, artifact.kind, artifact.category);

    // 1. Download .gz via the v19 File API (writes directly to disk).
    let downloaded: Awaited<ReturnType<typeof File.downloadFileAsync>>;
    let isPlainJsonFallback = false;
    try {
        downloaded = await File.downloadFileAsync(artifact.url, dest, {
            idempotent: true,
        });
    } catch (err) {
        // TODO: remove this workaround once all published artifacts use .json.gz
        // (publish.mjs now uploads meta.json.gz; old releases may still have
        // uncompressed .json files).
        if (
            err instanceof Error &&
            isHttpNotFound(err) &&
            artifact.url.endsWith(".json.gz")
        ) {
            const plainUrl = artifact.url.replace(/\.json\.gz$/, ".json");
            if (__DEV__) {
                log.debug(
                    `${packId}/${artifact.kind}: .gz 404, retrying plain ${plainUrl}`,
                );
            }
            const plainDest = jsonFile(
                packId,
                artifact.kind,
                artifact.category,
            );
            downloaded = await File.downloadFileAsync(plainUrl, plainDest, {
                idempotent: true,
            });
            isPlainJsonFallback = true;
        } else {
            throw err;
        }
    }

    if (isPlainJsonFallback) {
        // Plain JSON fallback — skip compression checks, verify content directly.
        const jsonStr = await downloaded.text();

        // Verify SHA-256 of the JSON content.
        if (!artifact.sha256) {
            bundleErrorFail(
                downloaded,
                `Integrity check failed for ${packId}/${artifact.kind}: manifest missing sha256`,
            );
        }
        const givenSha256 = await digestStringAsync(
            CryptoDigestAlgorithm.SHA256,
            jsonStr,
        );
        if (givenSha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
            bundleErrorFail(
                downloaded,
                `Integrity check failed for ${packId}/${artifact.kind}: SHA-256 mismatch ` +
                    `(expected ${artifact.sha256}, got ${givenSha256})`,
            );
        }

        const raw = JSON.parse(jsonStr) as Record<string, unknown>;

        // Schema version guard — treat missing schemaVersion as matching
        // (TODO: remove this leniency once all pipeline builders include schemaVersion).
        const payloadSchemaVersion: unknown = raw.schemaVersion;
        if (
            payloadSchemaVersion !== undefined &&
            (typeof payloadSchemaVersion !== "number" ||
                payloadSchemaVersion !== artifact.schemaVersion)
        ) {
            bundleErrorFail(
                downloaded,
                `Pack ${packId}/${artifact.kind} schemaVersion mismatch: ` +
                    `payload has ${payloadSchemaVersion}, expected ${artifact.schemaVersion}`,
            );
        }

        // 6. Validate payload structure (defense-in-depth).
        validateParsedPayload(packId, artifact.kind, raw, downloaded);

        // The file is already at the plain JSON path — register and exit.
        if (__DEV__) {
            log.debug(
                `${packId}/${artifact.kind}: installed via plain JSON fallback`,
            );
        }
        registerArtifact(packId, artifact.kind, artifact.category, raw);
        return;
    }

    // 2. Verify byte length.
    const info = downloaded.info(MD5_INFO_OPTS);
    if (info.size !== artifact.bytes) {
        bundleErrorFail(
            downloaded,
            `Size mismatch for ${packId}/${artifact.kind}: expected ${artifact.bytes}, got ${info.size ?? "N/A"}`,
        );
    }

    // 3. Verify MD5 hash of the compressed file.
    if (!artifact.md5) {
        bundleErrorFail(
            downloaded,
            `Integrity check failed for ${packId}/${artifact.kind}: manifest missing md5`,
        );
    }
    if (!info.md5 || info.md5.toLowerCase() !== artifact.md5.toLowerCase()) {
        bundleErrorFail(
            downloaded,
            `Integrity check failed for ${packId}/${artifact.kind}: MD5 mismatch ` +
                `(expected ${artifact.md5}, got ${info.md5 ?? "N/A"})`,
        );
    }

    // 4. Read raw bytes and inflate with fflate.
    const gzBytes = await downloaded.bytes();

    // Decompression bomb guard.
    const INFLATE_MAX_BYTES = OFFLINE.inflateMaxBytes;
    const inflateLimit = Math.min(INFLATE_MAX_BYTES, gzBytes.length * 20);
    const inflated = gunzipSync(gzBytes);
    if (inflated.length > inflateLimit) {
        bundleErrorFail(
            downloaded,
            `Decompressed size ${(inflated.length / 1024 / 1024).toFixed(1)} MB ` +
                `exceeds limit of ${(inflateLimit / 1024 / 1024).toFixed(1)} MB ` +
                `for ${packId}/${artifact.kind}`,
        );
    }
    const jsonStr = strFromU8(inflated);

    // 4a. Verify SHA-256 of the uncompressed JSON.
    if (!artifact.sha256) {
        bundleErrorFail(
            downloaded,
            `Integrity check failed for ${packId}/${artifact.kind}: manifest missing sha256`,
        );
    }
    const givenSha256 = await digestStringAsync(
        CryptoDigestAlgorithm.SHA256,
        jsonStr,
    );
    if (givenSha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
        bundleErrorFail(
            downloaded,
            `Integrity check failed for ${packId}/${artifact.kind}: SHA-256 mismatch ` +
                `(expected ${artifact.sha256}, got ${givenSha256})`,
        );
    }

    const raw = JSON.parse(jsonStr) as Record<string, unknown>;

    // 5. Schema version guard.
    // TODO: remove the undefined-skip leniency once all pipeline builders
    // include schemaVersion (buildTransit.mjs now emits schemaVersion: 1).
    if (raw.schemaVersion === undefined) {
        if (__DEV__) {
            log.debug(
                `${packId}/${artifact.kind}: schemaVersion absent in payload, ` +
                    `defaulting to expected ${artifact.schemaVersion}`,
            );
        }
    } else if (
        typeof raw.schemaVersion !== "number" ||
        raw.schemaVersion !== artifact.schemaVersion
    ) {
        bundleErrorFail(
            downloaded,
            `Pack ${packId}/${artifact.kind} schemaVersion mismatch: ` +
                `payload has ${raw.schemaVersion}, expected ${artifact.schemaVersion}`,
        );
    }

    // 5a. Validate payload structure (defense-in-depth).
    // Deletes the .gz on failure (consistent with other error paths).
    validateParsedPayload(packId, artifact.kind, raw, downloaded);

    // 6. Write plain .json.
    const plain = jsonFile(packId, artifact.kind, artifact.category);
    plain.create({ overwrite: true });
    plain.write(jsonStr);

    // 7. Delete the .gz.
    try {
        downloaded.delete();
    } catch {
        /* best-effort */
    }

    // 8. Register artifact.
    registerArtifact(packId, artifact.kind, artifact.category, raw);
}

// ─── Retry pack ───────────────────────────────────────────────────────────

/**
 * Retry a pack: re-download only non-installed artifacts.
 */
async function retryPackInternal(
    pack: CatalogPack,
    progress?: (p: InstallProgress) => void,
): Promise<InstalledArtifact[]> {
    validatePackId(pack.id);

    // Get current installed state.
    const currentIndex = await getInstalledIndex();
    const current = currentIndex[pack.id];

    if (!current) {
        // Nothing to retry — do a full install.
        return installPackInternal(pack, progress);
    }

    // Determine which artifacts need re-download.
    const failedKinds = new Map<string, ArtifactKind>();
    for (const a of current.artifacts) {
        if (a.status === "failed") {
            const key = a.category ? `${a.kind}-${a.category}` : a.kind;
            failedKinds.set(key, a.kind);
        }
    }

    const toRetry = pack.artifacts.filter((a) => {
        const key = a.category ? `${a.kind}-${a.category}` : a.kind;
        return failedKinds.has(key);
    });

    if (toRetry.length === 0) {
        return current.artifacts;
    }

    const results = [...current.artifacts];
    let done = 0;

    for (const artifact of toRetry) {
        progress?.({
            done,
            total: toRetry.length,
            currentKind: artifact.kind,
        });

        try {
            await installSingleArtifact(pack.id, artifact);
            // Replace the failed entry with an installed one.
            const key = artifact.category
                ? `${artifact.kind}-${artifact.category}`
                : artifact.kind;
            const idx = results.findIndex((a) => {
                const ak = a.category ? `${a.kind}-${a.category}` : a.kind;
                return ak === key;
            });
            if (idx >= 0) {
                results[idx] = {
                    kind: artifact.kind,
                    category: artifact.category,
                    bytes: artifact.bytes,
                    status: "installed",
                };
            } else {
                results.push({
                    kind: artifact.kind,
                    category: artifact.category,
                    bytes: artifact.bytes,
                    status: "installed",
                });
            }
        } catch (err) {
            log.warn(`Retry failed for ${pack.id}/${artifact.kind}:`, err);
            // Refresh the failed entry so the UI reflects the latest reason and
            // whether it's an unrecoverable bundle error vs. a transient one.
            const key = artifact.category
                ? `${artifact.kind}-${artifact.category}`
                : artifact.kind;
            const idx = results.findIndex((a) => {
                const ak = a.category ? `${a.kind}-${a.category}` : a.kind;
                return ak === key;
            });
            const failedEntry: InstalledArtifact = {
                kind: artifact.kind,
                category: artifact.category,
                bytes: artifact.bytes,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                retryable:
                    err instanceof PackArtifactError ? err.retryable : true,
            };
            if (idx >= 0) results[idx] = failedEntry;
            else results.push(failedEntry);
        }

        done++;
    }

    progress?.({
        done: toRetry.length,
        total: toRetry.length,
        currentKind: "meta",
    });

    // Persist updated index.
    await withIndexMutex(async () => {
        const index = await getInstalledIndex();
        if (index[pack.id]) {
            index[pack.id].artifacts = results;
            await setInstalledIndex(index);
        }
    });

    return results;
}

// ─── Remove pack ──────────────────────────────────────────────────────────

async function removeInstalledPack(packId: string): Promise<void> {
    validatePackId(packId);

    // 1. Unregister per-kind.
    unregisterArtifacts(packId);

    // 2. Delete pack directory recursively.
    try {
        const dir = packDir(packId);
        if (dir.exists) {
            dir.delete();
        }
    } catch {
        /* best-effort */
    }

    // 3. Update installed-pack index (mutex-guarded).
    await withIndexMutex(async () => {
        const index = await getInstalledIndex();
        delete index[packId];
        await setInstalledIndex(index);
    });
}

// ─── Init: load installed packs on app start ──────────────────────────────

/**
 * Reads the installed-pack index, and for each installed pack, re-registers
 * POI (parsed) and measuring (path only) sources. Failures are logged and a
 * partially-broken pack is skipped — the rest still load.
 */
export async function loadInstalledPacks(): Promise<void> {
    let index: InstalledIndex;
    try {
        index = await getInstalledIndex();
    } catch {
        return;
    }

    for (const packId of Object.keys(index)) {
        if (!VALID_PACK_ID.test(packId)) {
            log.warn(
                `Skipping invalid pack id "${packId}" in installed index.`,
            );
            continue;
        }

        const entry = index[packId];
        if (!entry) continue;

        for (const artifact of entry.artifacts) {
            if (artifact.status !== "installed") continue;

            try {
                // Boundaries are split into index + polygons files during
                // install; the combined file is intentionally deleted.
                // The case handler below checks for the index file instead.
                if (artifact.kind !== "boundaries") {
                    const checkFile = jsonFile(
                        packId,
                        artifact.kind,
                        artifact.category,
                    );
                    if (!checkFile.exists) continue;
                }

                switch (artifact.kind) {
                    case "poi": {
                        // Parse POI at startup (small and columnar).
                        const file = jsonFile(
                            packId,
                            artifact.kind,
                            artifact.category,
                        );
                        const jsonStr = await file.text();
                        const raw = JSON.parse(jsonStr);
                        // Minimal check: verify it's an object.
                        if (typeof raw !== "object" || raw === null) {
                            log.warn(
                                `POI payload is not an object for pack "${packId}" — skipping`,
                            );
                            continue;
                        }
                        registerRegion(packId, raw);
                        break;
                    }
                    case "measuring": {
                        // Register the file path only — lazy loading (T3 contract).
                        if (artifact.category) {
                            // After Phase 1, admin border data comes from the
                            // boundaries artifact; skip registration defensively.
                            if (
                                artifact.category === "admin-1st-border" ||
                                artifact.category === "admin-2nd-border"
                            ) {
                                break;
                            }
                            const file = jsonFile(
                                packId,
                                artifact.kind,
                                artifact.category,
                            );
                            registerMeasuringSource(
                                packId,
                                artifact.category as MeasuringCategory,
                                file.uri,
                            );
                        }
                        break;
                    }
                    case "boundaries": {
                        // Read the index file (small) and register the polygons
                        // path for lazy loading.
                        const indexPath = jsonFile(
                            packId,
                            artifact.kind,
                            "index",
                        );
                        if (!indexPath.exists) continue;
                        const indexJson = await indexPath.text();
                        const indexData = JSON.parse(indexJson);
                        const parsed =
                            boundariesIndexPayloadSchema.safeParse(indexData);
                        if (!parsed.success) {
                            log.warn(
                                `Boundaries index validation failed for pack "${packId}": ` +
                                    parsed.error.issues
                                        .map((i) => i.message)
                                        .join("; "),
                            );
                            continue;
                        }
                        const polygonsPath = jsonFile(
                            packId,
                            artifact.kind,
                            "polygons",
                        );
                        registerBoundarySource(
                            packId,
                            indexPath.uri,
                            polygonsPath.uri,
                            parsed.data.index as BoundaryIndexEntry[],
                            parsed.data.levels,
                        );
                        break;
                    }
                    case "transit": {
                        // Parse the transit artifact to extract preset summaries.
                        const transitFile = jsonFile(
                            packId,
                            artifact.kind,
                            artifact.category,
                        );
                        const jsonStr = await transitFile.text();
                        const data = JSON.parse(jsonStr);
                        const parsed = transitPayloadSchema.safeParse(data);
                        if (!parsed.success) {
                            log.warn(
                                `Transit payload validation failed for pack "${packId}": ` +
                                    parsed.error.issues
                                        .map((i) => i.message)
                                        .join("; "),
                            );
                            continue;
                        }
                        const presetSummaries = parsed.data.presets.map(
                            (p: {
                                id: string;
                                label: string;
                                bbox: [number, number, number, number];
                                kind?: string;
                            }) => ({
                                id: p.id,
                                label: p.label,
                                bbox: p.bbox,
                                kind: p.kind,
                            }),
                        );
                        registerTransitSource(
                            packId,
                            transitFile.uri,
                            presetSummaries,
                        );
                        break;
                    }
                    case "meta": {
                        const metaFile = jsonFile(
                            packId,
                            artifact.kind,
                            artifact.category,
                        );
                        const jsonStr = await metaFile.text();
                        const data = JSON.parse(jsonStr);
                        const parsed = metaPayloadSchema.safeParse(data);
                        if (!parsed.success) {
                            log.warn(
                                `Meta payload validation failed for pack "${packId}": ` +
                                    parsed.error.issues
                                        .map((i) => i.message)
                                        .join("; "),
                            );
                            continue;
                        }
                        const md = parsed.data;
                        if (md.adminLevels?.matching && md.bbox) {
                            registerPackAdminLevels({
                                packId,
                                label: md.label ?? packId,
                                bbox: md.bbox,
                                matchingLevels: md.adminLevels.matching.slice(
                                    0,
                                    4,
                                ) as [number, number, number, number],
                                ...(md.adminLevels.labels
                                    ? {
                                          labels: md.adminLevels
                                              .labels as PackAdminLevelInfo["labels"],
                                      }
                                    : {}),
                            });
                        }
                        break;
                    }
                }
            } catch (err) {
                log.warn(
                    `Failed to load artifact ${artifact.kind} ` +
                        `from pack "${packId}":`,
                    err,
                );
            }
        }
    }
}

// ─── Utility: list installed packs ────────────────────────────────────────

export async function listInstalledPacks(): Promise<InstalledPack[]> {
    const index = await getInstalledIndex();
    return Object.values(index);
}

// ─── TanStack Query hooks ─────────────────────────────────────────────────

export function useInstallPack() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            pack,
            onProgress,
        }: {
            pack: CatalogPack;
            onProgress?: (p: InstallProgress) => void;
        }) => installPackInternal(pack, onProgress),
        onSuccess: (data, variables) => {
            // Optimistically update installed packs cache so UI (e.g.
            // hiding-zone "No game pack downloaded" banner) reacts
            // immediately — before the async invalidate+refetch completes.
            const pack = variables.pack;
            const artifacts: InstalledArtifact[] = (data ?? []).map((a) => ({
                kind: a.kind,
                category: a.category,
                bytes: a.bytes,
                status: a.status,
            }));

            queryClient.setQueryData<InstalledPack[]>(
                ["installed-packs-v2"],
                (old) => {
                    const existing = old ?? [];
                    const idx = existing.findIndex((p) => p.id === pack.id);
                    const installed: InstalledPack = {
                        id: pack.id,
                        osmSnapshot: pack.osmSnapshot,
                        installedAt: new Date().toISOString(),
                        bbox: pack.bbox,
                        artifacts,
                    };
                    if (idx >= 0) {
                        const updated = [...existing];
                        updated[idx] = installed;
                        return updated;
                    }
                    return [...existing, installed];
                },
            );

            // Still invalidate so the on-disk truth is re-read eventually.
            queryClient.invalidateQueries({ queryKey: ["offline-catalog"] });
            queryClient.invalidateQueries({ queryKey: ["installed-packs-v2"] });
        },
    });
}

export function useRetryPack() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            pack,
            onProgress,
        }: {
            pack: CatalogPack;
            onProgress?: (p: InstallProgress) => void;
        }) => retryPackInternal(pack, onProgress),
        onSuccess: (data, variables) => {
            // Optimistically update installed packs cache so UI reacts
            // immediately — before the async invalidate+refetch completes.
            const pack = variables.pack;
            const artifacts: InstalledArtifact[] = (data ?? []).map((a) => ({
                kind: a.kind,
                category: a.category,
                bytes: a.bytes,
                status: a.status,
            }));

            queryClient.setQueryData<InstalledPack[]>(
                ["installed-packs-v2"],
                (old) => {
                    const existing = old ?? [];
                    const idx = existing.findIndex((p) => p.id === pack.id);
                    const installed: InstalledPack = {
                        id: pack.id,
                        osmSnapshot: pack.osmSnapshot,
                        installedAt: new Date().toISOString(),
                        bbox: pack.bbox,
                        artifacts,
                    };
                    if (idx >= 0) {
                        const updated = [...existing];
                        updated[idx] = installed;
                        return updated;
                    }
                    return [...existing, installed];
                },
            );

            // Still invalidate so the on-disk truth is re-read eventually.
            queryClient.invalidateQueries({ queryKey: ["offline-catalog"] });
            queryClient.invalidateQueries({ queryKey: ["installed-packs-v2"] });
        },
    });
}

export function useRemovePack() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: removeInstalledPack,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["offline-catalog"] });
            queryClient.invalidateQueries({ queryKey: ["installed-packs-v2"] });
        },
    });
}

export function useInstalledPacks() {
    return useQuery({
        queryKey: ["installed-packs-v2"],
        queryFn: listInstalledPacks,
        staleTime: 0, // always re-read after mutations
    });
}

// ─── Utility ────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human-readable "kind-category" (or "kind") label for an artifact. */
export function artifactLabel(artifact: InstalledArtifact): string {
    return artifact.category
        ? `${artifact.kind}-${artifact.category}`
        : artifact.kind;
}

/**
 * The first unrecoverable failed artifact in a pack (status "failed" with
 * `retryable === false`) — an integrity/validation failure that Retry can never
 * fix. The Offline Data screen uses this to show a "report a bug" banner
 * instead of a futile Retry affordance.
 */
export function findBundleError(
    pack: InstalledPack | undefined,
): InstalledArtifact | undefined {
    return pack?.artifacts.find(
        (a) => a.status === "failed" && a.retryable === false,
    );
}

/**
 * A GitHub "new issue" URL prefilled with the pack/artifact/error so a user can
 * report an unrecoverable bundle error in one tap.
 */
export function buildBugReportUrl(
    pack: InstalledPack,
    failed: InstalledArtifact,
): string {
    const name = artifactLabel(failed);
    const title = `[pack bundle error] ${pack.id} / ${name}`;
    const body = [
        `Pack: ${pack.id}`,
        `Snapshot: ${pack.osmSnapshot}`,
        `Artifact: ${name}`,
        `Error: ${failed.error ?? "unknown"}`,
        "",
        "(auto-filled from Offline Data — please add any extra context)",
    ].join("\n");
    return (
        `${OFFLINE.bugReportUrl}?title=${encodeURIComponent(title)}` +
        `&body=${encodeURIComponent(body)}`
    );
}

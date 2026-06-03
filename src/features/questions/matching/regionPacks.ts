import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { digestStringAsync } from "expo-crypto";
import { CryptoDigestAlgorithm } from "expo-crypto";
import { gunzipSync, strFromU8 } from "fflate";
import { Directory, File, Paths, type InfoOptions } from "expo-file-system";
import type { Bbox } from "@/shared/geojson";
import type { RawRegion } from "./bundledPois";
import { registerRegion, unregisterRegion } from "./bundledPois";

// ─── Types ─────────────────────────────────────────────────────────────────

export type PackMeta = {
    id: string;
    label: string;
    bbox: Bbox;
    totalCount: number;
    url: string;
    bytes: number;
    sha256: string;
    md5: string;
};

export type PackManifest = {
    schemaVersion: 1;
    generatedAt: string;
    packs: PackMeta[];
};

export type InstalledPackEntry = {
    id: string;
    bbox: Bbox;
    generatedAt: string;
    bytes: number;
};

// ─── Constants ────────────────────────────────────────────────────────────

const INSTALLED_INDEX_KEY = "installed-poi-packs";
const MANIFEST_STALE_TIME_MS = 30 * 60 * 1000; // 30 min
const MD5_INFO_OPTS: InfoOptions = { md5: true };

// Lazy — defers the expo-file-system module access so tests that don't
// exercise region packs don't need to mock expo-file-system.
let _poiDir: Directory | null = null;
function poiDir(): Directory {
    if (!_poiDir) {
        _poiDir = new Directory(Paths.document, "poi");
    }
    return _poiDir;
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

// ─── File helpers ─────────────────────────────────────────────────────────

function gzFile(id: string): File {
    return new File(poiDir(), `${id}.json.gz`);
}
function jsonFile(id: string): File {
    return new File(poiDir(), `${id}.json`);
}

// ─── Installed-pack index (AsyncStorage) ──────────────────────────────────

type InstalledIndex = Record<string, InstalledPackEntry>;

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
        return JSON.parse(raw) as InstalledIndex;
    } catch {
        return {};
    }
}

async function setInstalledIndex(index: InstalledIndex): Promise<void> {
    await AsyncStorage.setItem(INSTALLED_INDEX_KEY, JSON.stringify(index));
}

// ─── Manifest query ───────────────────────────────────────────────────────

async function fetchPackManifest(url: string): Promise<PackManifest> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Manifest fetch failed for ${url}: HTTP ${response.status}`,
        );
    }
    const manifest = (await response.json()) as PackManifest;
    if (manifest.schemaVersion !== 1) {
        throw new Error(
            `Unsupported manifest schemaVersion: ${manifest.schemaVersion}`,
        );
    }
    return manifest;
}

/** TanStack Query hook for the remote packs manifest. */
export function usePackManifest(url: string | null) {
    return useQuery({
        queryKey: ["poi-pack-manifest", url],
        queryFn: () => fetchPackManifest(url!),
        enabled: url != null,
        staleTime: MANIFEST_STALE_TIME_MS,
    });
}

// ─── Download mutation ────────────────────────────────────────────────────

function ensurePoiDir(): void {
    const dir = poiDir();
    if (!dir.exists) {
        dir.create({ intermediates: true });
    }
}

async function downloadAndInstallPack(meta: PackMeta): Promise<void> {
    validatePackId(meta.id);
    ensurePoiDir();

    // 1. Download .gz via the v19 File API (writes directly to disk).
    const dest = gzFile(meta.id);
    const downloaded = await File.downloadFileAsync(meta.url, dest, {
        idempotent: true,
    });

    // 2. Verify byte length.
    const info = downloaded.info(MD5_INFO_OPTS);
    if (info.size !== meta.bytes) {
        try {
            downloaded.delete();
        } catch {
            // best-effort cleanup
        }
        throw new Error(
            `Size mismatch for ${meta.id}: expected ${meta.bytes}, got ${info.size ?? "N/A"}`,
        );
    }

    // 3. Verify MD5 hash (fail closed — MD5 is required from the manifest).
    if (!meta.md5) {
        try {
            downloaded.delete();
        } catch {
            /* best-effort */
        }
        throw new Error(
            `Integrity check failed for ${meta.id}: manifest missing md5`,
        );
    }
    if (!info.md5 || info.md5.toLowerCase() !== meta.md5.toLowerCase()) {
        try {
            downloaded.delete();
        } catch {
            /* best-effort */
        }
        throw new Error(
            `Integrity check failed for ${meta.id}: MD5 mismatch ` +
                `(expected ${meta.md5}, got ${info.md5 ?? "N/A"})`,
        );
    }

    // 4. Read raw bytes and inflate with fflate (no base64, no TextDecoder).
    const gzBytes = await downloaded.bytes();

    // Decompression bomb guard: cap inflated size.
    // A typical pack is ~3–15 MB raw; 100 MB absolute is far beyond any real region.
    const INFLATE_MAX_BYTES = 100 * 1024 * 1024;
    // Also cap at 20× the gzip size — a normal ratio is 3–5×.
    const inflateLimit = Math.min(INFLATE_MAX_BYTES, gzBytes.length * 20);
    const inflated = gunzipSync(gzBytes);
    if (inflated.length > inflateLimit) {
        try {
            downloaded.delete();
        } catch {
            /* best-effort */
        }
        throw new Error(
            `Decompressed size ${(inflated.length / 1024 / 1024).toFixed(1)} MB ` +
                `exceeds limit of ${(inflateLimit / 1024 / 1024).toFixed(1)} MB ` +
                `for ${meta.id}`,
        );
    }
    const jsonStr = strFromU8(inflated);

    // 4a. Verify SHA-256 of the uncompressed JSON (fail closed).
    if (!meta.sha256) {
        try {
            downloaded.delete();
        } catch {
            /* best-effort */
        }
        throw new Error(
            `Integrity check failed for ${meta.id}: manifest missing sha256`,
        );
    }
    const givenSha256 = await digestStringAsync(
        CryptoDigestAlgorithm.SHA256,
        jsonStr,
    );
    if (givenSha256.toLowerCase() !== meta.sha256.toLowerCase()) {
        try {
            downloaded.delete();
        } catch {
            /* best-effort */
        }
        throw new Error(
            `Integrity check failed for ${meta.id}: SHA-256 mismatch ` +
                `(expected ${meta.sha256}, got ${givenSha256})`,
        );
    }

    const raw: RawRegion = JSON.parse(jsonStr);

    // 5. Schema version guard.
    if (raw.schemaVersion !== 1) {
        throw new Error(
            `Pack ${meta.id} has unsupported schemaVersion ${raw.schemaVersion} — refusing to register.`,
        );
    }

    // 6. Write plain .json for faster re-load on next app start.
    const plain = jsonFile(meta.id);
    plain.create({ overwrite: true });
    plain.write(jsonStr);

    // 7. Delete the .gz to reclaim space (the plain .json is sufficient).
    try {
        downloaded.delete();
    } catch {
        // best-effort — the gz is non-critical after inflation.
    }

    // 8. Register into the dynamic region registry.
    registerRegion(meta.id, raw);

    // 9. Persist installed-pack index (mutex-guarded against concurrent mutation).
    await withIndexMutex(async () => {
        const index = await getInstalledIndex();
        index[meta.id] = {
            id: meta.id,
            bbox: meta.bbox,
            generatedAt: raw.generatedAt,
            bytes: meta.bytes,
        };
        await setInstalledIndex(index);
    });
}

/** TanStack Query mutation hook for downloading + installing a region pack. */
export function useDownloadPack() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: downloadAndInstallPack,
        onSuccess: () => {
            // Refresh the manifest UI state (installed badges etc.).
            queryClient.invalidateQueries({ queryKey: ["poi-pack-manifest"] });
        },
    });
}

// ─── Remove mutation ──────────────────────────────────────────────────────

async function removeInstalledPack(packId: string): Promise<void> {
    validatePackId(packId);
    // 1. Delete files (best-effort — they may already be gone).
    try {
        gzFile(packId).delete();
    } catch {
        /* best-effort */
    }
    try {
        jsonFile(packId).delete();
    } catch {
        /* best-effort */
    }

    // 2. Deregister from the dynamic region registry.
    unregisterRegion(packId);

    // 3. Update installed-pack index (mutex-guarded).
    await withIndexMutex(async () => {
        const index = await getInstalledIndex();
        delete index[packId];
        await setInstalledIndex(index);
    });
}

/** TanStack Query mutation hook for removing a region pack. */
export function useRemovePack() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: removeInstalledPack,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["poi-pack-manifest"] });
        },
    });
}

// ─── Init: load installed packs on app start ──────────────────────────────

/**
 * Reads the installed-pack index, parses each installed `.json` into memory,
 * and calls `registerRegion`. Call once on app start (or lazily before the
 * first matching query). Failures are logged and a partially-broken pack is
 * skipped — the rest still load.
 */
export async function loadInstalledPacks(): Promise<void> {
    let index: InstalledIndex;
    try {
        index = await getInstalledIndex();
    } catch {
        // AsyncStorage read failed — no packs to load.
        return;
    }

    for (const id of Object.keys(index)) {
        // Silently skip invalid ids — they can't have been written by us
        // and must not be used in filesystem paths.
        if (!VALID_PACK_ID.test(id)) {
            console.warn(
                `[regionPacks] Skipping invalid pack id "${id}" in installed index.`,
            );
            continue;
        }
        try {
            const plain = jsonFile(id);
            if (!plain.exists) continue; // file was cleaned up externally

            const jsonStr = await plain.text();
            const raw: RawRegion = JSON.parse(jsonStr);

            if (raw.schemaVersion !== 1) {
                console.warn(
                    `[regionPacks] Installed pack "${id}" has unsupported ` +
                        `schemaVersion ${raw.schemaVersion} — skipping.`,
                );
                continue;
            }

            registerRegion(id, raw);
        } catch (err) {
            console.warn(
                `[regionPacks] Failed to load installed pack "${id}":`,
                err,
            );
        }
    }
}

// ─── Utility: list installed packs ────────────────────────────────────────

/** Returns the list of installed pack IDs with their metadata. */
export async function listInstalledPacks(): Promise<InstalledPackEntry[]> {
    const index = await getInstalledIndex();
    return Object.values(index);
}

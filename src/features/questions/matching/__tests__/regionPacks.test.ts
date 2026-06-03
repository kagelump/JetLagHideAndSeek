import type { RawRegion } from "../bundledPois";
import type { PackMeta, PackManifest } from "../regionPacks";

// ─── Module-level mocks ──────────────────────────────────────────────────

const mockRegisterRegion = jest.fn();
const mockUnregisterRegion = jest.fn();

jest.mock("../bundledPois", () => ({
    registerRegion: (...args: unknown[]) => mockRegisterRegion(...args),
    unregisterRegion: (...args: unknown[]) => mockUnregisterRegion(...args),
}));

// AsyncStorage is globally mocked in jest.setup.ts — use that.

// fflate: mock gunzipSync; strFromU8 is a pure portable decoder (kept real).
const mockGunzipSync = jest.fn();

jest.mock("fflate", () => {
    const actual = jest.requireActual("fflate");
    return {
        ...actual,
        gunzipSync: (data: Uint8Array) => mockGunzipSync(data),
    };
});

// expo-file-system v19: mock File, Directory, Paths — all inline in the
// factory so Jest's hoisted jest.mock doesn't see uninitialized variables.

jest.mock("expo-file-system", () => {
    // Inline mocks that tests can configure via the imported exports.
    const mockFileInfoFn = jest.fn();
    const mockFileBytesFn = jest.fn();
    const mockFileTextFn = jest.fn();
    const mockFileDeleteFn = jest.fn();
    const mockFileCreateFn = jest.fn();
    const mockFileWriteFn = jest.fn();

    const mockDirCreateImpl = jest.fn();

    const dirExistsStore = new Map<string, boolean>();

    function makeFileInstance(
        uri: string,
        overrides?: Record<string, unknown>,
    ) {
        const inst = {
            uri,
            exists: true,
            info: (opts?: unknown) => mockFileInfoFn(uri, opts),
            bytes: () => mockFileBytesFn(uri),
            text: () => mockFileTextFn(uri),
            delete: () => {
                mockFileDeleteFn(uri);
            },
            create: (opts?: unknown) => {
                mockFileCreateFn(uri, opts);
            },
            write: (content: string) => {
                mockFileWriteFn(uri, content);
            },
            ...overrides,
        };
        return inst;
    }

    function makeDirInstance(uri: string) {
        return {
            uri,
            get exists() {
                return dirExistsStore.get(uri) ?? false;
            },
            set exists(v: boolean) {
                dirExistsStore.set(uri, v);
            },
            create: (opts?: unknown) => {
                mockDirCreateImpl(uri, opts);
                dirExistsStore.set(uri, true);
            },
        };
    }

    const FakeFile = jest.fn((...args: (string | { uri: string })[]) => {
        const parts = args.map((a) => (typeof a === "string" ? a : a.uri));
        const uri = parts.join("/");
        return makeFileInstance(uri);
    }) as jest.Mock & {
        downloadFileAsync: jest.Mock;
        _makeFileInstance: typeof makeFileInstance;
        _mockFileInfoFn: jest.Mock;
        _mockFileBytesFn: jest.Mock;
        _mockFileTextFn: jest.Mock;
        _mockFileDeleteFn: jest.Mock;
        _mockFileCreateFn: jest.Mock;
        _mockFileWriteFn: jest.Mock;
        _mockDirCreateImpl: jest.Mock;
        _dirExistsStore: Map<string, boolean>;
    };

    FakeFile.downloadFileAsync = jest.fn();
    // Expose internals so tests can configure behavior and inspect calls.
    FakeFile._makeFileInstance = makeFileInstance;
    FakeFile._mockFileInfoFn = mockFileInfoFn;
    FakeFile._mockFileBytesFn = mockFileBytesFn;
    FakeFile._mockFileTextFn = mockFileTextFn;
    FakeFile._mockFileDeleteFn = mockFileDeleteFn;
    FakeFile._mockFileCreateFn = mockFileCreateFn;
    FakeFile._mockFileWriteFn = mockFileWriteFn;
    FakeFile._mockDirCreateImpl = mockDirCreateImpl;
    FakeFile._dirExistsStore = dirExistsStore;

    const FakeDir = jest.fn((...args: (string | { uri: string })[]) => {
        const parts = args.map((a) => (typeof a === "string" ? a : a.uri));
        const uri = parts.join("/");
        return makeDirInstance(uri);
    }) as jest.Mock & {
        _makeDirInstance: typeof makeDirInstance;
    };
    FakeDir._makeDirInstance = makeDirInstance;

    return {
        Directory: FakeDir,
        File: FakeFile,
        Paths: { document: "file:///mock-documents" },
        EncodingType: { UTF8: "utf8", Base64: "base64" },
    };
});

// ─── Fixtures ────────────────────────────────────────────────────────────

import poiMini from "./fixtures/poi-mini.json";

const RAW_REGION = poiMini as unknown as RawRegion;
const REGION_ID = RAW_REGION.region;

const PACK_META: PackMeta = {
    id: REGION_ID,
    label: RAW_REGION.label,
    bbox: RAW_REGION.bbox,
    totalCount: RAW_REGION.totalCount,
    url: "https://cdn.example.com/poi/test-region.json.gz",
    bytes: 5000,
    sha256: "abc123def456",
    md5: "abc123def456",
};

const POI_DIR_URI = "file:///mock-documents/poi";
const GZ_URI = `${POI_DIR_URI}/${REGION_ID}.json.gz`;
const JSON_URI = `${POI_DIR_URI}/${REGION_ID}.json`;

function jsonToBytes(obj: unknown): Uint8Array {
    const json = JSON.stringify(obj);
    return new TextEncoder().encode(json);
}

function setupGunzipPassThrough(raw: RawRegion): void {
    mockGunzipSync.mockReturnValue(jsonToBytes(raw));
}

// ─── Imports under test ──────────────────────────────────────────────────

import {
    loadInstalledPacks,
    useDownloadPack,
    usePackManifest,
    useRemovePack,
} from "../regionPacks";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/state/queryClient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File } from "expo-file-system";
import React from "react";

// Access the mock internals via the imported File.
type MockFile = jest.Mock & {
    downloadFileAsync: jest.Mock;
    _makeFileInstance: (
        uri: string,
        overrides?: Record<string, unknown>,
    ) => ReturnType<MockFile>;
    _mockFileInfoFn: jest.Mock;
    _mockFileBytesFn: jest.Mock;
    _mockFileTextFn: jest.Mock;
    _mockFileDeleteFn: jest.Mock;
    _mockFileCreateFn: jest.Mock;
    _mockFileWriteFn: jest.Mock;
    _mockDirCreateImpl: jest.Mock;
    _dirExistsStore: Map<string, boolean>;
};
const MockFile = File as any as MockFile;

// ─── TanStack Query wrapper ──────────────────────────────────────────────

const testQueryClient = queryClient;

function wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
        QueryClientProvider,
        { client: testQueryClient },
        children,
    );
}

// ─── Setup / teardown ────────────────────────────────────────────────────

beforeEach(async () => {
    jest.clearAllMocks();
    testQueryClient.clear();
    await AsyncStorage.clear();

    // Reset per-test state in the mock factory closures.
    MockFile._dirExistsStore.clear();
    MockFile._dirExistsStore.set(POI_DIR_URI, false);

    // Default: successful download returns a mock File.
    MockFile.downloadFileAsync.mockResolvedValue(
        MockFile._makeFileInstance(GZ_URI),
    );

    // Default: file info returns matching size + md5.
    MockFile._mockFileInfoFn.mockReturnValue({
        exists: true,
        size: PACK_META.bytes,
        md5: PACK_META.md5,
    });

    // Default: bytes() returns encoded fixture.
    MockFile._mockFileBytesFn.mockResolvedValue(jsonToBytes(RAW_REGION));

    // Default: text() returns JSON string.
    MockFile._mockFileTextFn.mockResolvedValue(JSON.stringify(RAW_REGION));

    // Default: gunzip pass-through.
    setupGunzipPassThrough(RAW_REGION);

    // Clear fetch mock.
    (global as { fetch?: unknown }).fetch = undefined;
});

async function seedInstalledIndex(
    entries: Record<
        string,
        { id: string; bbox: number[]; generatedAt: string; bytes: number }
    >,
): Promise<void> {
    await AsyncStorage.setItem("installed-poi-packs", JSON.stringify(entries));
}

// ─── Manifest query ──────────────────────────────────────────────────────

describe("usePackManifest", () => {
    it("fetches and returns the manifest", async () => {
        const manifest: PackManifest = {
            schemaVersion: 1,
            generatedAt: "2026-06-01T00:00:00Z",
            packs: [PACK_META],
        };
        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(manifest),
            });

        const { result } = renderHook(
            () => usePackManifest("https://cdn.example.com/poi/packs.json"),
            { wrapper },
        );

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });
        expect(result.current.data).toEqual(manifest);
    });

    it("returns error on non-ok response", async () => {
        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({ ok: false, status: 404 });

        const { result } = renderHook(
            () => usePackManifest("https://cdn.example.com/poi/packs.json"),
            { wrapper },
        );

        await waitFor(
            () => {
                expect(result.current.isError).toBe(true);
            },
            { timeout: 5000 },
        );
    });

    it("rejects unsupported schema version", async () => {
        const manifest = { schemaVersion: 99, generatedAt: "", packs: [] };
        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(manifest),
            });

        const { result } = renderHook(
            () => usePackManifest("https://cdn.example.com/poi/packs.json"),
            { wrapper },
        );

        await waitFor(
            () => {
                expect(result.current.isError).toBe(true);
            },
            { timeout: 5000 },
        );
    });

    it("is disabled when url is null", () => {
        const { result } = renderHook(() => usePackManifest(null), {
            wrapper,
        });
        expect(result.current.fetchStatus).toBe("idle");
    });
});

// ─── Download mutation ──────────────────────────────────────────────────

describe("useDownloadPack", () => {
    it("downloads, verifies, inflates, and registers a pack", async () => {
        const { result } = renderHook(() => useDownloadPack(), { wrapper });

        result.current.mutate(PACK_META);

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        // Should download via File.downloadFileAsync.
        expect(MockFile.downloadFileAsync).toHaveBeenCalledWith(
            PACK_META.url,
            expect.objectContaining({ uri: GZ_URI }),
            { idempotent: true },
        );

        // Should verify size + md5 via info().
        expect(MockFile._mockFileInfoFn).toHaveBeenCalledWith(GZ_URI, {
            md5: true,
        });

        // Should read raw bytes (no base64, no TextDecoder).
        expect(MockFile._mockFileBytesFn).toHaveBeenCalledWith(GZ_URI);

        // Should write plain .json.
        expect(MockFile._mockFileCreateFn).toHaveBeenCalledWith(JSON_URI, {
            overwrite: true,
        });
        expect(MockFile._mockFileWriteFn).toHaveBeenCalledWith(
            JSON_URI,
            expect.any(String),
        );

        // Should delete .gz after inflation.
        expect(MockFile._mockFileDeleteFn).toHaveBeenCalledWith(GZ_URI);

        // Should register.
        expect(mockRegisterRegion).toHaveBeenCalledWith(
            REGION_ID,
            expect.objectContaining({
                region: REGION_ID,
                schemaVersion: 1,
            }),
        );

        // Should update installed index.
        const stored = await AsyncStorage.getItem("installed-poi-packs");
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed[REGION_ID]).toBeDefined();
    });

    it("rejects on MD5 mismatch", async () => {
        MockFile._mockFileInfoFn.mockReturnValue({
            exists: true,
            size: PACK_META.bytes,
            md5: "wrong-md5-hash",
        });

        const { result } = renderHook(() => useDownloadPack(), { wrapper });
        result.current.mutate(PACK_META);

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });

        expect(MockFile._mockFileDeleteFn).toHaveBeenCalledWith(GZ_URI);
        expect(mockRegisterRegion).not.toHaveBeenCalled();
    });

    it("rejects on byte length mismatch", async () => {
        MockFile._mockFileInfoFn.mockReturnValue({
            exists: true,
            size: 999,
            md5: PACK_META.md5,
        });

        const { result } = renderHook(() => useDownloadPack(), { wrapper });
        result.current.mutate(PACK_META);

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });
        expect(mockRegisterRegion).not.toHaveBeenCalled();
    });

    it("rejects on unsupported schema version in inflated data", async () => {
        const badRegion = { ...RAW_REGION, schemaVersion: 99 };
        MockFile._mockFileBytesFn.mockResolvedValue(jsonToBytes(badRegion));
        setupGunzipPassThrough(badRegion as RawRegion);

        const { result } = renderHook(() => useDownloadPack(), { wrapper });
        result.current.mutate(PACK_META);

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });
        expect(mockRegisterRegion).not.toHaveBeenCalled();
    });
});

// ─── Remove mutation ─────────────────────────────────────────────────────

describe("useRemovePack", () => {
    it("deletes files, deregisters, and updates index", async () => {
        await seedInstalledIndex({
            [REGION_ID]: {
                id: REGION_ID,
                bbox: PACK_META.bbox,
                generatedAt: "2026-06-01T00:00:00Z",
                bytes: PACK_META.bytes,
            },
            "other-pack": {
                id: "other-pack",
                bbox: [0, 0, 1, 1],
                generatedAt: "2026-01-01T00:00:00Z",
                bytes: 100,
            },
        });

        const { result } = renderHook(() => useRemovePack(), { wrapper });
        result.current.mutate(REGION_ID);

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(MockFile._mockFileDeleteFn).toHaveBeenCalledWith(GZ_URI);
        expect(MockFile._mockFileDeleteFn).toHaveBeenCalledWith(JSON_URI);
        expect(mockUnregisterRegion).toHaveBeenCalledWith(REGION_ID);

        const stored = await AsyncStorage.getItem("installed-poi-packs");
        const parsed = JSON.parse(stored!);
        expect(parsed["other-pack"]).toBeDefined();
        expect(parsed[REGION_ID]).toBeUndefined();
    });
});

// ─── loadInstalledPacks ─────────────────────────────────────────────────

describe("loadInstalledPacks", () => {
    it("loads and registers installed packs from the index", async () => {
        await seedInstalledIndex({
            [REGION_ID]: {
                id: REGION_ID,
                bbox: PACK_META.bbox,
                generatedAt: "2026-06-01T00:00:00Z",
                bytes: PACK_META.bytes,
            },
        });

        await loadInstalledPacks();

        expect(mockRegisterRegion).toHaveBeenCalledWith(
            REGION_ID,
            expect.objectContaining({ region: REGION_ID }),
        );
    });

    it("skips packs whose .json file is missing", async () => {
        await seedInstalledIndex({
            [REGION_ID]: {
                id: REGION_ID,
                bbox: PACK_META.bbox,
                generatedAt: "2026-06-01T00:00:00Z",
                bytes: PACK_META.bytes,
            },
        });

        // Override the File constructor so .exists returns false.
        MockFile.mockImplementationOnce(
            (...args: (string | { uri: string })[]) => {
                const parts = args.map((a) =>
                    typeof a === "string" ? a : a.uri,
                );
                const uri = parts.join("/");
                return MockFile._makeFileInstance(uri, { exists: false });
            },
        );

        await loadInstalledPacks();

        expect(mockRegisterRegion).not.toHaveBeenCalled();
    });

    it("skips packs with unsupported schema version", async () => {
        const badRegion = { ...RAW_REGION, schemaVersion: 99 };
        await seedInstalledIndex({
            [REGION_ID]: {
                id: REGION_ID,
                bbox: PACK_META.bbox,
                generatedAt: "2026-06-01T00:00:00Z",
                bytes: PACK_META.bytes,
            },
        });
        MockFile._mockFileTextFn.mockResolvedValue(JSON.stringify(badRegion));

        await loadInstalledPacks();

        expect(mockRegisterRegion).not.toHaveBeenCalled();
    });

    it("handles empty index gracefully", async () => {
        await loadInstalledPacks();
        expect(mockRegisterRegion).not.toHaveBeenCalled();
    });
});

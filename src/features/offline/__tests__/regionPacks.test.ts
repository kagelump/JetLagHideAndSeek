import type { RawRegion } from "../../questions/matching/bundledPois";
import type { CatalogPack, Artifact } from "../packCatalog";

// ─── Module-level mocks ──────────────────────────────────────────────────

const mockRegisterRegion = jest.fn();
const mockUnregisterRegion = jest.fn();
const mockRegisterMeasuringSource = jest.fn();
const mockUnregisterMeasuringSources = jest.fn();
const mockRegisterBoundarySource = jest.fn();
const mockUnregisterBoundarySource = jest.fn();
const mockRegisterTransitSource = jest.fn();
const mockUnregisterTransitSource = jest.fn();
const mockRegisterPackAdminLevels = jest.fn();
const mockUnregisterPackAdminLevels = jest.fn();

jest.mock("../../questions/matching/bundledPois", () => ({
    registerRegion: (...args: unknown[]) => mockRegisterRegion(...args),
    unregisterRegion: (...args: unknown[]) => mockUnregisterRegion(...args),
}));

jest.mock("../../questions/measuring/lineBundleLoader", () => ({
    registerMeasuringSource: (...args: unknown[]) =>
        mockRegisterMeasuringSource(...args),
    unregisterMeasuringSources: (...args: unknown[]) =>
        mockUnregisterMeasuringSources(...args),
}));

jest.mock("../../offline/boundaryStore", () => ({
    registerBoundarySource: (...args: unknown[]) =>
        mockRegisterBoundarySource(...args),
    unregisterBoundarySource: (...args: unknown[]) =>
        mockUnregisterBoundarySource(...args),
}));

jest.mock("../../hidingZone/hidingZoneData", () => ({
    registerTransitSource: (...args: unknown[]) =>
        mockRegisterTransitSource(...args),
    unregisterTransitSource: (...args: unknown[]) =>
        mockUnregisterTransitSource(...args),
}));

jest.mock("../../offline/adminLevelDefaults", () => ({
    registerPackAdminLevels: (...args: unknown[]) =>
        mockRegisterPackAdminLevels(...args),
    unregisterPackAdminLevels: (...args: unknown[]) =>
        mockUnregisterPackAdminLevels(...args),
}));

// fflate: mock gunzipSync; strFromU8 is a pure portable decoder (kept real).
const mockGunzipSync = jest.fn();

jest.mock("fflate", () => {
    const actual = jest.requireActual("fflate");
    return {
        ...actual,
        gunzipSync: (data: Uint8Array) => mockGunzipSync(data),
    };
});

const mockDigestStringAsync = jest.fn();

jest.mock("expo-crypto", () => ({
    digestStringAsync: (...args: unknown[]) => mockDigestStringAsync(...args),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));

jest.mock("expo-file-system", () => {
    const mockFileInfoFn = jest.fn();
    const mockFileBytesFn = jest.fn();
    const mockFileTextFn = jest.fn();
    const mockFileDeleteFn = jest.fn();
    const mockFileCreateFn = jest.fn();
    const mockFileWriteFn = jest.fn();

    const mockDirCreateImpl = jest.fn();
    const mockDirDeleteImpl = jest.fn();

    const dirExistsStore = new Map<string, boolean>();
    const fileExistsStore = new Map<string, boolean>();

    function makeFileInstance(
        uri: string,
        overrides?: Record<string, unknown>,
    ) {
        const exists = fileExistsStore.has(uri)
            ? fileExistsStore.get(uri)
            : true;
        return {
            uri,
            exists,
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
            delete: () => {
                mockDirDeleteImpl(uri);
                dirExistsStore.set(uri, false);
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
        _mockDirDeleteImpl: jest.Mock;
        _dirExistsStore: Map<string, boolean>;
        _fileExistsStore: Map<string, boolean>;
    };

    FakeFile.downloadFileAsync = jest.fn();
    FakeFile._makeFileInstance = makeFileInstance;
    FakeFile._mockFileInfoFn = mockFileInfoFn;
    FakeFile._mockFileBytesFn = mockFileBytesFn;
    FakeFile._mockFileTextFn = mockFileTextFn;
    FakeFile._mockFileDeleteFn = mockFileDeleteFn;
    FakeFile._mockFileCreateFn = mockFileCreateFn;
    FakeFile._mockFileWriteFn = mockFileWriteFn;
    FakeFile._mockDirCreateImpl = mockDirCreateImpl;
    FakeFile._mockDirDeleteImpl = mockDirDeleteImpl;
    FakeFile._dirExistsStore = dirExistsStore;
    FakeFile._fileExistsStore = fileExistsStore;

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

import poiMini from "../../questions/matching/__tests__/fixtures/poi-mini.json";

const RAW_REGION = poiMini as unknown as RawRegion;
const REGION_ID = RAW_REGION.region;

const POI_ARTIFACT: Artifact = {
    kind: "poi",
    url: "https://cdn.example.com/packs/test-region-poi.json.gz",
    bytes: 5000,
    md5: "poi-md5-hash",
    sha256: "poi-sha256-hash",
    schemaVersion: 1,
};

const MEASURING_ARTIFACT: Artifact = {
    kind: "measuring",
    category: "coastline",
    url: "https://cdn.example.com/packs/test-region-measuring-coastline.json.gz",
    bytes: 3000,
    md5: "meas-md5-hash",
    sha256: "meas-sha256-hash",
    schemaVersion: 1,
};

const META_ARTIFACT: Artifact = {
    kind: "meta",
    url: "https://cdn.example.com/packs/test-region-meta.json.gz",
    bytes: 500,
    md5: "meta-md5-hash",
    sha256: "meta-sha256-hash",
    schemaVersion: 1,
};

const META_PAYLOAD = {
    schemaVersion: 1,
    id: REGION_ID,
    bbox: [3.3, 50.7, 7.2, 53.6],
    adminLevels: [4, 7, 9, 10],
    attribution: "© OpenStreetMap contributors",
};

const CATALOG_PACK: CatalogPack = {
    id: REGION_ID,
    label: "Test Region",
    regionPath: ["Europe", "Test Region"],
    bbox: [3.3, 50.7, 7.2, 53.6],
    osmSnapshot: "2026-06-08",
    totalBytes: 8500,
    artifacts: [POI_ARTIFACT, MEASURING_ARTIFACT, META_ARTIFACT],
};

const PACKS_DIR_URI = "file:///mock-documents/packs";
const PACK_DIR_URI = `${PACKS_DIR_URI}/${REGION_ID}`;
const POI_GZ_URI = `${PACK_DIR_URI}/poi.json.gz`;
const MEAS_GZ_URI = `${PACK_DIR_URI}/measuring-coastline.json.gz`;
const MEAS_JSON_URI = `${PACK_DIR_URI}/measuring-coastline.json`;

function jsonToBytes(obj: unknown): Uint8Array {
    const json = JSON.stringify(obj);
    return new TextEncoder().encode(json);
}

function setupGunzipPassThrough(payload: unknown): void {
    mockGunzipSync.mockReturnValue(jsonToBytes(payload));
}

// ─── Imports under test ──────────────────────────────────────────────────

import {
    buildBugReportUrl,
    findBundleError,
    loadInstalledPacks,
    useInstallPack,
    useRemovePack,
    useRetryPack,
    type InstalledPack,
} from "../regionPacks";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/state/queryClient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File } from "expo-file-system";
import React from "react";

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
    _mockDirDeleteImpl: jest.Mock;
    _dirExistsStore: Map<string, boolean>;
    _fileExistsStore: Map<string, boolean>;
};
const MockFile = File as any as MockFile;

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

    MockFile._dirExistsStore.clear();
    MockFile._fileExistsStore.clear();

    // Pre-create so pack dir doesn't need explicit creation.
    MockFile._dirExistsStore.set(PACK_DIR_URI, false);

    // Default: download returns a file matching the destination URI.
    MockFile.downloadFileAsync.mockImplementation(
        async (_url: string, dest: { uri: string }) =>
            MockFile._makeFileInstance(dest.uri),
    );

    // Default: file info returns matching size + md5.
    MockFile._mockFileInfoFn.mockReturnValue({
        exists: true,
        size: POI_ARTIFACT.bytes,
        md5: POI_ARTIFACT.md5,
    });

    // Default: bytes() returns encoded fixture.
    MockFile._mockFileBytesFn.mockResolvedValue(jsonToBytes(RAW_REGION));

    // Default: text() returns JSON string.
    MockFile._mockFileTextFn.mockResolvedValue(JSON.stringify(RAW_REGION));

    // Default: gunzip pass-through.
    setupGunzipPassThrough(RAW_REGION);

    // Default: digestStringAsync returns matching SHA-256.
    mockDigestStringAsync.mockResolvedValue(POI_ARTIFACT.sha256);
});

async function seedInstalledIndex(
    entries: Record<
        string,
        {
            id: string;
            osmSnapshot: string;
            installedAt: string;
            artifacts: any[];
        }
    >,
): Promise<void> {
    await AsyncStorage.setItem("installed-packs-v2", JSON.stringify(entries));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("useInstallPack", () => {
    it("installs all artifacts in a pack, registers poi + measuring", async () => {
        // Wire info() to return matching size/md5 per artifact.
        MockFile._mockFileInfoFn.mockImplementation((uri: string) => {
            if (uri.includes("poi")) {
                return {
                    exists: true,
                    size: POI_ARTIFACT.bytes,
                    md5: POI_ARTIFACT.md5,
                };
            }
            if (uri.includes("measuring")) {
                return {
                    exists: true,
                    size: MEASURING_ARTIFACT.bytes,
                    md5: MEASURING_ARTIFACT.md5,
                };
            }
            return {
                exists: true,
                size: META_ARTIFACT.bytes,
                md5: META_ARTIFACT.md5,
            };
        });

        // Wire bytes() to return right content per artifact.
        MockFile._mockFileBytesFn.mockImplementation((uri: string) => {
            if (uri.includes("meta")) {
                return Promise.resolve(jsonToBytes(META_PAYLOAD));
            }
            return Promise.resolve(jsonToBytes(RAW_REGION));
        });

        // Wire SHA-256 based on call order: meta (1st), poi (2nd), measuring (3rd).
        let shaCallCount = 0;
        mockDigestStringAsync.mockImplementation(() => {
            shaCallCount++;
            switch (shaCallCount) {
                case 1:
                    return Promise.resolve(META_ARTIFACT.sha256);
                case 2:
                    return Promise.resolve(POI_ARTIFACT.sha256);
                case 3:
                    return Promise.resolve(MEASURING_ARTIFACT.sha256);
                default:
                    return Promise.resolve(POI_ARTIFACT.sha256);
            }
        });

        const { result } = renderHook(() => useInstallPack(), { wrapper });

        result.current.mutate({ pack: CATALOG_PACK });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        // Should register poi.
        expect(mockRegisterRegion).toHaveBeenCalledWith(
            REGION_ID,
            expect.objectContaining({ region: REGION_ID }),
        );

        // Should register measuring coastline source.
        expect(mockRegisterMeasuringSource).toHaveBeenCalledWith(
            REGION_ID,
            "coastline",
            MEAS_JSON_URI,
        );

        // Should update installed index (v2 key).
        const stored = await AsyncStorage.getItem("installed-packs-v2");
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed[REGION_ID]).toBeDefined();
        expect(parsed[REGION_ID].osmSnapshot).toBe("2026-06-08");
        expect(parsed[REGION_ID].artifacts).toHaveLength(3);
        expect(
            parsed[REGION_ID].artifacts.every(
                (a: any) => a.status === "installed",
            ),
        ).toBe(true);
    });

    it("continues on artifact failure and marks it failed", async () => {
        // Make the measuring artifact fail (size mismatch).
        MockFile._mockFileInfoFn.mockImplementation((uri: string) => {
            if (uri.includes("measuring")) {
                return {
                    exists: true,
                    size: 999,
                    md5: MEASURING_ARTIFACT.md5,
                };
            }
            if (uri.includes("meta")) {
                return {
                    exists: true,
                    size: META_ARTIFACT.bytes,
                    md5: META_ARTIFACT.md5,
                };
            }
            return {
                exists: true,
                size: POI_ARTIFACT.bytes,
                md5: POI_ARTIFACT.md5,
            };
        });

        MockFile._mockFileBytesFn.mockImplementation((uri: string) => {
            if (uri.includes("meta")) {
                return Promise.resolve(jsonToBytes(META_PAYLOAD));
            }
            return Promise.resolve(jsonToBytes(RAW_REGION));
        });

        // SHA: 1st artf (meta) → meta hash; 2nd artf (poi) → poi hash; 3rd (measuring, fail) → any
        let shaCallCount2 = 0;
        mockDigestStringAsync.mockImplementation(() => {
            shaCallCount2++;
            if (shaCallCount2 === 1) {
                return Promise.resolve(META_ARTIFACT.sha256);
            }
            return Promise.resolve(POI_ARTIFACT.sha256);
        });

        const { result } = renderHook(() => useInstallPack(), { wrapper });

        result.current.mutate({ pack: CATALOG_PACK });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        // POI should still be registered.
        expect(mockRegisterRegion).toHaveBeenCalled();

        // Measuring should NOT be registered (size mismatch).
        expect(mockRegisterMeasuringSource).not.toHaveBeenCalled();

        // Index should show one failed.
        const stored = await AsyncStorage.getItem("installed-packs-v2");
        const parsed = JSON.parse(stored!);
        const failed = parsed[REGION_ID].artifacts.filter(
            (a: any) => a.status === "failed",
        );
        expect(failed).toHaveLength(1);
        expect(failed[0].kind).toBe("measuring");
        // Integrity failure (size mismatch) is unrecoverable → not retryable,
        // and the reason is persisted for the bundle-error banner.
        expect(failed[0].retryable).toBe(false);
        expect(failed[0].error).toMatch(/Size mismatch/);
    });

    it("marks POI as failed on MD5 mismatch and deletes the .gz", async () => {
        // Only make the POI artifact fail — meta should pass.
        MockFile._mockFileInfoFn.mockImplementation((uri: string) => {
            if (uri.includes("meta")) {
                return {
                    exists: true,
                    size: META_ARTIFACT.bytes,
                    md5: META_ARTIFACT.md5,
                };
            }
            // POI / measuring: wrong MD5
            return {
                exists: true,
                size: POI_ARTIFACT.bytes,
                md5: "wrong-md5",
            };
        });

        // Meta needs correct bytes and hash.
        MockFile._mockFileBytesFn.mockImplementation((uri: string) => {
            if (uri.includes("meta")) {
                return Promise.resolve(jsonToBytes(META_PAYLOAD));
            }
            return Promise.resolve(jsonToBytes(RAW_REGION));
        });

        let shaCallCount3 = 0;
        mockDigestStringAsync.mockImplementation(() => {
            shaCallCount3++;
            if (shaCallCount3 === 1) {
                return Promise.resolve(META_ARTIFACT.sha256);
            }
            // Subsequent calls (poi/measuring) — won't matter since MD5 fails first
            return Promise.resolve("some-hash");
        });

        const { result } = renderHook(() => useInstallPack(), { wrapper });
        result.current.mutate({ pack: CATALOG_PACK });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        // POI .gz should be deleted after MD5 failure.
        expect(MockFile._mockFileDeleteFn).toHaveBeenCalledWith(POI_GZ_URI);
        // POI should NOT be registered (MD5 failed).
        expect(mockRegisterRegion).not.toHaveBeenCalled();
        // Index should show poi as failed.
        const stored = await AsyncStorage.getItem("installed-packs-v2");
        const parsed = JSON.parse(stored!);
        const poiEntry = parsed[CATALOG_PACK.id].artifacts.find(
            (a: any) => a.kind === "poi",
        );
        expect(poiEntry).toBeDefined();
        expect(poiEntry.status).toBe("failed");
    });
});

// ─── Remove mutation ─────────────────────────────────────────────────────

describe("findBundleError / buildBugReportUrl", () => {
    const basePack: InstalledPack = {
        id: "asia-japan-kanto",
        osmSnapshot: "2026-06-19",
        installedAt: "2026-06-19T00:00:00.000Z",
        artifacts: [
            { kind: "poi", bytes: 1000, status: "installed" },
            {
                kind: "measuring",
                category: "body-of-water",
                bytes: 500,
                status: "failed",
                error: "schemaVersion mismatch: payload has 2, expected 1",
                retryable: false,
            },
        ],
    };

    it("finds the unrecoverable artifact only", () => {
        const found = findBundleError(basePack);
        expect(found?.category).toBe("body-of-water");
    });

    it("ignores retryable (transient) failures", () => {
        const transient: InstalledPack = {
            ...basePack,
            artifacts: [
                {
                    kind: "transit",
                    bytes: 10,
                    status: "failed",
                    error: "network error",
                    retryable: true,
                },
            ],
        };
        expect(findBundleError(transient)).toBeUndefined();
    });

    it("builds a prefilled GitHub issue URL with pack + artifact + error", () => {
        const failed = findBundleError(basePack)!;
        const url = buildBugReportUrl(basePack, failed);
        expect(url).toContain("github.com");
        expect(url).toContain("/issues/new?");
        expect(decodeURIComponent(url)).toContain("asia-japan-kanto");
        expect(decodeURIComponent(url)).toContain("measuring-body-of-water");
        expect(decodeURIComponent(url)).toContain("schemaVersion mismatch");
    });
});

describe("useRemovePack", () => {
    it("unregisters all kinds, deletes directory, and clears index", async () => {
        await seedInstalledIndex({
            [REGION_ID]: {
                id: REGION_ID,
                osmSnapshot: "2026-06-08",
                installedAt: "2026-06-10T00:00:00Z",
                artifacts: [
                    { kind: "poi", bytes: 5000, status: "installed" },
                    {
                        kind: "measuring",
                        category: "coastline",
                        bytes: 3000,
                        status: "installed",
                    },
                ],
            },
            "other-pack": {
                id: "other-pack",
                osmSnapshot: "2026-06-01",
                installedAt: "2026-06-05T00:00:00Z",
                artifacts: [{ kind: "poi", bytes: 1000, status: "installed" }],
            },
        });

        MockFile._dirExistsStore.set(PACK_DIR_URI, true);

        const { result } = renderHook(() => useRemovePack(), { wrapper });
        result.current.mutate(REGION_ID);

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(mockUnregisterRegion).toHaveBeenCalledWith(REGION_ID);
        expect(mockUnregisterMeasuringSources).toHaveBeenCalledWith(REGION_ID);
        expect(mockUnregisterBoundarySource).toHaveBeenCalledWith(REGION_ID);
        expect(mockUnregisterTransitSource).toHaveBeenCalledWith(REGION_ID);
        expect(mockUnregisterPackAdminLevels).toHaveBeenCalledWith(REGION_ID);

        // Directory delete should have been called.
        expect(MockFile._mockDirDeleteImpl).toHaveBeenCalledWith(PACK_DIR_URI);

        const stored = await AsyncStorage.getItem("installed-packs-v2");
        const parsed = JSON.parse(stored!);
        expect(parsed["other-pack"]).toBeDefined();
        expect(parsed[REGION_ID]).toBeUndefined();
    });
});

// ─── Retry mutation ──────────────────────────────────────────────────────

describe("useRetryPack", () => {
    it("retries only failed artifacts", async () => {
        // Seed with a partially-installed index (measuring failed).
        const partialIndex: Record<string, any> = {};
        partialIndex[REGION_ID] = {
            id: REGION_ID,
            osmSnapshot: "2026-06-08",
            installedAt: "2026-06-10T00:00:00Z",
            artifacts: [
                {
                    kind: "poi",
                    bytes: POI_ARTIFACT.bytes,
                    status: "installed",
                },
                {
                    kind: "measuring",
                    category: "coastline",
                    bytes: MEASURING_ARTIFACT.bytes,
                    status: "failed",
                },
                {
                    kind: "meta",
                    bytes: META_ARTIFACT.bytes,
                    status: "installed",
                },
            ],
        };
        await AsyncStorage.setItem(
            "installed-packs-v2",
            JSON.stringify(partialIndex),
        );

        MockFile._dirExistsStore.set(PACK_DIR_URI, true);

        // Now retry — measuring should be re-downloaded successfully.
        MockFile._mockFileInfoFn.mockImplementation((uri: string) => {
            if (uri.includes("measuring")) {
                return {
                    exists: true,
                    size: MEASURING_ARTIFACT.bytes,
                    md5: MEASURING_ARTIFACT.md5,
                };
            }
            if (uri.includes("meta")) {
                return {
                    exists: true,
                    size: META_ARTIFACT.bytes,
                    md5: META_ARTIFACT.md5,
                };
            }
            return {
                exists: true,
                size: POI_ARTIFACT.bytes,
                md5: POI_ARTIFACT.md5,
            };
        });

        MockFile._mockFileBytesFn.mockImplementation((uri: string) => {
            if (uri.includes("meta")) {
                return Promise.resolve(jsonToBytes(META_PAYLOAD));
            }
            return Promise.resolve(jsonToBytes(RAW_REGION));
        });

        // SHA-256: meta returns meta hash, measuring returns measuring hash.
        mockDigestStringAsync.mockImplementation(
            (_algo: string, str: string) => {
                if (str.includes("adminLevels")) {
                    return Promise.resolve(META_ARTIFACT.sha256);
                }
                if (str.includes("coastline")) {
                    return Promise.resolve(MEASURING_ARTIFACT.sha256);
                }
                return Promise.resolve(MEASURING_ARTIFACT.sha256);
            },
        );

        MockFile.downloadFileAsync.mockResolvedValue(
            MockFile._makeFileInstance(MEAS_GZ_URI),
        );

        const { result } = renderHook(() => useRetryPack(), { wrapper });
        result.current.mutate({ pack: CATALOG_PACK });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        // Should have registered measuring source on retry.
        expect(mockRegisterMeasuringSource).toHaveBeenCalledWith(
            REGION_ID,
            "coastline",
            MEAS_JSON_URI,
        );

        // Index should now have all artifacts installed.
        const stored = await AsyncStorage.getItem("installed-packs-v2");
        const parsed = JSON.parse(stored!);
        const allInstalled = parsed[REGION_ID].artifacts.every(
            (a: any) => a.status === "installed",
        );
        expect(allInstalled).toBe(true);
    });
});

// ─── loadInstalledPacks ─────────────────────────────────────────────────

describe("loadInstalledPacks", () => {
    it("loads and registers poi (parsed) + measuring (path only) from index", async () => {
        await seedInstalledIndex({
            [REGION_ID]: {
                id: REGION_ID,
                osmSnapshot: "2026-06-08",
                installedAt: "2026-06-10T00:00:00Z",
                artifacts: [
                    {
                        kind: "poi",
                        bytes: POI_ARTIFACT.bytes,
                        status: "installed",
                    },
                    {
                        kind: "measuring",
                        category: "coastline",
                        bytes: MEASURING_ARTIFACT.bytes,
                        status: "installed",
                    },
                ],
            },
        });

        // File exists so loadInstalledPacks reads it.
        MockFile._mockFileTextFn.mockResolvedValue(JSON.stringify(RAW_REGION));
        MockFile._dirExistsStore.set(PACK_DIR_URI, true);

        await loadInstalledPacks();

        // POI should be registered (parsed from file.text()).
        expect(mockRegisterRegion).toHaveBeenCalledWith(
            REGION_ID,
            expect.objectContaining({ region: REGION_ID }),
        );

        // Measuring should be registered with path only.
        expect(mockRegisterMeasuringSource).toHaveBeenCalledWith(
            REGION_ID,
            "coastline",
            MEAS_JSON_URI,
        );
    });

    it("does not call text() for measuring artifacts (path-only registration)", async () => {
        await seedInstalledIndex({
            [REGION_ID]: {
                id: REGION_ID,
                osmSnapshot: "2026-06-08",
                installedAt: "2026-06-10T00:00:00Z",
                artifacts: [
                    {
                        kind: "measuring",
                        category: "coastline",
                        bytes: MEASURING_ARTIFACT.bytes,
                        status: "installed",
                    },
                ],
            },
        });

        MockFile._dirExistsStore.set(PACK_DIR_URI, true);

        await loadInstalledPacks();

        // text() should NOT have been called for the measuring file — only
        // path registration via registerMeasuringSource.
        expect(mockRegisterRegion).not.toHaveBeenCalled();

        // Measuring source should be path-only registered.
        expect(mockRegisterMeasuringSource).toHaveBeenCalledWith(
            REGION_ID,
            "coastline",
            MEAS_JSON_URI,
        );
    });

    it("handles empty index gracefully", async () => {
        await loadInstalledPacks();
        expect(mockRegisterRegion).not.toHaveBeenCalled();
        expect(mockRegisterMeasuringSource).not.toHaveBeenCalled();
    });

    // N1: After install, boundaries.json is deleted (split into index +
    // polygons). On restart the exists guard must not skip boundaries.
    it("loads boundaries on restart after split (N1)", async () => {
        const BOUNDARIES_INDEX_URI = `${PACK_DIR_URI}/boundaries-index.json`;
        const BOUNDARIES_POLYGONS_URI = `${PACK_DIR_URI}/boundaries-polygons.json`;
        const BOUNDARIES_JSON_URI = `${PACK_DIR_URI}/boundaries.json`;

        const boundaryIndex = {
            schemaVersion: 1,
            regionId: REGION_ID,
            levels: [4, 8, 9, 10],
            index: [
                {
                    relationId: 12345,
                    name: "Test Boundary",
                    adminLevel: 8,
                    centroid: [5.0, 52.0],
                    bbox: [4.0, 51.0, 6.0, 53.0],
                    areaKm2: 1000,
                },
            ],
        };

        await seedInstalledIndex({
            [REGION_ID]: {
                id: REGION_ID,
                osmSnapshot: "2026-06-08",
                installedAt: "2026-06-10T00:00:00Z",
                artifacts: [
                    {
                        kind: "boundaries",
                        bytes: 5000,
                        status: "installed",
                    },
                ],
            },
        });

        // Simulate post-split state: boundaries.json does NOT exist,
        // but boundaries-index.json + boundaries-polygons.json DO exist.
        MockFile._fileExistsStore.set(BOUNDARIES_JSON_URI, false);
        MockFile._fileExistsStore.set(BOUNDARIES_INDEX_URI, true);
        MockFile._fileExistsStore.set(BOUNDARIES_POLYGONS_URI, true);

        // text() returns index data for the index file.
        MockFile._mockFileTextFn.mockImplementation((uri: string) => {
            if (uri === BOUNDARIES_INDEX_URI) {
                return Promise.resolve(JSON.stringify(boundaryIndex));
            }
            return Promise.resolve(JSON.stringify(RAW_REGION));
        });

        await loadInstalledPacks();

        // Boundaries should be registered from the split files.
        expect(mockRegisterBoundarySource).toHaveBeenCalledWith(
            REGION_ID,
            BOUNDARIES_INDEX_URI,
            BOUNDARIES_POLYGONS_URI,
            boundaryIndex.index,
            boundaryIndex.levels,
        );
    });
});

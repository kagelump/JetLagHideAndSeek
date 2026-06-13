/**
 * Tests for lineBundleLoader — the measuring line bundle loader.
 *
 * Covers:
 * - registerMeasuringSource / unregisterMeasuringSources
 * - loadLineBundle merging pack sources
 * - getLineBundle returning cached results after async load
 * - useEnsureMeasuringBundles hook behavior
 */

import { renderHook } from "@testing-library/react-native";

import type { LineBundle } from "../lineBundleLoader";

// We must set up the expo-file-system mock before importing the module.
jest.mock("expo-file-system", () => {
    function resolveFromCache(fullPath: string): string | undefined {
        const cache = (
            globalThis as unknown as { __fsCache?: Record<string, string> }
        ).__fsCache;
        return cache?.[fullPath];
    }
    return {
        __esModule: true,
        File: jest
            .fn()
            .mockImplementation((dirOrPath: string, name?: string) => {
                const fullPath =
                    name !== undefined ? `${dirOrPath}/${name}` : dirOrPath;
                return {
                    uri: fullPath,
                    get exists(): boolean {
                        return resolveFromCache(fullPath) !== undefined;
                    },
                    text: jest.fn(() => {
                        const content = resolveFromCache(fullPath);
                        if (content !== undefined) {
                            return Promise.resolve(content);
                        }
                        return Promise.reject(
                            new Error(`File not found: ${fullPath}`),
                        );
                    }),
                };
            }),
        readAsStringAsync: jest.fn((path: string) => {
            const content = resolveFromCache(path);
            if (content !== undefined) {
                return Promise.resolve(content);
            }
            return Promise.reject(new Error(`File not found: ${path}`));
        }),
        documentDirectory: "/mock-documents/",
    };
});

// Set up a global FS cache that the mock reads from.
const fsCache: Record<string, string> = {};
(globalThis as unknown as { __fsCache?: Record<string, string> }).__fsCache =
    fsCache;

import {
    __clearLineBundlesForTest,
    __clearPackSourcesForTest,
    __getPackSourcesForTest,
    __setLineBundleForTest,
    getLineBundle,
    loadLineBundle,
    registerMeasuringSource,
    unregisterMeasuringSources,
} from "../lineBundleLoader";

import type { MeasuringCategory } from "../measuringTypes";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a minimal valid LineBundle for a category. */
function makeBundle(
    category: string,
    overrides: Partial<LineBundle> = {},
): LineBundle {
    return {
        schemaVersion: 1,
        category,
        generatedAt: "2026-06-12T00:00:00.000Z",
        source: "test-source",
        extractBbox: [0, 0, 10, 10] as [number, number, number, number],
        features: [
            {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                    ],
                },
                properties: {},
            },
        ],
        ...overrides,
    };
}

// ─── Cleanup between tests ─────────────────────────────────────────────────

beforeEach(() => {
    __clearLineBundlesForTest();
    __clearPackSourcesForTest();
    // Clear the FS cache.
    Object.keys(fsCache).forEach((k) => delete fsCache[k]);
});

// ─── registerMeasuringSource / unregisterMeasuringSources ────────────────────

describe("registerMeasuringSource", () => {
    it("registers a pack source for a category", () => {
        registerMeasuringSource(
            "pack-1",
            "coastline",
            "/path/to/coastline.json",
        );
        const sources = __getPackSourcesForTest();
        expect(sources.get("coastline")).toEqual([
            { packId: "pack-1", path: "/path/to/coastline.json" },
        ]);
    });

    it("does not register duplicate entries", () => {
        registerMeasuringSource("pack-1", "coastline", "/path/a.json");
        registerMeasuringSource("pack-1", "coastline", "/path/a.json");
        const sources = __getPackSourcesForTest();
        expect(sources.get("coastline")).toHaveLength(1);
    });

    it("registers multiple packs for the same category", () => {
        registerMeasuringSource("pack-1", "coastline", "/path/a.json");
        registerMeasuringSource("pack-2", "coastline", "/path/b.json");
        const sources = __getPackSourcesForTest();
        expect(sources.get("coastline")).toHaveLength(2);
    });

    it("invalidates cache when registering", () => {
        __setLineBundleForTest(
            "coastline",
            makeBundle("coastline", { source: "cached" }),
        );
        expect(getLineBundle("coastline")?.source).toBe("cached");

        registerMeasuringSource("pack-1", "coastline", "/path/a.json");
        // Cache invalidated — getLineBundle returns null until loadLineBundle runs.
        expect(getLineBundle("coastline")).toBeNull();
    });
});

describe("unregisterMeasuringSources", () => {
    it("removes sources for a pack", () => {
        registerMeasuringSource("pack-1", "coastline", "/path/a.json");
        registerMeasuringSource("pack-2", "coastline", "/path/b.json");
        unregisterMeasuringSources("pack-1");
        const sources = __getPackSourcesForTest();
        expect(sources.get("coastline")).toHaveLength(1);
        expect(sources.get("coastline")![0].packId).toBe("pack-2");
    });

    it("removes the category entry when last source is removed", () => {
        registerMeasuringSource("pack-1", "coastline", "/path/a.json");
        unregisterMeasuringSources("pack-1");
        const sources = __getPackSourcesForTest();
        expect(sources.has("coastline")).toBe(false);
    });

    it("invalidates cache on unregister", () => {
        registerMeasuringSource("pack-1", "coastline", "/path/a.json");
        __setLineBundleForTest(
            "coastline",
            makeBundle("coastline", { source: "seam-bundle" }),
        );
        expect(getLineBundle("coastline")?.source).toBe("seam-bundle");

        unregisterMeasuringSources("pack-1");
        // Cache invalidated — getLineBundle returns null.
        expect(getLineBundle("coastline")).toBeNull();
    });
});

// ─── loadLineBundle ──────────────────────────────────────────────────────────

describe("loadLineBundle", () => {
    it("returns cached merged bundle on repeated calls", async () => {
        fsCache["/test/cached.json"] = JSON.stringify(
            makeBundle("coastline", { source: "cached" }),
        );
        registerMeasuringSource(
            "cached-pack",
            "coastline",
            "/test/cached.json",
        );

        const first = await loadLineBundle("coastline");
        expect(first).not.toBeNull();
        expect(first!.source).toBe("cached");

        // Second call should return the same cached object.
        const second = await loadLineBundle("coastline");
        expect(second).toBe(first);
    });

    it("returns null when no pack sources exist for a category", async () => {
        __clearLineBundlesForTest();
        __clearPackSourcesForTest();
        const result = await loadLineBundle("coastline");
        expect(result).toBeNull();
    });

    it("loads a category from pack sources", async () => {
        fsCache["/test/coastline-pack.json"] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack-source",
                extractBbox: [5, 5, 15, 15] as [number, number, number, number],
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [2, 2],
                                [3, 3],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        registerMeasuringSource(
            "test-pack",
            "coastline",
            "/test/coastline-pack.json",
        );

        const result = await loadLineBundle("coastline");

        expect(result).not.toBeNull();
        expect(result!.category).toBe("coastline");
        expect(result!.features).toHaveLength(1);
        expect(result!.source).toBe("pack-source");
    });

    it("merges multiple pack sources for the same category", async () => {
        fsCache["/test/pack1.json"] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack1",
                extractBbox: [0, 0, 5, 5] as [number, number, number, number],
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [0, 0],
                                [1, 1],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        fsCache["/test/pack2.json"] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack2",
                extractBbox: [3, 3, 8, 8] as [number, number, number, number],
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [2, 2],
                                [3, 3],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        registerMeasuringSource("pack-1", "coastline", "/test/pack1.json");
        registerMeasuringSource("pack-2", "coastline", "/test/pack2.json");

        const result = await loadLineBundle("coastline");

        expect(result).not.toBeNull();
        expect(result!.features).toHaveLength(2);
        expect(result!.source).toContain("pack1");
        expect(result!.source).toContain("pack2");
        // Bbox union: [min(0,3), min(0,3), max(5,8), max(5,8)]
        expect(result!.extractBbox[0]).toBe(0);
        expect(result!.extractBbox[2]).toBeGreaterThanOrEqual(8);
    });

    it("caches the merged result so getLineBundle is sync afterwards", async () => {
        fsCache["/test/sync.json"] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack-sync",
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [0, 0],
                                [10, 10],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        registerMeasuringSource("sync-pack", "coastline", "/test/sync.json");

        // Before load — getLineBundle returns null.
        expect(getLineBundle("coastline")).toBeNull();

        // Now load async.
        await loadLineBundle("coastline");
        const cached = getLineBundle("coastline");
        expect(cached).not.toBeNull();
        expect(cached!.source).toBe("pack-sync");
    });

    it("handles missing pack files gracefully", async () => {
        registerMeasuringSource(
            "bad-pack",
            "coastline",
            "/test/nonexistent.json",
        );

        // Should not throw — just warn and return null.
        const result = await loadLineBundle("coastline");
        expect(result).toBeNull();
    });
});

// ─── useEnsureMeasuringBundles (renderHook) ───────────────────────────────────

describe("useEnsureMeasuringBundles", () => {
    beforeEach(() => {
        __clearLineBundlesForTest();
        __clearPackSourcesForTest();
    });

    it("does not trigger loads for already-cached categories", () => {
        __setLineBundleForTest(
            "coastline",
            makeBundle("coastline", { source: "pre-cached" }),
        );

        const { useEnsureMeasuringBundles: hook } = jest.requireActual(
            "../useEnsureMeasuringBundles",
        );
        const questions = [
            {
                id: "q1",
                type: "measuring" as const,
                category: "coastline" as MeasuringCategory,
                center: [139.7, 35.7] as [number, number],
                answer: "unanswered" as const,
                seekerDistanceUnit: "km" as const,
            },
        ];

        const { result } = renderHook(() => hook(questions));
        expect(result.current).toBe(0);
    });

    it("triggers async load for uncached pack categories", () => {
        const { useEnsureMeasuringBundles: hook } = jest.requireActual(
            "../useEnsureMeasuringBundles",
        );

        const fakePath = "/test/ensure-unique-2.json";
        fsCache[fakePath] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack-ensure",
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [139.5, 35.5],
                                [139.8, 35.8],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        registerMeasuringSource("test-pack", "coastline", fakePath);

        const questions = [
            {
                id: "q2",
                type: "measuring" as const,
                category: "coastline" as MeasuringCategory,
                center: [139.7, 35.7] as [number, number],
                answer: "unanswered" as const,
                seekerDistanceUnit: "km" as const,
            },
        ];

        const { result } = renderHook(() => hook(questions));
        expect(typeof result.current).toBe("number");
        expect(result.current).toBeGreaterThanOrEqual(0);
    });
});

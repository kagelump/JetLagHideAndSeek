import AsyncStorage from "@react-native-async-storage/async-storage";
import osmtogeojson from "osmtogeojson";

import type { GeoJsonFeatureCollection } from "../geojsonTypes";

import {
    buildPlayAreaFromBoundary,
    buildPlayAreaFromOverpass,
    ensurePlayAreaBoundaryCached,
    fetchPlayAreaBoundary,
    isBundledPlayAreaId,
    loadCachedPlayAreaByRelationId,
    loadPlayAreaByRelationId,
    parseRelationId,
} from "../playAreaBoundary";
import { queryClient } from "@/state/queryClient";

jest.mock("osmtogeojson", () => ({
    __esModule: true,
    default: jest.fn(),
}));

const mockedOsmToGeoJson = osmtogeojson as jest.MockedFunction<
    typeof osmtogeojson
>;

const CACHE_KEY = "play-area-boundary:999999";

const osakaBoundary = {
    features: [
        {
            geometry: {
                coordinates: [
                    [
                        [135.35, 34.5],
                        [135.7, 34.5],
                        [135.7, 34.82],
                        [135.35, 34.82],
                        [135.35, 34.5],
                    ],
                ],
                type: "Polygon",
            },
            properties: { name: "Osaka" },
            type: "Feature",
        },
        {
            geometry: { coordinates: [135.5, 34.7], type: "Point" },
            properties: { name: "Ignore me" },
            type: "Feature",
        },
    ],
    type: "FeatureCollection",
};

function makeCachedOsaka(label = "Osaka") {
    return {
        ...buildPlayAreaFromBoundary(999999, {
            features: [osakaBoundary.features[0]],
            type: "FeatureCollection",
        } as unknown as GeoJsonFeatureCollection),
        label,
    };
}

async function storeCachedOsaka(label = "Osaka") {
    const playArea = makeCachedOsaka(label);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(playArea));
}

function makeOverpassResponse() {
    return {
        json: jest.fn().mockResolvedValue({ elements: [] }),
        ok: true,
    };
}

describe("playAreaBoundary", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        queryClient.clear();
        await AsyncStorage.clear();
        globalThis.fetch = jest.fn();
    });

    // -----------------------------------------------------------------------
    // Pure function tests (unchanged)
    // -----------------------------------------------------------------------

    it("validates direct OSM relation IDs", () => {
        expect(parseRelationId("358674")).toBe(358674);
        expect(parseRelationId(" 358674 ")).toBe(358674);
        expect(parseRelationId("")).toBeNull();
        expect(parseRelationId("-1")).toBeNull();
        expect(parseRelationId("way/358674")).toBeNull();
    });

    it("identifies bundled play area IDs", () => {
        expect(isBundledPlayAreaId(19631009)).toBe(true);
        expect(isBundledPlayAreaId(358674)).toBe(true);
        expect(isBundledPlayAreaId(999999)).toBe(false);
    });

    it("converts mocked Overpass Osaka geometry into a play area", () => {
        mockedOsmToGeoJson.mockReturnValue(osakaBoundary);

        const playArea = buildPlayAreaFromOverpass(358674, {
            elements: [],
        });

        expect(playArea.label).toBe("Osaka");
        expect(playArea.osmId).toBe(358674);
        expect(playArea.boundary.features).toHaveLength(1);
        expect(playArea.bbox).toEqual([135.35, 34.5, 135.7, 34.82]);
    });

    it("throws when Overpass API returns non-ok", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 429,
        });

        await expect(fetchPlayAreaBoundary(999999)).rejects.toThrow(
            "Overpass API error 429",
        );
    });

    it("throws when boundary has no polygon features", () => {
        const empty: GeoJsonFeatureCollection = {
            features: [],
            type: "FeatureCollection",
        };

        expect(() => buildPlayAreaFromBoundary(999999, empty)).toThrow(
            "No polygon boundary",
        );
    });

    // -----------------------------------------------------------------------
    // Query-backed integration tests
    // -----------------------------------------------------------------------

    it("returns bundled Tokyo without network", async () => {
        const result = await loadPlayAreaByRelationId(19631009);

        expect(result.cacheSource).toBe("bundled");
        expect(result.playArea.label).toBe("Tokyo 23 Wards");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("fetches and caches a play area via the query client", async () => {
        mockedOsmToGeoJson.mockReturnValue(osakaBoundary);
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            makeOverpassResponse(),
        );

        const first = await loadPlayAreaByRelationId(999999);
        expect(first.cacheSource).toBe("fetched");
        expect(first.playArea.label).toBe("Osaka");

        // Second call should hit the query cache.
        (globalThis.fetch as jest.Mock).mockClear();
        const second = await loadPlayAreaByRelationId(999999);
        expect(second.cacheSource).toBe("memory");
        expect(second.playArea.label).toBe("Osaka");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("reads a persisted boundary from AsyncStorage as a fallback", async () => {
        await storeCachedOsaka();

        const result = await loadCachedPlayAreaByRelationId(999999);

        expect(result).not.toBeNull();
        expect(result!.cacheSource).toBe("persisted");
        expect(result!.playArea.label).toBe("Osaka");
    });

    it("returns null for unknown relation IDs in loadCachedPlayAreaByRelationId", async () => {
        const result = await loadCachedPlayAreaByRelationId(999999);

        expect(result).toBeNull();
    });

    it("loadCachedPlayAreaByRelationId seeds the query cache from AsyncStorage", async () => {
        await storeCachedOsaka();

        await loadCachedPlayAreaByRelationId(999999);

        // After seeding, the query cache should have the data.
        const cached = queryClient.getQueryData(["play-area-boundary", 999999]);
        expect(cached).not.toBeUndefined();
        expect((cached as { label: string }).label).toBe("Osaka");
    });

    it("ensurePlayAreaBoundaryCached writes to the query cache and AsyncStorage", async () => {
        const playArea = makeCachedOsaka();

        await ensurePlayAreaBoundaryCached(playArea);

        // Should be in the query cache.
        expect(
            queryClient.getQueryData(["play-area-boundary", 999999]),
        ).toEqual(playArea);

        // Should be persisted to AsyncStorage.
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        expect(JSON.parse(raw ?? "{}")).toMatchObject({
            label: "Osaka",
            osmId: 999999,
        });
    });

    it("ensurePlayAreaBoundaryCached does not replace an existing cache entry", async () => {
        const original = makeCachedOsaka("Original Osaka");
        queryClient.setQueryData(["play-area-boundary", 999999], original);

        const replacement = makeCachedOsaka("Replacement Osaka");
        await ensurePlayAreaBoundaryCached(replacement);

        const cached = queryClient.getQueryData(["play-area-boundary", 999999]);
        expect((cached as { label: string }).label).toBe("Original Osaka");
    });

    it("boundary remains durable after query cache eviction (gc-resistance)", async () => {
        mockedOsmToGeoJson.mockReturnValue(osakaBoundary);
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            makeOverpassResponse(),
        );

        // Simulate the app flow: fetch via applyRelationId, then persistAppState
        // calls ensurePlayAreaBoundaryCached with the same object.
        const { playArea } = await loadPlayAreaByRelationId(999999);
        await ensurePlayAreaBoundaryCached(playArea);

        // Simulate gc eviction — happens after 30 min with no active observer
        // (usePlayAreaBoundary is not mounted; store reads imperatively).
        queryClient.clear();

        // The boundary must still resolve offline without a network call.
        const result = await loadCachedPlayAreaByRelationId(999999);
        expect(result).not.toBeNull();
        expect(result!.cacheSource).toBe("persisted");
        expect(result!.playArea.osmId).toBe(999999);
        expect(globalThis.fetch).not.toHaveBeenCalledTimes(2);
    });

    it("ensurePlayAreaBoundaryCached is a no-op for bundled play areas", async () => {
        const tokyo = (await loadPlayAreaByRelationId(19631009)).playArea;

        await ensurePlayAreaBoundaryCached(tokyo);

        // Bundled boundaries should not be in the query cache at this key.
        expect(
            queryClient.getQueryData(["play-area-boundary", 19631009]),
        ).toBeUndefined();
    });

    it("handles corrupted persisted boundaries gracefully", async () => {
        await AsyncStorage.setItem(CACHE_KEY, "not json");
        mockedOsmToGeoJson.mockReturnValue(osakaBoundary);
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            makeOverpassResponse(),
        );

        // loadCachedPlayAreaByRelationId should return null for corrupted data.
        const cached = await loadCachedPlayAreaByRelationId(999999);
        expect(cached).toBeNull();

        // loadPlayAreaByRelationId should fall through to a fetch.
        const fetched = await loadPlayAreaByRelationId(999999);
        expect(fetched.cacheSource).toBe("fetched");
        expect(fetched.playArea.label).toBe("Osaka");
    });

    it("accepts a signal parameter in fetchPlayAreaBoundary", async () => {
        mockedOsmToGeoJson.mockReturnValue(osakaBoundary);
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            makeOverpassResponse(),
        );

        const controller = new AbortController();
        await fetchPlayAreaBoundary(999999, controller.signal);

        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ signal: controller.signal }),
        );
    });
});

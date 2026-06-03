import type { MatchingCategory, OsmFeature } from "../matchingTypes";

import {
    localBboxFeatures,
    resolveBboxFeatures,
    type BboxObj,
} from "../featureSource";

// ─── Module-level mocks ──────────────────────────────────────────────────

const mockFetchAndParseBbox: jest.Mock = jest.fn();
const mockRegionCoveringBbox: jest.Mock = jest.fn();
const mockGetBundledCategoryFeatures: jest.Mock = jest.fn();
const mockGetRegionGeneratedAt: jest.Mock = jest.fn();
const mockIsBundleableCategory: jest.Mock = jest.fn();

jest.mock("../osmMatching", () => ({
    fetchAndParseOverpassBboxFeatures: (...args: unknown[]) =>
        mockFetchAndParseBbox(...args),
}));

jest.mock("../bundledPois", () => ({
    getBundledCategoryFeatures: (...args: unknown[]) =>
        mockGetBundledCategoryFeatures(...args),
    getRegionGeneratedAt: (...args: unknown[]) =>
        mockGetRegionGeneratedAt(...args),
    regionCoveringBbox: (...args: unknown[]) => mockRegionCoveringBbox(...args),
}));

jest.mock("../matchingSelectors", () => ({
    isBundleableCategory: (...args: unknown[]) =>
        mockIsBundleableCategory(...args),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────

const CELL_BBOX: BboxObj = {
    south: 35.5,
    west: 139.5,
    north: 35.6,
    east: 139.6,
};

const LOCAL_FEATURES: OsmFeature[] = [
    {
        lat: 35.55,
        lon: 139.55,
        name: "Local Park",
        osmId: 1,
        osmType: "node",
        tags: {},
    },
    {
        lat: 35.58,
        lon: 139.58,
        name: "Local Museum",
        osmId: 2,
        osmType: "way",
        tags: {},
    },
];

const OVERPASS_FEATURES: OsmFeature[] = [
    {
        lat: 35.56,
        lon: 139.56,
        name: "Overpass Park",
        osmId: 3,
        osmType: "node",
        tags: {},
    },
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ─── localBboxFeatures ──────────────────────────────────────────────────

describe("localBboxFeatures", () => {
    it("returns null when no region covers the bbox", () => {
        mockIsBundleableCategory.mockReturnValue(true);
        mockRegionCoveringBbox.mockReturnValue(null);

        const result = localBboxFeatures("park", CELL_BBOX);
        expect(result).toBeNull();
    });

    it("returns null for non-bundleable categories (admin-1st)", () => {
        mockIsBundleableCategory.mockReturnValue(false);

        const result = localBboxFeatures(
            "admin-1st" as MatchingCategory,
            CELL_BBOX,
        );
        expect(result).toBeNull();
        // Should not even check coverage for non-bundleable categories.
        expect(mockRegionCoveringBbox).not.toHaveBeenCalled();
    });

    it("returns features filtered to the bbox", () => {
        mockIsBundleableCategory.mockReturnValue(true);
        mockRegionCoveringBbox.mockReturnValue("test-region");
        mockGetBundledCategoryFeatures.mockReturnValue([
            ...LOCAL_FEATURES,
            {
                lat: 36.0,
                lon: 140.0,
                name: "Outside Feature",
                osmId: 99,
                osmType: "node",
                tags: {},
            },
        ]);
        mockGetRegionGeneratedAt.mockReturnValue("2026-01-01T00:00:00Z");

        const result = localBboxFeatures("park", CELL_BBOX);
        expect(result).not.toBeNull();
        expect(result!.features).toHaveLength(2); // outside feature filtered out
        expect(result!.features[0].name).toBe("Local Park");
        expect(result!.generatedAt).toBe("2026-01-01T00:00:00Z");
    });

    it("returns empty features array when category absent in bundle", () => {
        mockIsBundleableCategory.mockReturnValue(true);
        mockRegionCoveringBbox.mockReturnValue("test-region");
        mockGetBundledCategoryFeatures.mockReturnValue([]);
        mockGetRegionGeneratedAt.mockReturnValue("2026-01-01T00:00:00Z");

        const result = localBboxFeatures("library", CELL_BBOX);
        expect(result).not.toBeNull();
        expect(result!.features).toEqual([]);
    });
});

// ─── resolveBboxFeatures ────────────────────────────────────────────────

describe("resolveBboxFeatures", () => {
    it("returns local features when covered", async () => {
        mockIsBundleableCategory.mockReturnValue(true);
        mockRegionCoveringBbox.mockReturnValue("test-region");
        mockGetBundledCategoryFeatures.mockReturnValue(LOCAL_FEATURES);
        mockGetRegionGeneratedAt.mockReturnValue("2026-06-01T00:00:00Z");

        const result = await resolveBboxFeatures("park", CELL_BBOX);

        expect(result.source).toBe("local");
        expect(result.features).toEqual(LOCAL_FEATURES);
        expect(result.generatedAt).toBe("2026-06-01T00:00:00Z");
        expect(mockFetchAndParseBbox).not.toHaveBeenCalled();
    });

    it("calls Overpass when region does not cover", async () => {
        mockIsBundleableCategory.mockReturnValue(true);
        mockRegionCoveringBbox.mockReturnValue(null);
        mockFetchAndParseBbox.mockResolvedValue(OVERPASS_FEATURES);

        const result = await resolveBboxFeatures("park", CELL_BBOX);

        expect(result.source).toBe("overpass");
        expect(result.features).toEqual(OVERPASS_FEATURES);
        expect(result.generatedAt).toBeUndefined();
    });

    it("calls Overpass for non-bundleable categories", async () => {
        mockIsBundleableCategory.mockReturnValue(false);
        mockFetchAndParseBbox.mockResolvedValue(OVERPASS_FEATURES);

        const result = await resolveBboxFeatures(
            "admin-1st" as MatchingCategory,
            CELL_BBOX,
        );

        expect(result.source).toBe("overpass");
        expect(result.features).toEqual(OVERPASS_FEATURES);
    });

    it("passes correct argument order to fetchAndParseOverpassBboxFeatures", async () => {
        mockIsBundleableCategory.mockReturnValue(true);
        mockRegionCoveringBbox.mockReturnValue(null);
        mockFetchAndParseBbox.mockResolvedValue([]);

        await resolveBboxFeatures("park", CELL_BBOX);

        const callArgs = mockFetchAndParseBbox.mock.calls[0];
        // fetchAndParseOverpassBboxFeatures(category, south, west, north, east, signal?)
        expect(callArgs[0]).toBe("park");
        expect(callArgs[1]).toBe(35.5); // south
        expect(callArgs[2]).toBe(139.5); // west
        expect(callArgs[3]).toBe(35.6); // north
        expect(callArgs[4]).toBe(139.6); // east
    });

    it("forwards AbortSignal to Overpass call", async () => {
        mockIsBundleableCategory.mockReturnValue(true);
        mockRegionCoveringBbox.mockReturnValue(null);
        mockFetchAndParseBbox.mockResolvedValue([]);
        const controller = new AbortController();

        await resolveBboxFeatures("park", CELL_BBOX, controller.signal);

        expect(mockFetchAndParseBbox).toHaveBeenCalledWith(
            "park",
            35.5,
            139.5,
            35.6,
            139.6,
            controller.signal,
        );
    });
});

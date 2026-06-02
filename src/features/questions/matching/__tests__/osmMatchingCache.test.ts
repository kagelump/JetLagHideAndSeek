import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    clearOsmMatchingCellMemoryCache,
    clearOsmMatchingMemoryCache,
    containsSearchCircle,
    deduplicateFeatures,
    findMatchingFeaturesWithCache,
    findMatchingFeaturesWithCellCache,
    getOverscanRadius,
    MATCHING_CACHE_TTL_MS,
    OVERSCAN_FACTOR,
} from "../osmMatchingCache";
import {
    cellBbox,
    cellIndex,
    cellsForSearch,
    metersToDegreesLat,
    metersToDegreesLon,
} from "../osmMatchingGrid";

// ─── Module-level mocks ───────────────────────────────────────────────────────

const mockFetchAndParse = jest.fn<Promise<any[]>, any[]>();
const mockFetchAndParseBbox = jest.fn<Promise<any[]>, any[]>();

jest.mock("../osmMatching", () => ({
    DEFAULT_SEARCH_RADIUS_METERS: 50_000,
    fetchAndParseOverpassBboxFeatures: (...args: unknown[]) =>
        mockFetchAndParseBbox(...args),
    fetchAndParseOverpassFeatures: (...args: unknown[]) =>
        mockFetchAndParse(...args),
    rankMatchingFeatures:
        jest.requireActual("../osmMatching").rankMatchingFeatures,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const tokyoCenter: [number, number] = [139.767125, 35.681236];
const nearTokyoCenter: [number, number] = [139.777, 35.681]; // ~750 m east

const hospitalFeatures = [
    {
        lat: 35.685,
        lon: 139.77,
        name: "Tokyo Hospital",
        osmId: 1,
        osmType: "node" as const,
        tags: {},
    },
    {
        lat: 35.69,
        lon: 139.78,
        name: "Shinjuku Medical",
        osmId: 2,
        osmType: "way" as const,
        tags: {},
    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resetAll() {
    clearOsmMatchingMemoryCache();
    await clearOsmMatchingCellMemoryCache();
    (AsyncStorage.clear as jest.Mock)();
}

// ─── containsSearchCircle ─────────────────────────────────────────────────────

describe("containsSearchCircle", () => {
    it("returns true when requested circle is identical to cached circle", () => {
        expect(
            containsSearchCircle(35.68, 139.76, 5000, 35.68, 139.76, 5000),
        ).toBe(true);
    });

    it("returns true when requested circle is strictly inside cached circle", () => {
        // Center moved 750 m east, so dist ≈ 750. 750 + 3000 = 3750 <= 5000.
        expect(
            containsSearchCircle(35.68, 139.76, 5000, 35.68, 139.767, 3000),
        ).toBe(true);
    });

    it("returns false when requested circle extends beyond cached circle", () => {
        // dist ≈ 750. 750 + 5000 = 5750 > 5000.
        expect(
            containsSearchCircle(35.68, 139.76, 5000, 35.68, 139.767, 5000),
        ).toBe(false);
    });

    it("returns false when centers are far apart", () => {
        expect(
            containsSearchCircle(35.68, 139.76, 50_000, 35.68, 141.0, 50_000),
        ).toBe(false);
    });

    it("returns true when overscan circle contains exact-radius request", () => {
        // Overscan circle at A with radius 75 km covers request at B (5 km away)
        // with radius 50 km: 5000 + 50_000 = 55_000 <= 75_000.
        expect(
            containsSearchCircle(
                35.68,
                139.76,
                75_000,
                35.68,
                139.815, // ~3.5 km east at Tokyo latitude
                50_000,
            ),
        ).toBe(true);
    });
});

// ─── getOverscanRadius ────────────────────────────────────────────────────────

describe("getOverscanRadius", () => {
    it("multiplies by OVERSCAN_FACTOR and rounds up", () => {
        const result = getOverscanRadius(50_000);
        expect(result).toBe(Math.ceil(50_000 * OVERSCAN_FACTOR));
        expect(result).toBeGreaterThan(50_000);
    });
});

// ─── findMatchingFeaturesWithCache ────────────────────────────────────────────

describe("findMatchingFeaturesWithCache", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await resetAll();
        mockFetchAndParse.mockResolvedValue(hospitalFeatures);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("fetches from network on first call and returns ranked candidates", async () => {
        const result = await findMatchingFeaturesWithCache(
            "hospital",
            tokyoCenter,
        );

        expect(result.source).toBe("network");
        expect(result.candidates).toHaveLength(hospitalFeatures.length);
        expect(mockFetchAndParse).toHaveBeenCalledTimes(1);
    });

    it("uses overscan radius for network fetch", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });

        // fetchAndParseOverpassFeatures(category, center, radiusMeters, signal?)
        const [, , calledRadius] = mockFetchAndParse.mock.calls[0];
        expect(calledRadius).toBe(getOverscanRadius(5000));
        expect(calledRadius).toBeGreaterThan(5000);
    });

    it("returns memory hit on second call without another network request", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter);
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCache(
            "hospital",
            tokyoCenter,
        );

        expect(result.source).toBe("memory");
        expect(mockFetchAndParse).not.toHaveBeenCalled();
    });

    it("serves nearby center from memory without another network request", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        jest.clearAllMocks();

        // nearTokyoCenter is ~750 m from tokyoCenter; overscan was 7500 m,
        // so dist + 5000 ≈ 750 + 5000 = 5750 <= 7500 → should be a cache hit.
        const result = await findMatchingFeaturesWithCache(
            "hospital",
            nearTokyoCenter,
            { requestedRadiusMeters: 5000 },
        );

        expect(result.source).toBe("memory");
        expect(mockFetchAndParse).not.toHaveBeenCalled();
        // Candidates are re-ranked from the new center.
        expect(result.candidates.length).toBeGreaterThan(0);
    });

    it("fetches again when center is outside the cached overscan circle", async () => {
        const farCenter: [number, number] = [141.0, 35.68]; // ~100 km east

        await findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCache(
            "hospital",
            farCenter,
            {
                requestedRadiusMeters: 5000,
            },
        );

        expect(result.source).toBe("network");
        expect(mockFetchAndParse).toHaveBeenCalledTimes(1);
    });

    it("returns disk hit after memory is cleared", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        // Flush memory but keep AsyncStorage.
        clearOsmMatchingMemoryCache();
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCache(
            "hospital",
            tokyoCenter,
            {
                requestedRadiusMeters: 5000,
            },
        );

        expect(result.source).toBe("disk");
        expect(mockFetchAndParse).not.toHaveBeenCalled();
    });

    it("returns stale result and triggers background refresh when TTL exceeded", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        // Reset call count so we only count refreshes triggered by the stale hit.
        mockFetchAndParse.mockClear();

        // Age the cached entry past TTL.
        jest.spyOn(Date, "now").mockReturnValue(
            Date.now() + MATCHING_CACHE_TTL_MS + 1,
        );

        const freshFeatures = [
            {
                lat: 35.69,
                lon: 139.78,
                name: "New Hospital",
                osmId: 99,
                osmType: "node" as const,
                tags: {},
            },
        ];
        mockFetchAndParse.mockResolvedValue(freshFeatures);

        const result = await findMatchingFeaturesWithCache(
            "hospital",
            tokyoCenter,
            {
                requestedRadiusMeters: 5000,
            },
        );

        expect(result.source).toBe("stale");
        // Returns the old candidates immediately.
        expect(result.candidates.some((c) => c.name === "Tokyo Hospital")).toBe(
            true,
        );

        // Let the background refresh complete.
        await Promise.resolve();
        await Promise.resolve();

        expect(mockFetchAndParse).toHaveBeenCalledTimes(1);

        jest.spyOn(Date, "now").mockRestore();
    });

    it("deduplicates simultaneous in-flight requests for the same key", async () => {
        let resolveFirst!: (value: typeof hospitalFeatures) => void;
        mockFetchAndParse.mockReturnValue(
            new Promise((resolve) => {
                resolveFirst = resolve;
            }),
        );

        const p1 = findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        const p2 = findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });

        resolveFirst(hospitalFeatures);
        const [r1, r2] = await Promise.all([p1, p2]);

        // Only one actual fetch should have been made.
        expect(mockFetchAndParse).toHaveBeenCalledTimes(1);
        expect(r1.source).toBe("network");
        expect(r2.source).toBe("network");
    });

    it("caches empty results as a valid cache entry", async () => {
        mockFetchAndParse.mockResolvedValue([]);

        await findMatchingFeaturesWithCache("hospital", tokyoCenter);
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCache(
            "hospital",
            tokyoCenter,
        );

        expect(result.source).toBe("memory");
        expect(result.candidates).toEqual([]);
        expect(mockFetchAndParse).not.toHaveBeenCalled();
    });

    it("force-refresh bypasses cache and fetches fresh data", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter);
        jest.clearAllMocks();

        const freshFeatures = [
            {
                lat: 35.69,
                lon: 139.78,
                name: "Refreshed Hospital",
                osmId: 99,
                osmType: "node" as const,
                tags: {},
            },
        ];
        mockFetchAndParse.mockResolvedValue(freshFeatures);

        const result = await findMatchingFeaturesWithCache(
            "hospital",
            tokyoCenter,
            { forceRefresh: true },
        );

        expect(result.source).toBe("network");
        expect(mockFetchAndParse).toHaveBeenCalledTimes(1);
        expect(result.candidates[0].name).toBe("Refreshed Hospital");
    });

    it("returns empty candidates for non-searchable categories", async () => {
        const result = await findMatchingFeaturesWithCache(
            "transit-line",
            tokyoCenter,
        );

        expect(result.candidates).toEqual([]);
        expect(mockFetchAndParse).not.toHaveBeenCalled();
    });

    it("does not share cache between different categories", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCache(
            "museum",
            tokyoCenter,
            {
                requestedRadiusMeters: 5000,
            },
        );

        expect(result.source).toBe("network");
        expect(mockFetchAndParse).toHaveBeenCalledTimes(1);
    });

    it("persists result to AsyncStorage for disk retrieval", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });

        const keys = await AsyncStorage.getAllKeys();
        const cacheKeys = keys.filter((k) =>
            k.startsWith("osm-matching-cache:"),
        );
        expect(cacheKeys.length).toBeGreaterThan(0);
    });

    it("writes a manifest entry after a network fetch", async () => {
        await findMatchingFeaturesWithCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });

        const raw = await AsyncStorage.getItem("osm-matching-manifest");
        expect(raw).not.toBeNull();
        const manifest = JSON.parse(raw!);
        expect(manifest.rows.length).toBeGreaterThan(0);
        expect(manifest.rows[0].category).toBe("hospital");
    });

    it("candidates are sorted by distance from center", async () => {
        const result = await findMatchingFeaturesWithCache(
            "hospital",
            tokyoCenter,
        );

        for (let i = 1; i < result.candidates.length; i++) {
            expect(result.candidates[i - 1].distanceMeters).toBeLessThanOrEqual(
                result.candidates[i].distanceMeters,
            );
        }
    });
});

// ─── Grid system ──────────────────────────────────────────────────────────────

describe("cellIndex", () => {
    it("produces deterministic indices for the same coordinate", () => {
        const a = cellIndex(35.681236, 139.767125);
        const b = cellIndex(35.681236, 139.767125);
        expect(a).toBe(b);
    });

    it("rounds coordinates down to the cell origin", () => {
        // 139.767125 / 0.1 = 1397.67125 → floor = 1397
        // 35.681236 / 0.1 = 356.81236  → floor = 356
        expect(cellIndex(35.681236, 139.767125)).toBe("1397:356");
    });

    it("produces different indices for different cells", () => {
        // One full cell east (~10 km at equator).
        expect(cellIndex(35.68, 139.76)).not.toBe(cellIndex(35.68, 140.0));
    });

    it("rounds down across integer boundaries", () => {
        expect(cellIndex(0.0, 0.0)).toBe("0:0");
        expect(cellIndex(-0.001, -0.001)).toBe("-1:-1");
    });
});

describe("cellBbox", () => {
    it("returns correct bbox for a cell index", () => {
        const bbox = cellBbox("1397:356");
        expect(bbox.west).toBeCloseTo(139.7, 10);
        expect(bbox.south).toBeCloseTo(35.6, 10);
        expect(bbox.east).toBeCloseTo(139.8, 10);
        expect(bbox.north).toBeCloseTo(35.7, 10);
    });

    it("is reversible with cellIndex", () => {
        const bbox = cellBbox("1397:356");
        const centerLat = (bbox.south + bbox.north) / 2;
        const centerLon = (bbox.west + bbox.east) / 2;
        expect(cellIndex(centerLat, centerLon)).toBe("1397:356");
    });

    it("handles negative cell indices", () => {
        const bbox = cellBbox("-1:-1");
        expect(bbox.west).toBe(-0.1);
        expect(bbox.south).toBe(-0.1);
        expect(bbox.east).toBe(0.0);
        expect(bbox.north).toBe(0.0);
    });

    it("throws for malformed input", () => {
        expect(() => cellBbox("")).toThrow();
        expect(() => cellBbox("abc")).toThrow();
        expect(() => cellBbox("1:2:3")).not.toThrow(); // valid, extra ignored by split
    });
});

describe("cellsForSearch", () => {
    it("returns at least one cell for any search", () => {
        const cells = cellsForSearch(35.68, 139.76, 100);
        expect(cells.length).toBeGreaterThanOrEqual(1);
    });

    it("returns more cells for larger radii", () => {
        const small = cellsForSearch(35.68, 139.76, 100);
        const large = cellsForSearch(35.68, 139.76, 50_000);
        expect(large.length).toBeGreaterThanOrEqual(small.length);
    });

    it("union of returned cell bboxes covers the search circle bounding square", () => {
        const lat = 35.68;
        const lon = 139.76;
        const radius = 10_000;

        const cells = cellsForSearch(lat, lon, radius);

        // Compute the bounding square of the search circle.
        const dLat = metersToDegreesLat(radius);
        const dLon = metersToDegreesLon(lat, radius);
        const minLat = lat - dLat;
        const maxLat = lat + dLat;
        const minLon = lon - dLon;
        const maxLon = lon + dLon;

        // Check that the union of cell bboxes covers the bounding square.
        let unionWest = Number.POSITIVE_INFINITY;
        let unionSouth = Number.POSITIVE_INFINITY;
        let unionEast = Number.NEGATIVE_INFINITY;
        let unionNorth = Number.NEGATIVE_INFINITY;

        for (const cellId of cells) {
            const bbox = cellBbox(cellId);
            if (bbox.west < unionWest) unionWest = bbox.west;
            if (bbox.south < unionSouth) unionSouth = bbox.south;
            if (bbox.east > unionEast) unionEast = bbox.east;
            if (bbox.north > unionNorth) unionNorth = bbox.north;
        }

        expect(unionWest).toBeLessThanOrEqual(minLon + 1e-9);
        expect(unionSouth).toBeLessThanOrEqual(minLat + 1e-9);
        expect(unionEast).toBeGreaterThanOrEqual(maxLon - 1e-9);
        expect(unionNorth).toBeGreaterThanOrEqual(maxLat - 1e-9);
    });

    it("returns same cells for nearby center within same cell", () => {
        const cells1 = cellsForSearch(35.681, 139.767, 1000);
        const cells2 = cellsForSearch(35.682, 139.768, 1000);
        expect(cells1).toEqual(cells2);
    });
});

// ─── deduplicateFeatures ──────────────────────────────────────────────────────

describe("deduplicateFeatures", () => {
    it("removes duplicate features by (osmType, osmId)", () => {
        const dups = [
            {
                lat: 35.0,
                lon: 139.0,
                name: "A",
                osmId: 1,
                osmType: "node" as const,
                tags: {},
            },
            {
                lat: 35.1,
                lon: 139.1,
                name: "B",
                osmId: 2,
                osmType: "node" as const,
                tags: {},
            },
            {
                lat: 35.0,
                lon: 139.0,
                name: "A",
                osmId: 1,
                osmType: "node" as const,
                tags: {},
            },
        ];
        const result = deduplicateFeatures(dups);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("A");
    });

    it("keeps features with different osmIds even with the same name", () => {
        const features = [
            {
                lat: 35.0,
                lon: 139.0,
                name: "Same",
                osmId: 1,
                osmType: "node" as const,
                tags: {},
            },
            {
                lat: 35.1,
                lon: 139.1,
                name: "Same",
                osmId: 2,
                osmType: "node" as const,
                tags: {},
            },
        ];
        expect(deduplicateFeatures(features)).toHaveLength(2);
    });

    it("distinguishes node vs way with the same id", () => {
        const features = [
            {
                lat: 35.0,
                lon: 139.0,
                name: "A",
                osmId: 1,
                osmType: "node" as const,
                tags: {},
            },
            {
                lat: 35.1,
                lon: 139.1,
                name: "A",
                osmId: 1,
                osmType: "way" as const,
                tags: {},
            },
        ];
        expect(deduplicateFeatures(features)).toHaveLength(2);
    });
});

// ─── findMatchingFeaturesWithCellCache ────────────────────────────────────────

describe("findMatchingFeaturesWithCellCache", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await resetAll();
        mockFetchAndParseBbox.mockResolvedValue(hospitalFeatures);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("fetches missing cells from network on first call", async () => {
        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            tokyoCenter,
            { requestedRadiusMeters: 5000 },
        );

        expect(result.source).toBe("network");
        expect(result.candidates.length).toBeGreaterThan(0);
        // At least one cell fetch should have occurred.
        expect(mockFetchAndParseBbox).toHaveBeenCalled();
    });

    it("returns memory hit on second call without another network request", async () => {
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            tokyoCenter,
            { requestedRadiusMeters: 5000 },
        );

        expect(result.source).toBe("memory");
        expect(mockFetchAndParseBbox).not.toHaveBeenCalled();
    });

    it("serves nearby center from cached cells without network request", async () => {
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            nearTokyoCenter,
            { requestedRadiusMeters: 5000 },
        );

        // Same cells needed, should be cached.
        expect(result.source).toBe("memory");
        expect(mockFetchAndParseBbox).not.toHaveBeenCalled();
    });

    it("fetches only missing cells when search covers more cells", async () => {
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        jest.clearAllMocks();

        // Search with a larger radius that needs additional cells.
        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            tokyoCenter,
            { requestedRadiusMeters: 100_000 },
        );

        expect(result.source).toBe("network");
        // Some cells were already cached, should fetch the missing ones.
        expect(mockFetchAndParseBbox).toHaveBeenCalled();
    });

    it("persists cell results to AsyncStorage for disk retrieval", async () => {
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });

        const keys = await AsyncStorage.getAllKeys();
        const cellKeys = keys.filter((k) =>
            k.startsWith("osm-matching-cache:cell:"),
        );
        expect(cellKeys.length).toBeGreaterThan(0);
    });

    it("writes a cell manifest entry after a network fetch", async () => {
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });

        const raw = await AsyncStorage.getItem("osm-matching-manifest:cell");
        expect(raw).not.toBeNull();
        const manifest = JSON.parse(raw!);
        expect(manifest.rows.length).toBeGreaterThan(0);
        expect(manifest.rows[0].category).toBe("hospital");
    });

    it("returns disk hit after memory is cleared", async () => {
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        // Flush memory but keep AsyncStorage.
        await clearOsmMatchingCellMemoryCache();
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            tokyoCenter,
            { requestedRadiusMeters: 5000 },
        );

        expect(result.source).toBe("disk");
        expect(mockFetchAndParseBbox).not.toHaveBeenCalled();
    });

    it("returns empty candidates for non-searchable categories", async () => {
        const result = await findMatchingFeaturesWithCellCache(
            "transit-line",
            tokyoCenter,
        );

        expect(result.candidates).toEqual([]);
        expect(mockFetchAndParseBbox).not.toHaveBeenCalled();
    });

    it("candidates are sorted by distance from center", async () => {
        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            tokyoCenter,
            { requestedRadiusMeters: 5000 },
        );

        for (let i = 1; i < result.candidates.length; i++) {
            expect(result.candidates[i - 1].distanceMeters).toBeLessThanOrEqual(
                result.candidates[i].distanceMeters,
            );
        }
    });

    it("deduplicates features when cells overlap at boundaries", async () => {
        // Mock bbox fetch to return overlapping features (same osmId across cells).
        const overlappingFeatures = [
            {
                lat: 35.685,
                lon: 139.77,
                name: "Hospital A",
                osmId: 1,
                osmType: "node" as const,
                tags: {},
            },
        ];
        mockFetchAndParseBbox.mockResolvedValue(overlappingFeatures);

        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            tokyoCenter,
            { requestedRadiusMeters: 100_000 },
        );

        // Even though each cell returns the same feature, the merged result
        // should only contain it once due to deduplication.
        expect(
            result.candidates.filter((c) => c.name === "Hospital A"),
        ).toHaveLength(1);
    });

    it("does not share cell cache between different categories", async () => {
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCellCache(
            "museum",
            tokyoCenter,
            { requestedRadiusMeters: 5000 },
        );

        expect(result.source).toBe("network");
        expect(mockFetchAndParseBbox).toHaveBeenCalled();
    });

    it("deduplicates simultaneous in-flight cell requests for the same cell", async () => {
        // Use a tiny radius so only 1 cell is needed → in-flight dedup per cell
        // becomes effectively per-search.
        let resolveFirst!: (value: typeof hospitalFeatures) => void;
        mockFetchAndParseBbox.mockReturnValue(
            new Promise((resolve) => {
                resolveFirst = resolve;
            }),
        );

        const p1 = findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 1,
        });
        const p2 = findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 1,
        });

        resolveFirst(hospitalFeatures);
        const [r1, r2] = await Promise.all([p1, p2]);

        // Only one cell fetch should have been made.
        expect(mockFetchAndParseBbox).toHaveBeenCalledTimes(1);
        expect(r1.source).toBe("network");
        expect(r2.source).toBe("network");
    });

    it("returns stale result and triggers background refresh when TTL exceeded", async () => {
        // Use a tiny radius so only 1 cell is cached.
        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 1,
        });
        mockFetchAndParseBbox.mockClear();

        // Age past TTL.
        jest.spyOn(Date, "now").mockReturnValue(
            Date.now() + MATCHING_CACHE_TTL_MS + 1,
        );

        const freshFeatures = [
            {
                lat: 35.69,
                lon: 139.78,
                name: "New Hospital",
                osmId: 99,
                osmType: "node" as const,
                tags: {},
            },
        ];
        mockFetchAndParseBbox.mockResolvedValue(freshFeatures);

        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            tokyoCenter,
            { requestedRadiusMeters: 1 },
        );

        expect(result.source).toBe("stale");
        // Returns old candidates immediately.
        expect(result.candidates.some((c) => c.name === "Tokyo Hospital")).toBe(
            true,
        );

        // Let background refresh complete.
        await Promise.resolve();
        await Promise.resolve();

        expect(mockFetchAndParseBbox).toHaveBeenCalledTimes(1);
        jest.spyOn(Date, "now").mockRestore();
    });

    it("caches empty results as a valid cell cache entry", async () => {
        mockFetchAndParseBbox.mockResolvedValue([]);

        await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
            requestedRadiusMeters: 5000,
        });
        jest.clearAllMocks();

        const result = await findMatchingFeaturesWithCellCache(
            "hospital",
            tokyoCenter,
            { requestedRadiusMeters: 5000 },
        );

        expect(result.source).toBe("memory");
        expect(result.candidates).toEqual([]);
        expect(mockFetchAndParseBbox).not.toHaveBeenCalled();
    });
});

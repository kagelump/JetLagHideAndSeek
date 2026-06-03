import {
    searchCoversBbox,
    searchMatchingFeaturesProgressive,
} from "@/features/questions/matching/progressiveSearch";

let mockFindMatchingFeaturesWithCellCache: jest.Mock;

jest.mock("@/features/questions/matching/osmMatchingCache", () => ({
    findMatchingFeaturesWithCellCache: (...args: unknown[]) =>
        mockFindMatchingFeaturesWithCellCache(...args),
}));

// Helper to build a minimal candidate object for tests.
function candidate(id: number, distance = id * 100) {
    return {
        distanceMeters: distance,
        lat: 35.68 + id * 0.001,
        lon: 139.76 + id * 0.001,
        name: `POI ${id}`,
        osmId: id,
        osmType: "node" as const,
        tags: {},
    };
}

function nCandidates(n: number) {
    return Array.from({ length: n }, (_, i) => candidate(i + 1));
}

const TOKYO_BBOX: [number, number, number, number] = [
    139.6, 35.55, 139.9, 35.8,
];

const TOKYO_CENTER: [number, number] = [139.75, 35.675];

describe("searchCoversBbox", () => {
    it("returns true when all bbox corners are within the radius", () => {
        // From Tokyo center, 50 km easily covers the Tokyo bbox.
        expect(searchCoversBbox(139.75, 35.675, 50_000, TOKYO_BBOX)).toBe(true);
    });

    it("returns false when a bbox corner is outside the radius", () => {
        // 1 km from Tokyo center does NOT cover the bbox.
        expect(searchCoversBbox(139.75, 35.675, 1_000, TOKYO_BBOX)).toBe(false);
    });

    it("returns false when exactly one corner is outside", () => {
        // The south-west corner of Tokyo bbox is ~18 km from center.
        // A radius of 17 km should miss it.
        expect(searchCoversBbox(139.75, 35.675, 17_000, TOKYO_BBOX)).toBe(
            false,
        );
    });
});

describe("searchMatchingFeaturesProgressive", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ── Initial radius ──────────────────────────────────────────────

    it("starts search at stationRadius * 2", async () => {
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({ candidates: [], source: "network" });

        await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            600,
            TOKYO_BBOX,
        );

        expect(mockFindMatchingFeaturesWithCellCache).toHaveBeenCalledWith(
            "park",
            TOKYO_CENTER,
            expect.objectContaining({ requestedRadiusMeters: 1200 }),
        );
    });

    it("floors initial radius at MIN_INITIAL_RADIUS_METERS when stationRadius is 0", async () => {
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({ candidates: [], source: "network" });

        await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            0,
            TOKYO_BBOX,
        );

        expect(mockFindMatchingFeaturesWithCellCache).toHaveBeenCalledWith(
            "park",
            TOKYO_CENTER,
            expect.objectContaining({ requestedRadiusMeters: 1200 }),
        );
    });

    // ── Doubling ────────────────────────────────────────────────────

    it("doubles radius on each iteration when no stop condition met", async () => {
        // Return 3 candidates each time — never triggers the "> 10" stop.
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({
                candidates: nCandidates(3),
                source: "network",
            });

        // Use a huge far-away bbox so the encompass check fails at all radii.
        const farBbox: [number, number, number, number] = [
            -74.05, 40.68, -73.93, 40.88,
        ];

        await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            600,
            farBbox,
        );

        const calls = mockFindMatchingFeaturesWithCellCache.mock.calls;
        const radii = calls.map(
            (c) =>
                (c[2] as { requestedRadiusMeters: number })
                    .requestedRadiusMeters,
        );
        expect(radii).toEqual([
            1200, 2400, 4800, 9600, 19200, 38400, 76800, 153600, 200000,
        ]);
        // 153600 * 2 = 307200 → capped at 200000 for the final iteration.
        expect(radii[radii.length - 1]).toBe(200000);
    });

    // ── Stop when > 10 candidates ───────────────────────────────────

    it("stops when more than 10 candidates found", async () => {
        const few = nCandidates(3);
        const many = nCandidates(11);
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValueOnce({ candidates: few, source: "network" })
            .mockResolvedValueOnce({ candidates: few, source: "network" })
            .mockResolvedValueOnce({ candidates: many, source: "network" });

        const result = await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            600,
            null,
        );

        expect(result.candidates).toHaveLength(11);
        // Third call stops because > 10; no fourth call.
        expect(mockFindMatchingFeaturesWithCellCache).toHaveBeenCalledTimes(3);
        const lastRadius =
            mockFindMatchingFeaturesWithCellCache.mock.calls[2][2]
                .requestedRadiusMeters;
        expect(lastRadius).toBe(4800);
    });

    it("stops on first iteration when initial radius already yields > 10", async () => {
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({
                candidates: nCandidates(15),
                source: "network",
            });

        await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            600,
            null,
        );

        expect(mockFindMatchingFeaturesWithCellCache).toHaveBeenCalledTimes(1);
    });

    // ── Radius filtering (issue #1 fix) ───────────────────────────────

    it("filters out candidates beyond the effectiveRadius", async () => {
        // Use a stationRadius large enough that the initial search disk
        // (50 km) covers the Tokyo bbox — stops on encompass at iteration 1.
        const near = nCandidates(5); // distances 100–500
        const far = [
            candidate(6, 80_000),
            candidate(7, 120_000),
            candidate(8, 180_000),
        ];

        mockFindMatchingFeaturesWithCellCache = jest.fn().mockResolvedValue({
            candidates: [...near, ...far],
            source: "network",
        });

        const result = await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            25_000, // initial radius = 50 km, covers Tokyo
            TOKYO_BBOX,
        );

        // Only the 5 near candidates (within 50 km) should survive.
        expect(result.candidates).toHaveLength(5);
        const names = result.candidates.map((c) => c.name).sort();
        expect(names).toEqual(["POI 1", "POI 2", "POI 3", "POI 4", "POI 5"]);
        // The 3 far candidates must not appear.
        expect(names).not.toContain("POI 6");
        expect(names).not.toContain("POI 7");
        expect(names).not.toContain("POI 8");
    });

    it("counts only in-radius items for the > 10 stop condition", async () => {
        // Return 15 candidates total: only 3 are within the initial 1200 m
        // radius; the rest are 5 km+ away. The > 10 check must not fire at
        // iteration 1 — only 3 are in-radius.
        const threeNear = nCandidates(3); // distances 100, 200, 300
        const twelveFar = Array.from({ length: 12 }, (_, i) =>
            candidate(i + 4, 5_000 + i * 100),
        ); // distances 5000–6100

        const farBbox: [number, number, number, number] = [
            -74.05, 40.68, -73.93, 40.88,
        ];

        // Use mockResolvedValue (not Once) so every iteration gets the same
        // set — the loop continues until the hard cap because at 1200 m only
        // 3 are in-radius and the farBbox never enables the encompass check.
        mockFindMatchingFeaturesWithCellCache = jest.fn().mockResolvedValue({
            candidates: [...threeNear, ...twelveFar],
            source: "network",
        });

        const result = await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            600,
            farBbox,
        );

        // The loop must have made more than 1 call — proving it did NOT stop
        // at iteration 1 on the raw (unfiltered) count of 15.
        expect(
            mockFindMatchingFeaturesWithCellCache.mock.calls.length,
        ).toBeGreaterThan(1);

        // At the final radius (200 km) all 15 candidates are in-radius.
        expect(result.candidates).toHaveLength(15);
    });

    // ── Stop when search covers play area ───────────────────────────

    it("stops when radius encompasses entire play area", async () => {
        // 50 km from center easily covers Tokyo bbox.
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({
                candidates: nCandidates(3),
                source: "network",
            });

        // Start with stationRadius = 25000 so initial radius = 50000 which
        // covers the Tokyo bbox.
        const result = await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            25_000,
            TOKYO_BBOX,
        );

        expect(mockFindMatchingFeaturesWithCellCache).toHaveBeenCalledTimes(1);
        expect(result.searchRadiusMeters).toBe(50_000);
    });

    it("encompass check wins over item count when both satisfied", async () => {
        // Both conditions met on the same iteration — encompass check is
        // evaluated first and breaks immediately.
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({
                candidates: nCandidates(15),
                source: "network",
            });

        const result = await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            25_000,
            TOKYO_BBOX,
        );

        expect(mockFindMatchingFeaturesWithCellCache).toHaveBeenCalledTimes(1);
        expect(result.searchRadiusMeters).toBe(50_000);
    });

    // ── playAreaBbox = null ─────────────────────────────────────────

    it("skips encompass check when playAreaBbox is null", async () => {
        // Return 4 candidates each time; stop condition is only item count.
        // With bbox=null and <10 items, it keeps doubling until the hard cap.
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({
                candidates: nCandidates(5),
                source: "network",
            });

        await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            600,
            null,
        );

        // Should continue until the 200 km hard cap is reached.
        const calls = mockFindMatchingFeaturesWithCellCache.mock.calls;
        expect(calls.length).toBeGreaterThan(1);
    });

    // ── Hard cap ────────────────────────────────────────────────────

    it("caps the search radius at PROGRESSIVE_MAX_RADIUS_METERS", async () => {
        // Return 1 candidate at every radius so it never stops on count.
        // Use a far-away bbox so it never stops on encompass.
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({
                candidates: nCandidates(1),
                source: "network",
            });

        const farBbox: [number, number, number, number] = [
            -74.05, 40.68, -73.93, 40.88,
        ];

        const result = await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            1, // tiny -> floor at 1200
            farBbox,
        );

        // Final radius should be 200_000.
        expect(result.searchRadiusMeters).toBe(200_000);
    });

    // ── Abort signal ────────────────────────────────────────────────

    it("throws AbortError when signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({ candidates: [], source: "network" });

        let caught: unknown = null;
        try {
            await searchMatchingFeaturesProgressive(
                "park",
                TOKYO_CENTER,
                600,
                TOKYO_BBOX,
                { signal: controller.signal },
            );
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).name).toBe("AbortError");
        expect((caught as Error).message).toBe("Aborted");
    });

    // ── forceRefresh ────────────────────────────────────────────────

    it("passes forceRefresh through to the cache layer", async () => {
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({
                candidates: nCandidates(15),
                source: "network",
            });

        await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            600,
            null,
            { forceRefresh: true },
        );

        expect(mockFindMatchingFeaturesWithCellCache).toHaveBeenCalledWith(
            "park",
            TOKYO_CENTER,
            expect.objectContaining({ forceRefresh: true }),
        );
    });

    // ── Returns source ──────────────────────────────────────────────

    it("returns the cache source from the final iteration", async () => {
        mockFindMatchingFeaturesWithCellCache = jest
            .fn()
            .mockResolvedValue({ candidates: nCandidates(3), source: "disk" });

        const result = await searchMatchingFeaturesProgressive(
            "park",
            TOKYO_CENTER,
            25_000,
            TOKYO_BBOX,
        );

        expect(result.source).toBe("disk");
    });
});

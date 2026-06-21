/**
 * Tests for boundaryStore — offline boundary search and polygon loading.
 *
 * Covers:
 * - normalizeForSearch: cross-format fixture consistency with pipeline
 * - searchBoundaries: ranking (exact > prefix > substring, adminLevel, area)
 * - registerBoundarySource / unregisterBoundarySource lifecycle
 * - getBoundaryPolygon: decode + LRU cache
 * - findBoundaryRelation, anyPackIntersectsBbox, getAllBoundaryEntries
 *
 * Uses the global jest.setup.ts expo-file-system mock — tests set up
 * __fsCache entries before calling async polygon loaders.
 */

import {
    normalizeForSearch,
    searchBoundaries,
    registerBoundarySource,
    unregisterBoundarySource,
    getBoundaryPolygon,
    findBoundaryRelation,
    anyPackIntersectsBbox,
    getRegisteredBoundaryPackIds,
    getAvailableBoundaryLevels,
    getBoundaryLevelCounts,
    resetBoundaryStore,
    getAllBoundaryEntries,
} from "../boundaryStore";
import type { BoundaryIndexEntry } from "../boundaryStore";

// ─── Helpers ────────────────────────────────────────────────────────────

const makeEntry = (
    overrides: Partial<BoundaryIndexEntry> & {
        name: string;
        adminLevel: number;
    },
): BoundaryIndexEntry => ({
    relationId: overrides.relationId ?? 12345,
    name: overrides.name,
    adminLevel: overrides.adminLevel,
    centroid: overrides.centroid ?? [5.0, 52.0],
    bbox: overrides.bbox ?? [4.0, 51.0, 6.0, 53.0],
    areaKm2: overrides.areaKm2 ?? 1000,
    nameEn: overrides.nameEn,
    normalized: overrides.normalized ?? [normalizeForSearch(overrides.name)],
});

beforeEach(() => {
    resetBoundaryStore();
});

// ─── normalizeForSearch: cross-format fixture ───────────────────────────

describe("normalizeForSearch", () => {
    // These fixtures MUST match the pipeline's normalizeNames.test.mjs
    // CROSS_FORMAT_FIXTURES exactly. If either side changes, both must
    // be updated together.
    const FIXTURES: [string, string][] = [
        ["Amsterdam", "amsterdam"],
        ["Den Haag", "den haag"],
        ["São Paulo", "sao paulo"],
        ["München", "munchen"],
        ["Düsseldorf", "dusseldorf"],
        ["東京", "東京"],
        ["北海道", "北海道"],
        ["東京都 Tokyo", "東京都 tokyo"],
        ["が", "が"],
        ["", ""],
    ];

    it.each(FIXTURES)('normalizes "%s" → "%s"', (input, expected) => {
        expect(normalizeForSearch(input)).toBe(expected);
    });

    it("strips only U+0300–U+036F, preserves dakuten", () => {
        expect(normalizeForSearch("が")).toBe("が");
    });
});

// ─── searchBoundaries ───────────────────────────────────────────────────

describe("searchBoundaries", () => {
    it("returns empty for empty/whitespace query", () => {
        registerBoundarySource(
            "p",
            "/i.json",
            "/p.json",
            [makeEntry({ name: "A", adminLevel: 7 })],
            [7],
        );
        expect(searchBoundaries("")).toEqual([]);
        expect(searchBoundaries("   ")).toEqual([]);
    });

    it("finds exact match by name", () => {
        registerBoundarySource(
            "p",
            "/i.json",
            "/p.json",
            [makeEntry({ name: "Amsterdam", adminLevel: 7 })],
            [7],
        );
        const hits = searchBoundaries("Amsterdam");
        expect(hits).toHaveLength(1);
        expect(hits[0].name).toBe("Amsterdam");
        expect(hits[0].source).toBe("pack");
    });

    it("finds by normalized query", () => {
        registerBoundarySource(
            "p",
            "/i.json",
            "/p.json",
            [
                makeEntry({
                    name: "München",
                    adminLevel: 7,
                    normalized: ["munchen"],
                }),
            ],
            [7],
        );
        expect(searchBoundaries("münchen")).toHaveLength(1);
    });

    it("ranks exact > prefix > substring", () => {
        registerBoundarySource(
            "p",
            "/i.json",
            "/p.json",
            [
                makeEntry({
                    relationId: 1,
                    name: "Amsterdam Centrum",
                    adminLevel: 9,
                    normalized: ["amsterdam centrum"],
                }),
                makeEntry({
                    relationId: 2,
                    name: "Amsterdam",
                    adminLevel: 7,
                    normalized: ["amsterdam"],
                }),
                makeEntry({
                    relationId: 3,
                    name: "Amsterdam-Noord",
                    adminLevel: 9,
                    normalized: ["amsterdam-noord"],
                }),
            ],
            [7, 9],
        );
        const hits = searchBoundaries("Amsterdam");
        // Exact match first.
        expect(hits[0].name).toBe("Amsterdam");
        expect(hits[0].relationId).toBe(2);
    });

    it("ranks by adminLevel when match rank is equal", () => {
        registerBoundarySource(
            "p",
            "/i.json",
            "/p.json",
            [
                makeEntry({ relationId: 1, name: "Utrecht", adminLevel: 9 }),
                makeEntry({ relationId: 2, name: "Utrecht", adminLevel: 7 }),
            ],
            [7, 9],
        );
        const hits = searchBoundaries("Utrecht");
        expect(hits).toHaveLength(2);
        expect(hits[0].adminLevel).toBeLessThan(hits[1].adminLevel);
    });

    it("ranks by area (larger first) when same adminLevel", () => {
        registerBoundarySource(
            "p",
            "/i.json",
            "/p.json",
            [
                makeEntry({
                    relationId: 1,
                    name: "Utrecht",
                    adminLevel: 7,
                    areaKm2: 100,
                }),
                makeEntry({
                    relationId: 2,
                    name: "Utrecht",
                    adminLevel: 7,
                    areaKm2: 5000,
                }),
            ],
            [7],
        );
        const hits = searchBoundaries("Utrecht");
        expect(hits).toHaveLength(2);
        // Larger area first.
        expect(hits[0].relationId).toBe(2);
    });

    it("searches across multiple packs", () => {
        registerBoundarySource(
            "p1",
            "/i1.json",
            "/p1.json",
            [makeEntry({ relationId: 1, name: "Groningen", adminLevel: 7 })],
            [7],
        );
        registerBoundarySource(
            "p2",
            "/i2.json",
            "/p2.json",
            [makeEntry({ relationId: 2, name: "Maastricht", adminLevel: 7 })],
            [7],
        );
        expect(searchBoundaries("Groningen")).toHaveLength(1);
        expect(searchBoundaries("Maastricht")).toHaveLength(1);
    });

    it("caps at 20 results", () => {
        const many = Array.from({ length: 30 }, (_, i) =>
            makeEntry({ relationId: i, name: `Place ${i}`, adminLevel: 7 }),
        );
        registerBoundarySource("p", "/i.json", "/p.json", many, [7]);
        expect(searchBoundaries("Place").length).toBeLessThanOrEqual(20);
    });

    it("matches by nameEn variant", () => {
        registerBoundarySource(
            "p",
            "/i.json",
            "/p.json",
            [
                makeEntry({
                    relationId: 1,
                    name: "東京",
                    nameEn: "Tokyo",
                    adminLevel: 7,
                    normalized: ["東京", "tokyo"],
                }),
            ],
            [7],
        );
        expect(searchBoundaries("tokyo")).toHaveLength(1);
    });
});

// ─── Source lifecycle ───────────────────────────────────────────────────

describe("boundary source lifecycle", () => {
    const e: BoundaryIndexEntry = makeEntry({
        relationId: 42,
        name: "Test",
        adminLevel: 7,
    });

    it("registers and unregisters", () => {
        registerBoundarySource("p1", "/i.json", "/p.json", [e], [7]);
        expect(getRegisteredBoundaryPackIds()).toContain("p1");
        expect(getAvailableBoundaryLevels()).toEqual([7]);

        unregisterBoundarySource("p1");
        expect(getRegisteredBoundaryPackIds()).not.toContain("p1");
        expect(getAvailableBoundaryLevels()).toEqual([]);
    });

    it("merges levels across sources", () => {
        registerBoundarySource("p1", "/i.json", "/p.json", [e], [4, 7]);
        registerBoundarySource("p2", "/i2.json", "/p2.json", [e], [9, 10]);
        expect(getAvailableBoundaryLevels()).toEqual([4, 7, 9, 10]);
    });

    it("findBoundaryRelation", () => {
        registerBoundarySource("px", "/i.json", "/p.json", [e], [7]);
        expect(findBoundaryRelation(42)!.packId).toBe("px");
        expect(findBoundaryRelation(999)).toBeNull();
    });

    it("anyPackIntersectsBbox", () => {
        registerBoundarySource("p1", "/i.json", "/p.json", [e], [7]);
        expect(anyPackIntersectsBbox([3, 50, 7, 54])).toBe(true);
        expect(anyPackIntersectsBbox([0, 0, 1, 1])).toBe(false);
    });

    it("getAllBoundaryEntries collects across packs", () => {
        registerBoundarySource("p1", "/i.json", "/p.json", [e], [7]);
        registerBoundarySource(
            "p2",
            "/i2.json",
            "/p2.json",
            [e, { ...e, relationId: 43 }],
            [7],
        );
        expect(getAllBoundaryEntries()).toHaveLength(3);
    });

    it("getBoundaryLevelCounts tallies index entries per level", () => {
        registerBoundarySource(
            "p1",
            "/i.json",
            "/p.json",
            [
                makeEntry({ relationId: 1, name: "A", adminLevel: 4 }),
                makeEntry({ relationId: 2, name: "B", adminLevel: 7 }),
                makeEntry({ relationId: 3, name: "C", adminLevel: 7 }),
            ],
            [4, 7],
        );
        expect(getBoundaryLevelCounts()).toEqual({ 4: 1, 7: 2 });
    });
});

// ─── Polygon loading ────────────────────────────────────────────────────

describe("getBoundaryPolygon", () => {
    it("returns null for unknown pack", async () => {
        expect(await getBoundaryPolygon("nonexistent", 1)).toBeNull();
    });

    it("returns null for unknown relation in known pack", async () => {
        registerBoundarySource(
            "p1",
            "/mock/i.json",
            "/mock/p.json",
            [makeEntry({ relationId: 42, name: "Test", adminLevel: 7 })],
            [7],
        );
        expect(await getBoundaryPolygon("p1", 999)).toBeNull();
    });

    // TODO: re-enable once dynamic import mock is working in Jest.
    // The jest.setup.ts mock provides File, but await import("expo-file-system")
    // in getBoundaryPolygon doesn't resolve to the mock.
    it.todo("decodes polygon from file and caches in LRU");
});

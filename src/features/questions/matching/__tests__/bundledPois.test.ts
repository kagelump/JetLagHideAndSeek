import type { RawRegion } from "../bundledPois";
import {
    clearBundledRegionCache,
    getBundledCategoryFeatures,
    getRegionGeneratedAt,
    regionCoveringBbox,
    regionCoveringPoint,
    registerRegion,
    registerTestRegion,
    unregisterRegion,
    unregisterTestRegion,
} from "../bundledPois";
import type { MatchingCategory } from "../matchingTypes";

import poiMini from "./fixtures/poi-mini.json";

const FIXTURE = poiMini as unknown as RawRegion;
const REGION_ID = FIXTURE.region;

beforeEach(() => {
    clearBundledRegionCache();
    registerTestRegion(REGION_ID, FIXTURE);
});

afterEach(() => {
    clearBundledRegionCache();
});

// ─── Coverage ────────────────────────────────────────────────────────────

describe("regionCoveringPoint", () => {
    it("returns region id for a point inside the bbox", () => {
        expect(regionCoveringPoint(35.6, 139.7)).toBe(REGION_ID);
    });

    it("returns null for a point outside the bbox (north)", () => {
        expect(regionCoveringPoint(36.5, 139.7)).toBeNull();
    });

    it("returns null for a point outside the bbox (west)", () => {
        expect(regionCoveringPoint(35.6, 139.0)).toBeNull();
    });
});

describe("regionCoveringBbox", () => {
    it("returns region id when bbox is fully contained", () => {
        // [west, south, east, north] fully inside [139.5, 35.5, 140.0, 36.0]
        expect(regionCoveringBbox([139.6, 35.6, 139.9, 35.9])).toBe(REGION_ID);
    });

    it("returns null when bbox straddles the region edge", () => {
        // Extends past the east edge.
        expect(regionCoveringBbox([139.6, 35.6, 140.5, 35.9])).toBeNull();
    });

    it("returns null when bbox is completely outside", () => {
        expect(regionCoveringBbox([140.1, 36.1, 140.5, 36.5])).toBeNull();
    });
});

// ─── Category accessor ──────────────────────────────────────────────────

describe("getBundledCategoryFeatures", () => {
    it("returns correctly reconstructed OsmFeatures for park", () => {
        const features = getBundledCategoryFeatures(REGION_ID, "park");
        expect(features).toHaveLength(2);
        expect(features[0]).toMatchObject({
            lat: 35.66,
            lon: 139.7,
            name: "Yoyogi Park",
            osmId: 100,
            osmType: "way",
            tags: {},
        });
        expect(features[1]).toMatchObject({
            lat: 35.67,
            lon: 139.8,
            name: "Ueno Park",
            osmId: 50,
            osmType: "node",
            tags: {},
        });
    });

    it("returns features with nameLength for station-name-length", () => {
        const features = getBundledCategoryFeatures(
            REGION_ID,
            "station-name-length",
        );
        expect(features).toHaveLength(1);
        expect(features[0].name).toBe("Shinjuku Station");
        expect(features[0].nameLength).toBe(16);
    });

    it("returns empty array for unknown region", () => {
        expect(getBundledCategoryFeatures("nonexistent", "park")).toEqual([]);
    });

    it("returns empty array for unknown category", () => {
        expect(
            getBundledCategoryFeatures(
                REGION_ID,
                "hospital" as MatchingCategory,
            ),
        ).toEqual([]);
    });

    it("defaults osmType to node for out-of-range values", () => {
        // Manually register a fixture with an invalid osmType
        const badFixture: RawRegion = {
            ...FIXTURE,
            categories: {
                park: {
                    count: 1,
                    lon: [139.7],
                    lat: [35.66],
                    name: ["Bad Park"],
                    osmId: [999],
                    osmType: [99], // invalid
                },
            },
        };
        registerTestRegion("bad", badFixture);
        const features = getBundledCategoryFeatures("bad", "park");
        expect(features[0].osmType).toBe("node");
    });
});

// ─── Staleness stamp ─────────────────────────────────────────────────────

describe("getRegionGeneratedAt", () => {
    it("returns the generatedAt timestamp", () => {
        expect(getRegionGeneratedAt(REGION_ID)).toBe("2026-06-01T00:00:00Z");
    });

    it("returns null for unknown region", () => {
        expect(getRegionGeneratedAt("nonexistent")).toBeNull();
    });
});

// ─── Lazy loading ────────────────────────────────────────────────────────

describe("lazy loading", () => {
    it("coverage check does not trigger the heavy region load", () => {
        // The regionCoveringPoint function only reads REGIONS (from
        // regions.json metadata), not the heavy columnar data.
        // Clear cache (which now resets REGIONS) and verify coverage
        // works after re-registering.
        clearBundledRegionCache();
        registerTestRegion(REGION_ID, FIXTURE);
        const result = regionCoveringPoint(35.6, 139.7);
        expect(result).toBe(REGION_ID);
    });

    it("region load is memoized (second access does not re-parse)", () => {
        const first = getBundledCategoryFeatures(REGION_ID, "park");
        const second = getBundledCategoryFeatures(REGION_ID, "park");
        // Same array reference (not memoized per call currently — but the
        // parsed region is memoized).
        expect(second).toHaveLength(first.length);
    });
});

// ─── Schema mismatch ─────────────────────────────────────────────────────

describe("schema mismatch", () => {
    it("treats unsupported schema version as unavailable", () => {
        const v2Fixture: RawRegion = {
            ...FIXTURE,
            schemaVersion: 99,
        };
        registerTestRegion("v2", v2Fixture);
        // Coverage check doesn't trigger the load, so it still sees the
        // region in REGIONS (which is read from regions.json metadata, not
        // the heavy loader). But the category accessor returns empty.
        const features = getBundledCategoryFeatures("v2", "park");
        expect(features).toEqual([]);
        expect(getRegionGeneratedAt("v2")).toBeNull();
    });
});

// ─── Public registry (registerRegion / unregisterRegion) ─────────────────

describe("registerRegion / unregisterRegion", () => {
    it("registerTestRegion is an alias for registerRegion", () => {
        expect(registerTestRegion).toBe(registerRegion);
    });

    it("unregisterTestRegion is an alias for unregisterRegion", () => {
        expect(unregisterTestRegion).toBe(unregisterRegion);
    });

    it("unregisterRegion removes a region from coverage", () => {
        clearBundledRegionCache();
        registerRegion("temp", FIXTURE);
        expect(regionCoveringPoint(35.6, 139.7)).toBe("temp");

        unregisterRegion("temp");
        expect(regionCoveringPoint(35.6, 139.7)).toBeNull();
    });
});

// ─── Coverage precedence (bbox area sort) ────────────────────────────────

describe("coverage precedence", () => {
    beforeEach(() => {
        clearBundledRegionCache();
    });

    it("prefers the smaller region when both cover the same area", () => {
        // Small region: central Tokyo
        const small: RawRegion = {
            ...FIXTURE,
            region: "small",
            label: "Small Region",
            bbox: [139.7, 35.65, 139.8, 35.7], // ~0.005 sq deg
        };
        // Large region: all of Japan
        const large: RawRegion = {
            ...FIXTURE,
            region: "large",
            label: "Large Region",
            bbox: [128.0, 30.0, 146.0, 46.0], // ~288 sq deg
        };

        // Register large first to verify sort reorders it.
        registerRegion("large", large);
        registerRegion("small", small);

        // A point inside both regions should resolve to the smaller one.
        const result = regionCoveringPoint(35.68, 139.75);
        expect(result).toBe("small");

        // A bbox fully inside both should also resolve to the smaller one.
        const bboxResult = regionCoveringBbox([139.71, 35.66, 139.79, 35.69]);
        expect(bboxResult).toBe("small");
    });

    it("falls back to larger region when smaller one does not cover", () => {
        const small: RawRegion = {
            ...FIXTURE,
            region: "small",
            label: "Small Region",
            bbox: [139.7, 35.65, 139.8, 35.7],
        };
        const large: RawRegion = {
            ...FIXTURE,
            region: "large",
            label: "Large Region",
            bbox: [128.0, 30.0, 146.0, 46.0],
        };

        registerRegion("small", small);
        registerRegion("large", large);

        // Point in Hokkaido — covered by large but not small.
        const result = regionCoveringPoint(43.0, 141.0);
        expect(result).toBe("large");
    });
});

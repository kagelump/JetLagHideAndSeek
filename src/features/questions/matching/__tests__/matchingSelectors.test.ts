import { matchingCategories } from "../matchingCategories";
import type { MatchingCategory } from "../matchingTypes";
import {
    CATEGORY_SELECTORS,
    deriveOsmQueryTags,
    isBundleableCategory,
    selectorToOverpassTags,
    toTagsFilterArgs,
} from "../matchingSelectors";

// ─── selectorToOverpassTags ────────────────────────────────────────────────

describe("selectorToOverpassTags", () => {
    it("formats a single condition", () => {
        expect(
            selectorToOverpassTags([{ key: "leisure", value: "park" }]),
        ).toBe(`["leisure"="park"]`);
    });

    it("formats two ANDed conditions", () => {
        expect(
            selectorToOverpassTags([
                { key: "boundary", value: "administrative" },
                { key: "admin_level", value: "4" },
            ]),
        ).toBe(`["boundary"="administrative"]["admin_level"="4"]`);
    });

    it("formats a key-only condition (exists-style filter)", () => {
        expect(selectorToOverpassTags([{ key: "iata" }])).toBe(`["iata"]`);
    });

    it("formats mixed value and key-only conditions", () => {
        expect(
            selectorToOverpassTags([
                { key: "aeroway", value: "aerodrome" },
                { key: "iata" },
            ]),
        ).toBe(`["aeroway"="aerodrome"]["iata"]`);
    });

    it("formats empty conditions array as empty string", () => {
        expect(selectorToOverpassTags([])).toBe("");
    });
});

// ─── deriveOsmQueryTags ────────────────────────────────────────────────────

describe("deriveOsmQueryTags", () => {
    it('returns the Overpass QL tag string for "park"', () => {
        expect(deriveOsmQueryTags("park")).toBe(`["leisure"="park"]`);
    });

    it('returns the Overpass QL tag string for "museum"', () => {
        expect(deriveOsmQueryTags("museum")).toBe(`["tourism"="museum"]`);
    });

    it('returns the Overpass QL tag string for "hospital"', () => {
        expect(deriveOsmQueryTags("hospital")).toBe(`["amenity"="hospital"]`);
    });

    it('returns the Overpass QL tag string for "foreign-consulate"', () => {
        expect(deriveOsmQueryTags("foreign-consulate")).toBe(
            `["diplomatic"="embassy"]`,
        );
    });

    it('returns the Overpass QL tag string for "commercial-airport"', () => {
        expect(deriveOsmQueryTags("commercial-airport")).toBe(
            `["aeroway"="aerodrome"]["iata"]["military"!="airfield"]["landuse"!="military"]`,
        );
    });

    it('returns the Overpass QL tag string for "station-name-length"', () => {
        expect(deriveOsmQueryTags("station-name-length")).toBe(
            `["railway"="station"]`,
        );
    });

    it('returns "" for transit-line (not in registry)', () => {
        expect(deriveOsmQueryTags("transit-line")).toBe("");
    });

    it('returns "" for admin-1st (not in registry)', () => {
        expect(deriveOsmQueryTags("admin-1st")).toBe("");
    });

    it('returns "" for admin-4th (not in registry)', () => {
        expect(deriveOsmQueryTags("admin-4th")).toBe("");
    });
});

// ─── isBundleableCategory ──────────────────────────────────────────────────

describe("isBundleableCategory", () => {
    const bundledCategories: MatchingCategory[] = [
        "commercial-airport",
        "mountain",
        "landmark",
        "park",
        "amusement-park",
        "zoo",
        "aquarium",
        "golf-course",
        "museum",
        "movie-theater",
        "hospital",
        "library",
        "foreign-consulate",
        "station-name-length",
    ];

    const notBundled: MatchingCategory[] = [
        "transit-line",
        "admin-1st",
        "admin-2nd",
        "admin-3rd",
        "admin-4th",
    ];

    it.each(bundledCategories)("returns true for %s", (category) => {
        expect(isBundleableCategory(category)).toBe(true);
    });

    it.each(notBundled)("returns false for %s", (category) => {
        expect(isBundleableCategory(category)).toBe(false);
    });
});

// ─── toTagsFilterArgs ──────────────────────────────────────────────────────

describe("toTagsFilterArgs", () => {
    it("includes aeroway=aerodrome from multi-condition airport selector", () => {
        const args = toTagsFilterArgs();
        expect(args).toContain("aeroway=aerodrome");
    });

    it("includes natural=peak", () => {
        const args = toTagsFilterArgs();
        expect(args).toContain("natural=peak");
    });

    it("includes diplomatic=embassy", () => {
        const args = toTagsFilterArgs();
        expect(args).toContain("diplomatic=embassy");
    });

    it("includes railway=station", () => {
        const args = toTagsFilterArgs();
        expect(args).toContain("railway=station");
    });

    it("includes amenity with all three values sorted", () => {
        const args = toTagsFilterArgs();
        // Check the amenity entry contains all three values sorted.
        const amenityArg = args.find((a) => a.startsWith("amenity="));
        expect(amenityArg).toBeDefined();
        expect(amenityArg).toContain("cinema");
        expect(amenityArg).toContain("hospital");
        expect(amenityArg).toContain("library");
        // Verify sorted order.
        expect(amenityArg).toBe("amenity=cinema,hospital,library");
    });

    it("includes leisure with park and golf_course sorted", () => {
        const args = toTagsFilterArgs();
        const leisureArg = args.find((a) => a.startsWith("leisure="));
        expect(leisureArg).toBeDefined();
        expect(leisureArg).toBe("leisure=golf_course,park");
    });

    it("includes tourism with all values sorted", () => {
        const args = toTagsFilterArgs();
        const tourismArg = args.find((a) => a.startsWith("tourism="));
        expect(tourismArg).toBeDefined();
        expect(tourismArg).toBe(
            "tourism=aquarium,attraction,museum,theme_park,zoo",
        );
    });

    it("does not contain boundary or admin_level (admin not bundled)", () => {
        const args = toTagsFilterArgs();
        expect(args.some((a) => a.startsWith("boundary"))).toBe(false);
        expect(args.some((a) => a.startsWith("admin_level"))).toBe(false);
    });
});

// ─── Drift guard: deriveOsmQueryTags matches matchingCategories literal ────

describe("drift guard — deriveOsmQueryTags matches matchingCategories", () => {
    // station-name-length has a registry entry for extraction but keeps
    // osmQueryTags: "" at runtime because it uses the special buildStationQuery
    // path — the registry→QL derivation is intentionally not used here.
    const SPECIAL_QUERY_CATEGORIES = new Set<MatchingCategory>([
        "station-name-length",
    ]);

    for (const config of matchingCategories) {
        const { category, osmQueryTags } = config;
        const inRegistry = category in CATEGORY_SELECTORS;

        if (inRegistry && !SPECIAL_QUERY_CATEGORIES.has(category)) {
            it(`${category} derived QL matches literal osmQueryTags`, () => {
                expect(deriveOsmQueryTags(category)).toBe(osmQueryTags);
            });
        }
    }
});

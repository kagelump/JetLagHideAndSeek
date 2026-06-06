import {
    getMeasuringCategoryTitle,
    measuringCategories,
    measuringCategoriesBySection,
} from "@/features/questions/measuring/measuringCategories";

const DEFERRED_CATEGORIES = [
    "high-speed-rail",
    "coastline",
    "body-of-water",
    "admin-1st-border",
    "admin-2nd-border",
] as const;

describe("measuringCategories", () => {
    it("has 18 entries", () => {
        expect(measuringCategories).toHaveLength(18);
    });

    it("has exactly 13 implemented categories", () => {
        const implemented = measuringCategories.filter((c) => c.implemented);
        expect(implemented).toHaveLength(13);
    });

    it("has exactly 5 deferred (implemented: false) categories", () => {
        const deferred = measuringCategories.filter((c) => !c.implemented);
        expect(deferred).toHaveLength(5);
    });

    it("marks the expected 5 line/polygon categories as not implemented", () => {
        for (const category of DEFERRED_CATEGORIES) {
            const config = measuringCategories.find(
                (c) => c.category === category,
            );
            expect(config).toBeDefined();
            expect(config!.implemented).toBe(false);
        }
    });

    it("every implemented category has non-empty osmQueryTags", () => {
        for (const config of measuringCategories) {
            if (config.implemented) {
                expect(config.osmQueryTags).toBeTruthy();
            }
        }
    });

    it("every entry has a non-empty title", () => {
        for (const config of measuringCategories) {
            expect(config.title).toBeTruthy();
        }
    });

    it("every entry has a valid section", () => {
        const validSections = [
            "Transit",
            "Border",
            "Natural",
            "Places of Interest",
            "Public Utilities",
        ];
        for (const config of measuringCategories) {
            expect(validSections).toContain(config.section);
        }
    });

    it("has no duplicate categories", () => {
        const keys = measuringCategories.map((c) => c.category);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe("measuringCategoriesBySection", () => {
    it("groups all 18 entries across the expected sections", () => {
        const total = Object.values(measuringCategoriesBySection).reduce(
            (sum, configs) => sum + configs.length,
            0,
        );
        expect(total).toBe(18);
    });

    it("has the correct sections", () => {
        const sections = Object.keys(measuringCategoriesBySection);
        expect(sections).toContain("Transit");
        expect(sections).toContain("Border");
        expect(sections).toContain("Natural");
        expect(sections).toContain("Places of Interest");
        expect(sections).toContain("Public Utilities");
    });
});

describe("getMeasuringCategoryTitle", () => {
    it("returns the title for a known category", () => {
        expect(getMeasuringCategoryTitle("museum")).toBe("Museum");
        expect(getMeasuringCategoryTitle("park")).toBe("Park");
        expect(getMeasuringCategoryTitle("commercial-airport")).toBe("Airport");
        expect(getMeasuringCategoryTitle("rail-station")).toBe("Rail Station");
    });

    it("returns the category key for an unknown category", () => {
        // @ts-expect-error testing fallback for unknown category
        expect(getMeasuringCategoryTitle("unknown")).toBe("unknown");
    });
});

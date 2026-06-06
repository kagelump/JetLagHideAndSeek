import {
    getMeasuringCategoryTitle,
    isLineMeasuringCategory,
    LINE_MEASURING_CATEGORIES,
    measuringCategories,
    measuringCategoriesBySection,
} from "@/features/questions/measuring/measuringCategories";

const LINE_KEYS = [
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

    it("has all 18 categories implemented", () => {
        const implemented = measuringCategories.filter((c) => c.implemented);
        expect(implemented).toHaveLength(18);
    });

    it("marks the 5 line/polygon categories as implemented", () => {
        for (const category of LINE_KEYS) {
            const config = measuringCategories.find(
                (c) => c.category === category,
            );
            expect(config).toBeDefined();
            expect(config!.implemented).toBe(true);
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
            "Borders & Lines",
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

    describe("Borders & Lines section", () => {
        it("contains exactly the 5 line-category entries", () => {
            const borderConfigs =
                measuringCategoriesBySection["Borders & Lines"];
            expect(borderConfigs).toBeDefined();
            const keys = borderConfigs.map((c) => c.category);
            expect(new Set(keys)).toEqual(new Set(LINE_KEYS));
        });

        it("has no Border section (renamed)", () => {
            expect(
                (measuringCategoriesBySection as Record<string, unknown>)[
                    "Border"
                ],
            ).toBeUndefined();
        });
    });

    describe("titles", () => {
        it("uses updated admin border titles", () => {
            expect(getMeasuringCategoryTitle("admin-1st-border")).toBe(
                "Prefecture Border",
            );
            expect(getMeasuringCategoryTitle("admin-2nd-border")).toBe(
                "Ward / Municipality Border",
            );
        });
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
        expect(sections).toContain("Borders & Lines");
        expect(sections).toContain("Natural");
        expect(sections).toContain("Places of Interest");
        expect(sections).toContain("Public Utilities");
    });
});

describe("isLineMeasuringCategory", () => {
    it("has exactly 5 entries in LINE_MEASURING_CATEGORIES", () => {
        expect(LINE_MEASURING_CATEGORIES).toHaveLength(5);
    });

    it("returns true for each of the 5 line categories", () => {
        for (const cat of LINE_KEYS) {
            expect(isLineMeasuringCategory(cat)).toBe(true);
        }
    });

    it("returns false for the 13 point categories", () => {
        const pointCategories = measuringCategories
            .map((c) => c.category)
            .filter((cat) => !(LINE_KEYS as readonly string[]).includes(cat));
        expect(pointCategories).toHaveLength(13);
        for (const cat of pointCategories) {
            expect(isLineMeasuringCategory(cat)).toBe(false);
        }
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

import {
    getCategoryConfig,
    getCategorySection,
    getCategoryTitle,
    matchingCategories,
    matchingCategoriesBySection,
    setDefaultAdminConfig,
} from "../matchingCategories";
import { DEFAULT_ADMIN_DIVISION_PACK } from "../adminDivisionConfig";

describe("matchingCategories", () => {
    it("has a config for every category", () => {
        const categories = matchingCategories.map((c) => c.category);
        expect(categories).toContain("transit-line");
        expect(categories).toContain("station-name-length");
        expect(categories).toContain("mountain");
        expect(categories).toContain("park");
        expect(categories).toContain("hospital");
        expect(categories).toContain("foreign-consulate");
    });

    it("groups categories by section", () => {
        expect(matchingCategoriesBySection["Natural"]).toHaveLength(3);
        expect(matchingCategoriesBySection["Places of Interest"]).toHaveLength(
            6,
        );
        expect(matchingCategoriesBySection["Public Utilities"]).toHaveLength(3);
        // Admin entries have been removed from the static array — they are
        // now configured dynamically via adminDivisionConfig.
        expect(
            matchingCategoriesBySection["Administrative Divisions"],
        ).toBeUndefined();
    });

    it("looks up category config by category id", () => {
        const config = getCategoryConfig("museum");
        expect(config).toBeDefined();
        expect(config?.title).toBe("Museum");
        expect(config?.section).toBe("Places of Interest");
        expect(config?.osmQueryTags).toContain('"tourism"="museum"');
    });

    it("returns undefined for unknown categories", () => {
        expect(getCategoryConfig("unknown" as never)).toBeUndefined();
    });

    it("returns the title for a category", () => {
        expect(getCategoryTitle("zoo")).toBe("Zoo");
        // Admin categories need the module-level defaults to be synced
        // before they return the configured label.
        setDefaultAdminConfig(DEFAULT_ADMIN_DIVISION_PACK, "native");
        expect(getCategoryTitle("admin-2nd")).toBe(
            "2nd Admin Division (OSM level 7)",
        );
    });

    it("returns the section for a category", () => {
        expect(getCategorySection("mountain")).toBe("Natural");
        expect(getCategorySection("library")).toBe("Public Utilities");
    });

    it("has OSM query tags for all non-transit categories", () => {
        const specialCategories = new Set([
            "transit-line",
            "station-name-length",
        ]);
        for (const config of matchingCategories) {
            if (specialCategories.has(config.category)) {
                expect(config.osmQueryTags).toBe("");
            } else {
                expect(config.osmQueryTags).toBeTruthy();
            }
        }
    });
});

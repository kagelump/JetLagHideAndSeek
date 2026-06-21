/**
 * Tests for the admin-division border-tier helpers — the single source of
 * truth shared by matching admin categories and measuring admin borders.
 */

import {
    ADMIN_DIVISION_PRESETS,
    clonePack,
    getAdminBorderLabel,
    getAdminBorderOsmLevel,
    getAdminBorderQueryTags,
    isAdminBorderCategory,
} from "../adminDivisionConfig";

describe("isAdminBorderCategory", () => {
    it("recognizes the two border tiers", () => {
        expect(isAdminBorderCategory("admin-1st-border")).toBe(true);
        expect(isAdminBorderCategory("admin-2nd-border")).toBe(true);
    });

    it("rejects non-border categories", () => {
        expect(isAdminBorderCategory("admin-1st")).toBe(false);
        expect(isAdminBorderCategory("coastline")).toBe(false);
        expect(isAdminBorderCategory("park")).toBe(false);
    });
});

describe("getAdminBorderOsmLevel", () => {
    it("maps each tier to the matching admin division level", () => {
        const japan = clonePack(ADMIN_DIVISION_PRESETS.japan);
        expect(getAdminBorderOsmLevel(japan, "admin-1st-border")).toBe(4);
        expect(getAdminBorderOsmLevel(japan, "admin-2nd-border")).toBe(7);

        const generic = clonePack(ADMIN_DIVISION_PRESETS.generic);
        expect(getAdminBorderOsmLevel(generic, "admin-1st-border")).toBe(4);
        expect(getAdminBorderOsmLevel(generic, "admin-2nd-border")).toBe(6);
    });

    it("follows a user-edited level", () => {
        const pack = clonePack(ADMIN_DIVISION_PRESETS.generic);
        pack[0].osmLevel = "5";
        expect(getAdminBorderOsmLevel(pack, "admin-1st-border")).toBe(5);
    });
});

describe("getAdminBorderQueryTags", () => {
    it("emits a relation selector at the tier level", () => {
        const japan = clonePack(ADMIN_DIVISION_PRESETS.japan);
        expect(getAdminBorderQueryTags(japan, "admin-2nd-border")).toBe(
            '(relation["boundary"="administrative"]["admin_level"="7"];)',
        );
    });
});

describe("getAdminBorderLabel", () => {
    it("appends ' Border' to the shared matching label", () => {
        const japan = clonePack(ADMIN_DIVISION_PRESETS.japan);
        expect(getAdminBorderLabel(japan, "admin-1st-border", "english")).toBe(
            "Prefecture Border",
        );
        expect(getAdminBorderLabel(japan, "admin-2nd-border", "english")).toBe(
            "City Border",
        );
    });

    it("uses the generic ordinal label when the pack has no names", () => {
        const generic = clonePack(ADMIN_DIVISION_PRESETS.generic);
        expect(
            getAdminBorderLabel(generic, "admin-1st-border", "english"),
        ).toBe("1st Admin Division (OSM level 4) Border");
    });
});

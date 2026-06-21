import type { MatchingCategory } from "./matchingTypes";
import type {
    CategorySection,
    MatchingCategoryConfig,
} from "./matchingCategories";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminDivisionPresetName = "generic" | "japan";

export type AdminDivisionLevelEntry = {
    /** OSM admin_level value (e.g. "4", "7", "9", "10"). */
    osmLevel: string;
    /** Display label in the local language (e.g. "都道府県"). */
    labelNative: string;
    /** Display label in English (e.g. "Prefecture"). */
    labelEn: string;
};

/**
 * Ordered tuple matching admin-1st through admin-4th.
 * Index 0 = admin-1st, index 1 = admin-2nd, etc.
 */
export type AdminDivisionNamePack = [
    AdminDivisionLevelEntry,
    AdminDivisionLevelEntry,
    AdminDivisionLevelEntry,
    AdminDivisionLevelEntry,
];

/** Compact wire representation — labels are reconstructed from the preset. */
export type AdminDivisionsWireState = {
    pack: AdminDivisionPresetName;
    levels: [string, string, string, string];
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** Ordinal prefixes used by the generic preset label builder. */
const GENERIC_ORDINALS = ["1st", "2nd", "3rd", "4th"] as const;

function genericLabel(ordinal: string, osmLevel: string): string {
    // The generic preset always shows the OSM level inline so the user
    // can see which OSM admin_level they are configuring.
    return `${ordinal} Admin Division (OSM level ${osmLevel})`;
}

const GENERIC_PACK: AdminDivisionNamePack = [
    { osmLevel: "4", labelNative: "", labelEn: "" },
    { osmLevel: "6", labelNative: "", labelEn: "" },
    { osmLevel: "8", labelNative: "", labelEn: "" },
    { osmLevel: "10", labelNative: "", labelEn: "" },
];

const JAPAN_PACK: AdminDivisionNamePack = [
    { osmLevel: "4", labelNative: "都道府県", labelEn: "Prefecture" },
    { osmLevel: "7", labelNative: "市区町村", labelEn: "City" },
    { osmLevel: "9", labelNative: "町", labelEn: "Neighborhood" },
    { osmLevel: "10", labelNative: "丁目", labelEn: "Cho-me" },
];

export const ADMIN_DIVISION_PRESETS: Record<
    AdminDivisionPresetName,
    AdminDivisionNamePack
> = {
    generic: GENERIC_PACK,
    japan: JAPAN_PACK,
};

/** Deep-clone a pack so callers never share a reference with the presets. */
export function clonePack(pack: AdminDivisionNamePack): AdminDivisionNamePack {
    return pack.map((entry) => ({ ...entry })) as AdminDivisionNamePack;
}

export const DEFAULT_ADMIN_DIVISION_PACK: AdminDivisionNamePack =
    clonePack(GENERIC_PACK);
export const DEFAULT_ADMIN_DIVISION_PRESET_NAME: AdminDivisionPresetName =
    "generic";

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

const ADMIN_CATEGORIES: MatchingCategory[] = [
    "admin-1st",
    "admin-2nd",
    "admin-3rd",
    "admin-4th",
];

/** Index of each admin category in the 4-entry tuple. */
export const ADMIN_CATEGORY_INDEX: Record<string, number> = {
    "admin-1st": 0,
    "admin-2nd": 1,
    "admin-3rd": 2,
    "admin-4th": 3,
};

export function isAdminCategory(category: MatchingCategory): boolean {
    return Object.prototype.hasOwnProperty.call(ADMIN_CATEGORY_INDEX, category);
}

function getAdminEntry(
    pack: AdminDivisionNamePack,
    category: MatchingCategory,
): AdminDivisionLevelEntry {
    const index = ADMIN_CATEGORY_INDEX[category];
    if (index === undefined) {
        throw new Error(`Not an admin category: ${category}`);
    }
    return pack[index];
}

// ---------------------------------------------------------------------------
// Label / display helpers
// ---------------------------------------------------------------------------

export function getAdminDivisionLabel(
    pack: AdminDivisionNamePack,
    category: MatchingCategory,
    language: "native" | "english",
): string {
    const entry = getAdminEntry(pack, category);
    // When both labels are empty (the generic preset convention), derive the
    // label dynamically from the ordinal + current osmLevel so it never goes
    // stale after a level edit.
    if (!entry.labelEn && !entry.labelNative) {
        const index = ADMIN_CATEGORY_INDEX[category];
        const ordinal = GENERIC_ORDINALS[index];
        return genericLabel(ordinal, entry.osmLevel);
    }
    return language === "english" ? entry.labelEn : entry.labelNative;
}

// ---------------------------------------------------------------------------
// Query tag helpers
// ---------------------------------------------------------------------------

export function getAdminDivisionQueryTags(
    pack: AdminDivisionNamePack,
    category: MatchingCategory,
): string {
    const entry = getAdminEntry(pack, category);
    return `["boundary"="administrative"]["admin_level"="${entry.osmLevel}"]`;
}

// ---------------------------------------------------------------------------
// Admin border tiers (measuring)
// ---------------------------------------------------------------------------

/**
 * Measuring "distance to admin border" categories. These are the line-based
 * counterpart to the polygon-based matching admin categories: each border tier
 * reuses the SAME `AdminDivisionNamePack` so the OSM level + label stay in sync
 * with matching. Tier index maps into the 4-entry pack (0 = 1st admin division,
 * 1 = 2nd) — there are deliberately only two border tiers (see
 * "Keep two border tiers" design decision).
 */
export type AdminBorderCategory = "admin-1st-border" | "admin-2nd-border";

export const ADMIN_BORDER_TIER_INDEX: Record<AdminBorderCategory, number> = {
    "admin-1st-border": 0,
    "admin-2nd-border": 1,
};

export function isAdminBorderCategory(
    category: string,
): category is AdminBorderCategory {
    return Object.prototype.hasOwnProperty.call(
        ADMIN_BORDER_TIER_INDEX,
        category,
    );
}

/** The OSM admin_level (number) that a measuring border tier resolves to. */
export function getAdminBorderOsmLevel(
    pack: AdminDivisionNamePack,
    category: AdminBorderCategory,
): number {
    const entry = pack[ADMIN_BORDER_TIER_INDEX[category]];
    return parseInt(entry.osmLevel, 10);
}

/**
 * Display title for a measuring border tier, derived from the shared pack.
 * Reuses the matching admin label (e.g. "Prefecture", "State", or the generic
 * "1st Admin Division (OSM level 4)") and appends " Border".
 */
export function getAdminBorderLabel(
    pack: AdminDivisionNamePack,
    category: AdminBorderCategory,
    language: "native" | "english",
): string {
    const index = ADMIN_BORDER_TIER_INDEX[category];
    const matchingCategory = (["admin-1st", "admin-2nd"] as const)[index];
    const base = getAdminDivisionLabel(pack, matchingCategory, language);
    return `${base} Border`;
}

/** Overpass-QL tag selector for a measuring border tier (relations only). */
export function getAdminBorderQueryTags(
    pack: AdminDivisionNamePack,
    category: AdminBorderCategory,
): string {
    const level = getAdminBorderOsmLevel(pack, category);
    return `(relation["boundary"="administrative"]["admin_level"="${level}"];)`;
}

// ---------------------------------------------------------------------------
// Category config builders
// ---------------------------------------------------------------------------

export function buildAdminCategoryConfig(
    pack: AdminDivisionNamePack,
    category: MatchingCategory,
    language: "native" | "english",
): MatchingCategoryConfig {
    return {
        category,
        osmQueryTags: getAdminDivisionQueryTags(pack, category),
        section: "Administrative Divisions" as CategorySection,
        title: getAdminDivisionLabel(pack, category, language),
    };
}

export function buildAdminMatchingCategoryConfigs(
    pack: AdminDivisionNamePack,
    language: "native" | "english",
): MatchingCategoryConfig[] {
    return ADMIN_CATEGORIES.map((category) =>
        buildAdminCategoryConfig(pack, category, language),
    );
}

// ---------------------------------------------------------------------------
// Wire format reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct a full `AdminDivisionNamePack` from compact wire state.
 * Labels come from the preset definition; levels come from the wire.
 */
export function reconstructPackFromWire(
    wire: AdminDivisionsWireState,
): AdminDivisionNamePack {
    const preset = ADMIN_DIVISION_PRESETS[wire.pack];
    return preset.map((entry, i) => ({
        ...entry,
        osmLevel: wire.levels[i],
    })) as AdminDivisionNamePack;
}

/**
 * Extract compact wire state from a full pack + preset name.
 */
export function extractWireState(
    pack: AdminDivisionNamePack,
    presetName: AdminDivisionPresetName,
): AdminDivisionsWireState {
    return {
        pack: presetName,
        levels: pack.map((e) => e.osmLevel) as [string, string, string, string],
    };
}

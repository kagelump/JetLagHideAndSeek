import type { MatchingCategory } from "./matchingTypes";
import { deriveOsmQueryTags } from "./matchingSelectors";
import {
    type AdminDivisionNamePack,
    buildAdminCategoryConfig,
    isAdminCategory,
} from "./adminDivisionConfig";

export type CategorySection =
    | "Administrative Divisions"
    | "Natural"
    | "Places of Interest"
    | "Public Utilities"
    | "Transit";

export type MatchingCategoryConfig = {
    category: MatchingCategory;
    osmQueryTags: string;
    section: CategorySection;
    title: string;
};

/**
 * Base category definitions with section and title.
 * osmQueryTags is derived from matchingSelectors.ts for bundleable categories
 * (those in CATEGORY_SELECTORS). Categories with special query paths
 * (station-name-length, transit-line) or multi-condition tags (admin-*)
 * keep their literal strings.
 */
export const matchingCategories: MatchingCategoryConfig[] = [
    // Transit
    {
        category: "transit-line",
        osmQueryTags: "", // not OSM-tag based; handled by transit feature
        section: "Transit",
        title: "Transit Line",
    },
    {
        category: "station-name-length",
        osmQueryTags: "", // uses special buildStationQuery path
        section: "Transit",
        title: "Station's Name Length",
    },
    {
        category: "commercial-airport",
        osmQueryTags: deriveOsmQueryTags("commercial-airport"),
        section: "Transit",
        title: "Airport",
    },

    // Administrative Divisions are configured dynamically via
    // adminDivisionConfig.ts. Static fallback entries have been removed —
    // setDefaultAdminConfig() is called synchronously during state
    // initialisation so getCategoryConfig always has a pack available.

    // Natural
    {
        category: "mountain",
        osmQueryTags: deriveOsmQueryTags("mountain"),
        section: "Natural",
        title: "Mountain",
    },
    {
        category: "landmark",
        osmQueryTags: deriveOsmQueryTags("landmark"),
        section: "Natural",
        title: "Landmark",
    },
    {
        category: "park",
        osmQueryTags: deriveOsmQueryTags("park"),
        section: "Natural",
        title: "Park",
    },

    // Places of Interest
    {
        category: "amusement-park",
        osmQueryTags: deriveOsmQueryTags("amusement-park"),
        section: "Places of Interest",
        title: "Amusement Park",
    },
    {
        category: "zoo",
        osmQueryTags: deriveOsmQueryTags("zoo"),
        section: "Places of Interest",
        title: "Zoo",
    },
    {
        category: "aquarium",
        osmQueryTags: deriveOsmQueryTags("aquarium"),
        section: "Places of Interest",
        title: "Aquarium",
    },
    {
        category: "golf-course",
        osmQueryTags: deriveOsmQueryTags("golf-course"),
        section: "Places of Interest",
        title: "Golf Course",
    },
    {
        category: "museum",
        osmQueryTags: deriveOsmQueryTags("museum"),
        section: "Places of Interest",
        title: "Museum",
    },
    {
        category: "movie-theater",
        osmQueryTags: deriveOsmQueryTags("movie-theater"),
        section: "Places of Interest",
        title: "Movie Theater",
    },

    // Public Utilities
    {
        category: "hospital",
        osmQueryTags: deriveOsmQueryTags("hospital"),
        section: "Public Utilities",
        title: "Hospital",
    },
    {
        category: "library",
        osmQueryTags: deriveOsmQueryTags("library"),
        section: "Public Utilities",
        title: "Library",
    },
    {
        category: "foreign-consulate",
        osmQueryTags: deriveOsmQueryTags("foreign-consulate"),
        section: "Public Utilities",
        title: "Foreign Consulate",
    },
];

export const matchingCategoriesBySection = matchingCategories.reduce<
    Record<CategorySection, MatchingCategoryConfig[]>
>(
    (acc, config) => {
        const list = acc[config.section] ?? [];
        list.push(config);
        acc[config.section] = list;
        return acc;
    },
    {} as Record<CategorySection, MatchingCategoryConfig[]>,
);

// ---------------------------------------------------------------------------
// Module-level defaults for code paths that cannot access React context
// (e.g. matchingConfig.summary).
// ---------------------------------------------------------------------------

let _defaultAdminDivisionPack: AdminDivisionNamePack | undefined;
let _defaultLabelLanguage: "native" | "english" = "native";

/**
 * Set the admin division defaults used by `getCategoryTitle()` and
 * `getCategoryConfig()` when explicit overrides are not passed. Call this
 * from the app initialisation path whenever the admin division pack or label
 * language changes.
 *
 * ## Why this is a module-level mutable singleton
 *
 * `getCategoryConfig` and `getCategoryTitle` are called from non-React code
 * paths (e.g. `matchingConfig.summary`, Overpass query generation) that
 * cannot access React context. The module-level variables let those code
 * paths resolve the current admin division pack and label language without
 * threading context through every call site.
 *
 * ## Constraints
 *
 * - Call from store initialization/update paths (questionStore callbacks
 *   and AppStateProviders sync effect) whenever the admin division pack or
 *   label language changes. Do not call from event handlers, render logic,
 *   or any code outside the state-management layer.
 * - The function is called synchronously during provider setup so values are
 *   available on the first render.
 *
 * ## Call sites (canonical source)
 *
 * 1. questionStore.tsx — `setLabelLanguage` callback
 * 2. questionStore.tsx — `setAdminDivisionPack` state setter
 * 3. questionStore.tsx — `importQuestionSettings`
 * 4. AppStateProviders.tsx — sync effect on adminDivisionPack/labelLanguage
 */
export function setDefaultAdminConfig(
    pack: AdminDivisionNamePack,
    language: "native" | "english",
): void {
    _defaultAdminDivisionPack = pack;
    _defaultLabelLanguage = language;
}

/**
 * Read the active admin-division pack / label language for non-React consumers.
 *
 * The single source of truth is React state (`questionStore`), but the
 * Overpass-QL generation and the measuring admin-border runtime adapter run
 * outside the component tree and cannot read context. They read this module
 * global, kept in sync via `setDefaultAdminConfig` (see its JSDoc for the
 * call-site discipline). Returns `undefined` until the first sync.
 */
export function getDefaultAdminDivisionPack():
    | AdminDivisionNamePack
    | undefined {
    return _defaultAdminDivisionPack;
}

export function getDefaultLabelLanguage(): "native" | "english" {
    return _defaultLabelLanguage;
}

export function getCategoryConfig(
    category: MatchingCategory,
    adminDivisionPack?: AdminDivisionNamePack,
    labelLanguage?: "native" | "english",
): MatchingCategoryConfig | undefined {
    const pack = adminDivisionPack ?? _defaultAdminDivisionPack;
    const lang = labelLanguage ?? _defaultLabelLanguage;

    if (isAdminCategory(category) && pack) {
        return buildAdminCategoryConfig(pack, category, lang);
    }

    return matchingCategories.find((c) => c.category === category);
}

export function getCategoryTitle(
    category: MatchingCategory,
    adminDivisionPack?: AdminDivisionNamePack,
    labelLanguage?: "native" | "english",
): string {
    return (
        getCategoryConfig(category, adminDivisionPack, labelLanguage)?.title ??
        category
    );
}

export function getCategorySection(
    category: MatchingCategory,
): CategorySection {
    // Admin categories are configured dynamically; their section is always
    // "Administrative Divisions".
    if (isAdminCategory(category)) return "Administrative Divisions";
    return getCategoryConfig(category)?.section ?? "Natural";
}

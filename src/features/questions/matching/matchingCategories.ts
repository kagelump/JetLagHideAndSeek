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
    // getCategoryConfig resolves the live pack through the admin config
    // provider (registerAdminConfigProvider) registered by the state layer.

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

/**
 * Admin config provider — registered once by the React state layer so
 * non-React consumers (Overpass-QL generation, measuring border adapter)
 * always read the live value without call-site sync discipline.
 */
type AdminConfigProvider = () => {
    pack: AdminDivisionNamePack | undefined;
    language: "native" | "english";
};

let _configProvider: AdminConfigProvider | null = null;

/**
 * Register a callback that returns the current admin division config.
 *
 * Call once from the React state initialisation path (questionStore.tsx).
 * After registration, `getDefaultAdminDivisionPack()` and
 * `getDefaultLabelLanguage()` read from this provider — no per-mutation
 * sync calls are needed.
 */
export function registerAdminConfigProvider(
    provider: AdminConfigProvider,
): void {
    _configProvider = provider;
}

/**
 * Read the active admin-division pack for non-React consumers.
 *
 * The single source of truth is React state (`questionStore`), accessed
 * through the provider registered by `registerAdminConfigProvider`. Returns
 * `undefined` until the provider is registered (early in app startup, before
 * the first render commits).
 */
export function getDefaultAdminDivisionPack():
    | AdminDivisionNamePack
    | undefined {
    return _configProvider?.().pack;
}

/**
 * Read the active label language for non-React consumers. Defaults to
 * `"native"` until the provider is registered.
 */
export function getDefaultLabelLanguage(): "native" | "english" {
    return _configProvider?.().language ?? "native";
}

export function getCategoryConfig(
    category: MatchingCategory,
    adminDivisionPack?: AdminDivisionNamePack,
    labelLanguage?: "native" | "english",
): MatchingCategoryConfig | undefined {
    const pack = adminDivisionPack ?? getDefaultAdminDivisionPack();
    const lang = labelLanguage ?? getDefaultLabelLanguage();

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

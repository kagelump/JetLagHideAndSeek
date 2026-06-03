import type { MatchingCategory } from "./matchingTypes";
import { deriveOsmQueryTags } from "./matchingSelectors";

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

    // Administrative Divisions (not bundleable in Phase 1 — keep literals)
    {
        category: "admin-1st",
        osmQueryTags: `["boundary"="administrative"]["admin_level"="4"]`,
        section: "Administrative Divisions",
        title: "1st Admin. Division",
    },
    {
        category: "admin-2nd",
        osmQueryTags: `["boundary"="administrative"]["admin_level"="7"]`,
        section: "Administrative Divisions",
        title: "2nd Admin. Division",
    },
    {
        category: "admin-3rd",
        osmQueryTags: `["boundary"="administrative"]["admin_level"="9"]`,
        section: "Administrative Divisions",
        title: "3rd Admin. Division",
    },
    {
        category: "admin-4th",
        osmQueryTags: `["boundary"="administrative"]["admin_level"="10"]`,
        section: "Administrative Divisions",
        title: "4th Admin. Division",
    },

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

export function getCategoryConfig(
    category: MatchingCategory,
): MatchingCategoryConfig | undefined {
    return matchingCategories.find((c) => c.category === category);
}

export function getCategoryTitle(category: MatchingCategory): string {
    return getCategoryConfig(category)?.title ?? category;
}

export function getCategorySection(
    category: MatchingCategory,
): CategorySection {
    return getCategoryConfig(category)?.section ?? "Natural";
}

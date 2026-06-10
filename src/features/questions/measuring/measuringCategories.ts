import type { MatchingCategory } from "@/features/questions/matching/matchingTypes";
import { deriveOsmQueryTags } from "@/features/questions/matching/matchingSelectors";
import type { MeasuringCategory } from "./measuringTypes";

export type MeasuringCategorySection =
    | "Transit"
    | "Borders & Lines"
    | "Natural"
    | "Places of Interest"
    | "Public Utilities";

export type MeasuringCategoryConfig = {
    category: MeasuringCategory;
    implemented: boolean;
    osmQueryTags: string;
    section: MeasuringCategorySection;
    title: string;
};

/**
 * Maps a MeasuringCategory to the MatchingCategory whose OSM selectors and
 * spatial-index bundle it shares. Categories without a direct matching
 * counterpart (the 5 line/polygon deferred categories) map to null.
 */
export const MEASURING_TO_MATCHING_CATEGORY: Partial<
    Record<MeasuringCategory, MatchingCategory>
> = {
    "commercial-airport": "commercial-airport",
    "rail-station": "station-name-length",
    mountain: "mountain",
    park: "park",
    "amusement-park": "amusement-park",
    zoo: "zoo",
    aquarium: "aquarium",
    "golf-course": "golf-course",
    museum: "museum",
    "movie-theater": "movie-theater",
    hospital: "hospital",
    library: "library",
    "foreign-consulate": "foreign-consulate",
    // The 5 line/polygon categories have no matching counterpart:
    // high-speed-rail, coastline, body-of-water, admin-1st-border, admin-2nd-border
};

function osmTags(category: MeasuringCategory): string {
    const matchingCategory = MEASURING_TO_MATCHING_CATEGORY[category];
    if (matchingCategory) return deriveOsmQueryTags(matchingCategory);
    return "";
}

export const LINE_MEASURING_CATEGORIES: MeasuringCategory[] = [
    "high-speed-rail",
    "coastline",
    "body-of-water",
    "admin-1st-border",
    "admin-2nd-border",
];

export function isLineMeasuringCategory(category: MeasuringCategory): boolean {
    return (LINE_MEASURING_CATEGORIES as string[]).includes(category);
}

export const measuringCategories: MeasuringCategoryConfig[] = [
    // ── Transit ──────────────────────────────────────────────────────────
    {
        category: "commercial-airport",
        implemented: true,
        osmQueryTags: osmTags("commercial-airport"),
        section: "Transit",
        title: "Airport",
    },
    {
        category: "rail-station",
        implemented: true,
        osmQueryTags: osmTags("rail-station"),
        section: "Transit",
        title: "Rail Station",
    },

    // ── Borders & Lines ───────────────────────────────────────────────────
    {
        category: "high-speed-rail",
        implemented: true,
        osmQueryTags:
            '(way["railway"="rail"]["highspeed"="yes"]; way["railway"="rail"]["maxspeed"~"^2[0-9]{2}"];)',
        section: "Borders & Lines",
        title: "High-Speed Rail",
    },
    {
        category: "coastline",
        implemented: true,
        osmQueryTags: '(way["natural"="coastline"];)',
        section: "Borders & Lines",
        title: "Coastline",
    },
    {
        category: "body-of-water",
        implemented: true,
        osmQueryTags:
            '(way["natural"="water"]; relation["natural"="water"]; way["landuse"="basin"]; way["waterway"="riverbank"]; way["waterway"="stream"];)',
        section: "Borders & Lines",
        title: "Body of Water",
    },
    {
        category: "admin-1st-border",
        implemented: true,
        osmQueryTags:
            '(relation["boundary"="administrative"]["admin_level"="4"];)',
        section: "Borders & Lines",
        title: "Prefecture Border",
    },
    {
        category: "admin-2nd-border",
        implemented: true,
        osmQueryTags:
            '(relation["boundary"="administrative"]["admin_level"="7"];)',
        section: "Borders & Lines",
        title: "Ward / Municipality Border",
    },
    {
        category: "mountain",
        implemented: true,
        osmQueryTags: osmTags("mountain"),
        section: "Natural",
        title: "Mountain",
    },
    {
        category: "park",
        implemented: true,
        osmQueryTags: osmTags("park"),
        section: "Natural",
        title: "Park",
    },

    // ── Places of Interest ───────────────────────────────────────────────
    {
        category: "amusement-park",
        implemented: true,
        osmQueryTags: osmTags("amusement-park"),
        section: "Places of Interest",
        title: "Amusement Park",
    },
    {
        category: "zoo",
        implemented: true,
        osmQueryTags: osmTags("zoo"),
        section: "Places of Interest",
        title: "Zoo",
    },
    {
        category: "aquarium",
        implemented: true,
        osmQueryTags: osmTags("aquarium"),
        section: "Places of Interest",
        title: "Aquarium",
    },
    {
        category: "golf-course",
        implemented: true,
        osmQueryTags: osmTags("golf-course"),
        section: "Places of Interest",
        title: "Golf Course",
    },
    {
        category: "museum",
        implemented: true,
        osmQueryTags: osmTags("museum"),
        section: "Places of Interest",
        title: "Museum",
    },
    {
        category: "movie-theater",
        implemented: true,
        osmQueryTags: osmTags("movie-theater"),
        section: "Places of Interest",
        title: "Movie Theater",
    },

    // ── Public Utilities ─────────────────────────────────────────────────
    {
        category: "hospital",
        implemented: true,
        osmQueryTags: osmTags("hospital"),
        section: "Public Utilities",
        title: "Hospital",
    },
    {
        category: "library",
        implemented: true,
        osmQueryTags: osmTags("library"),
        section: "Public Utilities",
        title: "Library",
    },
    {
        category: "foreign-consulate",
        implemented: true,
        osmQueryTags: osmTags("foreign-consulate"),
        section: "Public Utilities",
        title: "Foreign Consulate",
    },
];

export const measuringCategoriesBySection = measuringCategories.reduce<
    Record<MeasuringCategorySection, MeasuringCategoryConfig[]>
>(
    (acc, config) => {
        const list = acc[config.section] ?? [];
        list.push(config);
        acc[config.section] = list;
        return acc;
    },
    {} as Record<MeasuringCategorySection, MeasuringCategoryConfig[]>,
);

export function getMeasuringCategoryConfig(
    category: MeasuringCategory,
): MeasuringCategoryConfig | undefined {
    return measuringCategories.find((c) => c.category === category);
}

export function getMeasuringCategoryTitle(category: MeasuringCategory): string {
    return getMeasuringCategoryConfig(category)?.title ?? category;
}

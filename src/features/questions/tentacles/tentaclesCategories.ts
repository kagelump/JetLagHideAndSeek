import { deriveOsmQueryTags } from "@/features/questions/matching/matchingSelectors";
import type { MatchingCategory } from "@/features/questions/matching/matchingTypes";
import type {
    TentaclesCategory,
    TentaclesDistanceOption,
} from "./tentaclesTypes";

export type TentaclesCategoryConfig = {
    category: TentaclesCategory;
    distanceOption: TentaclesDistanceOption;
    osmQueryTags: string;
    title: string;
};

export const tentaclesCategoryConfigs: TentaclesCategoryConfig[] = [
    {
        category: "museum",
        distanceOption: "2km",
        osmQueryTags: deriveOsmQueryTags("museum" as MatchingCategory),
        title: "Museum",
    },
    {
        category: "library",
        distanceOption: "2km",
        osmQueryTags: deriveOsmQueryTags("library" as MatchingCategory),
        title: "Library",
    },
    {
        category: "movie-theater",
        distanceOption: "2km",
        osmQueryTags: deriveOsmQueryTags("movie-theater" as MatchingCategory),
        title: "Movie Theater",
    },
    {
        category: "hospital",
        distanceOption: "2km",
        osmQueryTags: deriveOsmQueryTags("hospital" as MatchingCategory),
        title: "Hospital",
    },
    {
        category: "transit-line",
        distanceOption: "25km",
        osmQueryTags: "",
        title: "Metro Line",
    },
    {
        category: "zoo",
        distanceOption: "25km",
        osmQueryTags: deriveOsmQueryTags("zoo" as MatchingCategory),
        title: "Zoo",
    },
    {
        category: "aquarium",
        distanceOption: "25km",
        osmQueryTags: deriveOsmQueryTags("aquarium" as MatchingCategory),
        title: "Aquarium",
    },
    {
        category: "amusement-park",
        distanceOption: "25km",
        osmQueryTags: deriveOsmQueryTags("amusement-park" as MatchingCategory),
        title: "Amusement Park",
    },
];

export function getTentaclesCategoryConfig(
    category: TentaclesCategory,
): TentaclesCategoryConfig | undefined {
    return tentaclesCategoryConfigs.find((c) => c.category === category);
}

import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";

import type { BaseQuestion } from "@/features/questions/coreTypes";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";
import type { Position } from "@/shared/geojson";

export type TentaclesCategory =
    // 2 km group
    | "museum"
    | "library"
    | "movie-theater"
    | "hospital"
    // 25 km group
    | "transit-line"
    | "zoo"
    | "aquarium"
    | "amusement-park";

export type TentaclesDistanceOption = "2km" | "25km";

export const tentaclesCategoryDistance: Record<
    TentaclesCategory,
    TentaclesDistanceOption
> = {
    museum: "2km",
    library: "2km",
    "movie-theater": "2km",
    hospital: "2km",
    "transit-line": "25km",
    zoo: "25km",
    aquarium: "25km",
    "amusement-park": "25km",
};

export const tentaclesDistanceMeters: Record<TentaclesDistanceOption, number> =
    {
        "2km": 2000,
        "25km": 25000,
    };

export type TentaclesQuestion = BaseQuestion & {
    type: "tentacles";
    /**
     * The answer to a Tentacles question is the *named POI* the hider is
     * closest to, represented by `selectedOsmId` / `selectedOsmType` /
     * `selectedName`. The legacy `answer` status field is retained only so
     * generic store/list code can ask "is this answered?" — it is
     * "unanswered" until a POI is chosen, then "positive". There is no
     * meaningful "negative". See Task 02 (answer model).
     */
    answer: "unanswered" | "positive";
    candidates: OsmFeature[];
    category: TentaclesCategory;
    /** Seeker's position – center of the radius search. */
    center: Position;
    distanceMeters: number;
    distanceOption: TentaclesDistanceOption;
    selectedOsmId: number | null;
    selectedOsmType: "node" | "way" | "relation" | null;
    /** Display name of the selected POI; the human-readable answer. */
    selectedName: string | null;
};

export type TentaclesRenderState = {
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    poiFeatures: FeatureCollection<
        Point,
        { isSelected: boolean; name: string; osmId: number }
    >;
    /** The seeker's radius circle, shown as an outline layer. null when no center set. */
    radiusOutlineFeature: Feature<Polygon> | null;
    voronoiOutlineFeatures: FeatureCollection<Polygon | MultiPolygon>;
};

export const EMPTY_TENTACLES_RENDER_STATE: TentaclesRenderState = {
    hitMaskFeatures: { features: [], type: "FeatureCollection" },
    missMaskFeatures: { features: [], type: "FeatureCollection" },
    poiFeatures: { features: [], type: "FeatureCollection" },
    radiusOutlineFeature: null,
    voronoiOutlineFeatures: { features: [], type: "FeatureCollection" },
};

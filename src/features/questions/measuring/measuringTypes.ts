import type {
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";

import type {
    BaseQuestion,
    QuestionAnswer,
} from "@/features/questions/coreTypes";
import type { DistanceUnit } from "@/shared/distanceUnits";
import type { Position } from "@/shared/geojson";

export type MeasuringCategory =
    // Transit
    | "commercial-airport"
    | "high-speed-rail" // line-distance – see task-06
    | "rail-station"
    // Border
    | "admin-1st-border" // polygon-edge distance – see task-06
    | "admin-2nd-border" // polygon-edge distance – see task-06
    // Natural
    | "body-of-water" // polygon-edge distance – see task-06
    | "coastline" // line-distance – see task-06
    | "mountain"
    | "park"
    // Places of Interest
    | "amusement-park"
    | "zoo"
    | "aquarium"
    | "golf-course"
    | "museum"
    | "movie-theater"
    // Public Utilities
    | "hospital"
    | "library"
    | "foreign-consulate";

export type MeasuringQuestion = BaseQuestion & {
    type: "measuring";
    answer: QuestionAnswer;
    category: MeasuringCategory;
    /** Seeker's position – used as the search anchor to find nearby POIs. */
    center: Position;
    /** Display unit preference for the seeker's distance value. */
    seekerDistanceUnit: DistanceUnit;
    /**
     * Resolved distance from the seeker's center to the nearest feature of the
     * selected category. null until resolved (e.g. by the measure-on-render
     * pipeline or an explicit lookup).
     */
    seekerDistanceMeters: number | null;
    /**
     * Name of the nearest feature to the seeker's center. null until resolved.
     */
    nearestPoiName: string | null;
};

export type MeasuringRenderState = {
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>; // closer
    missMaskFeatures: FeatureCollection<Polygon | MultiPolygon>; // farther
    /** Hairline from each line-category question's `center` to its nearest point. */
    nearestPointConnectors: FeatureCollection<LineString>;
    /** A marker at each line-category question's nearest point. */
    nearestPointMarkers: FeatureCollection<Point>;
    /** The line geometry for line-category questions, clipped to the
     *  play area. Rendered as a reference line on the map. */
    lineFeatures: FeatureCollection<LineString | MultiLineString>;
};

export const EMPTY_MEASURING_RENDER_STATE: MeasuringRenderState = {
    hitMaskFeatures: { features: [], type: "FeatureCollection" },
    missMaskFeatures: { features: [], type: "FeatureCollection" },
    nearestPointConnectors: { features: [], type: "FeatureCollection" },
    nearestPointMarkers: { features: [], type: "FeatureCollection" },
    lineFeatures: { features: [], type: "FeatureCollection" },
};

import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiPolygon,
    Polygon,
} from "geojson";

import type {
    BaseQuestion,
    QuestionAnswer,
} from "@/features/questions/coreTypes";
import type { Position } from "@/shared/geojson";

/** Nearest rail station to a thermometer pin, resolved from POI data. */
export type ThermometerStationAnchor = {
    /** Station display name, or null when none was found within the radius. */
    name: string | null;
    /** Distance in meters from the pin to that station. null when unresolved. */
    distanceMeters: number | null;
};

export type ThermometerQuestion = BaseQuestion & {
    type: "thermometer";
    answer: QuestionAnswer; // positive = hotter, negative = colder
    /** Seeker's position before travel. null until set by the user. */
    previousPosition: Position | null;
    /** Seeker's position after travel. null until set by the user. */
    currentPosition: Position | null;
    /** Closest-station anchor for previousPosition. null = not yet resolved. */
    previousStation: ThermometerStationAnchor | null;
    /** Closest-station anchor for currentPosition. null = not yet resolved. */
    currentStation: ThermometerStationAnchor | null;
};

export type ThermometerRenderState = {
    /** Perpendicular bisector line between P1 and P2, clipped to the play area bbox. */
    bisectorLine: Feature<LineString> | null;
    /** Half-plane where the hider must be, clipped to the play area. */
    hitMaskFeatures: FeatureCollection<Polygon | MultiPolygon>;
    /**
     * Preview features shown while editing:
     * – travel segment line (P1 → P2)
     * – three range-ring circles from P1 at 1 km, 5 km, and 15 km
     * Each feature carries a `role` property (see Task 08).
     */
    previewFeatures: FeatureCollection<LineString | Polygon>;
};

export const EMPTY_THERMOMETER_RENDER_STATE: ThermometerRenderState = {
    bisectorLine: null,
    hitMaskFeatures: { features: [], type: "FeatureCollection" },
    previewFeatures: { features: [], type: "FeatureCollection" },
};

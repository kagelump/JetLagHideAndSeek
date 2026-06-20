import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";

import type { TransitStation } from "@/features/hidingZone/hidingZoneTypes";
import type { Position } from "@/shared/geojson";
import type {
    BaseQuestion,
    QuestionAnswer,
} from "@/features/questions/coreTypes";
import type { MeasuringRenderState } from "@/features/questions/measuring/measuringTypes";
import type { OsmMatchingRenderState } from "@/features/questions/matching/matchingTypes";
import type { TentaclesRenderState } from "@/features/questions/tentacles/tentaclesTypes";
import type { ThermometerRenderState } from "@/features/questions/thermometer/thermometerTypes";
import type { TransitLineQuestionFeatureCollection } from "@/features/questions/transitLine/transitLineTypes";
import type { DistanceUnit } from "@/shared/distanceUnits";

export type RadarDistanceOption =
    | "500m"
    | "1km"
    | "2km"
    | "5km"
    | "10km"
    | "15km"
    | "40km"
    | "80km"
    | "150km"
    | "0.5mi"
    | "1mi"
    | "2mi"
    | "5mi"
    | "10mi"
    | "15mi"
    | "25mi"
    | "50mi"
    | "100mi"
    | "other";

/** Metric distance presets shown when the unit system is metric. */
export const metricRadarPresets: Exclude<RadarDistanceOption, "other">[] = [
    "500m",
    "1km",
    "2km",
    "5km",
    "10km",
    "15km",
    "40km",
    "80km",
    "150km",
];

/**
 * Imperial distance presets shown when the unit system is imperial. A parallel
 * round-imperial ladder (not the metric distances relabeled), so e.g. the
 * "500m" tier becomes a clean "0.5mi" rather than an awkward 0.31mi.
 */
export const imperialRadarPresets: Exclude<RadarDistanceOption, "other">[] = [
    "0.5mi",
    "1mi",
    "2mi",
    "5mi",
    "10mi",
    "15mi",
    "25mi",
    "50mi",
    "100mi",
];

/**
 * Legacy export kept for callers that want the default (metric) preset ladder.
 * Prefer {@link metricRadarPresets} / {@link imperialRadarPresets}.
 */
export const radarDistancePresetOptions = metricRadarPresets;

const METERS_PER_MILE = 1609.344;

export const radarDistanceOptionMeters: Record<
    Exclude<RadarDistanceOption, "other">,
    number
> = {
    "500m": 500,
    "1km": 1000,
    "2km": 2000,
    "5km": 5000,
    "10km": 10000,
    "15km": 15000,
    "40km": 40000,
    "80km": 80000,
    "150km": 150000,
    "0.5mi": 0.5 * METERS_PER_MILE,
    "1mi": 1 * METERS_PER_MILE,
    "2mi": 2 * METERS_PER_MILE,
    "5mi": 5 * METERS_PER_MILE,
    "10mi": 10 * METERS_PER_MILE,
    "15mi": 15 * METERS_PER_MILE,
    "25mi": 25 * METERS_PER_MILE,
    "50mi": 50 * METERS_PER_MILE,
    "100mi": 100 * METERS_PER_MILE,
};

/** Whether a radar preset option belongs to the imperial ladder. */
export function isImperialRadarPreset(option: RadarDistanceOption): boolean {
    return option !== "other" && option.endsWith("mi");
}

export type RadarQuestion = BaseQuestion & {
    answer: QuestionAnswer;
    center: Position;
    distanceMeters: number;
    distanceOption: RadarDistanceOption;
    distanceUnit: DistanceUnit;
    type: "radar";
};

export type RadarQuestionFeatureProperties = {
    distanceMeters: number;
    id: string;
};

export type RadarQuestionFeatureCollection = FeatureCollection<
    Polygon | MultiPolygon,
    RadarQuestionFeatureProperties
>;

export type QuestionPinProperties = {
    id: string;
};

export type QuestionPinFeature = Feature<Point, QuestionPinProperties>;

export type RadarQuestionRenderState = {
    hitMaskFeatures: RadarQuestionFeatureCollection;
    missMaskFeatures: RadarQuestionFeatureCollection;
    outlineFeatures: RadarQuestionFeatureCollection;
    previewFeatures: RadarQuestionFeatureCollection;
};

export type QuestionMapRenderState = {
    measuring: MeasuringRenderState;
    osmMatching: OsmMatchingRenderState;
    radar: RadarQuestionRenderState;
    radarAreaFeatures: RadarQuestionFeatureCollection;
    tentacles: TentaclesRenderState;
    thermometer: ThermometerRenderState;
    transitLine: {
        hitMaskFeatures: TransitLineQuestionFeatureCollection;
        missMaskFeatures: TransitLineQuestionFeatureCollection;
    };
    /** Voronoi cell outlines clipped to the play area, merged across all candidate-based question types. */
    voronoiOutlineFeatures: FeatureCollection<Polygon | MultiPolygon>;
};

export type NearestStationInfo = {
    distanceMeters: number;
    station: TransitStation;
} | null;

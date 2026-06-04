import type { QuestionAnswer } from "@/features/questions/coreTypes";
import type { RadarQuestion } from "@/features/questions/radar/radarTypes";
import { haversineDistanceMeters, type Position } from "@/shared/geojson";

/**
 * Evaluates a radar question against a location. Returns "positive" (a Hit —
 * the location is within the radar distance of the question center) or
 * "negative" (a Miss). `location` and `question.center` are both `[lon, lat]`.
 */
export function evaluateRadarAnswer(
    question: RadarQuestion,
    location: Position,
): Exclude<QuestionAnswer, "unanswered"> {
    const meters = haversineDistanceMeters(
        location[1],
        location[0],
        question.center[1],
        question.center[0],
    );
    return meters <= question.distanceMeters ? "positive" : "negative";
}

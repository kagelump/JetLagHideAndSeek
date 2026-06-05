import { getCategoryTitle } from "@/features/questions/matching/matchingCategories";
import type { QuestionState } from "@/features/questions/questionTypes";
import type { RadarQuestion } from "@/features/questions/radar/radarTypes";
import type { Position } from "@/shared/geojson";
import { fromMeters } from "@/shared/distanceUnits";

function formatRadarDistance(question: RadarQuestion): string {
    if (question.distanceOption !== "other") {
        return question.distanceOption;
    }
    const value = fromMeters(question.distanceMeters, question.distanceUnit);
    return `${value}${question.distanceUnit}`;
}

function formatCoordinate(center: Position): string {
    const lat = center[1].toFixed(5);
    const lon = center[0].toFixed(5);
    return `(${lat}, ${lon})`;
}

/**
 * Human-readable prompt shared in the chat message and shown in the import
 * preview. Radar prompts are phrased as a yes/no question a hider can answer
 * from their location; matching prompts describe the attribute being compared.
 */
export function buildQuestionSharePrompt(question: QuestionState): string {
    if (question.type === "radar") {
        return `Are you within ${formatRadarDistance(
            question,
        )} of ${formatCoordinate(question.center)}?`;
    }

    if (question.category === "transit-line") {
        return question.lineName
            ? `Are you on the ${question.lineName}?`
            : "Which transit line are you on?";
    }

    const categoryTitle = getCategoryTitle(question.category);
    return question.targetName
        ? `Do we match on ${categoryTitle} (${question.targetName})?`
        : `Do we match on ${categoryTitle}?`;
}

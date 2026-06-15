import { useEffect, useRef } from "react";

import { findMatchingFeaturesWithIndex } from "@/features/questions/matching/osmMatchingCache";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import { positionsEqual, type Position } from "@/shared/geojson";
import type { useQuestionActions } from "@/state/questionStore";

/** Maximum search radius for finding a nearby rail station anchor (meters). */
const ANCHOR_SEARCH_RADIUS_METERS = 2000;

/**
 * Resolves the nearest rail station for each thermometer pin that has a
 * position but no anchor. Writes the anchor back through `updateQuestion`
 * with a stale-guard: if the pin position changed while the async lookup was
 * in flight the write is silently dropped.
 */
export function useThermometerStationAnchors(
    question: ThermometerQuestion,
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"],
): void {
    const inFlight = useRef(new Set<string>());

    useEffect(() => {
        void resolvePin(
            "start",
            question.previousPosition,
            question.previousStation,
        );
        void resolvePin(
            "end",
            question.currentPosition,
            question.currentStation,
        );

        async function resolvePin(
            pin: "start" | "end",
            position: Position | null,
            anchor: ThermometerQuestion["previousStation"],
        ): Promise<void> {
            if (!position || anchor !== null) return;

            const key = `${pin}:${position[0]},${position[1]}`;
            if (inFlight.current.has(key)) return;

            inFlight.current.add(key);
            try {
                const result = await findMatchingFeaturesWithIndex(
                    "station-name-length",
                    position,
                    {
                        maxCandidates: 1,
                        requestedRadiusMeters: ANCHOR_SEARCH_RADIUS_METERS,
                    },
                );

                const candidate = result.candidates[0];
                const resolvedAnchor = candidate
                    ? {
                          name: candidate.name,
                          distanceMeters: Math.round(candidate.distanceMeters),
                      }
                    : { name: null, distanceMeters: null };

                // Stale guard: only write if the pin position hasn't changed
                // since we started the async lookup.
                updateQuestion(question.id, (current) => {
                    if (current.type !== "thermometer") return current;
                    const currentPos =
                        pin === "start"
                            ? current.previousPosition
                            : current.currentPosition;
                    if (!currentPos || !positionsEqual(currentPos, position)) {
                        return current; // position changed, drop this stale result
                    }
                    return {
                        ...current,
                        [pin === "start"
                            ? "previousStation"
                            : "currentStation"]: resolvedAnchor,
                    } as ThermometerQuestion;
                });
            } catch {
                // Leave anchor null on failure; will retry on next render.
            } finally {
                inFlight.current.delete(key);
            }
        }
    }, [
        question.id,
        question.previousPosition,
        question.currentPosition,
        question.previousStation,
        question.currentStation,
        updateQuestion,
    ]);
}

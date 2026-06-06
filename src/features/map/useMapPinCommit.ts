import { useCallback } from "react";
import {
    updateQuestionCenter,
    useQuestionActions,
} from "@/state/questionStore";
import type { Position } from "@/shared/geojson";

export function useMapPinCommit(): (
    questionId: string,
    pinKey: string,
    position: Position,
) => void {
    const { updateQuestion } = useQuestionActions();

    return useCallback(
        (questionId: string, pinKey: string, position: Position) => {
            if (pinKey !== "center") return;
            updateQuestion(questionId, (question) =>
                updateQuestionCenter(question, position),
            );
        },
        [updateQuestion],
    );
}

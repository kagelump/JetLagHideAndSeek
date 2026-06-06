import { useCallback } from "react";
import {
    updateQuestionCenter,
    updateThermometerPin,
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
            if (pinKey === "center") {
                updateQuestion(questionId, (question) =>
                    updateQuestionCenter(question, position),
                );
                return;
            }
            updateQuestion(questionId, (question) => {
                if (question.type !== "thermometer") return question;
                if (pinKey !== "start" && pinKey !== "end") return question;
                return updateThermometerPin(question, pinKey, position);
            });
        },
        [updateQuestion],
    );
}

import { useCallback } from "react";
import { StyleSheet } from "react-native";

import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { getLastKnownMapCenter } from "@/features/map/mapCenter";
import { requestUserCoordinate } from "@/shared/location";
import {
    updateQuestionCenter,
    useQuestionActions,
} from "@/state/questionStore";
import { usePlayArea } from "@/state/playAreaStore";

import { MeasuringCategoryList } from "./MeasuringCategoryList";
import type { MeasuringCategory } from "./measuringTypes";

type Props = {
    onNavigate: (route: SheetRouteName) => void;
};

export function MeasuringCategoryScreen({ onNavigate }: Props) {
    const { playArea } = usePlayArea();
    const { createQuestion, updateQuestion } = useQuestionActions();

    const handlePick = useCallback(
        (category: MeasuringCategory) => {
            const question = createQuestion("measuring", {
                center: playArea.center,
                category,
            });
            onNavigate("question-detail");

            // Patch center post-create like radar/thermometer/tentacles do
            // (fixes the location race).
            requestUserCoordinate().then((result) => {
                const center = result.coordinate ?? getLastKnownMapCenter();
                if (center) {
                    updateQuestion(question.id, (current) =>
                        updateQuestionCenter(current, center),
                    );
                }
            });
        },
        [createQuestion, onNavigate, playArea.center, updateQuestion],
    );

    return (
        <SheetScrollView contentContainerStyle={styles.scrollContent}>
            <MeasuringCategoryList onSelect={handlePick} />
        </SheetScrollView>
    );
}

const styles = StyleSheet.create({
    scrollContent: {
        paddingTop: 0,
    },
});

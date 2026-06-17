import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { requestUserCoordinate } from "@/shared/location";
import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { getLastKnownMapCenter } from "@/features/map/mapCenter";
import { offsetPosition } from "@/shared/geojson";
import { usePlayArea } from "@/state/playAreaStore";
import {
    updateQuestionCenter,
    updateThermometerPin,
    useQuestionActions,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";

type AddQuestionScreenProps = {
    onNavigate: (route: SheetRouteName) => void;
};

export function AddQuestionScreen({ onNavigate }: AddQuestionScreenProps) {
    const { playArea } = usePlayArea();
    const { createQuestion, updateQuestion } = useQuestionActions();

    // Navigate immediately with the play-area center as fallback, then
    // update the question's center in the background if location arrives.
    const addRadarQuestion = useCallback(() => {
        const question = createQuestion("radar", {
            center: playArea.center,
        });
        onNavigate("question-detail");

        requestUserCoordinate().then((result) => {
            const center = result.coordinate ?? getLastKnownMapCenter();
            if (center) {
                updateQuestion(question.id, (current) =>
                    updateQuestionCenter(current, center),
                );
            }
        });
    }, [createQuestion, onNavigate, playArea.center, updateQuestion]);

    const addThermometerQuestion = useCallback(() => {
        const question = createQuestion("thermometer", {
            center: playArea.center,
        });
        onNavigate("question-detail");

        requestUserCoordinate().then((result) => {
            const center = result.coordinate ?? getLastKnownMapCenter();
            if (center) {
                updateQuestion(question.id, (current) => {
                    if (current.type !== "thermometer") {
                        return updateQuestionCenter(current, center);
                    }
                    const updated = updateThermometerPin(
                        current,
                        "start",
                        center,
                    );
                    return updateThermometerPin(
                        updated,
                        "end",
                        offsetPosition(center, 300, 90),
                    );
                });
            }
        });
    }, [createQuestion, onNavigate, playArea.center, updateQuestion]);

    const addTentaclesQuestion = useCallback(() => {
        const question = createQuestion("tentacles", {
            center: playArea.center,
            category: "museum",
        });
        onNavigate("question-detail");

        requestUserCoordinate().then((result) => {
            const center = result.coordinate ?? getLastKnownMapCenter();
            if (center) {
                updateQuestion(question.id, (current) =>
                    updateQuestionCenter(current, center),
                );
            }
        });
    }, [createQuestion, onNavigate, playArea.center, updateQuestion]);

    return (
        <SheetScrollView contentContainerStyle={styles.scrollContent}>
            <Pressable
                accessibilityLabel="Add radar question"
                accessibilityRole="button"
                onPress={addRadarQuestion}
                style={({ pressed }) => [
                    styles.optionRow,
                    pressed ? styles.actionPressed : null,
                ]}
                testID="add-radar-question-row"
            >
                <View style={styles.optionCopy}>
                    <Text style={styles.optionTitle}>Radar</Text>
                    <Text style={styles.metadata}>
                        Preview a distance from a movable map pin.
                    </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Pressable
                accessibilityLabel="Open matching questions"
                accessibilityRole="button"
                onPress={() => onNavigate("matching")}
                style={({ pressed }) => [
                    styles.optionRow,
                    pressed ? styles.actionPressed : null,
                ]}
                testID="add-matching-question-row"
            >
                <View style={styles.optionCopy}>
                    <Text style={styles.optionTitle}>Matching</Text>
                    <Text style={styles.metadata}>
                        Choose a question that compares nearby candidates.
                    </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Pressable
                accessibilityLabel="Add thermometer question"
                accessibilityRole="button"
                onPress={addThermometerQuestion}
                style={({ pressed }) => [
                    styles.optionRow,
                    pressed ? styles.actionPressed : null,
                ]}
                testID="add-thermometer-question-row"
            >
                <View style={styles.optionCopy}>
                    <Text style={styles.optionTitle}>Thermometer</Text>
                    <Text style={styles.metadata}>
                        Compare whether movement is hotter or colder.
                    </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Pressable
                accessibilityLabel="Add measuring question"
                accessibilityRole="button"
                onPress={() => onNavigate("measuring")}
                style={({ pressed }) => [
                    styles.optionRow,
                    pressed ? styles.actionPressed : null,
                ]}
                testID="add-measuring-question-row"
            >
                <View style={styles.optionCopy}>
                    <Text style={styles.optionTitle}>Measuring</Text>
                    <Text style={styles.metadata}>
                        Compare distance to a selected place or boundary.
                    </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Pressable
                accessibilityLabel="Add tentacles question"
                accessibilityRole="button"
                onPress={addTentaclesQuestion}
                style={({ pressed }) => [
                    styles.optionRow,
                    pressed ? styles.actionPressed : null,
                ]}
                testID="add-tentacles-question-row"
            >
                <View style={styles.optionCopy}>
                    <Text style={styles.optionTitle}>Tentacles</Text>
                    <Text style={styles.metadata}>
                        Find the closest qualifying place within range.
                    </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
            </Pressable>
        </SheetScrollView>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    chevron: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
    },
    metadata: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
    },
    optionCopy: {
        flex: 1,
    },
    optionRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        marginTop: 12,
        minHeight: 58,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    optionTitle: {
        color: colors.ink,
        fontSize: 18,
        fontWeight: "800",
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: 0,
    },
});

import { Pressable, StyleSheet, Text, View } from "react-native";

import { QuestionAnswerSelector } from "@/features/questions/components/QuestionAnswerSelector";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import { haversineDistanceMeters } from "@/shared/geojson";
import { fromMeters } from "@/shared/distanceUnits";
import { useQuestionActions, useActivePinKey } from "@/state/questionStore";
import { colors } from "@/theme/colors";
import type { Position } from "@/shared/geojson";

function formatCoord(pos: Position): string {
    return `${pos[1].toFixed(4)}, ${pos[0].toFixed(4)}`;
}

type ThermometerQuestionDetailScreenProps = {
    question: ThermometerQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
};

export function ThermometerQuestionDetailScreen({
    question,
    updateQuestion,
}: ThermometerQuestionDetailScreenProps) {
    const { setActivePinKey } = useQuestionActions();
    const activePinKey = useActivePinKey();

    const startPosition = question.previousPosition;
    const endPosition = question.currentPosition;

    const distanceMeters =
        startPosition && endPosition
            ? haversineDistanceMeters(
                  startPosition[1],
                  startPosition[0],
                  endPosition[1],
                  endPosition[0],
              )
            : 0;

    const isDegenerate = distanceMeters < 100;

    const handleAnswerChange = (
        answer: "unanswered" | "positive" | "negative",
    ) => {
        updateQuestion(question.id, (current) =>
            current.type === "thermometer"
                ? { ...current, answer, updatedAt: new Date().toISOString() }
                : current,
        );
    };

    return (
        <>
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Answer</Text>
                <QuestionAnswerSelector
                    answer={question.answer}
                    disabledAnswers={
                        isDegenerate ? ["positive", "negative"] : []
                    }
                    onChange={handleAnswerChange}
                    questionType={question.type}
                    testIDPrefix="thermometer-answer-option"
                />
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Active Pin</Text>
                <View style={styles.pinToggleRow}>
                    <Pressable
                        accessibilityLabel="Set active pin to start"
                        accessibilityRole="button"
                        accessibilityState={{
                            selected: activePinKey === "start",
                        }}
                        onPress={() => setActivePinKey("start")}
                        style={({ pressed }) => [
                            styles.pinToggleButton,
                            activePinKey === "start"
                                ? styles.pinToggleButtonActive
                                : null,
                            pressed ? styles.actionPressed : null,
                        ]}
                        testID="thermometer-active-pin-start"
                    >
                        <Text
                            style={[
                                styles.pinToggleButtonText,
                                activePinKey === "start"
                                    ? styles.pinToggleButtonTextActive
                                    : null,
                            ]}
                        >
                            Start
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityLabel="Set active pin to end"
                        accessibilityRole="button"
                        accessibilityState={{
                            selected: activePinKey === "end",
                        }}
                        onPress={() => setActivePinKey("end")}
                        style={({ pressed }) => [
                            styles.pinToggleButton,
                            activePinKey === "end"
                                ? styles.pinToggleButtonActive
                                : null,
                            pressed ? styles.actionPressed : null,
                        ]}
                        testID="thermometer-active-pin-end"
                    >
                        <Text
                            style={[
                                styles.pinToggleButtonText,
                                activePinKey === "end"
                                    ? styles.pinToggleButtonTextActive
                                    : null,
                            ]}
                        >
                            End
                        </Text>
                    </Pressable>
                </View>
            </View>

            <View style={styles.section}>
                <View style={styles.positionRow}>
                    <View style={styles.positionCol}>
                        <Text style={styles.positionLabel}>Start</Text>
                        <Text
                            style={styles.positionValue}
                            testID="thermometer-start-pos"
                        >
                            {startPosition
                                ? formatCoord(startPosition)
                                : "Not set"}
                        </Text>
                    </View>
                    <View style={styles.positionCol}>
                        <Text style={styles.positionLabel}>End</Text>
                        <Text
                            style={styles.positionValue}
                            testID="thermometer-end-pos"
                        >
                            {endPosition ? formatCoord(endPosition) : "Not set"}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Distance</Text>
                <Text
                    style={styles.distanceValue}
                    testID="thermometer-distance"
                >
                    {fromMeters(distanceMeters, "km")} km
                </Text>
                {isDegenerate ? (
                    <Text
                        style={styles.warningText}
                        testID="thermometer-degenerate-warning"
                    >
                        Pins are too close together for a meaningful thermometer
                        question.
                    </Text>
                ) : null}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    distanceValue: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "800",
        marginTop: 8,
    },
    metadata: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 8,
    },
    pinToggleButton: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flex: 1,
        justifyContent: "center",
        minHeight: 46,
        paddingHorizontal: 14,
    },
    pinToggleButtonActive: {
        backgroundColor: colors.button,
        borderColor: colors.button,
    },
    pinToggleButtonText: {
        color: colors.ink,
        fontSize: 15,
        fontWeight: "800",
    },
    pinToggleButtonTextActive: {
        color: colors.white,
    },
    pinToggleRow: {
        flexDirection: "row",
        gap: 10,
        marginTop: 10,
    },
    positionCol: { flex: 1 },
    positionLabel: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: "700",
        textTransform: "uppercase",
    },
    positionRow: {
        flexDirection: "row",
        gap: 12,
        marginTop: 8,
    },
    positionValue: {
        color: colors.ink,
        fontSize: 13,
        fontWeight: "600",
        marginTop: 2,
    },
    section: {
        marginTop: 12,
    },
    sectionTitle: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "800",
    },
    warningText: {
        color: "#b42318",
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
        marginTop: 8,
    },
});

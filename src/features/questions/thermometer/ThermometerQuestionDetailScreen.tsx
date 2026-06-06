import { Pressable, StyleSheet, Text, View } from "react-native";

import { QuestionAnswerSelector } from "@/features/questions/components/QuestionAnswerSelector";
import { QuestionLocationSelector } from "@/features/questions/components/QuestionLocationSelector";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import { haversineDistanceMeters } from "@/shared/geojson";
import { fromMeters } from "@/shared/distanceUnits";
import {
    updateThermometerPin,
    useQuestionActions,
    useActivePinKey,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";

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

    const handlePinChange = (
        pin: "start" | "end",
        position: [number, number],
    ) => {
        updateQuestion(question.id, (current) =>
            current.type === "thermometer"
                ? updateThermometerPin(current, pin, position)
                : current,
        );
    };

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
                <Text style={styles.sectionTitle}>Start Position</Text>
                {startPosition ? (
                    <QuestionLocationSelector
                        center={startPosition}
                        onCenterChange={(pos) => handlePinChange("start", pos)}
                        setToLocationAccessibilityLabel="Set thermometer start pin to my location"
                        testIDPrefix="thermometer-start"
                    />
                ) : (
                    <Text style={styles.metadata}>Not set</Text>
                )}
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>End Position</Text>
                {endPosition ? (
                    <QuestionLocationSelector
                        center={endPosition}
                        onCenterChange={(pos) => handlePinChange("end", pos)}
                        setToLocationAccessibilityLabel="Set thermometer end pin to my location"
                        testIDPrefix="thermometer-end"
                    />
                ) : (
                    <Text style={styles.metadata}>Not set</Text>
                )}
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

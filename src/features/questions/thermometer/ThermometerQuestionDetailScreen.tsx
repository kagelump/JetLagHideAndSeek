import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { QuestionAnswerSelector } from "@/features/questions/components/QuestionAnswerSelector";
import type { ThermometerStationAnchor } from "@/features/questions/thermometer/thermometerTypes";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import { useThermometerDrag } from "@/features/questions/thermometer/ThermometerDragContext";
import { useThermometerStationAnchors } from "@/features/questions/thermometer/useThermometerStationAnchors";
import { useQuestionElimination } from "@/features/questions/useQuestionElimination";
import { formatCoordinate, haversineDistanceMeters } from "@/shared/geojson";
import { fromMeters } from "@/shared/distanceUnits";
import { useQuestionActions } from "@/state/questionStore";
import { colors } from "@/theme/colors";

function formatStationLabel(anchor: ThermometerStationAnchor | null): string {
    if (!anchor) return "…"; // resolving
    if (anchor.name == null) return "No station nearby";
    const m = anchor.distanceMeters ?? 0;
    const dist = m < 1000 ? `${Math.round(m)} m` : `${fromMeters(m, "km")} km`;
    return `${anchor.name} (${dist})`;
}

type ThermometerQuestionDetailScreenProps = {
    question: ThermometerQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
};

export function ThermometerQuestionDetailScreen({
    question,
    updateQuestion,
}: ThermometerQuestionDetailScreenProps) {
    const drag = useThermometerDrag();
    useThermometerStationAnchors(question, updateQuestion);

    // While dragging a pin, feed the live positions in so the elimination stats
    // update in real time (drag.p1/p2 map to previous/current position).
    const liveOverride = useMemo(
        () =>
            drag
                ? {
                      ...question,
                      previousPosition: drag.p1,
                      currentPosition: drag.p2,
                  }
                : null,
        [drag, question],
    );
    const elimination = useQuestionElimination(question.id, liveOverride);
    const startPosition = question.previousPosition;
    const endPosition = question.currentPosition;

    const committedDistanceMeters =
        startPosition && endPosition
            ? haversineDistanceMeters(
                  startPosition[1],
                  startPosition[0],
                  endPosition[1],
                  endPosition[0],
              )
            : 0;

    const distanceMeters = drag ? drag.distanceMeters : committedDistanceMeters;

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
                <View style={styles.positionRow}>
                    <View style={styles.positionCol}>
                        <Text style={styles.positionLabel}>Start</Text>
                        <Text
                            style={styles.positionValue}
                            testID="thermometer-start-pos"
                        >
                            {startPosition
                                ? formatCoordinate(startPosition)
                                : "Not set"}
                        </Text>
                        {startPosition ? (
                            <Text
                                style={styles.stationLabel}
                                testID="thermometer-start-station"
                            >
                                {formatStationLabel(question.previousStation)}
                            </Text>
                        ) : null}
                    </View>
                    <View style={styles.positionCol}>
                        <Text style={styles.positionLabel}>End</Text>
                        <Text
                            style={styles.positionValue}
                            testID="thermometer-end-pos"
                        >
                            {endPosition
                                ? formatCoordinate(endPosition)
                                : "Not set"}
                        </Text>
                        {endPosition ? (
                            <Text
                                style={styles.stationLabel}
                                testID="thermometer-end-station"
                            >
                                {formatStationLabel(question.currentStation)}
                            </Text>
                        ) : null}
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
                {elimination !== null ? (
                    <Text
                        style={styles.eliminationValue}
                        testID="thermometer-elimination"
                    >
                        {elimination.totalPct}% eliminated (+
                        {elimination.byThisPct}% by this question)
                    </Text>
                ) : null}
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
    distanceValue: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "800",
        marginTop: 8,
    },
    eliminationValue: {
        color: colors.tint,
        fontSize: 14,
        fontWeight: "700",
        marginTop: 4,
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
    stationLabel: {
        color: colors.muted,
        fontSize: 12,
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

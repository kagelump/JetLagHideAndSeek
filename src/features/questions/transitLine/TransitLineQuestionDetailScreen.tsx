import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { QuestionAnswerSelector } from "@/features/questions/components/QuestionAnswerSelector";
import { QuestionLocationSelector } from "@/features/questions/components/QuestionLocationSelector";
import { formatStationDistance } from "@/features/questions/radar/radarGeometry";
import type { TransitLineQuestion } from "@/features/questions/transitLine/transitLineTypes";
import {
    getTransitLineOptions,
    reconcileTransitLineQuestionSelection,
} from "@/features/questions/transitLine/transitLineQuestion";
import {
    useHidingZoneDerived,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import {
    updateQuestionCenter,
    useQuestionActions,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";

export function TransitLineQuestionDetailScreen({
    question,
    updateQuestion,
}: {
    question: TransitLineQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
}) {
    const { radiusMeters } = useHidingZoneState();
    const { selectedRoutes, selectedStations } = useHidingZoneDerived();

    const routeNames = useMemo(
        () => new Map(selectedRoutes.map((route) => [route.id, route.name])),
        [selectedRoutes],
    );
    const lineOptions = useMemo(
        () =>
            getTransitLineOptions(
                selectedStations,
                routeNames,
                question.center,
                radiusMeters,
            ),
        [selectedStations, routeNames, question.center, radiusMeters],
    );
    const lineOptionIds = useMemo(
        () => lineOptions.map((line) => line.id).join("\0"),
        [lineOptions],
    );

    useEffect(() => {
        updateQuestion(question.id, (current) =>
            current.type === "matching"
                ? reconcileTransitLineQuestionSelection(current, lineOptions)
                : current,
        );
    }, [lineOptionIds, question.id, question.lineId, updateQuestion]);

    return (
        <>
            <View style={styles.section}>
                <Text
                    accessibilityLabel="Transit line answer section"
                    style={styles.sectionTitle}
                >
                    Answer
                </Text>
                <QuestionAnswerSelector
                    answer={question.answer}
                    disabledAnswers={
                        question.lineId === null
                            ? ["positive", "negative"]
                            : undefined
                    }
                    onChange={(answer) =>
                        updateQuestion(question.id, (current) =>
                            current.type === "matching"
                                ? {
                                      ...current,
                                      answer,
                                      updatedAt: new Date().toISOString(),
                                  }
                                : current,
                        )
                    }
                    questionType={question.type}
                    testIDPrefix="matching-answer-option"
                />
            </View>

            <QuestionLocationSelector
                center={question.center}
                onCenterChange={(center) =>
                    updateQuestion(question.id, (current) =>
                        updateQuestionCenter(current, center),
                    )
                }
                setToLocationAccessibilityLabel="Set transit line pin to my location"
                showSetToLocationButton={false}
                testIDPrefix="transit-line"
            />

            {selectedStations.length === 0 ? (
                <Text style={styles.emptyHint} testID="transit-line-no-presets">
                    Select transit presets in Hiding Zones settings to see
                    available lines.
                </Text>
            ) : lineOptions.length === 0 ? (
                <Text style={styles.emptyHint}>
                    No transit lines found within range.
                </Text>
            ) : null}

            <View style={styles.optionList}>
                {lineOptions.map((line) => {
                    const isSelected = line.id === question.lineId;
                    return (
                        <Pressable
                            accessibilityLabel={getLineAccessibilityLabel(line)}
                            accessibilityRole="button"
                            key={line.id}
                            onPress={() =>
                                updateQuestion(question.id, (current) =>
                                    current.type === "matching"
                                        ? {
                                              ...current,
                                              lineId: line.id,
                                              lineName: line.name,
                                              updatedAt:
                                                  new Date().toISOString(),
                                          }
                                        : current,
                                )
                            }
                            style={[
                                styles.lineRow,
                                isSelected ? styles.lineRowSelected : null,
                            ]}
                            testID={`transit-line-option-${line.id}`}
                        >
                            <View style={styles.lineCopy}>
                                <Text style={styles.lineName}>{line.name}</Text>
                                <Text style={styles.meta}>
                                    {line.stationCount} stations
                                </Text>
                            </View>
                            <View style={styles.closestStation}>
                                <Text
                                    numberOfLines={1}
                                    style={styles.closestStationName}
                                >
                                    {line.closestStation?.station.name ??
                                        "No station"}
                                </Text>
                                <Text style={styles.closestStationDistance}>
                                    {line.distanceMeters === null
                                        ? "No distance"
                                        : formatStationDistance(
                                              line.distanceMeters,
                                          )}
                                </Text>
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        </>
    );
}

type TransitLineOption = ReturnType<typeof getTransitLineOptions>[number];

function getLineAccessibilityLabel(line: TransitLineOption): string {
    const station = line.closestStation?.station.name ?? "No station";
    const distance =
        line.distanceMeters === null
            ? "No distance"
            : formatStationDistance(line.distanceMeters);
    return `${line.name}, closest station ${station}, ${distance}`;
}

const styles = StyleSheet.create({
    closestStation: {
        alignItems: "flex-end",
        flexShrink: 1,
        gap: 2,
        maxWidth: "46%",
    },
    closestStationDistance: {
        color: colors.tint,
        fontSize: 13,
        fontWeight: "800",
    },
    closestStationName: {
        color: colors.ink,
        fontSize: 13,
        fontWeight: "700",
    },
    lineCopy: { flex: 1 },
    lineName: { color: colors.ink, fontSize: 16, fontWeight: "700" },
    lineRow: {
        alignItems: "center",
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: colors.card,
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        minHeight: 58,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    lineRowSelected: {
        borderColor: colors.tint,
        backgroundColor: colors.buttonSubtle,
    },
    emptyHint: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 8,
    },
    meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
    optionList: { gap: 8, marginTop: 12 },
    section: {
        marginTop: 12,
    },
    sectionTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "800",
    },
});

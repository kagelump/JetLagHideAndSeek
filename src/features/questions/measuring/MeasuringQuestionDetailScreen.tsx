import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { QuestionAnswerSelector } from "@/features/questions/components/QuestionAnswerSelector";
import { QuestionLocationSelector } from "@/features/questions/components/QuestionLocationSelector";
import { fromMeters } from "@/shared/distanceUnits";
import {
    updateQuestionCenter,
    useQuestionActions,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";
import type { DistanceUnit } from "@/shared/distanceUnits";
import {
    getMeasuringCategoryTitle,
    isLineMeasuringCategory,
    measuringCategoriesBySection,
    type MeasuringCategorySection,
} from "./measuringCategories";
import { computeLineDistance } from "./lineMeasuringGeometry";
import { computeNearestPoiDistance } from "./pointMeasuringGeometry";
import type { MeasuringCategory, MeasuringQuestion } from "./measuringTypes";

type MeasuringQuestionDetailScreenProps = {
    question: MeasuringQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
};

const DISTANCE_UNITS: DistanceUnit[] = ["m", "km", "mi"];

// ─── Shared auto-result component ────────────────────────────────────────────

type DistanceResolver = (
    center: [number, number],
    category: MeasuringCategory,
) => { nearestPoint: [number, number]; distanceMeters: number } | null;

type MeasuringAutoResultProps = {
    question: MeasuringQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
    distanceResolver: DistanceResolver;
};

function MeasuringAutoResult({
    question,
    updateQuestion,
    distanceResolver,
}: MeasuringAutoResultProps) {
    const categoryTitle = getMeasuringCategoryTitle(question.category);

    const result = useMemo(() => {
        try {
            return distanceResolver(question.center, question.category);
        } catch (err) {
            console.warn(
                `[MeasuringAutoResult] distance resolver failed:`,
                err,
            );
            return null;
        }
    }, [question.center, question.category, distanceResolver]);

    const displayDistance =
        result?.distanceMeters !== undefined && result.distanceMeters !== null
            ? fromMeters(result.distanceMeters, question.seekerDistanceUnit)
            : null;

    const handleUnitChange = useCallback(
        (unit: DistanceUnit) => {
            updateQuestion(question.id, (current) => {
                if (current.type !== "measuring") return current;
                return {
                    ...current,
                    seekerDistanceUnit: unit,
                    updatedAt: new Date().toISOString(),
                };
            });
        },
        [question.id, updateQuestion],
    );

    const answerEnabled = displayDistance !== null;

    return (
        <>
            {/* ── Position pin ──────────────────────────────────────── */}
            <QuestionLocationSelector
                center={question.center}
                onCenterChange={(center) =>
                    updateQuestion(question.id, (current) =>
                        updateQuestionCenter(current, center),
                    )
                }
                setToLocationAccessibilityLabel={`Set measuring pin to my location`}
                testIDPrefix="measuring"
            />

            {/* ── Result block ──────────────────────────────────────── */}
            <View style={styles.section}>
                <View style={styles.resultBlock} testID="measuring-auto-result">
                    <Text style={styles.sectionTitle}>
                        Nearest {categoryTitle.toLowerCase()}
                    </Text>
                    <Text
                        style={styles.distanceValue}
                        testID="measuring-auto-distance"
                    >
                        {displayDistance !== null
                            ? `${displayDistance} ${question.seekerDistanceUnit}`
                            : "Computing..."}
                    </Text>
                </View>

                {/* ── Planning phrase ──────────────────────────────── */}
                {displayDistance !== null ? (
                    <Text
                        style={styles.planningPhrase}
                        testID="measuring-auto-phrase"
                    >
                        {"I'm"} {displayDistance} {question.seekerDistanceUnit}{" "}
                        from the nearest {categoryTitle.toLowerCase()}. Are you
                        closer or farther from yours?
                    </Text>
                ) : null}

                {/* ── Unit toggle ──────────────────────────────────── */}
                <View style={styles.unitToggle}>
                    {DISTANCE_UNITS.map((unit) => {
                        const isActive = question.seekerDistanceUnit === unit;
                        return (
                            <Pressable
                                accessibilityLabel={`${unit} distance unit`}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isActive }}
                                key={unit}
                                onPress={() => handleUnitChange(unit)}
                                style={[
                                    styles.unitButton,
                                    isActive ? styles.unitButtonActive : null,
                                ]}
                                testID={`measuring-unit-${unit}`}
                            >
                                <Text
                                    style={[
                                        styles.unitButtonText,
                                        isActive
                                            ? styles.unitButtonTextActive
                                            : null,
                                    ]}
                                >
                                    {unit}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            {/* ── Answer selector ───────────────────────────────────── */}
            <View style={styles.section}>
                <Text
                    accessibilityLabel="Measuring answer section"
                    style={styles.sectionTitle}
                >
                    Answer
                </Text>
                <QuestionAnswerSelector
                    answer={question.answer}
                    disabledAnswers={
                        !answerEnabled ? ["positive", "negative"] : undefined
                    }
                    onChange={(answer) => {
                        updateQuestion(question.id, (current) =>
                            current.type === "measuring"
                                ? {
                                      ...current,
                                      answer,
                                      updatedAt: new Date().toISOString(),
                                  }
                                : current,
                        );
                    }}
                    questionType={question.type}
                    testIDPrefix="measuring-answer-option"
                />
            </View>
        </>
    );
}

// ─── Main screen ────────────────────────────────────────────────────────────

export function MeasuringQuestionDetailScreen({
    question,
    updateQuestion,
}: MeasuringQuestionDetailScreenProps) {
    const categoryTitle = getMeasuringCategoryTitle(question.category);

    const handleCategoryChange = useCallback(
        (category: MeasuringCategory) => {
            updateQuestion(question.id, (current) => {
                if (current.type !== "measuring") return current;
                return {
                    ...current,
                    category,
                    updatedAt: new Date().toISOString(),
                };
            });
        },
        [question.id, updateQuestion],
    );

    // Line/polygon categories: static category readout, line-distance resolver.
    if (isLineMeasuringCategory(question.category)) {
        return (
            <>
                {/* ── Category readout (static for lines) ──────────── */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Category</Text>
                    <View style={styles.categoryPicker}>
                        <View style={styles.staticCategoryResult}>
                            <Text style={styles.categoryTitle}>
                                {categoryTitle}
                            </Text>
                        </View>
                    </View>
                </View>

                <MeasuringAutoResult
                    question={question}
                    updateQuestion={updateQuestion}
                    distanceResolver={computeLineDistance}
                />
            </>
        );
    }

    // Point categories: category picker + point-distance resolver.
    return (
        <>
            {/* ── Category picker ──────────────────────────────────── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Category</Text>
                <View style={styles.categoryPicker}>
                    {(
                        Object.entries(measuringCategoriesBySection) as [
                            MeasuringCategorySection,
                            (typeof measuringCategoriesBySection)[MeasuringCategorySection],
                        ][]
                    ).map(([section, configs]) => {
                        const implemented = configs.filter(
                            (
                                c,
                            ): c is (typeof configs)[number] & {
                                implemented: true;
                            } => c.implemented,
                        );
                        if (implemented.length === 0) return null;
                        return (
                            <View key={section} style={styles.categorySection}>
                                <Text style={styles.categorySectionLabel}>
                                    {section}
                                </Text>
                                {implemented.map((config) => {
                                    const isSelected =
                                        question.category === config.category;
                                    return (
                                        <Pressable
                                            accessibilityLabel={`${config.title} measuring category`}
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                selected: isSelected,
                                            }}
                                            key={config.category}
                                            onPress={() =>
                                                handleCategoryChange(
                                                    config.category,
                                                )
                                            }
                                            style={[
                                                styles.categoryRow,
                                                isSelected
                                                    ? styles.categoryRowSelected
                                                    : null,
                                            ]}
                                            testID={`measuring-category-${config.category}`}
                                        >
                                            <View
                                                style={[
                                                    styles.categoryRadio,
                                                    isSelected
                                                        ? styles.categoryRadioSelected
                                                        : null,
                                                ]}
                                            />
                                            <Text style={styles.categoryTitle}>
                                                {config.title}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        );
                    })}
                </View>
            </View>

            <MeasuringAutoResult
                question={question}
                updateQuestion={updateQuestion}
                distanceResolver={computeNearestPoiDistance}
            />
        </>
    );
}

const styles = StyleSheet.create({
    categoryPicker: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 10,
        overflow: "hidden",
    },
    categoryRadio: {
        borderColor: colors.muted,
        borderRadius: 10,
        borderWidth: 2,
        height: 20,
        marginRight: 10,
        width: 20,
    },
    categoryRadioSelected: {
        backgroundColor: colors.tint,
        borderColor: colors.tint,
        borderWidth: 6,
    },
    categoryRow: {
        alignItems: "center",
        flexDirection: "row",
        minHeight: 44,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    categoryRowSelected: {
        backgroundColor: colors.buttonSubtle,
    },
    categorySection: {
        borderColor: colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingBottom: 4,
        paddingTop: 6,
    },
    categorySectionLabel: {
        color: colors.muted,
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0.4,
        marginBottom: 2,
        paddingHorizontal: 14,
        textTransform: "uppercase",
    },
    categoryTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "600",
    },
    distanceValue: {
        color: colors.tint,
        fontSize: 24,
        fontWeight: "800",
        marginTop: 4,
    },
    planningPhrase: {
        color: colors.ink,
        fontSize: 14,
        fontWeight: "600",
        lineHeight: 20,
    },
    resultBlock: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 10,
        padding: 16,
    },
    section: {
        marginTop: 12,
    },
    sectionTitle: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "800",
    },
    staticCategoryResult: {
        minHeight: 44,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    unitButton: {
        alignItems: "center",
        borderRadius: 7,
        flex: 1,
        justifyContent: "center",
        minHeight: 36,
        paddingHorizontal: 10,
    },
    unitButtonActive: {
        backgroundColor: colors.button,
    },
    unitButtonText: {
        color: colors.ink,
        fontSize: 13,
        fontWeight: "800",
    },
    unitButtonTextActive: {
        color: colors.white,
    },
    unitToggle: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 4,
        marginTop: 10,
        padding: 4,
    },
});

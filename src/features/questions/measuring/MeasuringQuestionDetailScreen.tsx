import { useCallback, useMemo, useState } from "react";
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
} from "./measuringCategories";
import { computeLineDistance } from "./lineMeasuringGeometry";
import { computeNearestPoiDistance } from "./pointMeasuringGeometry";
import { MeasuringCategoryList } from "./MeasuringCategoryList";
import { useEnsureMeasuringBundles } from "./useEnsureMeasuringBundles";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";
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
    /** Bumps when async line bundles finish loading; triggers recompute. */
    bundleRevision?: number;
};

function MeasuringAutoResult({
    question,
    updateQuestion,
    distanceResolver,
    bundleRevision,
}: MeasuringAutoResultProps) {
    const categoryTitle = getMeasuringCategoryTitle(question.category);

    // Observe the shared deferred computation so we only compute the distance
    // after its cache is warm. Calling distanceResolver (computeLineDistance
    // for line categories) during render on a cold cache blocks the JS thread
    // for ~2 s with turf simplify. Instead, wait for the deferred computation
    // to settle — it already calls computeLineCategory → computeLineDistance
    // and populates the LRU cache, so our call will be a fast hit.
    const { isComputing } = useQuestionMapRenderState();

    const result = useMemo(() => {
        if (isComputing) return null;
        try {
            return distanceResolver(question.center, question.category);
        } catch (err) {
            console.warn(
                `[MeasuringAutoResult] distance resolver failed:`,
                err,
            );
            return null;
        }
    }, [
        question.center,
        question.category,
        distanceResolver,
        bundleRevision,
        isComputing,
    ]);

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
            {/* ── Answer selector (top) ─────────────────────────────── */}
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
        </>
    );
}

// ─── Main screen ────────────────────────────────────────────────────────────

export function MeasuringQuestionDetailScreen({
    question,
    updateQuestion,
}: MeasuringQuestionDetailScreenProps) {
    const categoryTitle = getMeasuringCategoryTitle(question.category);
    const [isChanging, setIsChanging] = useState(false);

    // Ensure line bundles are loaded for the current category. The shared
    // deferred computation (useQuestionMapRenderState) also calls this hook
    // internally; this second call is a belt-and-suspenders that covers the
    // edge case where this screen mounts before the map.
    const bundleRevision = useEnsureMeasuringBundles(
        useMemo(
            () =>
                isLineMeasuringCategory(question.category) ? [question] : [],
            [question],
        ),
    );

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

    const handleSelectCategory = useCallback(
        (category: MeasuringCategory) => {
            handleCategoryChange(category);
            setIsChanging(false);
        },
        [handleCategoryChange],
    );

    const distanceResolver = isLineMeasuringCategory(question.category)
        ? computeLineDistance
        : computeNearestPoiDistance;

    return (
        <>
            {/* ── Category section ────────────────────────────────── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Category</Text>
                <Pressable
                    accessibilityLabel={`${categoryTitle} — tap to change category`}
                    accessibilityRole="button"
                    onPress={() => setIsChanging((v) => !v)}
                    style={[styles.categoryPicker, styles.changeHeader]}
                    testID="measuring-category-change"
                >
                    <Text style={styles.changeHeaderText}>{categoryTitle}</Text>
                    <Text style={styles.changeHint}>
                        {isChanging ? "Done" : "Change"}
                    </Text>
                </Pressable>
                {isChanging ? (
                    <View style={styles.inlineList}>
                        <MeasuringCategoryList
                            selectedCategory={question.category}
                            onSelect={handleSelectCategory}
                        />
                    </View>
                ) : null}
            </View>

            <MeasuringAutoResult
                question={question}
                updateQuestion={updateQuestion}
                distanceResolver={distanceResolver}
                bundleRevision={bundleRevision}
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
    changeHeader: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        minHeight: 48,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    changeHeaderText: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "600",
    },
    changeHint: {
        color: colors.tint,
        fontSize: 14,
        fontWeight: "700",
    },
    distanceValue: {
        color: colors.tint,
        fontSize: 24,
        fontWeight: "800",
        marginTop: 4,
    },
    inlineList: {
        marginTop: 10,
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

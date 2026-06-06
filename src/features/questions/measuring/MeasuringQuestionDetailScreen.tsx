import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { QuestionAnswerSelector } from "@/features/questions/components/QuestionAnswerSelector";
import { QuestionLocationSelector } from "@/features/questions/components/QuestionLocationSelector";
import { OsmFeatureDetailModal } from "@/features/questions/matching/OsmFeatureDetailModal";
import { OsmMatchingCandidatesModal } from "@/features/questions/matching/OsmMatchingCandidatesModal";
import { formatCandidateName } from "@/features/questions/matching/formatCandidateName";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";
import { formatStationDistance } from "@/features/questions/radar/radarGeometry";
import { fromMeters } from "@/shared/distanceUnits";
import { haversineDistanceMeters, positionsEqual } from "@/shared/geojson";
import {
    updateQuestionCenter,
    useLabelLanguage,
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
import type { MeasuringCategory, MeasuringQuestion } from "./measuringTypes";
import { useMeasuringSearch } from "./useMeasuringSearch";

type MeasuringQuestionDetailScreenProps = {
    question: MeasuringQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
};

const DISTANCE_UNITS: DistanceUnit[] = ["m", "km", "mi"];

// ─── Line-category result ────────────────────────────────────────────────────

type LineMeasuringResultProps = {
    question: MeasuringQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
};

function LineMeasuringResult({
    question,
    updateQuestion,
}: LineMeasuringResultProps) {
    const categoryTitle = getMeasuringCategoryTitle(question.category);

    const result = useMemo(
        () => computeLineDistance(question.center, question.category),
        [question.center, question.category],
    );

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

    const answerEnabled = true; // line categories: answer is always enabled

    return (
        <>
            {/* ── Category readout ────────────────────────────────── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Category</Text>
                <View style={styles.categoryPicker}>
                    <View style={styles.lineCategoryResult}>
                        <Text style={styles.categoryTitle}>
                            {categoryTitle}
                        </Text>
                    </View>
                </View>
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
                <View
                    style={styles.lineResultBlock}
                    testID="measuring-line-result"
                >
                    <Text style={styles.sectionTitle}>
                        Nearest {categoryTitle.toLowerCase()}
                    </Text>
                    <Text
                        style={styles.lineDistanceValue}
                        testID="measuring-line-distance"
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
                        testID="measuring-line-phrase"
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
                    onChange={(answer) =>
                        updateQuestion(question.id, (current) =>
                            current.type === "measuring"
                                ? {
                                      ...current,
                                      answer,
                                      updatedAt: new Date().toISOString(),
                                  }
                                : current,
                        )
                    }
                    questionType={question.type}
                    testIDPrefix="measuring-answer-option"
                />
            </View>
        </>
    );
}

export function MeasuringQuestionDetailScreen({
    question,
    updateQuestion,
}: MeasuringQuestionDetailScreenProps) {
    const [isShowAllModalVisible, setShowAllModalVisible] = useState(false);
    const [detailFeature, setDetailFeature] = useState<
        (OsmFeature & { distanceMeters?: number }) | null
    >(null);
    const [isDetailVisible, setDetailVisible] = useState(false);
    const [cacheSource, setCacheSource] = useState<string | null>(null);
    const labelLanguage = useLabelLanguage();
    const categoryTitle = getMeasuringCategoryTitle(question.category);
    const lastSearchCenterRef = useRef<[number, number] | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Incremented whenever category or center changes so in-flight searches can
    // detect that their results are stale and discard them.
    const searchGenerationRef = useRef(0);

    const { isLoading, error, performSearch } = useMeasuringSearch(
        question.category,
        question.center,
    );

    // Wrap performSearch to update the question with results.
    const searchAndUpdate = useCallback(
        async (forceRefresh = false) => {
            const generation = ++searchGenerationRef.current;
            lastSearchCenterRef.current = question.center;
            const result = await performSearch(forceRefresh);
            if (!result) return;
            // Discard results if a newer search has been triggered (category or
            // center changed) while this one was in flight.
            if (searchGenerationRef.current !== generation) return;

            const { candidates, source } = result;
            setCacheSource(source);
            updateQuestion(question.id, (current) => {
                if (current.type !== "measuring") return current;
                return {
                    ...current,
                    candidates,
                    updatedAt: new Date().toISOString(),
                };
            });
        },
        [performSearch, question.center, question.id, updateQuestion],
    );

    // Schedule a debounced search. Clears any pending timer first.
    const scheduleSearch = useCallback(() => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            void searchAndUpdate();
        }, 400);
    }, [searchAndUpdate]);

    // Clean up timers on unmount.
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current !== null) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, []);

    // Auto-query on mount if no candidates are loaded, and invalidate stale
    // candidates when the question pin moves.
    useEffect(() => {
        const needsSearch =
            question.candidates.length === 0 &&
            (lastSearchCenterRef.current === null ||
                !positionsEqual(lastSearchCenterRef.current, question.center));

        if (needsSearch && !isLoading) {
            scheduleSearch();
        } else if (
            question.candidates.length > 0 &&
            lastSearchCenterRef.current !== null &&
            !positionsEqual(lastSearchCenterRef.current, question.center)
        ) {
            // Pin moved since last search: clear derived state so the next
            // effect run will trigger a fresh search.
            setCacheSource(null);
            updateQuestion(question.id, (current) => {
                if (current.type !== "measuring") return current;
                return {
                    ...current,
                    candidates: [],
                    selectedOsmId: null,
                    selectedOsmType: null,
                    seekerDistanceMeters: null,
                    updatedAt: new Date().toISOString(),
                };
            });
        } else if (
            question.candidates.length > 0 &&
            lastSearchCenterRef.current === null
        ) {
            // Candidates were loaded from persistence/import; record the center.
            lastSearchCenterRef.current = question.center;
        }
    }, [
        question.center,
        question.candidates.length,
        isLoading,
        scheduleSearch,
    ]);

    const handleSelectCandidate = useCallback(
        (candidate: {
            name: string;
            osmId: number;
            osmType: "node" | "way" | "relation";
        }) => {
            // Find the full candidate to get its lat/lon for distance calc.
            const full = question.candidates.find(
                (c) =>
                    c.osmId === candidate.osmId &&
                    c.osmType === candidate.osmType,
            );
            const seekerDistanceMeters = full
                ? haversineDistanceMeters(
                      question.center[1],
                      question.center[0],
                      full.lat,
                      full.lon,
                  )
                : null;

            updateQuestion(question.id, (current) => {
                if (current.type !== "measuring") return current;
                return {
                    ...current,
                    selectedOsmId: candidate.osmId,
                    selectedOsmType: candidate.osmType,
                    seekerDistanceMeters,
                    updatedAt: new Date().toISOString(),
                };
            });
        },
        [question.center, question.candidates, question.id, updateQuestion],
    );

    const handleCategoryChange = useCallback(
        (category: MeasuringCategory) => {
            // Invalidate any in-flight search for the old category.
            searchGenerationRef.current += 1;
            // Clear candidates and selection when category changes.
            updateQuestion(question.id, (current) => {
                if (current.type !== "measuring") return current;
                return {
                    ...current,
                    category,
                    candidates: [],
                    selectedOsmId: null,
                    selectedOsmType: null,
                    seekerDistanceMeters: null,
                    updatedAt: new Date().toISOString(),
                };
            });
            setCacheSource(null);
            lastSearchCenterRef.current = null;
        },
        [question.id, updateQuestion],
    );

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

    const hasCandidates = question.candidates.length > 0;
    const hasSelection =
        question.selectedOsmId !== null && question.selectedOsmType !== null;
    const displayDistance =
        question.seekerDistanceMeters !== null
            ? fromMeters(
                  question.seekerDistanceMeters,
                  question.seekerDistanceUnit,
              )
            : null;

    // Line/polygon categories: no candidate list, distance is derived on render.
    if (isLineMeasuringCategory(question.category)) {
        return (
            <LineMeasuringResult
                question={question}
                updateQuestion={updateQuestion}
            />
        );
    }

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

            {/* ── Candidate list ────────────────────────────────────── */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                    Nearest {categoryTitle}s
                </Text>

                {hasCandidates ? (
                    <View style={styles.candidateList}>
                        {question.candidates.slice(0, 3).map((candidate) => {
                            const isSelected =
                                question.selectedOsmId === candidate.osmId &&
                                question.selectedOsmType === candidate.osmType;
                            return (
                                <Pressable
                                    accessibilityLabel={`${formatCandidateName(candidate, labelLanguage)}${candidate.distanceMeters !== undefined ? `, ${formatStationDistance(candidate.distanceMeters)}` : ""}`}
                                    accessibilityRole="button"
                                    key={`${candidate.osmType}-${candidate.osmId}`}
                                    onPress={() => {
                                        if (isSelected) {
                                            setDetailFeature(candidate);
                                            setTimeout(
                                                () => setDetailVisible(true),
                                                0,
                                            );
                                        } else {
                                            handleSelectCandidate(candidate);
                                        }
                                    }}
                                    style={[
                                        styles.candidateRow,
                                        isSelected
                                            ? styles.candidateRowSelected
                                            : null,
                                    ]}
                                    testID={`measuring-candidate-${candidate.osmId}`}
                                >
                                    <View style={styles.candidateCopy}>
                                        <Text
                                            style={styles.candidateName}
                                            numberOfLines={1}
                                        >
                                            {formatCandidateName(
                                                candidate,
                                                labelLanguage,
                                            )}
                                        </Text>
                                    </View>
                                    {candidate.distanceMeters !== undefined ? (
                                        <Text style={styles.candidateDistance}>
                                            {formatStationDistance(
                                                candidate.distanceMeters,
                                            )}
                                        </Text>
                                    ) : null}
                                </Pressable>
                            );
                        })}

                        {question.candidates.length > 3 && (
                            <Pressable
                                accessibilityLabel={`Show all ${question.candidates.length} ${categoryTitle.toLowerCase()}s`}
                                accessibilityRole="button"
                                onPress={() => setShowAllModalVisible(true)}
                                style={({ pressed }) => [
                                    styles.showMoreButton,
                                    pressed ? styles.actionPressed : null,
                                ]}
                                testID="measuring-show-more"
                            >
                                <Text style={styles.showMoreText}>
                                    Show more... (
                                    {question.candidates.length - 3} more)
                                </Text>
                            </Pressable>
                        )}
                    </View>
                ) : (
                    <Text style={styles.metadata}>
                        {isLoading
                            ? `Searching for nearest ${categoryTitle.toLowerCase()}...`
                            : `No ${categoryTitle.toLowerCase()} found nearby.`}
                    </Text>
                )}

                {cacheSource === "stale" && !isLoading ? (
                    <Text
                        style={styles.staleCacheText}
                        testID="measuring-stale"
                    >
                        Results may be outdated — tap Refresh to update.
                    </Text>
                ) : null}

                {error ? (
                    <Text style={styles.errorText} testID="measuring-error">
                        {error}
                    </Text>
                ) : null}

                <Pressable
                    accessibilityLabel={`Refresh ${categoryTitle} search`}
                    accessibilityRole="button"
                    disabled={isLoading}
                    onPress={() => {
                        void searchAndUpdate(true);
                    }}
                    style={({ pressed }) => [
                        styles.refreshButton,
                        pressed ? styles.actionPressed : null,
                        isLoading ? styles.refreshButtonDisabled : null,
                    ]}
                    testID="measuring-refresh"
                >
                    <Text style={styles.refreshButtonText}>
                        {isLoading ? "Searching..." : "Refresh Search"}
                    </Text>
                </Pressable>
            </View>

            {/* ── Planning phrase ───────────────────────────────────── */}
            {hasSelection && displayDistance !== null ? (
                <View style={styles.section}>
                    <Text style={styles.planningPhrase}>
                        {"I'm"} {displayDistance} {question.seekerDistanceUnit}{" "}
                        from my nearest {categoryTitle.toLowerCase()}. Are you
                        closer or farther from yours?
                    </Text>

                    {/* ── Unit toggle ──────────────────────────────── */}
                    <View style={styles.unitToggle}>
                        {DISTANCE_UNITS.map((unit) => {
                            const isActive =
                                question.seekerDistanceUnit === unit;
                            return (
                                <Pressable
                                    accessibilityLabel={`${unit} distance unit`}
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        selected: isActive,
                                    }}
                                    key={unit}
                                    onPress={() => handleUnitChange(unit)}
                                    style={[
                                        styles.unitButton,
                                        isActive
                                            ? styles.unitButtonActive
                                            : null,
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
            ) : null}

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
                        !hasSelection ? ["positive", "negative"] : undefined
                    }
                    onChange={(answer) =>
                        updateQuestion(question.id, (current) =>
                            current.type === "measuring"
                                ? {
                                      ...current,
                                      answer,
                                      updatedAt: new Date().toISOString(),
                                  }
                                : current,
                        )
                    }
                    questionType={question.type}
                    testIDPrefix="measuring-answer-option"
                />
            </View>

            {/* ── Modals ────────────────────────────────────────────── */}
            <OsmMatchingCandidatesModal
                candidates={question.candidates}
                categoryTitle={categoryTitle}
                labelLanguage={labelLanguage}
                selectedOsmId={question.selectedOsmId}
                selectedOsmType={question.selectedOsmType}
                onSelect={handleSelectCandidate}
                onShowDetail={(candidate) => {
                    setDetailFeature(candidate);
                    setShowAllModalVisible(false);
                    setTimeout(() => setDetailVisible(true), 300);
                }}
                onClose={() => setShowAllModalVisible(false)}
                visible={isShowAllModalVisible}
            />

            <OsmFeatureDetailModal
                feature={detailFeature}
                categoryTitle={categoryTitle}
                labelLanguage={labelLanguage}
                searchCenter={question.center}
                visible={isDetailVisible}
                onClose={() => setDetailVisible(false)}
            />
        </>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    candidateCopy: { flex: 1, marginRight: 8 },
    candidateDistance: {
        color: colors.tint,
        fontSize: 13,
        fontWeight: "800",
    },
    candidateList: { gap: 8, marginTop: 12 },
    candidateName: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "700",
    },
    candidateRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        minHeight: 48,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    candidateRowSelected: {
        backgroundColor: colors.buttonSubtle,
        borderColor: colors.tint,
    },
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
    errorText: {
        color: "#b42318",
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
        marginTop: 8,
    },
    lineCategoryResult: {
        minHeight: 44,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    lineDistanceValue: {
        color: colors.tint,
        fontSize: 24,
        fontWeight: "800",
        marginTop: 4,
    },
    lineResultBlock: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 10,
        padding: 16,
    },
    metadata: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
    },
    planningPhrase: {
        color: colors.ink,
        fontSize: 14,
        fontWeight: "600",
        lineHeight: 20,
    },
    refreshButton: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        marginTop: 12,
        minHeight: 48,
        paddingHorizontal: 16,
    },
    refreshButtonDisabled: {
        opacity: 0.5,
    },
    refreshButtonText: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "800",
    },
    section: {
        marginTop: 12,
    },
    sectionTitle: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "800",
    },
    showMoreButton: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        marginTop: 4,
        minHeight: 48,
        paddingHorizontal: 16,
    },
    showMoreText: {
        color: colors.tint,
        fontSize: 15,
        fontWeight: "700",
    },
    staleCacheText: {
        color: colors.muted,
        fontSize: 12,
        lineHeight: 16,
        marginTop: 6,
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

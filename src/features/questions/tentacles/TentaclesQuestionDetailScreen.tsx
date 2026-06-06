import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { QuestionLocationSelector } from "@/features/questions/components/QuestionLocationSelector";
import {
    tentaclesCategoryDistance,
    tentaclesDistanceMeters,
} from "@/features/questions/tentacles/tentaclesTypes";
import type {
    TentaclesCategory,
    TentaclesDistanceOption,
    TentaclesQuestion,
} from "@/features/questions/tentacles/tentaclesTypes";
import {
    resetTentaclesAnswer,
    selectTentaclesPoi,
    useQuestionActions,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";
import { tentaclesCategoryConfigs } from "./tentaclesCategories";
import { useTentaclesSearch } from "./useTentaclesSearch";

type TentaclesQuestionDetailScreenProps = {
    question: TentaclesQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
};

export function TentaclesQuestionDetailScreen({
    question,
    updateQuestion,
}: TentaclesQuestionDetailScreenProps) {
    const search = useTentaclesSearch({
        category: question.category,
        center: question.center,
        distanceMeters: question.distanceMeters,
    });

    const handleCategoryChange = useCallback(
        (category: TentaclesCategory) => {
            const distanceOption = tentaclesCategoryDistance[category];
            const distanceMeters = tentaclesDistanceMeters[distanceOption];
            updateQuestion(question.id, (current) =>
                current.type === "tentacles"
                    ? {
                          ...current,
                          category,
                          distanceOption,
                          distanceMeters,
                          candidates: [],
                          updatedAt: new Date().toISOString(),
                      }
                    : current,
            );
        },
        [question.id, updateQuestion],
    );

    const handleCenterChange = useCallback(
        (center: [number, number]) => {
            updateQuestion(question.id, (current) =>
                current.type === "tentacles"
                    ? {
                          ...current,
                          center,
                          candidates: [],
                          updatedAt: new Date().toISOString(),
                      }
                    : current,
            );
        },
        [question.id, updateQuestion],
    );

    const handleSelectCandidate = useCallback(
        (candidate: {
            osmId: number;
            osmType: "node" | "way" | "relation";
            name: string;
        }) => {
            updateQuestion(question.id, (current) =>
                current.type === "tentacles"
                    ? selectTentaclesPoi(current, candidate)
                    : current,
            );
        },
        [question.id, updateQuestion],
    );

    const handleReset = useCallback(() => {
        updateQuestion(question.id, (current) =>
            current.type === "tentacles"
                ? resetTentaclesAnswer(current)
                : current,
        );
    }, [question.id, updateQuestion]);

    // Auto-search when center or category changes.
    const [searchGeneration, setSearchGeneration] = useState(0);
    const searchRunningRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (searchRunningRef.current) return;
            searchRunningRef.current = true;
            const results = await search.performSearch();
            if (cancelled) return;
            searchRunningRef.current = false;
            if (results) {
                updateQuestion(question.id, (current) =>
                    current.type === "tentacles"
                        ? { ...current, candidates: results }
                        : current,
                );
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [searchGeneration]);

    // Trigger search on mount and when generation changes.
    useEffect(() => {
        setSearchGeneration((g) => g + 1);
    }, [question.center[0], question.center[1], question.category]);

    const isSelected =
        question.selectedOsmId !== null && question.selectedOsmType !== null;

    const distanceLabel = question.distanceOption;

    const sectionedConfigs = tentaclesCategoryConfigs.reduce<
        Record<TentaclesDistanceOption, typeof tentaclesCategoryConfigs>
    >(
        (acc, config) => {
            const key = config.distanceOption;
            if (!acc[key]) acc[key] = [];
            acc[key].push(config);
            return acc;
        },
        {} as Record<TentaclesDistanceOption, typeof tentaclesCategoryConfigs>,
    );

    const distanceSections: TentaclesDistanceOption[] = ["2km", "25km"];

    return (
        <>
            {/* Category picker */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Category</Text>
                {distanceSections.map((dist) => (
                    <View key={dist} style={styles.distanceGroup}>
                        <Text style={styles.distanceLabel}>
                            {dist === "2km" ? "2 km" : "25 km"}
                        </Text>
                        <View style={styles.categoryGrid}>
                            {sectionedConfigs[dist]?.map((config) => (
                                <Pressable
                                    accessibilityLabel={`Select ${config.title} category`}
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        selected:
                                            question.category ===
                                            config.category,
                                    }}
                                    key={config.category}
                                    onPress={() =>
                                        handleCategoryChange(config.category)
                                    }
                                    style={({ pressed }) => [
                                        styles.categoryButton,
                                        question.category === config.category
                                            ? styles.categoryButtonActive
                                            : null,
                                        pressed ? styles.actionPressed : null,
                                    ]}
                                    testID={`tentacles-category-${config.category}`}
                                >
                                    <Text
                                        style={[
                                            styles.categoryButtonText,
                                            question.category ===
                                            config.category
                                                ? styles.categoryButtonTextActive
                                                : null,
                                        ]}
                                    >
                                        {config.title}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                ))}
            </View>

            {/* Position */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>My Position</Text>
                <QuestionLocationSelector
                    center={question.center}
                    onCenterChange={handleCenterChange}
                    setToLocationAccessibilityLabel="Set tentacles search center to my location"
                    testIDPrefix="tentacles"
                />
            </View>

            {/* Search status */}
            <View style={styles.section}>
                <Text style={styles.searchLabel}>
                    Searching within {distanceLabel}
                </Text>
                {search.isLoading ? (
                    <Text style={styles.metadata}>Searching…</Text>
                ) : null}
            </View>

            {/* Candidate list (the answer affordance) */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                    Hider is closest to: (pick one)
                </Text>
                {question.candidates.length === 0 && !search.isLoading ? (
                    <Text style={styles.metadata}>
                        No candidates found within range.
                    </Text>
                ) : (
                    question.candidates.map((candidate) => {
                        const isThisSelected =
                            question.selectedOsmId === candidate.osmId;
                        const distKm =
                            candidate.distanceMeters !== undefined
                                ? candidate.distanceMeters >= 1000
                                    ? `${(candidate.distanceMeters / 1000).toFixed(1)} km`
                                    : `${Math.round(candidate.distanceMeters)} m`
                                : "";
                        return (
                            <Pressable
                                accessibilityLabel={`Select ${candidate.name}`}
                                accessibilityRole="button"
                                accessibilityState={{
                                    selected: isThisSelected,
                                }}
                                key={`${candidate.osmType}/${candidate.osmId}`}
                                onPress={() =>
                                    handleSelectCandidate({
                                        osmId: candidate.osmId,
                                        osmType: candidate.osmType,
                                        name: candidate.name ?? "",
                                    })
                                }
                                style={({ pressed }) => [
                                    styles.candidateRow,
                                    isThisSelected
                                        ? styles.candidateRowSelected
                                        : null,
                                    pressed ? styles.actionPressed : null,
                                ]}
                                testID={`tentacles-candidate-${candidate.osmId}`}
                            >
                                <Text
                                    style={[
                                        styles.candidateName,
                                        isThisSelected
                                            ? styles.candidateNameSelected
                                            : null,
                                    ]}
                                >
                                    {candidate.name}
                                </Text>
                                {distKm ? (
                                    <Text style={styles.candidateDistance}>
                                        {distKm}
                                    </Text>
                                ) : null}
                            </Pressable>
                        );
                    })
                )}
            </View>

            {/* Answer + Reset */}
            {isSelected ? (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Answer</Text>
                    <View style={styles.answerRow}>
                        <Text style={styles.answerText}>
                            {question.selectedName}
                        </Text>
                        <Pressable
                            accessibilityLabel="Reset tentacles answer"
                            accessibilityRole="button"
                            onPress={handleReset}
                            style={({ pressed }) => [
                                styles.resetButton,
                                pressed ? styles.actionPressed : null,
                            ]}
                            testID="tentacles-reset-answer"
                        >
                            <Text style={styles.resetButtonText}>Reset</Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    answerRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
        marginTop: 10,
    },
    answerText: {
        color: colors.ink,
        flex: 1,
        fontSize: 15,
        fontWeight: "800",
    },
    candidateDistance: {
        color: colors.muted,
        fontSize: 13,
    },
    candidateName: {
        color: colors.ink,
        flex: 1,
        fontSize: 14,
        fontWeight: "600",
    },
    candidateNameSelected: {
        color: colors.white,
    },
    candidateRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        marginTop: 6,
        minHeight: 46,
        paddingHorizontal: 14,
    },
    candidateRowSelected: {
        backgroundColor: colors.button,
        borderColor: colors.button,
    },
    categoryButton: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flex: 1,
        justifyContent: "center",
        minHeight: 42,
        paddingHorizontal: 10,
    },
    categoryButtonActive: {
        backgroundColor: colors.button,
        borderColor: colors.button,
    },
    categoryButtonText: {
        color: colors.ink,
        fontSize: 12,
        fontWeight: "700",
    },
    categoryButtonTextActive: {
        color: colors.white,
    },
    categoryGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 8,
    },
    distanceGroup: {
        marginTop: 12,
    },
    distanceLabel: {
        color: colors.muted,
        fontSize: 13,
        fontWeight: "700",
    },
    metadata: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 8,
    },
    resetButton: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 42,
        paddingHorizontal: 14,
    },
    resetButtonText: {
        color: "#b42318",
        fontSize: 14,
        fontWeight: "800",
    },
    searchLabel: {
        color: colors.muted,
        fontSize: 14,
    },
    section: {
        marginTop: 12,
    },
    sectionTitle: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "800",
    },
});

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { QuestionAnswerSelector } from "@/features/questions/components/QuestionAnswerSelector";
import { QuestionLocationSelector } from "@/features/questions/components/QuestionLocationSelector";
import { formatStationDistance } from "@/features/questions/radar/radarGeometry";
import { useHidingZoneState } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import {
    updateQuestionCenter,
    useLabelLanguage,
    useQuestionActions,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";
import type { MatchingQuestion, OsmFeature } from "./matchingTypes";
import { formatCandidateName } from "./formatCandidateName";
import { getCategoryTitle } from "./matchingCategories";
import { OsmMatchingCandidatesModal } from "./OsmMatchingCandidatesModal";
import { OsmFeatureDetailModal } from "./OsmFeatureDetailModal";
import { useMatchingSearch } from "./useMatchingSearch";

type OsmMatchingQuestionDetailScreenProps = {
    question: MatchingQuestion;
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"];
};

function centersEqual(a: [number, number], b: [number, number]): boolean {
    return a[0] === b[0] && a[1] === b[1];
}

export function OsmMatchingQuestionDetailScreen({
    question,
    updateQuestion,
}: OsmMatchingQuestionDetailScreenProps) {
    const [isShowAllModalVisible, setShowAllModalVisible] = useState(false);
    const [detailFeature, setDetailFeature] = useState<
        (OsmFeature & { distanceMeters?: number }) | null
    >(null);
    const [isDetailVisible, setDetailVisible] = useState(false);
    const [cacheSource, setCacheSource] = useState<string | null>(null);
    const { radiusMeters: stationRadiusMeters } = useHidingZoneState();
    const { playArea } = usePlayArea();
    const categoryTitle = getCategoryTitle(question.category);
    const labelLanguage = useLabelLanguage();
    const lastSearchCenterRef = useRef<[number, number] | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { isLoading, error, performSearch } = useMatchingSearch(
        question.category,
        question.center,
        stationRadiusMeters,
        playArea.bbox,
        { unbounded: question.category === "commercial-airport" },
    );

    // Wrap performSearch to update the question with results.
    const searchAndUpdate = useCallback(
        async (forceRefresh = false) => {
            lastSearchCenterRef.current = question.center;
            const result = await performSearch(forceRefresh);
            if (!result) return;

            const { candidates, source } = result;
            const nearest = candidates[0] ?? null;
            setCacheSource(source);
            updateQuestion(question.id, (current) => {
                if (current.type !== "matching") return current;
                return {
                    ...current,
                    candidates,
                    selectedOsmId: nearest?.osmId ?? null,
                    selectedOsmType: nearest?.osmType ?? null,
                    targetName: nearest?.name ?? null,
                    targetOsmId: nearest?.osmId ?? null,
                    targetOsmType: nearest?.osmType ?? null,
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
                !centersEqual(lastSearchCenterRef.current, question.center));

        if (needsSearch && !isLoading) {
            scheduleSearch();
        } else if (
            question.candidates.length > 0 &&
            lastSearchCenterRef.current !== null &&
            !centersEqual(lastSearchCenterRef.current, question.center)
        ) {
            // Pin moved since last search: clear derived state so the next
            // effect run will trigger a fresh search for the new center.
            setCacheSource(null);
            updateQuestion(question.id, (current) => {
                if (current.type !== "matching") return current;
                return {
                    ...current,
                    candidates: [],
                    selectedOsmId: null,
                    selectedOsmType: null,
                    targetName: null,
                    targetOsmId: null,
                    targetOsmType: null,
                    updatedAt: new Date().toISOString(),
                };
            });
        } else if (
            question.candidates.length > 0 &&
            lastSearchCenterRef.current === null
        ) {
            // Candidates were loaded from persistence/import; record the center
            // so future moves are detected correctly.
            lastSearchCenterRef.current = question.center;
        }
    }, [
        question.center,
        question.candidates.length,
        isLoading,
        scheduleSearch,
    ]);

    const handleSelectCandidate = (candidate: {
        name: string;
        osmId: number;
        osmType: "node" | "way" | "relation";
    }) => {
        console.log(
            `[detailTap] select: writing selectedOsmId=${candidate.osmId} selectedOsmType=${candidate.osmType}`,
        );
        updateQuestion(question.id, (current) => {
            if (current.type !== "matching") return current;
            return {
                ...current,
                selectedOsmId: candidate.osmId,
                selectedOsmType: candidate.osmType,
                targetName: candidate.name,
                targetOsmId: candidate.osmId,
                targetOsmType: candidate.osmType,
                updatedAt: new Date().toISOString(),
            };
        });
    };

    const hasCandidates = question.candidates.length > 0;

    return (
        <>
            <QuestionLocationSelector
                center={question.center}
                onCenterChange={(center) =>
                    updateQuestion(question.id, (current) =>
                        updateQuestionCenter(current, center),
                    )
                }
                setToLocationAccessibilityLabel={`Set ${categoryTitle} pin to my location`}
                showSetToLocationButton={false}
                testIDPrefix="osm-matching"
            />

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{categoryTitle}</Text>

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
                                        const selId = question.selectedOsmId;
                                        const selType =
                                            question.selectedOsmType;
                                        const candId = candidate.osmId;
                                        const candType = candidate.osmType;
                                        const isSelected =
                                            selId === candId &&
                                            selType === candType;
                                        console.log(
                                            `[detailTap] top3: selected=${String(selId)}/${String(selType)} ` +
                                                `candidate=${candId}/${candType} ` +
                                                `isSelected=${isSelected} → ` +
                                                `${isSelected ? "openDetail" : "select"}`,
                                        );
                                        if (isSelected) {
                                            setDetailFeature(candidate);
                                            // Defer to next tick: presenting a
                                            // Modal from inside a touch handler
                                            // on another Modal can be swallowed
                                            // by React Native's event loop.
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
                                    testID={`osm-matching-candidate-${candidate.osmId}`}
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
                                testID="osm-matching-show-more"
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
                        testID="osm-matching-stale"
                    >
                        Results may be outdated — tap Refresh to update.
                    </Text>
                ) : null}

                {error ? (
                    <Text style={styles.errorText} testID="osm-matching-error">
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
                    testID="osm-matching-refresh"
                >
                    <Text style={styles.refreshButtonText}>
                        {isLoading ? "Searching..." : "Refresh Search"}
                    </Text>
                </Pressable>
            </View>

            <View style={styles.section}>
                <Text
                    accessibilityLabel="Matching answer section"
                    style={styles.sectionTitle}
                >
                    Answer
                </Text>
                <QuestionAnswerSelector
                    answer={question.answer}
                    disabledAnswers={
                        question.targetName === null
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

            <OsmMatchingCandidatesModal
                candidates={question.candidates}
                categoryTitle={categoryTitle}
                labelLanguage={labelLanguage}
                selectedOsmId={question.selectedOsmId}
                selectedOsmType={question.selectedOsmType}
                onSelect={handleSelectCandidate}
                onShowDetail={(candidate) => {
                    setDetailFeature(candidate);
                    setTimeout(() => setDetailVisible(true), 0);
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
    errorText: {
        color: "#b42318",
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
        marginTop: 8,
    },
    staleCacheText: {
        color: colors.muted,
        fontSize: 12,
        lineHeight: 16,
        marginTop: 6,
    },
    metadata: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
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
});

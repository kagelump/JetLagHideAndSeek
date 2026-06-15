import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SlideUpModal } from "@/components/SlideUpModal";
import { formatStationDistance } from "@/features/questions/radar/radarGeometry";
import { colors } from "@/theme/colors";

import { formatCandidateName } from "./formatCandidateName";
import type { OsmFeature } from "./matchingTypes";

type OsmMatchingCandidatesModalProps = {
    candidates: (OsmFeature & { distanceMeters?: number })[];
    categoryTitle: string;
    labelLanguage?: "native" | "english";
    selectedOsmId: number | null;
    selectedOsmType: "node" | "way" | "relation" | null;
    onSelect: (candidate: {
        name: string;
        osmId: number;
        osmType: "node" | "way" | "relation";
    }) => void;
    onShowDetail?: (
        candidate: OsmFeature & { distanceMeters?: number },
    ) => void;
    onClose: () => void;
    visible: boolean;
};

export function OsmMatchingCandidatesModal({
    candidates,
    categoryTitle,
    labelLanguage = "native",
    selectedOsmId,
    selectedOsmType,
    onSelect,
    onShowDetail,
    onClose,
    visible,
}: OsmMatchingCandidatesModalProps) {
    return (
        <SlideUpModal onClose={onClose} visible={visible}>
            <View style={styles.modal}>
                <View style={styles.header}>
                    <Text style={styles.title}>All {categoryTitle}s</Text>
                    <Pressable
                        accessibilityLabel="Close full candidate list"
                        accessibilityRole="button"
                        onPress={onClose}
                        style={styles.closeButton}
                        testID="osm-matching-all-modal-close"
                    >
                        <Text style={styles.closeText}>Close</Text>
                    </Pressable>
                </View>

                <ScrollView
                    contentContainerStyle={styles.list}
                    keyboardShouldPersistTaps="handled"
                >
                    {candidates.map((candidate) => {
                        const isSelected =
                            selectedOsmId === candidate.osmId &&
                            selectedOsmType === candidate.osmType;
                        return (
                            <Pressable
                                accessibilityLabel={`${formatCandidateName(candidate, labelLanguage)}${candidate.distanceMeters !== undefined ? `, ${formatStationDistance(candidate.distanceMeters)}` : ""}`}
                                accessibilityRole="button"
                                key={`${candidate.osmType}-${candidate.osmId}`}
                                onPress={() => {
                                    const candId = candidate.osmId;
                                    const candType = candidate.osmType;
                                    const isSelected =
                                        selectedOsmId === candId &&
                                        selectedOsmType === candType;
                                    if (isSelected && onShowDetail) {
                                        onShowDetail(candidate);
                                    } else {
                                        onSelect(candidate);
                                    }
                                }}
                                style={[
                                    styles.candidateRow,
                                    isSelected
                                        ? styles.candidateRowSelected
                                        : null,
                                ]}
                                testID={`osm-matching-all-candidate-${candidate.osmId}`}
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
                </ScrollView>
            </View>
        </SlideUpModal>
    );
}

const styles = StyleSheet.create({
    candidateCopy: { flex: 1, marginRight: 8 },
    candidateDistance: {
        color: colors.tint,
        fontSize: 13,
        fontWeight: "800",
    },
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
    closeButton: {
        alignItems: "center",
        backgroundColor: colors.buttonSubtle,
        borderRadius: 8,
        justifyContent: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    closeText: {
        color: colors.ink,
        fontSize: 15,
        fontWeight: "800",
    },
    header: {
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        marginBottom: 16,
    },
    list: {
        gap: 8,
        paddingBottom: 22,
    },
    modal: {
        backgroundColor: colors.panel,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: "88%",
        padding: 20,
        width: "100%",
    },
    title: {
        color: colors.ink,
        fontSize: 24,
        fontWeight: "800",
        marginTop: 2,
    },
});

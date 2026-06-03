import {
    Linking,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { formatStationDistance } from "@/features/questions/radar/radarGeometry";
import { haversineDistanceMeters } from "@/shared/geojson";
import type { Position } from "@/shared/geojson";
import { colors } from "@/theme/colors";

import { formatCandidateName } from "./formatCandidateName";
import type { OsmFeature } from "./matchingTypes";
import { POI_DATA_ATTRIBUTION } from "./poiAttribution";

// ─── Types ─────────────────────────────────────────────────────────────────

type OsmFeatureDetailModalProps = {
    feature: (OsmFeature & { distanceMeters?: number }) | null;
    categoryTitle: string;
    labelLanguage?: "native" | "english";
    searchCenter?: Position;
    visible: boolean;
    onClose: () => void;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatCoordinate(value: number): string {
    return value.toFixed(6);
}

function resolveDistance(
    feature: OsmFeature & { distanceMeters?: number },
    searchCenter?: Position,
): string | null {
    if (feature.distanceMeters !== undefined) {
        return formatStationDistance(feature.distanceMeters);
    }
    if (searchCenter) {
        const [lon, lat] = searchCenter;
        const meters = haversineDistanceMeters(
            lat,
            lon,
            feature.lat,
            feature.lon,
        );
        return formatStationDistance(meters);
    }
    return null;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function OsmFeatureDetailModal({
    feature,
    categoryTitle,
    labelLanguage = "native",
    searchCenter,
    visible,
    onClose,
}: OsmFeatureDetailModalProps) {
    const displayName = feature
        ? formatCandidateName(feature, labelLanguage)
        : "";
    const distance = feature ? resolveDistance(feature, searchCenter) : null;
    const tagEntries = feature
        ? Object.entries(feature.tags).sort(([a], [b]) => a.localeCompare(b))
        : [];

    return (
        <Modal
            animationType="slide"
            onRequestClose={onClose}
            transparent
            visible={visible}
        >
            <View style={styles.scrim}>
                <View style={styles.modal}>
                    <View style={styles.header}>
                        <Text style={styles.title}>{displayName}</Text>
                        <Pressable
                            accessibilityLabel="Close POI detail"
                            accessibilityRole="button"
                            onPress={onClose}
                            style={styles.closeButton}
                            testID="poi-detail-close"
                        >
                            <Text style={styles.closeText}>Close</Text>
                        </Pressable>
                    </View>

                    <ScrollView
                        contentContainerStyle={styles.content}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* ── Key Info ─────────────────────────────── */}
                        <View style={styles.infoCard}>
                            <Text style={styles.categoryBadge}>
                                {categoryTitle}
                            </Text>

                            {distance !== null ? (
                                <InfoRow label="Distance" value={distance} />
                            ) : null}

                            {feature ? (
                                <>
                                    <InfoRow
                                        label="Coordinates"
                                        value={`${formatCoordinate(feature.lat)}, ${formatCoordinate(feature.lon)}`}
                                    />
                                    <View style={styles.infoRow}>
                                        <Text style={styles.infoLabel}>
                                            OSM ID
                                        </Text>
                                        <Pressable
                                            onPress={() =>
                                                Linking.openURL(
                                                    `https://www.openstreetmap.org/${feature.osmType}/${feature.osmId}`,
                                                )
                                            }
                                        >
                                            <Text style={styles.osmLink}>
                                                {feature.osmType}/
                                                {feature.osmId}
                                            </Text>
                                        </Pressable>
                                    </View>
                                    <InfoRow
                                        label="OSM Type"
                                        value={feature.osmType}
                                    />
                                </>
                            ) : null}

                            {feature?.iata ? (
                                <InfoRow label="IATA" value={feature.iata} />
                            ) : null}

                            {feature?.nameLength !== undefined ? (
                                <InfoRow
                                    label="Name Length"
                                    value={`${feature.nameLength} characters`}
                                />
                            ) : null}
                        </View>

                        {/* ── Tags ────────────────────────────────── */}
                        <Text style={styles.sectionHeading}>Tags</Text>
                        <View style={styles.tagsCard}>
                            {tagEntries.length > 0 ? (
                                tagEntries.map(([key, value]) => (
                                    <View key={key} style={styles.tagRow}>
                                        <Text style={styles.tagKey}>{key}</Text>
                                        <Text
                                            style={styles.tagValue}
                                            numberOfLines={3}
                                        >
                                            {value}
                                        </Text>
                                    </View>
                                ))
                            ) : (
                                <Text style={styles.emptyTags}>
                                    No tags available
                                </Text>
                            )}
                        </View>

                        {/* ── External Links ──────────────────────── */}
                        {feature ? (
                            <Pressable
                                accessibilityLabel="Open in Google Maps"
                                accessibilityRole="link"
                                onPress={() =>
                                    Linking.openURL(
                                        `https://www.google.com/maps/search/?api=1&query=${feature.lat},${feature.lon}`,
                                    )
                                }
                                style={styles.googleMapsButton}
                                testID="poi-detail-google-maps"
                            >
                                <Text style={styles.googleMapsText}>
                                    Open in Google Maps
                                </Text>
                            </Pressable>
                        ) : null}

                        {/* ── Attribution ─────────────────────────── */}
                        <Text style={styles.attribution}>
                            {POI_DATA_ATTRIBUTION.text}
                        </Text>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValue}>{value}</Text>
        </View>
    );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    attribution: {
        color: colors.muted,
        fontSize: 11,
        lineHeight: 15,
        marginTop: 24,
        textAlign: "center",
    },
    categoryBadge: {
        color: colors.tint,
        fontSize: 13,
        fontWeight: "700",
        marginBottom: 12,
    },
    closeButton: {
        alignItems: "center",
        backgroundColor: colors.buttonSubtle,
        borderRadius: 8,
        justifyContent: "center",
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    closeText: {
        color: colors.ink,
        fontSize: 15,
        fontWeight: "800",
    },
    content: {
        gap: 16,
        paddingBottom: 22,
    },
    emptyTags: {
        color: colors.muted,
        fontSize: 14,
        fontStyle: "italic",
        paddingVertical: 8,
    },
    header: {
        alignItems: "flex-start",
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        marginBottom: 16,
    },
    infoCard: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        gap: 8,
        padding: 16,
    },
    infoLabel: {
        color: colors.muted,
        fontSize: 13,
        fontWeight: "600",
        minWidth: 100,
    },
    infoRow: {
        flexDirection: "row",
        gap: 8,
    },
    infoValue: {
        color: colors.ink,
        flex: 1,
        fontSize: 14,
        fontWeight: "600",
    },
    modal: {
        backgroundColor: colors.panel,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: "88%",
        padding: 20,
        width: "100%",
    },
    scrim: {
        backgroundColor: "rgba(23, 32, 42, 0.32)",
        flex: 1,
        justifyContent: "flex-end",
    },
    sectionHeading: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        marginBottom: -8,
        textTransform: "uppercase",
    },
    tagKey: {
        color: colors.muted,
        fontSize: 13,
        fontWeight: "600",
        minWidth: 100,
    },
    tagRow: {
        borderTopColor: colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        gap: 8,
        paddingVertical: 8,
    },
    tagValue: {
        color: colors.ink,
        flex: 1,
        fontSize: 14,
    },
    tagsCard: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 4,
    },
    googleMapsButton: {
        alignItems: "center",
        backgroundColor: colors.button,
        borderRadius: 8,
        justifyContent: "center",
        paddingVertical: 12,
    },
    googleMapsText: {
        color: "#ffffff",
        fontSize: 15,
        fontWeight: "800",
    },
    osmLink: {
        color: colors.tint,
        fontSize: 14,
        fontWeight: "600",
        textDecorationLine: "underline",
    },
    title: {
        color: colors.ink,
        flex: 1,
        fontSize: 22,
        fontWeight: "800",
        marginTop: 2,
    },
});

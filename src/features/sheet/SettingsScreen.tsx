import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { SheetListRow } from "@/components/SheetListRow";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { POI_DATA_ATTRIBUTION } from "@/features/questions/matching/poiAttribution";
import { ShareSetupModal } from "@/sharing/export/ShareSetupModal";
import { useHidingZoneState } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { useQuestions } from "@/state/questionStore";
import { colors } from "@/theme/colors";

type SettingsScreenProps = {
    onNavigate: (route: SheetRouteName) => void;
};

export function SettingsScreen({ onNavigate }: SettingsScreenProps) {
    const { cacheSource, playArea } = usePlayArea();
    const { radiusMeters, radiusUnit, selectedPresetIds } =
        useHidingZoneState();
    const questions = useQuestions();
    const [isShareVisible, setIsShareVisible] = useState(false);

    return (
        <View style={styles.container}>
            <Pressable
                accessibilityLabel="Share game setup"
                accessibilityRole="button"
                onPress={() => setIsShareVisible(true)}
                style={({ pressed }) => [
                    styles.shareButton,
                    pressed ? styles.actionPressed : null,
                ]}
                testID="settings-share-button"
            >
                <Text style={styles.shareButtonText} accessibilityLabel="Share">
                    Share
                </Text>
            </Pressable>

            <View style={styles.actions}>
                <SheetListRow
                    accessibilityLabel="Open Play Area settings"
                    description={`${playArea.label} · ${cacheSource}`}
                    onPress={() => onNavigate("play-area")}
                    testID="settings-play-area-row"
                    title="Play Area"
                />

                <SheetListRow
                    accessibilityLabel="Open Hiding Zones settings"
                    description="Eligible transit stations for the hiding zone."
                    onPress={() => onNavigate("hiding-zone")}
                    testID="settings-hiding-zone-row"
                    title="Hiding Zones"
                />

                <SheetListRow
                    accessibilityLabel="Open Offline Data settings"
                    description="Download offline POI packs for matching questions."
                    onPress={() => onNavigate("offline-data")}
                    testID="settings-offline-data-row"
                    title="Offline Data"
                />
            </View>

            <View style={styles.attribution}>
                <Text style={styles.attributionHeading}>
                    Data & Attribution
                </Text>
                <Text style={styles.attributionText}>
                    {POI_DATA_ATTRIBUTION.text}
                </Text>
                <View style={styles.attributionLinks}>
                    <Text
                        accessibilityLabel="OpenStreetMap copyright"
                        accessibilityRole="link"
                        onPress={() =>
                            Linking.openURL(
                                POI_DATA_ATTRIBUTION.osmCopyrightUrl,
                            )
                        }
                        style={styles.attributionLink}
                    >
                        OpenStreetMap Copyright
                    </Text>
                    <Text
                        accessibilityLabel="Open Database License"
                        accessibilityRole="link"
                        onPress={() =>
                            Linking.openURL(POI_DATA_ATTRIBUTION.odblUrl)
                        }
                        style={styles.attributionLink}
                    >
                        ODbL 1.0
                    </Text>
                    <Text
                        accessibilityLabel="Geofabrik downloads"
                        accessibilityRole="link"
                        onPress={() =>
                            Linking.openURL(POI_DATA_ATTRIBUTION.geofabrikUrl)
                        }
                        style={styles.attributionLink}
                    >
                        Geofabrik
                    </Text>
                </View>
            </View>
            <ShareSetupModal
                hidingZones={{
                    radiusMeters,
                    radiusUnit,
                    selectedPresetIds,
                }}
                onClose={() => setIsShareVisible(false)}
                playArea={playArea}
                questions={questions}
                visible={isShareVisible}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    actions: {
        gap: 8,
        marginTop: 12,
    },
    attribution: {
        borderTopColor: colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: 24,
        paddingTop: 20,
    },
    attributionHeading: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        marginBottom: 8,
        textTransform: "uppercase",
    },
    attributionLink: {
        color: colors.tint,
        fontSize: 13,
        fontWeight: "600",
        marginRight: 16,
    },
    attributionLinks: {
        flexDirection: "row",
        flexWrap: "wrap",
        marginTop: 8,
    },
    attributionText: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
    },
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 0,
    },
    shareButton: {
        alignSelf: "flex-end",
        backgroundColor: colors.button,
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    shareButtonText: {
        color: colors.white,
        fontSize: 14,
        fontWeight: "800",
    },
});

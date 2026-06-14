import { useState } from "react";
import {
    Alert,
    Linking,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    View,
} from "react-native";

import { SheetListRow } from "@/components/SheetListRow";
import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { POI_DATA_ATTRIBUTION } from "@/features/questions/matching/poiAttribution";
import { ShareSetupModal } from "@/sharing/export/ShareSetupModal";
import {
    useHidingZoneDerived,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import { clearAppCaches, useResetGame } from "@/state/maintenance";
import { usePlayArea } from "@/state/playAreaStore";
import { isPlayAreaSet } from "@/features/map/playArea";
import {
    useGameMode,
    useLabelLanguage,
    useQuestionActions,
    useQuestions,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";

type SettingsScreenProps = {
    onNavigate: (route: SheetRouteName) => void;
};

function SetupBadge({ done }: { done: boolean }) {
    if (!done) return null;
    return (
        <View style={styles.badge}>
            <Text style={styles.badgeText}>✓</Text>
        </View>
    );
}

export function SettingsScreen({ onNavigate }: SettingsScreenProps) {
    const { cacheSource, playArea } = usePlayArea();
    const { radiusMeters, radiusUnit, selectedPresetIds } =
        useHidingZoneState();
    const { selectedPresets, selectedStations } = useHidingZoneDerived();
    const questions = useQuestions();
    const labelLanguage = useLabelLanguage();
    const gameMode = useGameMode();
    const { setGameMode, setLabelLanguage } = useQuestionActions();
    const [isShareVisible, setIsShareVisible] = useState(false);
    const [maintenanceResult, setMaintenanceResult] = useState<string | null>(
        null,
    );
    const resetGame = useResetGame();

    const playAreaDone = isPlayAreaSet(playArea);
    const hidingZonesDone = selectedPresetIds.length > 0;
    const setupComplete = playAreaDone && hidingZonesDone;

    const handleResetGame = () => {
        Alert.alert(
            "Reset Game",
            "Start a new game? This clears all questions and resets your play area and hiding zones.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reset",
                    style: "destructive",
                    onPress: async () => {
                        await resetGame();
                        onNavigate("main");
                    },
                },
            ],
        );
    };

    const handleClearCache = () => {
        Alert.alert(
            "Clear Cache",
            "Clear cached map/POI data? Downloaded offline packs are kept.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                        const count = await clearAppCaches();
                        setMaintenanceResult(
                            `Cleared ${count} cached item${count === 1 ? "" : "s"}`,
                        );
                    },
                },
            ],
        );
    };

    return (
        <SheetScrollView contentContainerStyle={styles.container}>
            <View style={styles.actions}>
                <Text style={styles.sectionHeading}>Set up your game</Text>
                <SheetListRow
                    accessibilityLabel="Open Play Area settings"
                    description={`${playArea.label} · ${cacheSource}`}
                    onPress={() => onNavigate("play-area")}
                    testID="settings-play-area-row"
                    title="Play Area"
                    trailing={<SetupBadge done={playAreaDone} />}
                />

                <SheetListRow
                    accessibilityLabel="Open Hiding Zones settings"
                    description={
                        hidingZonesDone
                            ? `${selectedPresets.length} operators · ${selectedStations.length} stations`
                            : "Pick eligible transit stations"
                    }
                    onPress={() => onNavigate("hiding-zone")}
                    testID="settings-hiding-zone-row"
                    title="Hiding Zones"
                    trailing={<SetupBadge done={hidingZonesDone} />}
                />

                <Pressable
                    accessibilityLabel="Share game setup"
                    accessibilityRole="button"
                    onPress={() => {
                        if (setupComplete) setIsShareVisible(true);
                    }}
                    style={({ pressed }) => [
                        styles.shareRow,
                        !setupComplete ? styles.shareRowInactive : null,
                        pressed ? styles.actionPressed : null,
                    ]}
                    testID="settings-share-button"
                >
                    <View style={styles.shareRowCopy}>
                        <Text style={styles.shareRowTitle}>Share</Text>
                        <Text style={styles.shareRowDescription}>
                            Send a link or QR code to players.
                        </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                </Pressable>
            </View>

            <View style={styles.actions}>
                <Text style={styles.sectionHeading}>Supporting</Text>
                <SheetListRow
                    accessibilityLabel="Open Offline Data settings"
                    description="Download offline POI packs for matching questions."
                    onPress={() => onNavigate("offline-data")}
                    testID="settings-offline-data-row"
                    title="Offline Data"
                />
            </View>

            <View style={styles.actions}>
                <Text style={styles.sectionHeading}>Mode</Text>
                <SheetListRow
                    accessibilityLabel="Toggle hider mode"
                    description="Opening a shared question link answers it from your current location"
                    onPress={() =>
                        setGameMode(gameMode === "hider" ? "seeker" : "hider")
                    }
                    testID="settings-hider-mode-row"
                    title="Hider Mode"
                    trailing={
                        <Switch
                            onValueChange={(v) =>
                                setGameMode(v ? "hider" : "seeker")
                            }
                            value={gameMode === "hider"}
                        />
                    }
                />
            </View>

            <View style={styles.actions}>
                <Text style={styles.sectionHeading}>Display</Text>
                <SheetListRow
                    accessibilityLabel="Toggle POI label language between native and English"
                    description="Show POI names in English when available"
                    onPress={() =>
                        setLabelLanguage(
                            labelLanguage === "english" ? "native" : "english",
                        )
                    }
                    testID="settings-label-language-row"
                    title="English Labels"
                    trailing={
                        <Switch
                            value={labelLanguage === "english"}
                            onValueChange={(v) =>
                                setLabelLanguage(v ? "english" : "native")
                            }
                        />
                    }
                />
                <SheetListRow
                    accessibilityLabel="Configure admin division categories"
                    description="Set OSM levels and labels for admin division questions"
                    onPress={() => onNavigate("admin-divisions")}
                    testID="settings-admin-divisions-row"
                    title="Admin Divisions"
                />
            </View>

            <View style={styles.actions}>
                <Text style={styles.sectionHeading}>Maintenance</Text>
                <SheetListRow
                    accessibilityLabel="Reset the game to a fresh state"
                    description="Start a new game? This clears all questions and resets your play area and hiding zones."
                    destructive
                    onPress={handleResetGame}
                    testID="settings-reset-game-row"
                    title="Reset Game"
                />
                {__DEV__ ? (
                    <>
                        <SheetListRow
                            accessibilityLabel="Clear cached map and POI data"
                            description="Clear cached map/POI data? Downloaded offline packs are kept."
                            onPress={handleClearCache}
                            testID="settings-clear-cache-row"
                            title="Clear Cache"
                        />
                        <SheetListRow
                            accessibilityLabel="Run GEOS parity harness"
                            description="Validate native GEOS buffer against JS oracle on-device."
                            onPress={() => onNavigate("geometry-parity")}
                            testID="settings-geometry-parity-row"
                            title="Run GEOS Parity Harness"
                        />
                    </>
                ) : null}
                {maintenanceResult ? (
                    <Text
                        style={styles.maintenanceResult}
                        testID="settings-maintenance-result"
                    >
                        {maintenanceResult}
                    </Text>
                ) : null}
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
        </SheetScrollView>
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
    badge: {
        alignItems: "center",
        backgroundColor: colors.tint,
        borderRadius: 10,
        height: 20,
        justifyContent: "center",
        width: 20,
    },
    badgeText: {
        color: colors.white,
        fontSize: 12,
        fontWeight: "800",
    },
    chevron: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
    },
    container: {
        paddingBottom: 40,
        paddingHorizontal: 20,
        paddingTop: 0,
    },
    maintenanceResult: {
        color: colors.ink,
        fontSize: 14,
        fontWeight: "600",
        marginTop: 8,
        textAlign: "center",
    },
    sectionHeading: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        marginBottom: 8,
        marginTop: 24,
        textTransform: "uppercase",
    },
    shareRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        minHeight: 62,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    shareRowCopy: {
        flex: 1,
    },
    shareRowDescription: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
    },
    shareRowInactive: {
        opacity: 0.6,
    },
    shareRowTitle: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "700",
    },
});

import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CalculatingIndicator } from "@/components/CalculatingIndicator";
import { isPlayAreaSet } from "@/features/map/playArea";
import { useEliminationPercentage } from "@/features/map/useEliminationPercentage";
import { useStationElimination } from "@/features/map/useStationElimination";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { usePlayArea } from "@/state/playAreaStore";
import { useHidingZoneState } from "@/state/hidingZoneStore";
import {
    useGameMode,
    useQuestionActions,
    useQuestionIds,
    useSeekingStartedAt,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";

import { DrawerAction, SeekTimeModal } from "./sheetComponents";
import { createLogger } from "@/shared/logger";

const log = createLogger("MainSheetContent");

function MainSheetContent({
    onNavigate,
}: {
    onNavigate: (route: SheetRouteName) => void;
}) {
    const { playArea } = usePlayArea();
    const questionIds = useQuestionIds();
    const gameMode = useGameMode();
    const { setGameMode, setSeekingStartedAt } = useQuestionActions();
    const { selectedPresetIds } = useHidingZoneState();
    const seekingStartedAt = useSeekingStartedAt();
    const { value: eliminationPct, isComputing: eliminationPctComputing } =
        useEliminationPercentage();
    const { remainingCount, isComputing } = useStationElimination();

    // Debug: trace when the HUD sees computing state changes.
    useEffect(() => {
        log.debug(
            `station isComputing=${isComputing}, ` +
                `remainingCount=${remainingCount}, ` +
                `eliminationPctComputing=${eliminationPctComputing}, ` +
                `eliminationPct=${eliminationPct}`,
        );
    }, [isComputing, remainingCount, eliminationPctComputing, eliminationPct]);

    const showFirstRun =
        !isPlayAreaSet(playArea) ||
        (selectedPresetIds.length === 0 && questionIds.length === 0);

    // Tick every minute to update elapsed time display.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (seekingStartedAt === null) return;
        const id = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(id);
    }, [seekingStartedAt]);

    const elapsedMs = seekingStartedAt !== null ? now - seekingStartedAt : null;

    // Seek time modal state
    const [showSeekTimeModal, setShowSeekTimeModal] = useState(false);
    const [seekTimeDraft, setSeekTimeDraft] = useState(() => {
        // Default to the current seeking start time, or now
        if (seekingStartedAt !== null) {
            return new Date(seekingStartedAt);
        }
        const now = new Date();
        now.setMinutes(0, 0, 0);
        return now;
    });

    const handleOpenSeekTime = useCallback(() => {
        const base =
            seekingStartedAt !== null ? new Date(seekingStartedAt) : new Date();
        setSeekTimeDraft(base);
        setShowSeekTimeModal(true);
    }, [seekingStartedAt]);

    const handleSetSeekTime = useCallback(() => {
        setSeekingStartedAt(seekTimeDraft.getTime());
        setShowSeekTimeModal(false);
    }, [seekTimeDraft, setSeekingStartedAt]);

    return (
        <>
            <View style={styles.container}>
                <View style={styles.hudContent}>
                    {showFirstRun ? (
                        <>
                            <View style={styles.firstRunContent}>
                                <View>
                                    <Text style={styles.eyebrow}>
                                        Hide & Seek Mapper
                                    </Text>
                                    <Text style={styles.title}>
                                        Set up your game
                                    </Text>
                                    <Text style={styles.description}>
                                        You{"'"}re the seeker. Ask the hider
                                        questions, record their answers, and
                                        watch the map narrow down where they can
                                        be.
                                    </Text>
                                </View>
                                <View style={styles.firstRunActions}>
                                    <Pressable
                                        accessibilityLabel="Set up a game"
                                        accessibilityRole="button"
                                        onPress={() =>
                                            onNavigate(
                                                isPlayAreaSet(playArea)
                                                    ? "hiding-zone"
                                                    : "play-area",
                                            )
                                        }
                                        style={({ pressed }) => [
                                            styles.primaryButton,
                                            pressed
                                                ? styles.actionPressed
                                                : null,
                                        ]}
                                        testID="main-setup-game"
                                    >
                                        <Text style={styles.primaryButtonText}>
                                            Set up a game
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityLabel="Join a game"
                                        accessibilityRole="button"
                                        onPress={() => onNavigate("settings")}
                                        style={({ pressed }) => [
                                            styles.subtleButton,
                                            pressed
                                                ? styles.actionPressed
                                                : null,
                                        ]}
                                        testID="main-join-game"
                                    >
                                        <Text style={styles.subtleButtonText}>
                                            Join a game
                                        </Text>
                                    </Pressable>
                                </View>
                                <Text style={styles.exploreHint}>
                                    …or just explore the map.
                                </Text>
                            </View>
                            <View style={styles.navRows}>
                                <DrawerAction
                                    title="Questions"
                                    description=""
                                    isActive={false}
                                    onPress={() => onNavigate("questions")}
                                    testID="main-questions-row"
                                />
                                <DrawerAction
                                    title="Settings"
                                    description=""
                                    isActive={false}
                                    onPress={() => onNavigate("settings")}
                                    testID="main-settings-row"
                                />
                            </View>
                        </>
                    ) : (
                        <>
                            <View style={styles.hudHeader}>
                                <View>
                                    <Text style={styles.eyebrow}>
                                        Current game
                                    </Text>
                                    <Text style={styles.title}>
                                        {playArea.label}
                                    </Text>
                                </View>
                                <Pressable
                                    accessibilityLabel={`Switch to ${gameMode === "hider" ? "seeker" : "hider"} mode`}
                                    accessibilityRole="button"
                                    onPress={() =>
                                        setGameMode(
                                            gameMode === "hider"
                                                ? "seeker"
                                                : "hider",
                                        )
                                    }
                                    style={({ pressed }) => [
                                        styles.modeChip,
                                        pressed ? styles.actionPressed : null,
                                    ]}
                                    testID="main-mode-chip"
                                >
                                    <Text style={styles.modeChipText}>
                                        {gameMode === "hider"
                                            ? "Hider"
                                            : "Seeker"}
                                    </Text>
                                </Pressable>
                            </View>

                            <View style={styles.statCard}>
                                <Pressable
                                    accessibilityLabel={
                                        elapsedMs !== null
                                            ? "Seek time"
                                            : "Set seeking start time"
                                    }
                                    accessibilityRole="button"
                                    onPress={handleOpenSeekTime}
                                    style={({ pressed }) => [
                                        styles.statItem,
                                        pressed ? styles.actionPressed : null,
                                    ]}
                                    testID="main-seek-time"
                                >
                                    {elapsedMs !== null ? (
                                        <Text style={styles.statNumber}>
                                            {formatElapsed(elapsedMs)}
                                        </Text>
                                    ) : (
                                        <>
                                            <Text style={styles.naText}>
                                                N/A
                                            </Text>
                                            <Text style={styles.naHint}>
                                                Tap to start
                                            </Text>
                                        </>
                                    )}
                                    <Text style={styles.statLabel}>
                                        Seek time
                                    </Text>
                                </Pressable>
                                <Pressable
                                    accessibilityLabel="Stations remaining"
                                    accessibilityRole="button"
                                    onPress={() => onNavigate("station-detail")}
                                    style={({ pressed }) => [
                                        styles.statItem,
                                        pressed ? styles.actionPressed : null,
                                    ]}
                                    testID="main-stations-remaining"
                                >
                                    {isComputing ? (
                                        <CalculatingIndicator
                                            style={styles.statSpinner}
                                        />
                                    ) : (
                                        <Text style={styles.statNumber}>
                                            {remainingCount}
                                        </Text>
                                    )}
                                    <Text style={styles.statLabel}>
                                        Stations
                                    </Text>
                                </Pressable>
                                <View style={styles.statItem}>
                                    {eliminationPctComputing ? (
                                        <CalculatingIndicator
                                            style={styles.statSpinner}
                                        />
                                    ) : (
                                        <Text style={styles.statNumber}>
                                            {eliminationPct !== null
                                                ? `${eliminationPct}%`
                                                : "—"}
                                        </Text>
                                    )}
                                    <Text style={styles.statLabel}>
                                        Eliminated
                                    </Text>
                                </View>
                            </View>

                            <Pressable
                                accessibilityLabel="Add question"
                                accessibilityRole="button"
                                onPress={() => onNavigate("add-question")}
                                style={({ pressed }) => [
                                    styles.primaryButton,
                                    pressed ? styles.actionPressed : null,
                                ]}
                                testID="main-add-question"
                            >
                                <Text style={styles.primaryButtonText}>
                                    + Add Question
                                </Text>
                            </Pressable>

                            <View style={styles.navRows}>
                                <DrawerAction
                                    title="Questions"
                                    description={`${questionIds.length} asked · tap to review`}
                                    isActive={false}
                                    onPress={() => onNavigate("questions")}
                                    testID="main-questions-row"
                                />
                                <DrawerAction
                                    title="Settings"
                                    description="Play area, hiding zones, sharing"
                                    isActive={false}
                                    onPress={() => onNavigate("settings")}
                                    testID="main-settings-row"
                                />
                            </View>

                            {selectedPresetIds.length === 0 ? (
                                <Pressable
                                    accessibilityLabel="Finish setting up your game"
                                    accessibilityRole="button"
                                    onPress={() => onNavigate("settings")}
                                    style={({ pressed }) => [
                                        styles.nudge,
                                        pressed ? styles.actionPressed : null,
                                    ]}
                                    testID="main-setup-nudge"
                                >
                                    <View style={styles.nudgeDot} />
                                    <Text style={styles.nudgeText}>
                                        Setup · pick hiding zones to start
                                    </Text>
                                </Pressable>
                            ) : null}
                        </>
                    )}
                </View>
            </View>
            {showSeekTimeModal ? (
                <SeekTimeModal
                    draft={seekTimeDraft}
                    onCancel={() => setShowSeekTimeModal(false)}
                    onChange={setSeekTimeDraft}
                    onSet={handleSetSeekTime}
                />
            ) : null}
        </>
    );
}

function formatElapsed(ms: number): string {
    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 1) {
        return `${minutes} min`;
    }
    return `${hours}:${String(minutes).padStart(2, "0")} hr`;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 20,
    },
    hudContent: {
        gap: 14,
        paddingTop: 4,
    },
    firstRunContent: {
        gap: 16,
        paddingVertical: 20,
    },
    eyebrow: {
        color: colors.tint,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    title: {
        color: colors.ink,
        fontSize: 24,
        fontWeight: "800",
        marginTop: 2,
    },
    description: {
        color: colors.muted,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 8,
    },
    firstRunActions: {
        gap: 10,
    },
    primaryButton: {
        alignItems: "center",
        backgroundColor: colors.tint,
        borderRadius: 8,
        justifyContent: "center",
        minHeight: 50,
        paddingHorizontal: 16,
    },
    primaryButtonText: {
        color: colors.white,
        fontSize: 16,
        fontWeight: "800",
    },
    subtleButton: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 50,
        paddingHorizontal: 16,
    },
    subtleButtonText: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "700",
    },
    exploreHint: {
        color: colors.muted,
        fontSize: 13,
        textAlign: "center",
    },
    navRows: {
        gap: 8,
    },
    hudHeader: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
    },
    modeChip: {
        backgroundColor: colors.button,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    modeChipText: {
        color: colors.white,
        fontSize: 14,
        fontWeight: "700",
    },
    statCard: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        justifyContent: "space-around",
        padding: 14,
    },
    statItem: {
        alignItems: "center",
    },
    statNumber: {
        color: colors.ink,
        fontSize: 26,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    statLabel: {
        color: colors.muted,
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0.4,
        marginTop: 2,
        textTransform: "uppercase",
    },
    statSpinner: {
        height: 26,
    },
    naText: {
        color: colors.muted,
        fontSize: 22,
        fontWeight: "900",
    },
    naHint: {
        color: colors.tint,
        fontSize: 9,
        fontWeight: "600",
    },
    nudge: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        justifyContent: "center",
        paddingVertical: 8,
    },
    nudgeDot: {
        backgroundColor: colors.tint,
        borderRadius: 4,
        height: 8,
        width: 8,
    },
    nudgeText: {
        color: colors.tint,
        fontSize: 13,
        fontWeight: "700",
    },
    actionPressed: {
        opacity: 0.72,
    },
});

export { MainSheetContent };

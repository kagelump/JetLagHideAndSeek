import {
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    BackHandler,
    Dimensions,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import DateTimePicker, {
    type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import { SlideUpModal } from "@/components/SlideUpModal";
import { HidingZoneScreen } from "@/features/hidingZone/HidingZoneScreen";
import { useEliminationPercentage } from "@/features/map/useEliminationPercentage";
import { useStationElimination } from "@/features/map/useStationElimination";
import { PlayAreaScreen } from "@/features/playArea/PlayAreaScreen";
import { StationDetailScreen } from "@/features/sheet/StationDetailScreen";
import { isPlayAreaSet } from "@/features/map/playArea";
import { AddQuestionScreen } from "@/features/questions/AddQuestionScreen";
import { MatchingQuestionScreen } from "@/features/questions/MatchingQuestionScreen";
import {
    QuestionActionsMenu,
    QuestionDetailScreen,
} from "@/features/questions/QuestionDetailScreen";
import { QuestionsScreen } from "@/features/questions/QuestionsScreen";
import { AdminDivisionScreen } from "@/features/sheet/AdminDivisionScreen";
import { GeometryParityScreen } from "@/features/sheet/GeometryParityScreen";
import { OfflineDataScreen } from "@/features/offline/OfflineDataScreen";
import { SettingsScreen } from "@/features/sheet/SettingsScreen";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { getBackTarget, getNavDirection } from "@/features/sheet/sheetNav";
import { getQuestionDefinition } from "@/features/questions/questionRegistry";
import { useHidingZoneState } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import {
    useGameMode,
    useQuestionActions,
    useQuestionDerived,
    useQuestionIds,
    useSeekingStartedAt,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";

const SHEET_WIDTH = Dimensions.get("window").width;
const TRANSITION_MS = 300;

type TransitionDirection = "forward" | "back";

type SheetTransition = {
    direction: TransitionDirection;
    from: SheetRouteName;
    id: number;
    isAnimating: boolean;
    to: SheetRouteName;
};

type MainDrawerProps = {
    onNavigate: (route: SheetRouteName) => void;
    route: SheetRouteName;
};

export function MainDrawer({ route, onNavigate }: MainDrawerProps) {
    const [displayedRoute, setDisplayedRoute] = useState(route);
    const displayedRouteRef = useRef(route);
    const [transition, setTransition] = useState<SheetTransition | null>(null);
    const transitionIdRef = useRef(0);
    const startedTransitionIdRef = useRef<number | null>(null);
    const currentRoute = transition?.to ?? displayedRoute;
    const backTarget = getBackTarget(currentRoute);
    const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const leavingX = useSharedValue(0);
    const enteringX = useSharedValue(0);
    const transitionId = transition?.id ?? null;
    const transitionDirection = transition?.direction ?? null;

    const leavingStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: leavingX.value }],
    }));

    const enteringStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: enteringX.value }],
    }));

    const beginTransition = useCallback(
        (from: SheetRouteName, to: SheetRouteName) => {
            if (to === from) return;
            if (cleanupTimerRef.current) {
                clearTimeout(cleanupTimerRef.current);
                cleanupTimerRef.current = null;
            }

            const dir = getNavDirection(from, to);
            const id = transitionIdRef.current + 1;
            transitionIdRef.current = id;
            startedTransitionIdRef.current = null;

            leavingX.value = 0;
            enteringX.value = getEnteringStartX(dir);
            displayedRouteRef.current = to;
            setDisplayedRoute(to);
            setTransition({
                direction: dir,
                from,
                id,
                isAnimating: false,
                to,
            });
        },
        [enteringX, leavingX],
    );

    const handleNavigate = useCallback(
        (to: SheetRouteName) => {
            const from = displayedRouteRef.current;
            if (to === from) return;
            beginTransition(from, to);
            onNavigate(to);
        },
        [beginTransition, onNavigate],
    );

    useEffect(() => {
        if (route === displayedRouteRef.current) return;
        beginTransition(displayedRouteRef.current, route);
    }, [beginTransition, route]);

    useEffect(() => {
        if (transitionDirection === null || transitionId === null) return;
        if (startedTransitionIdRef.current === transitionId) return;
        startedTransitionIdRef.current = transitionId;

        const isBack = transitionDirection === "back";

        leavingX.value = 0;
        enteringX.value = getEnteringStartX(transitionDirection);
        setTransition((current) =>
            current?.id === transitionId
                ? { ...current, isAnimating: true }
                : current,
        );

        leavingX.value = withTiming(isBack ? SHEET_WIDTH : -SHEET_WIDTH, {
            duration: TRANSITION_MS,
        });
        enteringX.value = withTiming(0, { duration: TRANSITION_MS });

        cleanupTimerRef.current = setTimeout(() => {
            setTransition((current) =>
                current?.id === transitionId ? null : current,
            );
        }, TRANSITION_MS);
    }, [enteringX, leavingX, transitionDirection, transitionId]);

    useEffect(() => {
        return () => {
            if (cleanupTimerRef.current) {
                clearTimeout(cleanupTimerRef.current);
                cleanupTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!backTarget) return;
        const onBackPress = () => {
            handleNavigate(backTarget);
            return true;
        };
        const sub = BackHandler.addEventListener(
            "hardwareBackPress",
            onBackPress,
        );
        return () => sub.remove();
    }, [backTarget, handleNavigate]);

    const edgeGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetX(10)
                .onEnd((event) => {
                    if (event.translationX > 80 || event.velocityX > 500) {
                        runOnJS(handleNavigate)(backTarget!);
                    }
                }),
        [handleNavigate, backTarget],
    );

    return (
        <View style={styles.transitionContainer}>
            {transition ? (
                <Animated.View
                    key={`route-${transition.from}`}
                    style={[
                        styles.animatedFill,
                        getLeavingLayerStyle(transition.direction),
                        transition.isAnimating ? leavingStyle : null,
                    ]}
                >
                    {renderRouteContent(transition.from, handleNavigate)}
                </Animated.View>
            ) : null}

            <Animated.View
                key={`route-${currentRoute}`}
                style={[
                    styles.animatedFill,
                    transition
                        ? getEnteringLayerStyle(transition.direction)
                        : null,
                    transition
                        ? transition.isAnimating
                            ? enteringStyle
                            : getEnteringInitialStyle(transition.direction)
                        : null,
                ]}
            >
                {renderRouteContent(currentRoute, handleNavigate)}
            </Animated.View>

            {backTarget ? (
                <GestureDetector gesture={edgeGesture}>
                    <View
                        testID="edge-swipe-back-slab"
                        style={styles.edgeSlab}
                    />
                </GestureDetector>
            ) : null}
        </View>
    );
}

function getEnteringStartX(direction: TransitionDirection) {
    return direction === "back" ? -SHEET_WIDTH : SHEET_WIDTH;
}

function getEnteringInitialStyle(direction: TransitionDirection) {
    return {
        transform: [{ translateX: getEnteringStartX(direction) }],
    };
}

function getLeavingLayerStyle(direction: TransitionDirection) {
    return {
        zIndex: direction === "back" ? 2 : 1,
    };
}

function getEnteringLayerStyle(direction: TransitionDirection) {
    return {
        zIndex: direction === "back" ? 1 : 2,
    };
}

function renderRouteContent(
    routeName: SheetRouteName,
    onNavigate: (route: SheetRouteName) => void,
) {
    switch (routeName) {
        case "settings":
            return (
                <ChildSheetShell onBack={() => onNavigate("main")}>
                    <SettingsScreen onNavigate={onNavigate} />
                </ChildSheetShell>
            );
        case "play-area":
            return (
                <ChildSheetShell onBack={() => onNavigate("settings")}>
                    <PlayAreaScreen onNavigate={onNavigate} />
                </ChildSheetShell>
            );
        case "hiding-zone":
            return (
                <ChildSheetShell onBack={() => onNavigate("settings")}>
                    <HidingZoneScreen />
                </ChildSheetShell>
            );
        case "offline-data":
            return (
                <ChildSheetShell onBack={() => onNavigate("settings")}>
                    <OfflineDataScreen />
                </ChildSheetShell>
            );
        case "admin-divisions":
            return (
                <ChildSheetShell onBack={() => onNavigate("settings")}>
                    <AdminDivisionScreen />
                </ChildSheetShell>
            );
        case "geometry-parity":
            return (
                <ChildSheetShell onBack={() => onNavigate("settings")}>
                    <GeometryParityScreen />
                </ChildSheetShell>
            );
        case "questions":
            return (
                <ChildSheetShell onBack={() => onNavigate("main")}>
                    <QuestionsScreen onNavigate={onNavigate} />
                </ChildSheetShell>
            );
        case "add-question":
            return (
                <ChildSheetShell onBack={() => onNavigate("questions")}>
                    <AddQuestionScreen onNavigate={onNavigate} />
                </ChildSheetShell>
            );
        case "matching":
            return (
                <ChildSheetShell onBack={() => onNavigate("add-question")}>
                    <MatchingQuestionScreen onNavigate={onNavigate} />
                </ChildSheetShell>
            );
        case "question-detail":
            return (
                <QuestionDetailShell
                    onBack={() => onNavigate("questions")}
                    onNavigate={onNavigate}
                />
            );
        case "station-detail":
            return (
                <ChildSheetShell onBack={() => onNavigate("main")}>
                    <StationDetailScreen />
                </ChildSheetShell>
            );
        default: {
            return <MainSheetContent onNavigate={onNavigate} />;
        }
    }
}

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
    const eliminationPct = useEliminationPercentage();
    const { remainingCount, isComputing } = useStationElimination();

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
                                        <ActivityIndicator
                                            color={colors.tint}
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
                                    <Text style={styles.statNumber}>
                                        {eliminationPct !== null
                                            ? `${eliminationPct}%`
                                            : "—"}
                                    </Text>
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

type SeekTimeModalProps = {
    draft: Date;
    onCancel: () => void;
    onChange: (d: Date) => void;
    onSet: () => void;
};

function SeekTimeModal({
    draft,
    onCancel,
    onChange,
    onSet,
}: SeekTimeModalProps) {
    const handleChange = useCallback(
        (_event: DateTimePickerEvent, date?: Date) => {
            if (date) onChange(date);
        },
        [onChange],
    );

    return (
        <SlideUpModal onClose={onCancel} scrimColor="rgba(0,0,0,0.4)" visible>
            <Pressable style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                    <Pressable
                        accessibilityLabel="Cancel"
                        accessibilityRole="button"
                        hitSlop={12}
                        onPress={onCancel}
                        style={styles.modalCancelButton}
                    >
                        <Text style={styles.modalCancelText}>Cancel</Text>
                    </Pressable>
                    <Text style={styles.modalHeaderTitle}>
                        Seeking start time
                    </Text>
                    <Pressable
                        accessibilityLabel="Set time"
                        accessibilityRole="button"
                        hitSlop={12}
                        onPress={onSet}
                        style={styles.modalDoneButton}
                        testID="seek-time-modal-set"
                    >
                        <Text style={styles.modalDoneText}>Set</Text>
                    </Pressable>
                </View>
                <View style={styles.timePickerBody}>
                    <DateTimePicker
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        is24Hour
                        mode="time"
                        onChange={handleChange}
                        value={draft}
                    />
                </View>
            </Pressable>
        </SlideUpModal>
    );
}

function ChildSheetShell({
    accessory,
    children,
    footer,
    onBack,
    title,
}: {
    accessory?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    onBack: () => void;
    title?: string;
}) {
    return (
        <View style={styles.fullContainer}>
            <View style={styles.childHeader}>
                <BackButton onPress={onBack} />
                {title ? (
                    <Text
                        numberOfLines={1}
                        pointerEvents="none"
                        style={styles.childHeaderTitle}
                    >
                        {title}
                    </Text>
                ) : null}
                <View style={styles.childHeaderSpacer} />
                {accessory ? (
                    <View style={styles.childHeaderAccessory}>{accessory}</View>
                ) : null}
            </View>
            <View style={styles.childBody}>{children}</View>
            {footer ? <View style={styles.childFooter}>{footer}</View> : null}
        </View>
    );
}

function QuestionDetailShell({
    onBack,
    onNavigate,
}: {
    onBack: () => void;
    onNavigate: (route: SheetRouteName) => void;
}) {
    const { activeQuestion } = useQuestionDerived();
    const title = activeQuestion
        ? (() => {
              const def = getQuestionDefinition(activeQuestion.type);
              return typeof def.title === "function"
                  ? def.title(activeQuestion)
                  : def.title;
          })()
        : undefined;

    return (
        <ChildSheetShell
            accessory={<QuestionActionsMenu onNavigate={onNavigate} />}
            onBack={onBack}
            title={title}
        >
            <QuestionDetailScreen />
        </ChildSheetShell>
    );
}

function BackButton({ onPress }: { onPress: () => void }) {
    return (
        <Pressable
            accessible
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={onPress}
            style={styles.backButton}
        >
            <Text style={styles.backText}>Back</Text>
        </Pressable>
    );
}

type DrawerActionProps = {
    description: string;
    isActive: boolean;
    onPress: () => void;
    testID: string;
    title: string;
};

function DrawerAction({
    description,
    isActive,
    onPress,
    testID,
    title,
}: DrawerActionProps) {
    return (
        <Pressable
            accessible
            accessibilityLabel={title}
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [
                styles.action,
                isActive ? styles.actionActive : null,
                pressed ? styles.actionPressed : null,
            ]}
            testID={testID}
        >
            <View style={styles.actionCopy}>
                <Text style={styles.actionTitle} accessibilityLabel={title}>
                    {title}
                </Text>
                {description ? (
                    <Text
                        style={styles.actionDescription}
                        accessibilityLabel={description}
                    >
                        {description}
                    </Text>
                ) : null}
            </View>
            <Text style={styles.chevron}>›</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    action: {
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
    actionActive: {
        backgroundColor: colors.tealTintBg,
        borderColor: colors.tint,
    },
    actionCopy: {
        flex: 1,
    },
    actionDescription: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
    },
    actionPressed: {
        opacity: 0.72,
    },
    actions: {
        gap: 8,
    },
    actionTitle: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "700",
    },
    animatedFill: {
        ...StyleSheet.absoluteFillObject,
    },
    backButton: {
        alignSelf: "flex-start",
        justifyContent: "center",
        minHeight: 44,
        minWidth: 72,
        paddingVertical: 4,
    },
    childHeader: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        minHeight: 44,
        paddingBottom: 4,
        paddingHorizontal: 20,
    },
    childHeaderAccessory: {
        alignItems: "flex-end",
        minWidth: 94,
    },
    childHeaderSpacer: {
        flex: 1,
    },
    childHeaderTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "700",
        left: 0,
        position: "absolute",
        right: 0,
        textAlign: "center",
    },
    container: {
        flex: 1,
        paddingHorizontal: 20,
    },
    description: {
        color: colors.muted,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 8,
    },
    detail: {
        color: colors.muted,
        fontSize: 14,
        lineHeight: 19,
        marginTop: 4,
    },
    edgeSlab: {
        bottom: 0,
        left: 0,
        position: "absolute",
        top: 0,
        width: 20,
    },
    eyebrow: {
        color: colors.tint,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    firstRunActions: {
        gap: 10,
    },
    firstRunContent: {
        gap: 16,
        paddingVertical: 20,
    },
    exploreHint: {
        color: colors.muted,
        fontSize: 13,
        textAlign: "center",
    },
    fullContainer: {
        flex: 1,
    },
    childBody: {
        flex: 1,
    },
    childFooter: {
        borderTopColor: colors.border,
        borderTopWidth: 1,
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    header: {
        paddingBottom: 10,
        paddingTop: 2,
    },
    hudContent: {
        gap: 14,
        paddingTop: 4,
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
    naAffordance: {
        alignItems: "center",
        justifyContent: "center",
    },
    naHint: {
        color: colors.tint,
        fontSize: 9,
        fontWeight: "600",
    },
    naText: {
        color: colors.muted,
        fontSize: 22,
        fontWeight: "900",
    },
    navRows: {
        gap: 8,
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
    statLabel: {
        color: colors.muted,
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0.4,
        marginTop: 2,
        textTransform: "uppercase",
    },
    statNumber: {
        color: colors.ink,
        fontSize: 26,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    statSpinner: {
        height: 26,
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
    title: {
        color: colors.ink,
        fontSize: 24,
        fontWeight: "800",
        marginTop: 2,
    },
    transitionContainer: {
        flex: 1,
        overflow: "hidden",
    },
    backText: {
        color: colors.tint,
        fontSize: 16,
        fontWeight: "700",
    },
    chevron: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
    },
    // Seek time modal
    modalCancelButton: {
        minWidth: 72,
    },
    modalCancelText: {
        color: colors.muted,
        fontSize: 16,
        fontWeight: "600",
    },
    modalContainer: {
        backgroundColor: colors.background,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingBottom: 40,
    },
    modalDoneButton: {
        alignItems: "flex-end",
        minWidth: 72,
    },
    modalDoneText: {
        color: colors.tint,
        fontSize: 16,
        fontWeight: "700",
    },
    modalHeader: {
        alignItems: "center",
        borderBottomColor: colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    modalHeaderTitle: {
        color: colors.ink,
        fontSize: 18,
        fontWeight: "800",
    },
    timePickerBody: {
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
});

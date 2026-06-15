import {
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    BackHandler,
    Dimensions,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import { HidingZoneScreen } from "@/features/hidingZone/HidingZoneScreen";
import { buildCombinedEligibilityMask } from "@/features/map/maskBuilder";
import { zoneEliminationPercent } from "@/features/map/useEliminationPercentage";
import { PlayAreaScreen } from "@/features/playArea/PlayAreaScreen";
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
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";
import {
    useHidingZoneDerived,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import {
    useGameMode,
    useQuestionActions,
    useQuestionDerived,
    useQuestionIds,
    useSeekingStartedAt,
} from "@/state/questionStore";
import { geomAreaM2 } from "@/shared/geometry/parityMetrics";
import { colors } from "@/theme/colors";
import type { GeoJsonFeatureCollection } from "@/features/map/geojsonTypes";

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
    const { selectedStations, zoneFeatures } = useHidingZoneDerived();
    const seekingStartedAt = useSeekingStartedAt();
    const questionMapRenderState = useQuestionMapRenderState();

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

    // Elimination percentage: piggyback on the existing mask computation.
    const eliminationPct = useMemo(() => {
        if (!playArea.boundary || zoneFeatures.features.length === 0)
            return null;

        const zoneArea = featureCollectionArea(zoneFeatures as any);
        if (zoneArea <= 0) return null;

        const mask = buildCombinedEligibilityMask(
            playArea.boundary as any,
            [
                zoneFeatures as any,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.radar.hitMaskFeatures as any,
                ),
                questionMapRenderState.transitLine.hitMaskFeatures as any,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.osmMatching.hitMaskFeatures as any,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.thermometer.hitMaskFeatures as any,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.tentacles.hitMaskFeatures as any,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.measuring.hitMaskFeatures as any,
                ),
            ],
            [
                questionMapRenderState.radar.missMaskFeatures as any,
                questionMapRenderState.transitLine.missMaskFeatures as any,
                questionMapRenderState.osmMatching.missMaskFeatures as any,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.tentacles.missMaskFeatures as any,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.measuring.missMaskFeatures as any,
                ),
            ],
        );

        const playAreaArea = featureCollectionArea(playArea.boundary as any);
        const maskArea = featureCollectionArea(mask);
        return zoneEliminationPercent(playAreaArea, maskArea, zoneArea);
    }, [playArea.boundary, zoneFeatures, questionMapRenderState]);

    const handleStartSeeking = useCallback(() => {
        setSeekingStartedAt(Date.now());
    }, [setSeekingStartedAt]);

    return (
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
                                    questions, record their answers, and watch
                                    the map narrow down where they can be.
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
                                        pressed ? styles.actionPressed : null,
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
                                        pressed ? styles.actionPressed : null,
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
                                <Text style={styles.eyebrow}>Current game</Text>
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
                                    {gameMode === "hider" ? "Hider" : "Seeker"}
                                </Text>
                            </Pressable>
                        </View>

                        <View style={styles.statCard}>
                            <View style={styles.statItem}>
                                {elapsedMs !== null ? (
                                    <Text style={styles.statNumber}>
                                        {formatElapsed(elapsedMs)}
                                    </Text>
                                ) : (
                                    <Pressable
                                        accessibilityLabel="Set seeking start time"
                                        accessibilityRole="button"
                                        onPress={handleStartSeeking}
                                        style={({ pressed }) => [
                                            styles.naAffordance,
                                            pressed
                                                ? styles.actionPressed
                                                : null,
                                        ]}
                                        testID="main-start-seeking"
                                    >
                                        <Text style={styles.naText}>N/A</Text>
                                        <Text style={styles.naHint}>
                                            Tap to start
                                        </Text>
                                    </Pressable>
                                )}
                                <Text style={styles.statLabel}>Hide time</Text>
                            </View>
                            <View style={styles.statItem}>
                                <Text style={styles.statNumber}>
                                    {selectedStations.length}
                                </Text>
                                <Text style={styles.statLabel}>Stations</Text>
                            </View>
                            <View style={styles.statItem}>
                                <Text style={styles.statNumber}>
                                    {eliminationPct !== null
                                        ? `${eliminationPct}%`
                                        : "—"}
                                </Text>
                                <Text style={styles.statLabel}>Eliminated</Text>
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
    );
}

function formatElapsed(ms: number): string {
    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}hr`;
}

function featureCollectionArea(fc: GeoJsonFeatureCollection): number {
    let total = 0;
    for (const feature of fc.features) {
        if (!feature?.geometry) continue;
        const { type } = feature.geometry;
        if (type === "Polygon" || type === "MultiPolygon") {
            total += geomAreaM2(feature.geometry as any);
        }
    }
    return total;
}

function asSeparateMaskConstraints(
    fc: GeoJsonFeatureCollection,
): GeoJsonFeatureCollection[] {
    if (fc.features.length === 0) return [];
    return fc.features.map((feature: any) => ({
        features: [feature],
        type: "FeatureCollection" as const,
    }));
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
});

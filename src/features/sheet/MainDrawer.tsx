import {
    Suspense,
    lazy,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { BackHandler, Dimensions, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import { HidingZoneScreen } from "@/features/hidingZone/HidingZoneScreen";
import { PlayAreaScreen } from "@/features/playArea/PlayAreaScreen";
import { StationDetailScreen } from "@/features/sheet/StationDetailScreen";
import { AddQuestionScreen } from "@/features/questions/AddQuestionScreen";
import { MatchingQuestionScreen } from "@/features/questions/MatchingQuestionScreen";
import { MeasuringCategoryScreen } from "@/features/questions/measuring/MeasuringCategoryScreen";
import { QuestionsScreen } from "@/features/questions/QuestionsScreen";
import { AdminDivisionScreen } from "@/features/sheet/AdminDivisionScreen";
import { OfflineDataScreen } from "@/features/offline/OfflineDataScreen";
import { SettingsScreen } from "@/features/sheet/SettingsScreen";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { getBackTarget, getNavDirection } from "@/features/sheet/sheetNav";
import { MainSheetContent } from "@/features/sheet/MainSheetContent";
import {
    ChildSheetShell,
    QuestionDetailShell,
} from "@/features/sheet/sheetComponents";
import { ANIMATION } from "@/config/appConfig";

/**
 * Lazy-loaded dev-only screen. The import() creates a separate Metro async
 * chunk so the parity harness + fixtures (~1900 lines) are excluded from the
 * main production bundle. In production (`__DEV__` is false) the chunk is
 * never fetched because the route is unreachable.
 */
const GeometryParityScreen = lazy(() =>
    import("@/features/sheet/GeometryParityScreen").then((m) => ({
        default: m.GeometryParityScreen,
    })),
);

const SHEET_WIDTH = Dimensions.get("window").width;

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
            duration: ANIMATION.sheetTransitionMs,
        });
        enteringX.value = withTiming(0, {
            duration: ANIMATION.sheetTransitionMs,
        });

        cleanupTimerRef.current = setTimeout(() => {
            setTransition((current) =>
                current?.id === transitionId ? null : current,
            );
        }, ANIMATION.sheetTransitionMs);
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
                    if (
                        event.translationX > ANIMATION.swipeBackThreshold ||
                        event.velocityX > ANIMATION.swipeBackVelocity
                    ) {
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
            if (!__DEV__) return null;
            return (
                <Suspense fallback={null}>
                    <ChildSheetShell onBack={() => onNavigate("settings")}>
                        <GeometryParityScreen />
                    </ChildSheetShell>
                </Suspense>
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
        case "measuring":
            return (
                <ChildSheetShell onBack={() => onNavigate("add-question")}>
                    <MeasuringCategoryScreen onNavigate={onNavigate} />
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

const styles = StyleSheet.create({
    transitionContainer: {
        flex: 1,
        overflow: "hidden",
    },
    animatedFill: {
        ...StyleSheet.absoluteFillObject,
    },
    edgeSlab: {
        bottom: 0,
        left: 0,
        position: "absolute",
        top: 0,
        width: 20,
    },
});

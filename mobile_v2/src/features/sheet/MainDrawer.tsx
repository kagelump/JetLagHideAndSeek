import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PlayAreaScreen } from "@/features/playArea/PlayAreaScreen";
import { SettingsScreen } from "@/features/sheet/SettingsScreen";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { getBackTarget, getNavDirection } from "@/features/sheet/sheetNav";
import { colors } from "@/theme/colors";

const SHEET_WIDTH = Dimensions.get("window").width;

type MainDrawerProps = {
    route: SheetRouteName;
    onNavigate: (route: SheetRouteName) => void;
};

const routeContent: Record<SheetRouteName, { title: string; detail: string }> =
    {
        "add-question": {
            detail: "Question creation will land here in a later milestone.",
            title: "Add Question",
        },
        main: {
            detail: "Choose a workflow to start shaping the game.",
            title: "Game Setup",
        },
        questions: {
            detail: "The question list will be wired once the state model exists.",
            title: "Questions",
        },
        settings: {
            detail: "Play area, units, and sharing controls will live here.",
            title: "Settings",
        },
        "play-area": {
            detail: "Choose the boundary for the game map.",
            title: "Play Area",
        },
        "hiding-zone": {
            detail: "Select eligible transit stations for the hiding zone.",
            title: "Hiding Zones",
        },
    };

export function MainDrawer({ route, onNavigate }: MainDrawerProps) {
    const backTarget = getBackTarget(route);
    const directionRef = useRef<"forward" | "back">("forward");
    const [leavingRoute, setLeavingRoute] = useState<SheetRouteName | null>(
        null,
    );
    const prevRouteRef = useRef(route);
    const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const leavingX = useSharedValue(0);
    const enteringX = useSharedValue(0);

    const leavingStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: leavingX.value }],
    }));

    const enteringStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: enteringX.value }],
    }));

    const handleNavigate = useCallback(
        (to: SheetRouteName) => {
            if (cleanupTimerRef.current) {
                clearTimeout(cleanupTimerRef.current);
                cleanupTimerRef.current = null;
            }
            const dir = getNavDirection(route, to);
            directionRef.current = dir;
            setLeavingRoute(route);
            enteringX.value = dir === "forward" ? SHEET_WIDTH : -SHEET_WIDTH;
            onNavigate(to);
        },
        [route, onNavigate],
    );

    useEffect(() => {
        if (route === prevRouteRef.current) return;
        prevRouteRef.current = route;
        const isBack = directionRef.current === "back";

        leavingX.value = withTiming(isBack ? SHEET_WIDTH : -SHEET_WIDTH, {
            duration: 300,
        });
        enteringX.value = withTiming(0, { duration: 300 });

        cleanupTimerRef.current = setTimeout(() => {
            setLeavingRoute(null);
        }, 300);

        return () => {
            if (cleanupTimerRef.current) {
                clearTimeout(cleanupTimerRef.current);
                cleanupTimerRef.current = null;
            }
        };
    }, [route]);

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
            {leavingRoute ? (
                <Animated.View style={[styles.animatedFill, leavingStyle]}>
                    {renderRouteContent(leavingRoute, handleNavigate)}
                </Animated.View>
            ) : null}

            <Animated.View style={[styles.animatedFill, enteringStyle]}>
                {renderRouteContent(route, handleNavigate)}
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

function renderRouteContent(
    routeName: SheetRouteName,
    onNavigate: (route: SheetRouteName) => void,
) {
    switch (routeName) {
        case "settings":
            return (
                <View style={styles.container}>
                    <BackButton onPress={() => onNavigate("main")} />
                    <SettingsScreen onNavigate={onNavigate} />
                </View>
            );
        case "play-area":
            return (
                <View style={styles.fullContainer}>
                    <View style={styles.backButtonRow}>
                        <BackButton onPress={() => onNavigate("settings")} />
                    </View>
                    <PlayAreaScreen />
                </View>
            );
        case "hiding-zone":
            return (
                <View style={styles.fullContainer}>
                    <View style={styles.backButtonRow}>
                        <BackButton onPress={() => onNavigate("settings")} />
                    </View>
                    <HidingZoneScreen />
                </View>
            );
        default: {
            const content = routeContent[routeName];
            return (
                <View style={styles.container}>
                    <View style={styles.header}>
                        {routeName !== "main" ? (
                            <BackButton onPress={() => onNavigate("main")} />
                        ) : null}
                        <Text style={styles.eyebrow}>Mobile v2</Text>
                        <Text style={styles.title}>{content.title}</Text>
                        <Text style={styles.detail}>{content.detail}</Text>
                    </View>

                    <View style={styles.actions}>
                        <DrawerAction
                            title="Questions"
                            description="Review answers and question geometry."
                            isActive={routeName === "questions"}
                            onPress={() => onNavigate("questions")}
                            testID="main-questions-row"
                        />
                        <DrawerAction
                            title="Add Question"
                            description="Start a radius, thermometer, or transit question."
                            isActive={routeName === "add-question"}
                            onPress={() => onNavigate("add-question")}
                            testID="main-add-question-row"
                        />
                        <DrawerAction
                            title="Settings"
                            description="Adjust the play area and app preferences."
                            isActive={false}
                            onPress={() => onNavigate("settings")}
                            testID="main-settings-row"
                        />
                    </View>
                </View>
            );
        }
    }
}

function BackButton({ onPress }: { onPress: () => void }) {
    return (
        <Pressable
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
                <Text style={styles.actionTitle}>{title}</Text>
                <Text style={styles.actionDescription}>{description}</Text>
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
        backgroundColor: "#e6f2ef",
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
        marginBottom: 8,
        paddingVertical: 4,
    },
    backButtonRow: {
        paddingHorizontal: 20,
    },
    fullContainer: {
        flex: 1,
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
    container: {
        flex: 1,
        paddingHorizontal: 20,
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
        letterSpacing: 0,
        textTransform: "uppercase",
    },
    header: {
        paddingBottom: 10,
        paddingTop: 2,
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
});

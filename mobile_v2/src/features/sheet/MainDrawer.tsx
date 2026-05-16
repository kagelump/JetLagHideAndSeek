import { Pressable, StyleSheet, Text, View } from "react-native";

import { PlayAreaScreen } from "@/features/playArea/PlayAreaScreen";
import { SettingsScreen } from "@/features/sheet/SettingsScreen";
import { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { colors } from "@/theme/colors";

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
    };

export function MainDrawer({ route, onNavigate }: MainDrawerProps) {
    const content = routeContent[route];

    if (route === "settings") {
        return (
            <View style={styles.container}>
                <BackButton onPress={() => onNavigate("main")} />
                <SettingsScreen onNavigate={onNavigate} />
            </View>
        );
    }

    if (route === "play-area") {
        return (
            <View style={styles.container}>
                <BackButton onPress={() => onNavigate("settings")} />
                <PlayAreaScreen />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                {route !== "main" ? (
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
                    isActive={route === "questions"}
                    onPress={() => onNavigate("questions")}
                    testID="main-questions-row"
                />
                <DrawerAction
                    title="Add Question"
                    description="Start a radius, thermometer, or transit question."
                    isActive={route === "add-question"}
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
    backButton: {
        alignSelf: "flex-start",
        marginBottom: 8,
        paddingVertical: 4,
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
});

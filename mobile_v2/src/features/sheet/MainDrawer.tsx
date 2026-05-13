import { Pressable, StyleSheet, Text, View } from "react-native";

import { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { colors } from "@/theme/colors";

type MainDrawerProps = {
    route: SheetRouteName;
    onNavigate: (route: SheetRouteName) => void;
};

const routeContent: Record<SheetRouteName, { title: string; detail: string }> = {
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
};

export function MainDrawer({ route, onNavigate }: MainDrawerProps) {
    const content = routeContent[route];

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                {route !== "main" ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => onNavigate("main")}
                        style={styles.backButton}
                    >
                        <Text style={styles.backText}>Back</Text>
                    </Pressable>
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
                />
                <DrawerAction
                    title="Add Question"
                    description="Start a radius, thermometer, or transit question."
                    isActive={route === "add-question"}
                    onPress={() => onNavigate("add-question")}
                />
                <DrawerAction
                    title="Settings"
                    description="Adjust the play area and app preferences."
                    isActive={route === "settings"}
                    onPress={() => onNavigate("settings")}
                />
            </View>
        </View>
    );
}

type DrawerActionProps = {
    description: string;
    isActive: boolean;
    onPress: () => void;
    title: string;
};

function DrawerAction({
    description,
    isActive,
    onPress,
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
        minHeight: 72,
        paddingHorizontal: 16,
        paddingVertical: 12,
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
        gap: 10,
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
        fontSize: 15,
        lineHeight: 21,
        marginTop: 6,
    },
    eyebrow: {
        color: colors.tint,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
        textTransform: "uppercase",
    },
    header: {
        paddingBottom: 18,
        paddingTop: 6,
    },
    title: {
        color: colors.ink,
        fontSize: 28,
        fontWeight: "800",
        marginTop: 4,
    },
});

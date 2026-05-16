import { Pressable, StyleSheet, Text, View } from "react-native";

import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { usePlayArea } from "@/state/playAreaStore";
import { colors } from "@/theme/colors";

type SettingsScreenProps = {
    onNavigate: (route: SheetRouteName) => void;
};

export function SettingsScreen({ onNavigate }: SettingsScreenProps) {
    const { cacheSource, playArea } = usePlayArea();

    return (
        <View style={styles.container}>
            <Text style={styles.eyebrow}>Settings</Text>
            <Text style={styles.title}>Game Settings</Text>
            <Text style={styles.detail}>
                Adjust the map area and app preferences.
            </Text>

            <View style={styles.actions}>
                <Pressable
                    accessibilityLabel="Open Play Area settings"
                    accessibilityRole="button"
                    onPress={() => onNavigate("play-area")}
                    style={({ pressed }) => [
                        styles.action,
                        pressed ? styles.actionPressed : null,
                    ]}
                    testID="settings-play-area-row"
                >
                    <View style={styles.actionCopy}>
                        <Text style={styles.actionTitle}>Play Area</Text>
                        <Text style={styles.actionDescription}>
                            {playArea.label} · {cacheSource}
                        </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                </Pressable>
            </View>
        </View>
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
        marginTop: 18,
    },
    actionTitle: {
        color: colors.ink,
        fontSize: 17,
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
        paddingTop: 6,
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
    title: {
        color: colors.ink,
        fontSize: 28,
        fontWeight: "800",
        marginTop: 4,
    },
});

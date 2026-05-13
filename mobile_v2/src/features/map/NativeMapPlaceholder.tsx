import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/theme/colors";

export function NativeMapPlaceholder() {
    const insets = useSafeAreaInsets();

    return (
        <View style={styles.canvas}>
            <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
                <Text style={styles.title}>Hide & Seek</Text>
                <Text style={styles.subtitle}>Clean mobile shell</Text>
            </View>
            <View style={styles.parkShape} />
            <View style={styles.waterShape} />
            <View style={styles.roadPrimary} />
            <View style={styles.roadSecondary} />
            <View style={styles.pin}>
                <View style={styles.pinCore} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    canvas: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.background,
        overflow: "hidden",
    },
    parkShape: {
        backgroundColor: colors.mapGreen,
        borderColor: "#7ead88",
        borderRadius: 26,
        borderWidth: 1,
        height: 250,
        left: -40,
        opacity: 0.78,
        position: "absolute",
        top: 140,
        transform: [{ rotate: "-18deg" }],
        width: 280,
    },
    pin: {
        alignItems: "center",
        backgroundColor: colors.white,
        borderColor: "rgba(23, 32, 42, 0.18)",
        borderRadius: 18,
        borderWidth: 1,
        height: 36,
        justifyContent: "center",
        left: "54%",
        position: "absolute",
        top: "39%",
        width: 36,
        ...Platform.select({
            default: {
                elevation: 5,
                shadowColor: "#000",
                shadowOffset: { height: 4, width: 0 },
                shadowOpacity: 0.14,
                shadowRadius: 10,
            },
            web: {
                boxShadow: "0 4px 10px rgba(0, 0, 0, 0.14)",
            },
        }),
    },
    pinCore: {
        backgroundColor: colors.tint,
        borderRadius: 7,
        height: 14,
        width: 14,
    },
    roadPrimary: {
        backgroundColor: colors.mapRoad,
        borderRadius: 16,
        height: 26,
        left: -30,
        position: "absolute",
        right: -20,
        top: 310,
        transform: [{ rotate: "20deg" }],
    },
    roadSecondary: {
        backgroundColor: "#e6c4b7",
        borderRadius: 10,
        height: 18,
        left: 120,
        position: "absolute",
        right: -60,
        top: 210,
        transform: [{ rotate: "-34deg" }],
    },
    subtitle: {
        color: colors.muted,
        fontSize: 14,
        marginTop: 2,
    },
    title: {
        color: colors.ink,
        fontSize: 22,
        fontWeight: "700",
    },
    topBar: {
        paddingHorizontal: 20,
    },
    waterShape: {
        backgroundColor: colors.mapBlue,
        borderRadius: 999,
        height: 330,
        opacity: 0.74,
        position: "absolute",
        right: -170,
        top: 96,
        width: 330,
    },
});

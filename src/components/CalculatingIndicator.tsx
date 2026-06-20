import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors } from "@/theme/colors";

type CalculatingIndicatorProps = {
    /** Spinner size. Defaults to "small". */
    size?: "small" | "large";
    /** Spinner color. Defaults to the app tint. */
    color?: string;
    style?: StyleProp<ViewStyle>;
};

/**
 * Inline loading spinner shown in place of a value while a deferred
 * computation is pending (see {@link useDeferredComputation}). Standardizes the
 * ad-hoc `ActivityIndicator` usages across stat readouts.
 */
export function CalculatingIndicator({
    size = "small",
    color = colors.tint,
    style,
}: CalculatingIndicatorProps) {
    return (
        <ActivityIndicator
            accessibilityLabel="Calculating"
            color={color}
            size={size}
            style={style}
        />
    );
}

type CalculatingPillProps = {
    /** When false the pill renders nothing. */
    active: boolean;
    /** Label text. Defaults to "Calculating…". */
    label?: string;
    style?: StyleProp<ViewStyle>;
};

/**
 * Floating "Calculating…" pill for overlaying on the map while heavy geometry
 * recomputes. Always mount this and toggle via `active` rather than
 * conditionally mounting it from a map layer file (see the nil-subview
 * regression guard in NativeMap.test).
 */
export function CalculatingPill({
    active,
    label = "Calculating…",
    style,
}: CalculatingPillProps) {
    if (!active) return null;
    return (
        <View
            accessibilityLabel="Calculating"
            accessibilityRole="progressbar"
            pointerEvents="none"
            style={[styles.pill, style]}
        >
            <ActivityIndicator color={colors.tint} size="small" />
            <Text style={styles.pillLabel}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    pill: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 3,
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        shadowColor: "#000",
        shadowOffset: { height: 1, width: 0 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
    },
    pillLabel: {
        color: colors.ink,
        fontSize: 13,
        fontWeight: "700",
    },
});

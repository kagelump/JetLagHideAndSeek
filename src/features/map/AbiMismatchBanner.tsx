import { EXPECTED_NATIVE_ABI, nativeAbiVersion } from "native-geometry";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/theme/colors";

/**
 * Persistent, non-dismissible dev banner that appears when the native
 * geometry binary reports a lower ABI version than the JS code expects.
 * On mismatch all overlay ops degrade silently to pure JS, which can
 * hard-lock for ~25 s on body-of-water dissolves. The banner makes this
 * visible so developers know to rebuild the dev client.
 *
 * Only renders in __DEV__ mode. Checks independently of geometryBackend.ts
 * (no coupling between the backend and the UI).
 */
export function AbiMismatchBanner(): React.JSX.Element | null {
    const insets = useSafeAreaInsets();
    const nativeAbi =
        typeof nativeAbiVersion === "function" ? nativeAbiVersion() : 0;

    if (!__DEV__) return null;
    if (nativeAbi >= EXPECTED_NATIVE_ABI) return null;

    return (
        <View style={[styles.banner, { paddingTop: insets.top + 4 }]}>
            <Text style={styles.text}>
                Native geometry binary is outdated (ABI {nativeAbi} &lt;
                expected {EXPECTED_NATIVE_ABI}). Overlay ops running in slow JS
                mode. Rebuild the dev client.
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        backgroundColor: colors.warningBg,
        left: 0,
        position: "absolute",
        paddingBottom: 4,
        paddingHorizontal: 16,
        right: 0,
        top: 0,
        zIndex: 100,
    },
    text: {
        color: colors.white,
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
});

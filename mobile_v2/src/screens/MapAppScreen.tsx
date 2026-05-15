import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";

import { NativeMap } from "@/features/map/NativeMap";
import { AppBottomSheet } from "@/features/sheet/AppBottomSheet";
import { colors } from "@/theme/colors";

export function MapAppScreen() {
    return (
        <View style={styles.screen}>
            <StatusBar style="dark" />
            <NativeMap />
            <AppBottomSheet />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        backgroundColor: colors.background,
        flex: 1,
    },
});

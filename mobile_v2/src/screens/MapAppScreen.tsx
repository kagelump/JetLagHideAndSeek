import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";

import { NativeMapPlaceholder } from "@/features/map/NativeMapPlaceholder";
import { AppBottomSheet } from "@/features/sheet/AppBottomSheet";
import { colors } from "@/theme/colors";

export function MapAppScreen() {
    return (
        <View style={styles.screen}>
            <StatusBar style="dark" />
            <NativeMapPlaceholder />
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

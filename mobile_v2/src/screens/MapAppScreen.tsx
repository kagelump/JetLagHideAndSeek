import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";

import { NativeMap } from "@/features/map/NativeMap";
import { AppBottomSheet } from "@/features/sheet/AppBottomSheet";
import { HidingZoneProvider } from "@/state/hidingZoneStore";
import { PlayAreaProvider } from "@/state/playAreaStore";
import { colors } from "@/theme/colors";

export function MapAppScreen() {
    return (
        <PlayAreaProvider>
            <HidingZoneProvider>
                <View style={styles.screen}>
                    <StatusBar style="dark" />
                    <NativeMap />
                    <AppBottomSheet />
                </View>
            </HidingZoneProvider>
        </PlayAreaProvider>
    );
}

const styles = StyleSheet.create({
    screen: {
        backgroundColor: colors.background,
        flex: 1,
    },
});

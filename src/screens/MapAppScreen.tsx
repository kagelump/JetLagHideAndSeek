import { StatusBar } from "expo-status-bar";
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { getQuestionPins } from "@/features/map/getQuestionPins";
import { NativeMap } from "@/features/map/NativeMap";
import { useMapPinCommit } from "@/features/map/useMapPinCommit";
import { ThermometerDragProvider } from "@/features/questions/thermometer/ThermometerDragContext";
import { useThermometerDrag } from "@/features/questions/thermometer/useThermometerDrag";
import {
    AppBottomSheet,
    type BottomSheetHandle,
} from "@/features/sheet/AppBottomSheet";
import { SheetSnapProvider } from "@/features/sheet/SheetSnapContext";
import { FabButton } from "@/features/sheet/FabButton";
import {
    SHEET_SNAP_INDEX,
    type SheetRouteName,
} from "@/features/sheet/sheetRoutes";
import { useQuestionDerived } from "@/state/questionStore";
import { colors } from "@/theme/colors";

export function MapAppScreen() {
    const bottomSheetRef = useRef<BottomSheetHandle>(null);
    const sheetIndexRef = useRef<number>(SHEET_SNAP_INDEX.medium);
    const [sheetIndex, setSheetIndex] = useState<number>(
        SHEET_SNAP_INDEX.medium,
    );
    const [sheetRoute, setSheetRoute] = useState<SheetRouteName>("main");
    const isQuestionDetailRoute = sheetRoute === "question-detail";
    const handlePinCommit = useMapPinCommit();
    const { activeQuestion } = useQuestionDerived();
    const { dragState, handleDragUpdate } = useThermometerDrag();

    const allPins = useMemo(
        () => getQuestionPins(activeQuestion),
        [activeQuestion],
    );
    const pins = isQuestionDetailRoute ? allPins : [];
    const questionId = isQuestionDetailRoute
        ? (activeQuestion?.id ?? null)
        : null;
    const isLocked = activeQuestion?.isLocked ?? false;
    const canMove = isQuestionDetailRoute && !isLocked && pins.length > 0;

    const handleMapPress = useCallback(() => {
        if (sheetIndexRef.current === SHEET_SNAP_INDEX.large) {
            bottomSheetRef.current?.snapToIndex(SHEET_SNAP_INDEX.compact);
        }
    }, []);

    const handleSheetIndexChange = useCallback((index: number) => {
        sheetIndexRef.current = index;
        setSheetIndex(index);
    }, []);

    const handleSheetRouteChange = useCallback((route: SheetRouteName) => {
        setSheetRoute(route);
    }, []);

    const handleFabPress = useCallback(() => {
        bottomSheetRef.current?.snapToIndex(SHEET_SNAP_INDEX.medium);
    }, []);

    const handleSheetSnap = useCallback((index: number) => {
        bottomSheetRef.current?.snapToIndex(index);
    }, []);

    return (
        <ThermometerDragProvider value={dragState}>
            <View style={styles.screen}>
                <StatusBar style="dark" />
                <NativeMap
                    canMove={canMove}
                    isQuestionDetailRoute={isQuestionDetailRoute}
                    onPinCommit={handlePinCommit}
                    onPress={handleMapPress}
                    onThermometerDragUpdate={handleDragUpdate}
                    pins={pins}
                    questionId={questionId}
                />
                <FabButton
                    accessibilityHidden={sheetIndex !== -1}
                    onPress={handleFabPress}
                />
                <SheetSnapProvider snapToIndex={handleSheetSnap}>
                    <AppBottomSheet
                        ref={bottomSheetRef}
                        onIndexChange={handleSheetIndexChange}
                        onRouteChange={handleSheetRouteChange}
                    />
                </SheetSnapProvider>
            </View>
        </ThermometerDragProvider>
    );
}

const styles = StyleSheet.create({
    screen: {
        backgroundColor: colors.background,
        flex: 1,
    },
});

import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import type { ComponentType } from "react";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import { BackHandler, Keyboard, StyleSheet } from "react-native";

import { MainDrawer } from "@/features/sheet/MainDrawer";
import { SHEET_SNAP_INDEX, SheetRouteName } from "@/features/sheet/sheetRoutes";
import { getBackTarget } from "@/features/sheet/sheetNav";
import { colors } from "@/theme/colors";

const Sheet = BottomSheet as ComponentType<any>;
const SheetView = BottomSheetView as ComponentType<any>;

export type BottomSheetHandle = {
    snapToIndex: (index: number) => void;
};

type AppBottomSheetProps = {
    onIndexChange?: (index: number) => void;
    onRouteChange?: (route: SheetRouteName) => void;
};

const SHEET_SNAP_POINTS = ["18%", "42%", "88%"] as const;

export const AppBottomSheet = forwardRef<
    BottomSheetHandle,
    AppBottomSheetProps
>(function AppBottomSheet({ onIndexChange, onRouteChange }, ref) {
    const sheetRef = useRef<{ snapToIndex?: (index: number) => void } | null>(
        null,
    );
    const snapPoints = useMemo(() => [...SHEET_SNAP_POINTS], []);
    const [route, setRoute] = useState<SheetRouteName>("main");
    const [, setSheetIndex] = useState<number>(SHEET_SNAP_INDEX.medium);
    const currentIndexRef = useRef<number>(SHEET_SNAP_INDEX.medium);

    useImperativeHandle(ref, () => ({
        snapToIndex(index: number) {
            sheetRef.current?.snapToIndex?.(index);
        },
    }));

    const handleBackPress = useCallback(() => {
        const backTarget = getBackTarget(route);
        if (backTarget) {
            sheetRef.current?.snapToIndex?.(getRouteSnapIndex(backTarget));
            setRoute(backTarget);
            return true;
        }
        // On "main" route: close the sheet.
        sheetRef.current?.snapToIndex?.(-1);
        return true;
    }, [route]);

    useEffect(() => {
        const sub = BackHandler.addEventListener(
            "hardwareBackPress",
            handleBackPress,
        );
        return () => sub.remove();
    }, [handleBackPress]);

    useEffect(() => {
        const target = getRouteSnapIndex(route);
        if (
            currentIndexRef.current === -1 ||
            target > currentIndexRef.current
        ) {
            sheetRef.current?.snapToIndex?.(target);
        }
    }, [route]);

    useEffect(() => {
        onRouteChange?.(route);
    }, [route, onRouteChange]);

    return (
        <Sheet
            ref={sheetRef}
            index={SHEET_SNAP_INDEX.medium}
            snapPoints={snapPoints}
            enableDynamicSizing={false}
            enableOverDrag={false}
            handleIndicatorStyle={styles.handleIndicator}
            backgroundStyle={styles.sheetBackground}
            accessible={false}
            onChange={(index: number) => {
                if (index === SHEET_SNAP_INDEX.compact || index === -1) {
                    Keyboard.dismiss();
                }
                currentIndexRef.current = index;
                setSheetIndex(index);
                onIndexChange?.(index);
            }}
        >
            <SheetView accessible={false} style={styles.content}>
                <MainDrawer route={route} onNavigate={setRoute} />
            </SheetView>
        </Sheet>
    );
});

function getRouteSnapIndex(route: SheetRouteName): number {
    return route === "matching" ||
        route === "measuring" ||
        route === "admin-divisions" ||
        route === "play-area"
        ? SHEET_SNAP_INDEX.large
        : SHEET_SNAP_INDEX.medium;
}

const styles = StyleSheet.create({
    content: {
        bottom: 0,
        flex: 1,
        paddingBottom: 32,
    },
    handleIndicator: {
        backgroundColor: "#b8b1a4",
        width: 44,
    },
    sheetBackground: {
        backgroundColor: colors.panel,
        borderRadius: 32,
    },
});

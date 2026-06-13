import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";

export type SheetScrollViewHandle = {
    scrollTo: (options: { y: number; animated?: boolean }) => void;
};

type SheetScrollViewProps = {
    children?: ComponentProps<typeof BottomSheetScrollView>["children"];
    contentContainerStyle?: ComponentProps<
        typeof BottomSheetScrollView
    >["contentContainerStyle"];
    style?: ComponentProps<typeof BottomSheetScrollView>["style"];
};

export const SheetScrollView = forwardRef<
    SheetScrollViewHandle,
    SheetScrollViewProps
>(function SheetScrollView({ children, contentContainerStyle, style }, ref) {
    const scrollRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
        scrollTo({ y, animated = true }) {
            scrollRef.current?.scrollTo({ y, animated });
        },
    }));

    return (
        <BottomSheetScrollView
            ref={scrollRef as any}
            style={[styles.scroll, style]}
            contentContainerStyle={[styles.content, contentContainerStyle]}
            keyboardShouldPersistTaps="handled"
            scrollIndicatorInsets={{ right: 4 }}
        >
            {children}
        </BottomSheetScrollView>
    );
});

const styles = StyleSheet.create({
    content: {
        paddingBottom: 160,
    },
    scroll: {
        flex: 1,
    },
});

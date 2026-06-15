import { useState } from "react";
import {
    type LayoutChangeEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { colors } from "@/theme/colors";

import type { MapCallout } from "./useMapCallout";

type MapPoiCalloutProps = {
    callout: MapCallout | null;
    /** Screen-space pixel point for `callout.coordinate`, from the map's
     *  `getPointInView` projection. Null while a projection is pending. */
    point: { x: number; y: number } | null;
    onDismiss: () => void;
};

/** Gap in px between the tail tip and the POI circle. */
const TAIL_GAP = 10;

/**
 * The single, map-wide POI info bubble, rendered as a plain absolutely-
 * positioned overlay *over* the map — NOT a MapLibre annotation.
 *
 * We deliberately avoid `MarkerView`/`PointAnnotation` here: on iOS those are
 * UIView-backed annotations that position themselves by measuring their React
 * child's frame, which races with layout and produces the top-left flash, the
 * anchoring quirks, and the nil-subview crash. A screen-space overlay sidesteps
 * all of it — `NativeMap` projects the coordinate with `getPointInView` and
 * reprojects on camera changes to keep the bubble pinned to the POI.
 *
 * Positioning: we measure the bubble (`onLayout`) and offset by half its width
 * / its full height so the tail tip lands just above the POI. Until the first
 * measurement we render at `opacity: 0` to avoid a one-frame jump.
 */
export function MapPoiCallout({
    callout,
    point,
    onDismiss,
}: MapPoiCalloutProps) {
    const [size, setSize] = useState<{ height: number; width: number } | null>(
        null,
    );

    if (!callout || !point) return null;

    const handleLayout = (event: LayoutChangeEvent) => {
        const { height, width } = event.nativeEvent.layout;
        if (size?.width !== width || size?.height !== height) {
            setSize({ height, width });
        }
    };

    const left = point.x - (size?.width ?? 0) / 2;
    const top = point.y - (size?.height ?? 0) - TAIL_GAP;

    return (
        <View
            onLayout={handleLayout}
            style={[styles.overlay, { left, opacity: size ? 1 : 0, top }]}
        >
            <View style={styles.bubble}>
                <Text style={styles.title} textBreakStrategy="simple">
                    {callout.title}
                </Text>
                <Pressable
                    accessibilityLabel="Close callout"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={onDismiss}
                    style={({ pressed }) => [
                        styles.close,
                        pressed ? styles.closePressed : null,
                    ]}
                >
                    <Text style={styles.closeText}>✕</Text>
                </Pressable>
            </View>
            {/* Tail triangle, centered under the bubble, pointing at the POI. */}
            <View style={styles.tail} />
        </View>
    );
}

const styles = StyleSheet.create({
    bubble: {
        alignItems: "center",
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        paddingHorizontal: 10,
        paddingVertical: 8,
        // Shadow (iOS)
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 4,
    },
    close: {
        alignItems: "center",
        borderRadius: 12,
        height: 24,
        justifyContent: "center",
        marginLeft: 8,
        width: 24,
    },
    closePressed: {
        backgroundColor: colors.border,
    },
    closeText: {
        color: colors.muted,
        fontSize: 13,
        fontWeight: "600",
    },
    overlay: {
        alignItems: "center",
        position: "absolute",
    },
    tail: {
        backgroundColor: colors.background,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        borderLeftWidth: StyleSheet.hairlineWidth,
        height: 8,
        marginTop: -1, // overlap the bubble border seam
        transform: [{ rotate: "-45deg" }],
        width: 8,
    },
    title: {
        color: colors.ink,
        fontSize: 14,
        fontWeight: "700",
        maxWidth: 220,
    },
});

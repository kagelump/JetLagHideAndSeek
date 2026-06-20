import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
    cancelAnimation,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { colors } from "@/theme/colors";

type CalculatingHeaderShimmerProps = {
    /** When false the shimmer renders nothing and stops animating. */
    active: boolean;
    /** Device top safe-area inset (status-bar height). */
    topInset: number;
};

// Number of vertical stripes used to fake a soft horizontal gradient band
// without an extra gradient dependency. A sine opacity profile gives a smooth
// bright-center / transparent-edge highlight that reads as a shimmer sweep.
const STRIPE_COUNT = 18;
const MAX_OPACITY = 0.38;
const BAND_FRACTION = 0.45; // band width as a fraction of the header width
const HEADER_BELOW_INSET = 44; // height covered below the status bar
const SWEEP_DURATION_MS = 1300;

const STRIPE_OPACITIES = Array.from({ length: STRIPE_COUNT }, (_, i) => {
    const t = i / (STRIPE_COUNT - 1);
    return Math.sin(Math.PI * t) * MAX_OPACITY;
});

/**
 * Ambient left-to-right color-fade sweep across the top header / status-bar
 * region, shown while heavy geometry recomputes. The animation runs on the
 * Reanimated UI thread, so it keeps sweeping smoothly even while the JS thread
 * is blocked by the synchronous GEOS computation that triggered it.
 *
 * Always mounted by the caller and toggled via `active` (an early `return null`
 * here, never a conditional mount in the caller) to satisfy the map-layer
 * nil-subview guard.
 */
export function CalculatingHeaderShimmer({
    active,
    topInset,
}: CalculatingHeaderShimmerProps) {
    const [width, setWidth] = useState(0);
    const progress = useSharedValue(0);
    const bandWidth = width * BAND_FRACTION;

    useEffect(() => {
        if (!active || width === 0) {
            cancelAnimation(progress);
            progress.value = 0;
            return;
        }
        progress.value = 0;
        progress.value = withRepeat(
            withTiming(1, { duration: SWEEP_DURATION_MS }),
            -1,
            false,
        );
        return () => cancelAnimation(progress);
    }, [active, width, progress]);

    const bandStyle = useAnimatedStyle(() => ({
        transform: [
            {
                translateX: -bandWidth + progress.value * (width + bandWidth),
            },
        ],
    }));

    if (!active) return null;

    const areaHeight = topInset + HEADER_BELOW_INSET;

    return (
        <View
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            pointerEvents="none"
            style={[styles.area, { height: areaHeight }]}
            testID="calculating-header-shimmer"
        >
            <Animated.View
                style={[styles.band, { width: bandWidth }, bandStyle]}
            >
                {STRIPE_OPACITIES.map((opacity, i) => (
                    <View key={i} style={[styles.stripe, { opacity }]} />
                ))}
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    area: {
        left: 0,
        overflow: "hidden",
        position: "absolute",
        right: 0,
        top: 0,
    },
    band: {
        bottom: 0,
        flexDirection: "row",
        position: "absolute",
        top: 0,
    },
    stripe: {
        backgroundColor: colors.tint,
        flex: 1,
        height: "100%",
    },
});

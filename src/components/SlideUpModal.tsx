import { useCallback, useEffect, useRef, useState } from "react";
import {
    Animated,
    Easing,
    Modal,
    Pressable,
    type StyleProp,
    StyleSheet,
    type ViewStyle,
} from "react-native";

type SlideUpModalProps = {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    /** Background color behind the content panel. Default: "rgba(23, 32, 42, 0.32)" */
    scrimColor?: string;
    /** Additional styles for the content wrapper (the view that slides up). */
    contentStyle?: StyleProp<ViewStyle>;
};

/** How far below its resting position the panel starts/ends its slide. */
const SLIDE_OFFSET = 320;
const ENTER_DURATION = 260;
const EXIT_DURATION = 220;

/**
 * A modal whose content panel slides up from the bottom while the dark scrim
 * fades in behind it (and reverses on exit).
 *
 * Why not RN's `animationType="slide"`: that translates the *entire* modal —
 * scrim included — up from the bottom edge, so the dark overlay sweeps in
 * diagonally instead of fading in place. Here we animate the two layers
 * independently: `opacity` drives the scrim (fade), `translateY` drives only
 * the content (slide). Both run in parallel so the overlay and the panel move
 * in together.
 */
export function SlideUpModal({
    visible,
    onClose,
    children,
    scrimColor = "rgba(23, 32, 42, 0.32)",
    contentStyle,
}: SlideUpModalProps) {
    const [isShown, setIsShown] = useState(visible);
    // Start at the resting position only if we mount already-visible; otherwise
    // start off-screen/transparent so the entrance animation has somewhere to
    // travel from.
    const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
    const translateY = useRef(
        new Animated.Value(visible ? 0 : SLIDE_OFFSET),
    ).current;

    const animateIn = useCallback(() => {
        Animated.parallel([
            // Scrim fades on a fixed timeline so it reads as "appearing with"
            // the panel rather than tracking the spring's overshoot.
            Animated.timing(opacity, {
                toValue: 1,
                duration: ENTER_DURATION,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            // Panel springs up so it settles with a subtle, physical ease.
            Animated.spring(translateY, {
                toValue: 0,
                damping: 22,
                stiffness: 240,
                mass: 1,
                overshootClamping: false,
                useNativeDriver: true,
            }),
        ]).start();
    }, [opacity, translateY]);

    const animateOut = useCallback(() => {
        Animated.parallel([
            Animated.timing(opacity, {
                toValue: 0,
                duration: EXIT_DURATION,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: SLIDE_OFFSET,
                duration: EXIT_DURATION,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start(({ finished }) => {
            if (finished) {
                setIsShown(false);
            }
        });
    }, [opacity, translateY]);

    useEffect(() => {
        if (visible) {
            // Reset to the start of the slide before the panel paints, then
            // animate up once it is mounted. Mounting and the first frame share
            // the same start values, so there is no flash at the final position.
            opacity.setValue(0);
            translateY.setValue(SLIDE_OFFSET);
            setIsShown(true);
        } else if (isShown) {
            animateOut();
        }
    }, [visible, isShown, animateOut, opacity, translateY]);

    useEffect(() => {
        if (visible && isShown) {
            animateIn();
        }
    }, [visible, isShown, animateIn]);

    return (
        <Modal
            animationType="none"
            onRequestClose={onClose}
            transparent
            visible={isShown}
        >
            <Animated.View
                style={[styles.scrim, { backgroundColor: scrimColor, opacity }]}
            >
                <Pressable
                    accessibilityLabel="Close modal"
                    onPress={onClose}
                    style={StyleSheet.absoluteFill}
                />
                <Animated.View
                    style={[{ transform: [{ translateY }] }, contentStyle]}
                >
                    {children}
                </Animated.View>
            </Animated.View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    scrim: {
        flex: 1,
        justifyContent: "flex-end",
    },
});

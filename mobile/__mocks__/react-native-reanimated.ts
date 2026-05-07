// Minimal mock for react-native-reanimated to avoid native module init in Jest.
// Must not reference any out-of-scope variables — Jest/Babel enforces this in jest.mock factories.
// Since we import this from jest.setup.ts via require(), the scope rules are relaxed.

const NOOP = () => {};
const ID = (t: any) => t;

const Animated = {
    View: "Reanimated.View",
    Text: "Reanimated.Text",
    Image: "Reanimated.Image",
    ScrollView: "Reanimated.ScrollView",
    FlatList: "Reanimated.FlatList",
    Extrapolate: {},
    interpolate: NOOP,
    interpolateColor: NOOP,
    clamp: NOOP,
    createAnimatedComponent: ID,
    addWhitelistedUIProps: NOOP,
    addWhitelistedNativeProps: NOOP,
};

class BaseAnimationMock {
    duration() { return this; }
    delay() { return this; }
    springify() { return this; }
    damping() { return this; }
    stiffness() { return this; }
    withCallback() { return this; }
    randomDelay() { return this; }
    withInitialValues() { return this; }
    easing(_: any) { return this; }
    rotate(_: any) { return this; }
    mass(_: any) { return this; }
    restDisplacementThreshold(_: any) { return this; }
    restSpeedThreshold(_: any) { return this; }
    overshootClamping(_: any) { return this; }
    dampingRatio(_: any) { return this; }
    getDelay() { return 0; }
    getDelayFunction() { return NOOP; }
    getDuration() { return 300; }
    getReduceMotion() { return 3; }
    getAnimationAndConfig() { return [NOOP, {}]; }
    build() { return () => ({ initialValues: {}, animations: {} }); }
    reduceMotion() { return this; }
}

module.exports = {
    __esModule: true,

    default: Animated,
    ...Animated,

    // hooks
    useAnimatedProps(cb: any) { return cb(); },
    useEvent: NOOP,
    useSharedValue(init: any) {
        const value = { value: init };
        return new Proxy(value, {
            get(target: any, prop: string) {
                if (prop === "value") return target.value;
                if (prop === "get") return () => target.value;
                if (prop === "set") {
                    return (next: any) => {
                        if (typeof next === "function")
                            target.value = (next as (arg: any) => any)(target.value);
                        else
                            target.value = next;
                    };
                }
            },
            set(target: any, prop: string, next: any) {
                if (prop === "value") { target.value = next; return true; }
                return false;
            },
        });
    },
    useAnimatedStyle(cb: any) { return cb(); },
    useAnimatedReaction: NOOP,
    useAnimatedRef() { return { current: null }; },
    useAnimatedScrollHandler() { return NOOP; },
    useDerivedValue(processor: any) {
        const result = processor();
        return { value: result, get: () => result };
    },
    useAnimatedSensor() {
        return {
            sensor: { value: { x: 0, y: 0, z: 0, interfaceOrientation: 0, qw: 0, qx: 0, qy: 0, qz: 0, yaw: 0, pitch: 0, roll: 0 } },
            unregister: NOOP,
            isAvailable: false,
            config: { interval: 0, adjustToInterfaceOrientation: false, iosReferenceFrame: 0 },
        };
    },
    useAnimatedKeyboard() { return { height: 0, state: 0 }; },
    useScrollViewOffset() { return { value: 0 }; },
    useScrollOffset() { return { value: 0 }; },

    // animations
    cancelAnimation: NOOP,
    withDecay(_: any, callback?: any) { callback?.(true); return 0; },
    withDelay(_ms: any, nextAnimation: any) { return nextAnimation; },
    withRepeat: ID,
    withSequence() { return 0; },
    withSpring(toValue: any, _config?: any, callback?: any) { callback?.(true); return toValue; },
    withTiming(toValue: any, _config?: any, callback?: any) { callback?.(true); return toValue; },

    // easing
    Easing: {
        linear: ID, ease: ID, quad: ID, cubic: ID, poly: ID,
        sin: ID, circle: ID, exp: ID, elastic: ID, back: ID,
        bounce: ID, bezier() { return { factory: ID }; },
        bezierFn: ID, steps: ID, in: ID, out: ID, inOut: ID,
    },

    // core
    runOnJS: ID,
    runOnUI: ID,
    createWorkletRuntime: NOOP,
    runOnRuntime: NOOP,
    makeMutable: ID,
    enableLayoutAnimations: NOOP,

    // layout animations
    BaseAnimationBuilder: new BaseAnimationMock(),
    ComplexAnimationBuilder: new BaseAnimationMock(),
    Keyframe: BaseAnimationMock,
    FadeIn: new BaseAnimationMock(),
    FadeOut: new BaseAnimationMock(),
    SlideInRight: new BaseAnimationMock(),
    SlideInLeft: new BaseAnimationMock(),
    SlideOutRight: new BaseAnimationMock(),
    SlideOutLeft: new BaseAnimationMock(),
    Layout: new BaseAnimationMock(),
    LinearTransition: new BaseAnimationMock(),
    FadingTransition: new BaseAnimationMock(),
};

import { StyleSheet, Text, View } from "react-native";

import { useEliminationPercentage } from "@/features/map/useEliminationPercentage";
import { colors } from "@/theme/colors";

import { getActiveGeometryBackend, useE2eReadoutState } from "./e2eControls";
import { E2E_HOOKS_ENABLED } from "./isE2eHooksEnabled";

/**
 * Stable, machine-parseable label Maestro asserts against. One key per text
 * node so a flow regex stays simple: `assertVisible: "e2e-readout:totalPct=..."`.
 */
export function readoutLabel(key: string, value: string | number): string {
    return `e2e-readout:${key}=${value}`;
}

/** Pin elimination % to 2 dp so flow band-regexes are deterministic. */
export function formatReadoutPct(value: number): string {
    return value.toFixed(2);
}

/**
 * Flag-gated overlay that renders derived state into accessibility text nodes
 * for Maestro. Returns `null` in production (gate off) and whenever no scenario
 * has armed the readout. The `ready=1` row appears ONLY once derivation has
 * settled (no in-flight geometry) — flows `extendedWaitUntil` on it before
 * asserting numbers, which is how we dodge the async-derivation race the C0
 * spike caught.
 *
 * The gate check lives in this outer component (which calls no hooks) so the
 * inner component's hooks stay unconditional.
 */
export function E2eDebugReadout() {
    if (!E2E_HOOKS_ENABLED) return null;
    return <E2eDebugReadoutInner />;
}

function E2eDebugReadoutInner() {
    const { active, name } = useE2eReadoutState();
    const { value, isComputing } = useEliminationPercentage();
    const backend = getActiveGeometryBackend();

    if (!active) return null;

    // "Settled" = no in-flight geometry derivation (design §4). This is what
    // `ready=1` means and what flows gate on — independent of whether there is
    // an eliminable value yet (a bare play-area scenario with no hiding-zone
    // stations settles with a null value, and that is still ready).
    const settled = !isComputing;

    return (
        <View pointerEvents="none" style={styles.overlay} testID="e2e-readout">
            <ReadoutRow label={readoutLabel("name", name ?? "")} />
            <ReadoutRow label={readoutLabel("backend", backend)} />
            {settled && value !== null ? (
                <ReadoutRow
                    label={readoutLabel("totalPct", formatReadoutPct(value))}
                />
            ) : null}
            {settled ? <ReadoutRow label={readoutLabel("ready", 1)} /> : null}
        </View>
    );
}

function ReadoutRow({ label }: { label: string }) {
    // The accessibilityLabel is the contract (iOS Text doesn't always expose
    // its child to XCUITest); the visible text is for human debugging.
    return (
        <Text accessibilityLabel={label} accessible style={styles.text}>
            {label}
        </Text>
    );
}

const styles = StyleSheet.create({
    overlay: {
        backgroundColor: colors.panel,
        borderRadius: 6,
        left: 8,
        opacity: 0.92,
        padding: 6,
        position: "absolute",
        top: 52,
        zIndex: 999,
    },
    text: {
        color: colors.ink,
        fontSize: 11,
    },
});

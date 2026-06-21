import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useHidingZoneActions } from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { useQuestionActions } from "@/state/questionStore";
import { applyE2eScenario } from "@/testing/e2e/applyE2eScenario";
import { e2eControls } from "@/testing/e2e/e2eControls";
import { E2E_HOOKS_ENABLED } from "@/testing/e2e/isE2eHooksEnabled";
import { parseE2eLink } from "@/testing/e2e/parseE2eLink";
import { colors } from "@/theme/colors";

/**
 * Test-only deep-link entry point (`jetlag-hide-seek-v2://e2e?d=...`). Seeds a
 * scenario into the app stores with no UI taps, then returns to the map.
 *
 * Hard-gated by {@link E2E_HOOKS_ENABLED}: in any build where the gate is off
 * (all production builds) this renders the same "route not found" UI as
 * `app/+not-found.tsx` and never touches the stores. The gate check is in the
 * outer component (which calls no hooks) so the inner component's hooks stay
 * unconditional.
 */
export default function E2eRoute() {
    if (!E2E_HOOKS_ENABLED) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Route not found</Text>
                <Link href="/" style={styles.link}>
                    Return to map
                </Link>
            </View>
        );
    }
    return <E2eSeedRoute />;
}

function E2eSeedRoute() {
    const { d } = useLocalSearchParams<{ d?: string | string[] }>();
    const router = useRouter();
    const { importPlayArea } = usePlayArea();
    const { replaceSetup } = useHidingZoneActions();
    const {
        addImportedQuestion,
        importQuestions,
        setAdminDivisionPack,
        setAdminDivisionPresetName,
    } = useQuestionActions();
    const [error, setError] = useState<string | null>(null);
    const seededRef = useRef(false);

    useEffect(() => {
        if (seededRef.current) return;
        seededRef.current = true;

        const parsed = parseE2eLink(d);
        if (!parsed.ok) {
            setError(`parse:${parsed.error.code}`);
            return;
        }

        const result = applyE2eScenario({
            scenario: parsed.scenario,
            stores: {
                hidingZones: { replaceSetup },
                playArea: { importPlayArea },
                questions: {
                    addImportedQuestion,
                    importQuestions,
                    importAdminDivisions: (pack, presetName) => {
                        setAdminDivisionPack(pack);
                        setAdminDivisionPresetName(presetName);
                    },
                },
            },
            controls: e2eControls,
        });

        if (!result.ok) {
            setError(result.error);
            return;
        }
        router.replace("/");
    }, [
        d,
        router,
        importPlayArea,
        replaceSetup,
        addImportedQuestion,
        importQuestions,
        setAdminDivisionPack,
        setAdminDivisionPresetName,
    ]);

    if (error) {
        const label = `e2e-error:${error}`;
        return (
            <View style={styles.container}>
                <Text style={styles.title}>E2E seed failed</Text>
                <Text accessibilityLabel={label} accessible testID="e2e-error">
                    {label}
                </Text>
            </View>
        );
    }

    // Seeding then `router.replace("/")` — nothing to show in the interim.
    return <View style={styles.container} testID="e2e-seeding" />;
}

const styles = StyleSheet.create({
    container: {
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        gap: 12,
        justifyContent: "center",
        padding: 24,
    },
    link: {
        color: colors.tint,
        fontSize: 16,
        fontWeight: "800",
    },
    title: {
        color: colors.ink,
        fontSize: 22,
        fontWeight: "800",
    },
});

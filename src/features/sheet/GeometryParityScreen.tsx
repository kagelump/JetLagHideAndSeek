/**
 * Dev-only screen that runs the GEOS parity harness, crash/perf sweep, and
 * crash fuzz on-device. Gated by `__DEV__` — not accessible in production.
 *
 * Three actions, each as a button:
 * 1. "Run Parity Harness" — JS vs GEOS buffer comparison over curated fixtures.
 * 2. "Run Crash/Perf Sweep" — GEOS-only dense grid sweep for crash/perf coverage.
 * 3. "Run Crash Fuzz" — degenerate WKB → null, 1,000 iterations each.
 */

import { useState } from "react";
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { SheetListRow } from "@/components/SheetListRow";
import { colors } from "@/theme/colors";
import type {
    ParityReport,
    SweepResult,
    FuzzResult,
    StressTestResult,
} from "@/features/questions/measuring/parityHarness";
import {
    PARITY_CASES,
    TOKYO_PLAY_AREA_BBOX,
    runParitySweep,
    runGeosSweep,
    runCrashFuzz,
    runMemoryStressTest,
} from "@/features/questions/measuring/parityHarness";

// ─── Progress state ──────────────────────────────────────────────────────

type RunState =
    | { phase: "idle" }
    | { phase: "running"; label: string; done: number; total: number }
    | {
          phase: "done";
          report: ParityReport | null;
          sweep: SweepResult | null;
          fuzz: FuzzResult | null;
          stress: StressTestResult | null;
      };

// ─── Screen ──────────────────────────────────────────────────────────────

export function GeometryParityScreen() {
    const [state, setState] = useState<RunState>({ phase: "idle" });

    const isRunning = state.phase === "running";

    // ── Parity harness (async — yields to UI between cases) ──────
    const handleRunParity = async () => {
        if (isRunning) return;
        setState({
            phase: "running",
            label: "Parity harness",
            done: 0,
            total: PARITY_CASES.length,
        });

        const report = await runParitySweep(PARITY_CASES, (done, total) => {
            setState((prev) =>
                prev.phase === "running"
                    ? { phase: "running", label: "Parity harness", done, total }
                    : prev,
            );
        });
        setState((prev) => {
            const base =
                prev.phase === "done"
                    ? prev
                    : {
                          phase: "done" as const,
                          report: null,
                          sweep: null,
                          fuzz: null,
                          stress: null,
                      };
            return { ...base, report };
        });
    };

    // ── Crash/perf sweep (async — yields every 25 cases) ─────────
    const handleRunSweep = async () => {
        if (isRunning) return;
        setState({
            phase: "running",
            label: "Crash/perf sweep",
            done: 0,
            total: 0,
        });

        const sweep = await runGeosSweep(
            TOKYO_PLAY_AREA_BBOX,
            2_000,
            [500, 2_000],
            8,
            (done, total) => {
                setState((prev) =>
                    prev.phase === "running"
                        ? {
                              phase: "running",
                              label: "Crash/perf sweep",
                              done,
                              total,
                          }
                        : prev,
                );
            },
        );
        setState((prev) => {
            const base =
                prev.phase === "done"
                    ? prev
                    : {
                          phase: "done" as const,
                          report: null,
                          sweep: null,
                          fuzz: null,
                          stress: null,
                      };
            return { ...base, sweep };
        });
    };

    // ── Crash fuzz (async) ───────────────────────────────────────
    const handleRunFuzz = async () => {
        if (isRunning) return;
        setState({
            phase: "running",
            label: "Crash fuzz",
            done: 0,
            total: 7,
        });

        const fuzz = await runCrashFuzz((done, total) => {
            setState((prev) =>
                prev.phase === "running"
                    ? { phase: "running", label: "Crash fuzz", done, total }
                    : prev,
            );
        });
        setState((prev) => {
            const base =
                prev.phase === "done"
                    ? prev
                    : {
                          phase: "done" as const,
                          report: null,
                          sweep: null,
                          fuzz: null,
                          stress: null,
                      };
            return { ...base, fuzz };
        });
    };

    // ── Memory stress test (async — yields every 10k iters) ──────
    const handleRunStress = async () => {
        if (isRunning) return;
        // 500 iters ~7.5 min on iPhone 12 — long enough for Instruments
        // to show the allocation pattern. ASan is the primary signal for
        // double-free/use-after-free (deterministic on first offense).
        const ITERATIONS = 500;
        setState({
            phase: "running",
            label: "Memory stress test",
            done: 0,
            total: ITERATIONS,
        });

        const stress = await runMemoryStressTest(
            ITERATIONS,
            2_000,
            8,
            (done) => {
                if (done % 500 === 0 || done === ITERATIONS) {
                    setState((prev) =>
                        prev.phase === "running"
                            ? {
                                  phase: "running",
                                  label: "Memory stress test",
                                  done,
                                  total: ITERATIONS,
                              }
                            : prev,
                    );
                }
            },
        );
        setState((prev) => {
            const base =
                prev.phase === "done"
                    ? prev
                    : {
                          phase: "done" as const,
                          report: null,
                          sweep: null,
                          fuzz: null,
                          stress: null,
                      };
            return { ...base, stress };
        });
    };

    return (
        <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
        >
            <Text style={styles.heading}>GEOS Parity Harness</Text>
            <Text style={styles.subtitle}>
                Dev-only tooling for native geometry validation.
            </Text>

            {/* ── Actions ──────────────────────────────────────────── */}
            <View style={styles.actions}>
                <SheetListRow
                    accessibilityLabel="Run GEOS parity harness"
                    description="Compare JS vs GEOS buffer output over curated fixtures. Reports PARITY PASS/FAIL."
                    onPress={handleRunParity}
                    title="Run Parity Harness"
                />
                <SheetListRow
                    accessibilityLabel="Run crash and performance sweep"
                    description="GEOS-only dense grid sweep for crash/perf coverage. ~450 cases."
                    onPress={handleRunSweep}
                    title="Run Crash/Perf Sweep"
                />
                <SheetListRow
                    accessibilityLabel="Run crash fuzz"
                    description="Feed degenerate WKB to the native buffer. 1k iterations × 7 cases."
                    onPress={handleRunFuzz}
                    title="Run Crash Fuzz"
                />
                <SheetListRow
                    accessibilityLabel="Run memory stress test"
                    description="50k buffer iterations over body-of-water. Use with Instruments → Allocations."
                    onPress={handleRunStress}
                    title="Run Memory Stress Test"
                />
            </View>

            {/* ── Progress ─────────────────────────────────────────── */}
            {state.phase === "running" ? (
                <View style={styles.progressSection}>
                    <ActivityIndicator color={colors.tint} size="small" />
                    <Text style={styles.progressText}>
                        {state.label}: {state.done}
                        {state.total > 0 ? ` / ${state.total}` : ""}
                    </Text>
                </View>
            ) : null}

            {/* ── Results ──────────────────────────────────────────── */}
            {state.phase === "done" ? (
                <View style={styles.results}>
                    {state.report ? (
                        <ParityReportCard report={state.report} />
                    ) : null}
                    {state.sweep ? (
                        <SweepResultCard sweep={state.sweep} />
                    ) : null}
                    {state.fuzz ? <FuzzResultCard fuzz={state.fuzz} /> : null}
                    {state.stress ? (
                        <StressResultCard stress={state.stress} />
                    ) : null}
                </View>
            ) : null}
        </ScrollView>
    );
}

// ─── Result cards ────────────────────────────────────────────────────────

function ParityReportCard({ report }: { report: ParityReport }) {
    return (
        <View style={styles.card}>
            <Text
                style={[
                    styles.passFail,
                    report.passed ? styles.pass : styles.fail,
                ]}
                accessibilityLabel={
                    report.passed ? "PARITY PASS" : "PARITY FAIL"
                }
            >
                {report.passed ? "PARITY PASS" : "PARITY FAIL"}
            </Text>
            <Text style={styles.metric}>
                Cases: {report.results.length} | JS oracle:{" "}
                {(report.jsOracleTotalMs / 1000).toFixed(1)}s
            </Text>
            <Text style={styles.metric}>
                Max symDiff ratio: {report.maxSymDiffRatio.toFixed(5)} | Max
                bbox Δ: {report.maxBboxDeltaM.toFixed(1)}m
            </Text>
            {report.failures.length > 0 ? (
                <View style={styles.failureList}>
                    <Text style={styles.failureHeading}>
                        Failures ({report.failures.length}):
                    </Text>
                    {report.failures.map((r, i) => (
                        <Text key={i} style={styles.failureItem}>
                            {r.kase.label}:{" "}
                            {!r.jsGeom
                                ? "JS null"
                                : !r.geosGeom
                                  ? "GEOS null"
                                  : `symDiff=${(r.symDiffRatio! * 100).toFixed(2)}% bboxΔ=${r.bboxDeltaM!.toFixed(1)}m`}
                        </Text>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

function SweepResultCard({ sweep }: { sweep: SweepResult }) {
    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Crash/Perf Sweep</Text>
            <Text style={styles.metric}>
                {sweep.total} cases: {sweep.buffered} buffered, {sweep.nulls}{" "}
                nulls in {(sweep.totalMs / 1000).toFixed(1)}s
            </Text>
            <Text style={styles.metric}>
                Max single-case: {sweep.maxMs.toFixed(0)}ms
            </Text>
            {Object.keys(sweep.nullsByCategory).length > 0 ? (
                <View style={styles.failureList}>
                    <Text style={styles.failureHeading}>
                        Nulls by category:
                    </Text>
                    {Object.entries(sweep.nullsByCategory).map(
                        ([cat, count]) => (
                            <Text key={cat} style={styles.failureItem}>
                                {cat}: {count}
                            </Text>
                        ),
                    )}
                </View>
            ) : null}
        </View>
    );
}

function FuzzResultCard({ fuzz }: { fuzz: FuzzResult }) {
    return (
        <View style={styles.card}>
            <Text
                style={[
                    styles.passFail,
                    fuzz.passed ? styles.pass : styles.fail,
                ]}
                accessibilityLabel={
                    fuzz.passed ? "CRASH FUZZ PASS" : "CRASH FUZZ FAIL"
                }
            >
                {fuzz.passed ? "CRASH FUZZ PASS" : "CRASH FUZZ FAIL"}
            </Text>
            <Text style={styles.cardTitle}>Must return null</Text>
            {fuzz.nullCases.map((r, i) => (
                <Text key={i} style={styles.metric}>
                    {r.label}: {r.allNull ? "all null ✓" : "NON-NULL ✗"} (
                    {r.iterations} iters)
                </Text>
            ))}
            <Text style={[styles.cardTitle, { marginTop: 8 }]}>
                Must not crash
            </Text>
            {fuzz.surviveCases.map((r, i) => (
                <Text key={i} style={styles.metric}>
                    {r.label}: {r.survived ? "survived ✓" : "CRASHED ✗"} (
                    {r.iterations} iters)
                </Text>
            ))}
        </View>
    );
}

function StressResultCard({ stress }: { stress: StressTestResult }) {
    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Memory Stress Test</Text>
            <Text style={styles.metric}>
                {stress.iterations.toLocaleString()} iterations in{" "}
                {(stress.totalMs / 1000).toFixed(1)}s
            </Text>
            <Text style={styles.metric}>
                All buffered: {stress.allBuffered ? "yes ✓" : "NO ✗"}
            </Text>
            <Text style={styles.hint}>
                Check Instruments → Allocations: live GEOS allocation count
                should return to baseline after the batch.
            </Text>
        </View>
    );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    actions: {
        gap: 6,
        marginTop: 16,
    },
    card: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 12,
        padding: 14,
    },
    cardTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "700",
        marginBottom: 6,
    },
    container: {
        padding: 20,
        paddingBottom: 60,
    },
    fail: {
        color: colors.errorDark,
    },
    failureHeading: {
        color: colors.ink,
        fontSize: 13,
        fontWeight: "700",
        marginTop: 8,
    },
    failureItem: {
        color: colors.muted,
        fontSize: 12,
        lineHeight: 17,
        marginLeft: 8,
    },
    failureList: {
        marginTop: 6,
    },
    heading: {
        color: colors.ink,
        fontSize: 22,
        fontWeight: "800",
    },
    hint: {
        color: colors.muted,
        fontSize: 12,
        fontStyle: "italic",
        lineHeight: 17,
        marginTop: 6,
    },
    metric: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
    },
    pass: {
        color: colors.success,
    },
    passFail: {
        fontSize: 20,
        fontWeight: "800",
        marginBottom: 6,
    },
    progressSection: {
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
        justifyContent: "center",
        marginTop: 24,
    },
    progressText: {
        color: colors.muted,
        fontSize: 14,
    },
    results: {
        marginTop: 16,
    },
    subtitle: {
        color: colors.muted,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 4,
    },
});

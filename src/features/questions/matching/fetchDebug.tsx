import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useMemo,
    useState,
} from "react";
import { StyleSheet, Text } from "react-native";

import { colors } from "@/theme/colors";
import { createLogger } from "@/shared/logger";

const log = createLogger("fetchDebug");

// ─── Types ────────────────────────────────────────────────────────────────

export type FetchOrigin =
    | "overpass"
    | "local-bundle"
    | "admin-boundary"
    | "memory"
    | "disk";

export type FetchDebugInfo = {
    /** Total number of candidate features returned to the UI. */
    totalCount: number;
    /** Per-origin item counts (before dedup, so may sum to > totalCount). */
    origins: Partial<Record<FetchOrigin, number>>;
    /** Wall-clock duration of the resolve in milliseconds. */
    durationMs: number;
    /** Present iff at least one Overpass round-trip happened. */
    networkMs?: number;
    status: "loading" | "done" | "error";
    /** Epoch-ms at which the fetch completed (or errored). */
    at: number;
};

// ─── Formatting ────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
    if (ms < 1_000) return `${ms}ms`;
    return `${(ms / 1_000).toFixed(1)}s`;
}

/**
 * Formats a FetchDebugInfo record into the one-line footer string shown at
 * the bottom of the question sheet. Returns an empty string when there's
 * nothing to report.
 */
export function formatFetchDebug(info: FetchDebugInfo): string {
    if (info.status === "loading") return "searching…";
    if (info.status === "error") return "";

    const { totalCount, origins, durationMs, networkMs } = info;
    if (totalCount === 0) return "";

    const fromCache = (origins.memory ?? 0) + (origins.disk ?? 0);
    const fromBundle = origins["local-bundle"] ?? 0;
    const fromOverpass = origins.overpass ?? 0;

    // Cache-only: no fetch happened.
    if (fromCache > 0 && fromBundle === 0 && fromOverpass === 0) {
        return `${totalCount} items from cache`;
    }

    // Bundle-only: everything came from a bundled region and nothing from
    // Overpass or cache.
    if (fromBundle > 0 && fromOverpass === 0 && fromCache === 0) {
        return `fetched ${totalCount} items from local bundle`;
    }

    // Overpass-only: no cache, no bundle.
    if (fromOverpass > 0 && fromBundle === 0 && fromCache === 0) {
        const timing =
            networkMs !== undefined ? ` (${formatDuration(networkMs)})` : "";
        return `fetched ${totalCount} items from overpass${timing}`;
    }

    // Mixed: show a per-origin breakdown. In __DEV__ show full breakdown;
    // in production show only the dominant source.
    const parts: string[] = [];
    if (fromBundle > 0) parts.push(`${fromBundle} from bundle`);
    if (fromOverpass > 0) {
        const timing =
            networkMs !== undefined ? ` (${formatDuration(networkMs)})` : "";
        parts.push(`${fromOverpass} from overpass${timing}`);
    }
    if (fromCache > 0) parts.push(`${fromCache} from cache`);

    if (parts.length === 0) return "";

    if (__DEV__) {
        return `${parts.join(" · ")} (${totalCount} total, ${formatDuration(durationMs)})`;
    }

    // Production: show the dominant source only.
    const dominant =
        fromOverpass > 0
            ? `fetched ${totalCount} items from overpass${networkMs !== undefined ? ` (${formatDuration(networkMs)})` : ""}`
            : fromBundle > 0
              ? `fetched ${totalCount} items from local bundle`
              : `${totalCount} items from cache`;
    return dominant;
}

// ─── Context ───────────────────────────────────────────────────────────────

type FetchDebugContextValue = {
    info: FetchDebugInfo | null;
    report: (info: FetchDebugInfo) => void;
    clear: () => void;
};

const FetchDebugContext = createContext<FetchDebugContextValue | null>(null);

/**
 * Wraps a question-detail sub-tree so that fetch-debug events recorded by
 * child screens are scoped to the active question. Must be placed above
 * `<QuestionFetchDebugLine />`.
 */
export function FetchDebugScope({ children }: { children: ReactNode }) {
    const [info, setInfo] = useState<FetchDebugInfo | null>(null);

    const report = useCallback((next: FetchDebugInfo) => {
        setInfo(next);
    }, []);

    const clear = useCallback(() => {
        setInfo(null);
    }, []);

    const value = useMemo<FetchDebugContextValue>(
        () => ({ info, report, clear }),
        [info, report, clear],
    );

    return (
        <FetchDebugContext.Provider value={value}>
            {children}
        </FetchDebugContext.Provider>
    );
}

/**
 * Returns the latest fetch-debug info for the current question, or null when
 * no fetch has been recorded (e.g. radar questions).
 */
export function useFetchDebug(): FetchDebugInfo | null {
    const ctx = useContext(FetchDebugContext);
    if (!ctx) {
        if (__DEV__) {
            throw new Error(
                "useFetchDebug must be used within a <FetchDebugScope>.",
            );
        }
        return null;
    }
    return ctx.info;
}

/**
 * Returns a reporter that screens (or the shared search hook) call to record
 * fetch-debug events. Safe to call outside a FetchDebugScope — it becomes a
 * no-op, so raw-fetcher bypass attempts are benign in production.
 */
export function useReportFetchDebug(): (info: FetchDebugInfo) => void {
    const ctx = useContext(FetchDebugContext);
    if (!ctx) {
        if (__DEV__) {
            log.warn(
                "useReportFetchDebug called outside a <FetchDebugScope>. " +
                    "Wrap the question sheet in <FetchDebugScope> so the fetch-debug " +
                    "footer renders.",
            );
        }
        // No-op outside a scope, but the DEV warning above makes the omission
        // impossible to miss during development.
        return () => {};
    }
    return ctx.report;
}

// ─── Footer component ─────────────────────────────────────────────────────

/**
 * Renders the fetch-debug line at the bottom of a question sheet. Reads from
 * the nearest `<FetchDebugScope>`. When no fetch has been recorded (radar
 * questions, transit-line), renders null.
 *
 * Always visible in `__DEV__`. In production the line is gated behind a
 * developer-mode flag — see §3.5 of the design doc.
 */
export function QuestionFetchDebugLine() {
    const info = useFetchDebug();

    if (!info) return null;

    const text = formatFetchDebug(info);
    if (!text) return null;

    return (
        <Text style={styles.debugLine} testID="fetch-debug-line">
            {text}
        </Text>
    );
}

const styles = StyleSheet.create({
    debugLine: {
        color: colors.muted,
        fontSize: 11,
        lineHeight: 15,
        marginTop: 12,
        textAlign: "center",
    },
});

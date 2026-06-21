/**
 * Tiny namespaced logging primitive.
 *
 * ## Why this exists
 *
 * Every `console.*` in React Native is a **synchronous bridge call**. Firing
 * them unconditionally inside geometry/mask/search hot loops both spams the
 * production console and corrupts the millisecond-scale performance
 * measurements this project depends on (measuring-perf / distance-field work).
 * Before this module, gating was done by hand per file (`if (__DEV__) {…}`),
 * which silently decayed as new files were added. An eslint `no-console` rule
 * now bans raw `console` everywhere except this file.
 *
 * ## How to use it
 *
 * ```ts
 * import { createLogger } from "@/shared/logger";
 * const log = createLogger("myFeature");
 * log.debug("computed", n, "candidates"); // dev-only, off in production
 * log.warn("falling back to JS path");     // always emitted
 * ```
 *
 * - `debug` / `info` are **dev-only** — they never reach a production build, so
 *   hot-path diagnostics are free to leave in place.
 * - `warn` / `error` always pass through — they signal real problems.
 *
 * ## Turning namespaces up or down
 *
 * Per-namespace verbosity is controlled by {@link LOGGING_CONFIG} in
 * `src/config/logging.ts` (edit that file to demote/silence a namespace once
 * you're done debugging it) or, at runtime, by {@link setLoggerNamespaceLevel}.
 * See `src/config/logging.ts` for the level semantics and the production floor.
 */

import { LOGGING_CONFIG, type LogLevel } from "@/config/logging";

export interface Logger {
    /** Verbose hot-path diagnostics. Dev-only. */
    debug(...args: unknown[]): void;
    /** Notable-but-normal events. Dev-only. */
    info(...args: unknown[]): void;
    /** Recoverable problems. Always emitted (unless the namespace is `silent`). */
    warn(...args: unknown[]): void;
    /** Errors. Always emitted (unless the namespace is `silent`). */
    error(...args: unknown[]): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 100,
};

/**
 * Runtime per-namespace level overrides. Take precedence over
 * {@link LOGGING_CONFIG}. Useful for a dev menu that mutes/unmutes a subsystem
 * without editing the config file.
 */
const runtimeOverrides = new Map<string, LogLevel>();

/**
 * Override (or clear) a namespace's level at runtime. Pass `undefined` to fall
 * back to {@link LOGGING_CONFIG}. Does not bypass the production floor — `debug`
 * / `info` still never emit outside `__DEV__`.
 */
export function setLoggerNamespaceLevel(
    namespace: string,
    level: LogLevel | undefined,
): void {
    if (level === undefined) {
        runtimeOverrides.delete(namespace);
    } else {
        runtimeOverrides.set(namespace, level);
    }
}

/** The minimum level a namespace will emit, after config + production floor. */
function thresholdRank(namespace: string): number {
    const configured =
        runtimeOverrides.get(namespace) ??
        LOGGING_CONFIG.namespaces[namespace] ??
        LOGGING_CONFIG.default;
    let rank = LEVEL_RANK[configured];
    // Production safety floor: never emit debug/info in a release build, no
    // matter what the config says. Config can only make things quieter in dev.
    if (!__DEV__ && rank < LEVEL_RANK.warn) rank = LEVEL_RANK.warn;
    return rank;
}

function shouldEmit(namespace: string, level: LogLevel): boolean {
    return LEVEL_RANK[level] >= thresholdRank(namespace);
}

export function createLogger(namespace: string): Logger {
    const tag = `[${namespace}]`;
    // Fold the tag into the leading string arg so a message reads
    // `[ns] message` as a single string (matching the pre-logger inline-prefix
    // convention and keeping string assertions/grep intact). Non-string leading
    // args (objects, errors) get the tag as a separate first argument.
    const tagged = (args: unknown[]): unknown[] =>
        typeof args[0] === "string"
            ? [`${tag} ${args[0]}`, ...args.slice(1)]
            : [tag, ...args];
    return {
        debug(...args: unknown[]): void {
            if (shouldEmit(namespace, "debug")) console.log(...tagged(args));
        },
        info(...args: unknown[]): void {
            if (shouldEmit(namespace, "info")) console.info(...tagged(args));
        },
        warn(...args: unknown[]): void {
            if (shouldEmit(namespace, "warn")) console.warn(...tagged(args));
        },
        error(...args: unknown[]): void {
            if (shouldEmit(namespace, "error")) console.error(...tagged(args));
        },
    };
}

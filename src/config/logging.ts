/**
 * Logging configuration — the one place to turn namespaces up or down.
 *
 * Every `createLogger("<namespace>")` call (see `src/shared/logger.ts`) consults
 * this file. To stop seeing a namespace's chatter once you're done debugging it,
 * **demote it here** — no code changes at the call sites:
 *
 * ```ts
 * export const LOGGING_CONFIG: LoggingConfig = {
 *     default: "debug",
 *     namespaces: {
 *         lineBuffer: "silent", // mute the body-of-water buffer logs entirely
 *         search: "warn",       // only warnings/errors from matching search
 *     },
 * };
 * ```
 *
 * Levels are ordered `debug < info < warn < error < silent`. A namespace emits a
 * message only if the message's level is **at or above** the namespace's
 * configured level. `silent` mutes everything (including `error`) for that
 * namespace.
 *
 * Two things are independent of this file:
 * - **Production safety floor:** `debug`/`info` never emit in a non-`__DEV__`
 *   build regardless of config — verbose logs cannot ship. Config only ever
 *   makes a namespace *quieter* in dev, or controls whether `warn`/`error` show.
 * - **Runtime overrides:** `setLoggerNamespaceLevel(ns, level)` overrides this
 *   file at runtime (e.g. from a dev menu) without editing it.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LoggingConfig {
    /** Level applied to any namespace not listed in `namespaces`. */
    default: LogLevel;
    /** Per-namespace level overrides. Add an entry to demote/silence a namespace. */
    namespaces: Record<string, LogLevel>;
}

export const LOGGING_CONFIG: LoggingConfig = {
    default: "debug",
    namespaces: {
        // Add `<namespace>: "silent" | "warn" | ...` to quiet a namespace.
        // Known namespaces today: lineBuffer, lineDistance, lineBundle, prog,
        // search, osmMatchingCache, useStationElimination,
        // useDeferredComputation, js, geometryBackend, geos, regionPacks.
    },
};

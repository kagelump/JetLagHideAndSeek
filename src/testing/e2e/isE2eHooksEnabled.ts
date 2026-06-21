/**
 * Master gate for every deep-link E2E test hook (the test-only `/e2e` route,
 * scenario seeding, the debug readout, and the geometry-backend override).
 *
 * Two layers, so the hooks are impossible to trigger in a shipped app:
 *
 *  - `__DEV__` is `false` in any release build ⇒ the hooks are gone in
 *    production regardless of the env var.
 *  - `EXPO_PUBLIC_E2E_HOOKS` is inlined by Metro at bundle time (the
 *    `EXPO_PUBLIC_` prefix is required for client exposure) and is unset in
 *    normal dev, so a developer running the app locally never accidentally
 *    enables it. Only an actual E2E run (CI or the local stack) sets it to
 *    `"1"`.
 *
 * This module is the **single reader** of `EXPO_PUBLIC_E2E_HOOKS`. Every other
 * module must import `E2E_HOOKS_ENABLED` instead of re-reading the env var, so
 * the gate can never drift.
 */
export const E2E_HOOKS_ENABLED =
    __DEV__ && process.env.EXPO_PUBLIC_E2E_HOOKS === "1";

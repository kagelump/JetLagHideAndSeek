/**
 * Debounce interval (ms) for persisting app state to AsyncStorage.
 *
 * Set to 500ms in production to batch rapid state changes into a single write.
 * Tests set this to 0 so persistence flushes synchronously — no waiting needed.
 */
export let persistDebounceMs = 500;

/** @internal — test-only override. Do not use in application code. */
export function _setPersistDebounceMsForTest(ms: number): void {
    persistDebounceMs = ms;
}

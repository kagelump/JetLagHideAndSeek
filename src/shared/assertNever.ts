/**
 * Exhaustiveness check helper.
 *
 * Call in a `default` branch of a `switch` (or similar) so that adding a new
 * variant to the union without a corresponding case produces a compile-time
 * error instead of a silent fallthrough.
 */
export function assertNever(value: never): never {
    throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

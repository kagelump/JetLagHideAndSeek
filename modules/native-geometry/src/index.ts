import { requireNativeModule } from "expo-modules-core";

const Native = requireNativeModule("NativeGeometry");

/**
 * Expected native ABI version. Bump whenever the WKB function surface changes
 * (e.g., new overlay ops). `getGeometryBackend()` warns when the native binary
 * reports a lower version — the GEOS backend stays selected for whatever ops
 * exist, but the mismatch tells the developer to rebuild the dev client.
 *
 * History:
 *   1 — G2 initial release (bufferWKB, geosVersion)
 *   2 — G5 overlay ops (differenceWKB, unionWKB, intersectionWKB, unaryUnionWKB)
 */
export const EXPECTED_NATIVE_ABI = 2;

/**
 * True when the native module is linked and exposes bufferWKB (the core
 * capability — line-buffer hot path). Overlay op availability is checked
 * per-op in the GEOS backend so a stale binary never disables buffer.
 */
export function isAvailable(): boolean {
    try {
        return typeof Native?.bufferWKB === "function";
    } catch {
        return false;
    }
}

/** GEOS library version string (e.g. "3.14.1"). */
export function geosVersion(): string {
    return Native.geosVersion();
}

/** Native ABI version reported by the binary, or 0 if unavailable. */
export function nativeAbiVersion(): number {
    try {
        const v = Native.nativeAbiVersion?.();
        return typeof v === "number" ? v : 0;
    } catch {
        return 0;
    }
}

/**
 * Buffer a WKB geometry by `distance` (in input units) with
 * `quadrantSegments` arc fidelity. Returns the buffered WKB or null
 * on failure.
 */
export function bufferWKB(
    wkb: Uint8Array,
    distance: number,
    quadrantSegments: number,
): Uint8Array | null {
    const out = Native.bufferWKB(wkb, distance, quadrantSegments);
    if (out === null || out === undefined) return null;
    // expo-modules-core maps native Data/ByteArray to JS Uint8Array.
    // Guard so we neither re-copy a Uint8Array nor mis-handle an ArrayBuffer.
    return out instanceof Uint8Array ? out : new Uint8Array(out);
}

// ─── Overlay ops (G5) ─────────────────────────────────────────────────────

function _wrapWkbResult(out: unknown): Uint8Array | null {
    if (out === null || out === undefined) return null;
    return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/**
 * Topological difference `a - b`. Both inputs are raw WGS84 WKB.
 * Returns the result WKB or null on empty result / failure.
 */
export function differenceWKB(a: Uint8Array, b: Uint8Array): Uint8Array | null {
    // Guard against partial native ABI (stale binary with bufferWKB but
    // not the overlay functions).
    if (typeof Native.differenceWKB !== "function") return null;
    return _wrapWkbResult(Native.differenceWKB(a, b));
}

/**
 * Topological union `a ∪ b`. Both inputs are raw WGS84 WKB.
 * Returns the result WKB or null on empty result / failure.
 */
export function unionWKB(a: Uint8Array, b: Uint8Array): Uint8Array | null {
    if (typeof Native.unionWKB !== "function") return null;
    return _wrapWkbResult(Native.unionWKB(a, b));
}

/**
 * Topological intersection `a ∩ b`. Both inputs are raw WGS84 WKB.
 * Returns the result WKB or null on empty result / failure.
 */
export function intersectionWKB(
    a: Uint8Array,
    b: Uint8Array,
): Uint8Array | null {
    if (typeof Native.intersectionWKB !== "function") return null;
    return _wrapWkbResult(Native.intersectionWKB(a, b));
}

/**
 * Unary union (self-dissolve) of a single geometry. Input is raw WGS84 WKB.
 * Returns the dissolved result WKB or null on empty result / failure.
 */
export function unaryUnionWKB(wkb: Uint8Array): Uint8Array | null {
    if (typeof Native.unaryUnionWKB !== "function") return null;
    return _wrapWkbResult(Native.unaryUnionWKB(wkb));
}

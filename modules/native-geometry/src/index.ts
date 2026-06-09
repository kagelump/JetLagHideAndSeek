import { requireNativeModule } from "expo-modules-core";

const Native = requireNativeModule("NativeGeometry");

/**
 * True when the native module is linked and exposes bufferWKB.
 * Probed by the G0 geometry-backend seam to decide whether to use GEOS.
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

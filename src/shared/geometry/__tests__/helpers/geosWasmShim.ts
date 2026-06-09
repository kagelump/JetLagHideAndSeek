/**
 * Test-only shim that exposes the real GEOS buffer engine to Jest via
 * {@link https://www.npmjs.com/package/geos-wasm | geos-wasm} (GEOS compiled
 * to WebAssembly).
 *
 * The native Expo module can't run in Jest, but GEOS itself is platform-
 * agnostic C — geos-wasm runs it in pure Node. This shim implements the **same
 * `bufferWKB(wkb, distance, quadrantSegments) -> wkb` contract** as the native
 * `modules/native-geometry` module, so it can be dropped in as the mock for
 * `native-geometry` and drive the real `geosGeometryBackend` pipeline
 * (project → encodeWkb → GEOS → decodeWkb → unproject) against the turf oracle.
 *
 * Notes:
 * - geos-wasm ships **ESM-only** and its loader uses `import.meta.url`, which is
 *   invalid in the CJS modules Jest produces. We load it through a runtime
 *   dynamic `import()` hidden behind `new Function` so babel/jest can't rewrite
 *   it to `require()` — Node's native ESM loader then handles `import.meta`.
 * - The bundled GEOS is 3.13.x (geos-wasm's release), not the app's vendored
 *   3.14.1. That's fine: parity is gated on **tolerance** (area ratio), not
 *   exact bytes, and buffer/arc generation is stable across GEOS 3.x.
 * - Buffer params mirror the native module exactly: round cap, round join,
 *   caller-supplied quadrant segments (also the JSTS/turf defaults).
 */

// geos-wasm has no bundled types we depend on; treat the instance as dynamic.

let geos: any = null;
let initPromise: Promise<void> | null = null;

const GEOSBUF_CAP_ROUND = 1;
const GEOSBUF_JOIN_ROUND = 1;

/**
 * Load + initialize geos-wasm once. Call from `beforeAll`. Idempotent and
 * safe to call concurrently.
 */
export function initGeosWasm(): Promise<void> {
    if (geos) return Promise.resolve();
    if (initPromise) return initPromise;

    initPromise = (async () => {
        // Hidden dynamic import: keeps it a true ESM import at runtime so
        // geos-wasm's `import.meta.url` resolves under Node (see file header).
        const dynamicImport = new Function(
            "specifier",
            "return import(specifier)",
        ) as (specifier: string) => Promise<any>;

        const mod = await dynamicImport("geos-wasm");
        const initGeosJs = mod.default ?? mod;
        geos = await initGeosJs();
    })();

    return initPromise;
}

/**
 * GEOS version string of the wasm build (e.g. "3.13.0-CAPI-1.19.0"), or
 * "unknown" if the string-returning C call doesn't marshal under the test
 * environment. Best-effort — used only for diagnostic logging, never on the
 * buffer path (which goes through WKB/heap, not cwrap string returns).
 */
export function geosWasmVersion(): string {
    if (!geos)
        throw new Error("geos-wasm not initialized — call initGeosWasm()");
    try {
        return geos.GEOSversion() || "unknown";
    } catch {
        return "unknown";
    }
}

/**
 * Buffer a little-endian WKB geometry by `distance` (input units) with
 * `quadrantSegments` arc fidelity, returning WKB or `null` on failure.
 *
 * Synchronous, mirroring the native module's signature so it can replace the
 * mocked `native-geometry.bufferWKB`. Requires {@link initGeosWasm} first.
 */
export function bufferWKB(
    wkb: Uint8Array,
    distance: number,
    quadrantSegments: number,
): Uint8Array | null {
    if (!geos) {
        throw new Error(
            "geos-wasm not initialized — await initGeosWasm() in beforeAll",
        );
    }
    const M = geos.Module;

    // --- WKB → GEOS geometry (copy bytes into the wasm heap) ---
    const inPtr = M._malloc(wkb.length);
    M.HEAPU8.set(wkb, inPtr);
    const geom = geos.GEOSGeomFromWKB_buf(inPtr, wkb.length);
    M._free(inPtr);
    if (!geom) return null;

    // --- Buffer with native-matching params (round cap/join, qs) ---
    const params = geos.GEOSBufferParams_create();
    geos.GEOSBufferParams_setQuadrantSegments(params, quadrantSegments);
    geos.GEOSBufferParams_setEndCapStyle(params, GEOSBUF_CAP_ROUND);
    geos.GEOSBufferParams_setJoinStyle(params, GEOSBUF_JOIN_ROUND);
    const buffered = geos.GEOSBufferWithParams(geom, params, distance);
    geos.GEOSBufferParams_destroy(params);
    geos.GEOSGeom_destroy(geom);
    if (!buffered) return null;

    // --- GEOS geometry → WKB (read bytes back off the heap) ---
    const sizePtr = M._malloc(4); // size_t is 32-bit on wasm32
    const outPtr = geos.GEOSGeomToWKB_buf(buffered, sizePtr);
    const outSize = outPtr ? M.HEAPU32[sizePtr >> 2] : 0;
    let out: Uint8Array | null = null;
    if (outPtr && outSize > 0) {
        // Copy out of the heap before freeing (the heap can move/realloc).
        out = new Uint8Array(M.HEAPU8.subarray(outPtr, outPtr + outSize));
        geos.GEOSFree(outPtr);
    }
    M._free(sizePtr);
    geos.GEOSGeom_destroy(buffered);

    return out;
}

/**
 * Unary union a little-endian WKB geometry (raw WGS84), returning WKB or
 * `null` on failure. Synchronous, mirroring the native module's signature.
 *
 * Requires {@link initGeosWasm} first.
 */
export function unaryUnionWKB(wkb: Uint8Array): Uint8Array | null {
    if (!geos) {
        throw new Error(
            "geos-wasm not initialized — await initGeosWasm() in beforeAll",
        );
    }
    const M = geos.Module;

    // --- Parse WKB → GEOS geometry ---
    const inPtr = M._malloc(wkb.length);
    M.HEAPU8.set(wkb, inPtr);
    const geom = geos.GEOSGeomFromWKB_buf(inPtr, wkb.length);
    M._free(inPtr);
    if (!geom) return null;

    // --- Unary union ---
    const unioned = geos.GEOSUnaryUnion(geom);
    geos.GEOSGeom_destroy(geom);
    if (!unioned) return null;

    // --- GEOS geometry → WKB ---
    const sizePtr = M._malloc(4);
    const outPtr = geos.GEOSGeomToWKB_buf(unioned, sizePtr);
    const outSize = outPtr ? M.HEAPU32[sizePtr >> 2] : 0;
    let out: Uint8Array | null = null;
    if (outPtr && outSize > 0) {
        out = new Uint8Array(M.HEAPU8.subarray(outPtr, outPtr + outSize));
        geos.GEOSFree(outPtr);
    }
    M._free(sizePtr);
    geos.GEOSGeom_destroy(unioned);

    return out;
}

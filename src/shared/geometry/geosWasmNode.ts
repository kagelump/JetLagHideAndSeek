/**
 * Node/GEOS-wasm helper shared by the pipeline and the Jest GEOS shim.
 *
 * Wraps {@link https://www.npmjs.com/package/geos-wasm | geos-wasm} and the
 * WKB codec in `wkb.ts` so build-time geometry ops (unary union, buffer,
 * boolean set ops) can run in Node with the same C++ GEOS engine the native
 * module uses at runtime.
 *
 * This module is consumed directly by the packs pipeline (via tsx) and
 * re-exported by `src/shared/geometry/__tests__/helpers/geosWasmShim.ts` for
 * the GEOS test suites, which run Jest with `--experimental-vm-modules`.
 */

interface GeosModule {
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
}

interface GeosInstance {
    Module: GeosModule;
    GEOSGeomFromWKB_buf(ptr: number, size: number): number;
    GEOSGeomToWKB_buf(geom: number, sizePtr: number): number;
    GEOSFree(ptr: number): void;
    GEOSGeom_destroy(geom: number): void;
    GEOSUnaryUnion(geom: number): number;
    GEOSBufferParams_create(): number;
    GEOSBufferParams_setQuadrantSegments(params: number, qs: number): void;
    GEOSBufferParams_setEndCapStyle(params: number, style: number): void;
    GEOSBufferParams_setJoinStyle(params: number, style: number): void;
    GEOSBufferWithParams(
        geom: number,
        params: number,
        distance: number,
    ): number;
    GEOSBufferParams_destroy(params: number): void;
    GEOSversion(): string;
    GEOSDifference(a: number, b: number): number;
    GEOSUnion(a: number, b: number): number;
    GEOSIntersection(a: number, b: number): number;
    /** 1 = valid, 0 = invalid, 2 = exception. */
    GEOSisValid(geom: number): number;
    GEOSMakeValid(geom: number): number;
}

let geosInstance: GeosInstance | null = null;
let initPromise: Promise<void> | null = null;

const GEOSBUF_CAP_ROUND = 1;
const GEOSBUF_JOIN_ROUND = 1;

function ensureGeos(): void {
    if (!geosInstance) {
        throw new Error(
            "geos-wasm not initialized — await initGeosWasm() before calling GEOS helpers",
        );
    }
}

function getModule(): GeosModule {
    ensureGeos();
    return geosInstance!.Module;
}

/** Parse a little-endian WKB buffer into a GEOS geometry pointer. */
function wkbToGeom(wkb: Uint8Array): number | null {
    const M = getModule();
    const inPtr = M._malloc(wkb.length);
    M.HEAPU8.set(wkb, inPtr);
    const geom = geosInstance!.GEOSGeomFromWKB_buf(inPtr, wkb.length);
    M._free(inPtr);
    return geom || null;
}

/**
 * Parse WKB and, if the geometry is invalid, recover it with MakeValid —
 * matching the native iOS/Android op core (`geos_ops.cpp`). Keeping this in
 * lockstep is what makes the wasm path a faithful oracle: golden fixtures
 * generated here must reflect the same validity policy the app runs at
 * runtime. Returns the (possibly recovered) geometry, or `null` on parse /
 * recovery failure. Takes ownership of the parsed handle.
 */
function parseAndValidate(wkb: Uint8Array): number | null {
    const geom = wkbToGeom(wkb);
    if (!geom) return null;

    if (geosInstance!.GEOSisValid(geom) !== 1) {
        const fixed = geosInstance!.GEOSMakeValid(geom);
        geosInstance!.GEOSGeom_destroy(geom);
        return fixed || null;
    }
    return geom;
}

/** Serialize a GEOS geometry pointer into a little-endian WKB buffer. */
function geomToWKB(geom: number): Uint8Array | null {
    const M = getModule();
    const sizePtr = M._malloc(4);
    const outPtr = geosInstance!.GEOSGeomToWKB_buf(geom, sizePtr);
    const outSize = outPtr ? M.HEAPU32[sizePtr >> 2] : 0;
    let out: Uint8Array | null = null;
    if (outPtr && outSize > 0) {
        // Copy out of the heap before freeing (the heap can move/realloc).
        out = new Uint8Array(M.HEAPU8.subarray(outPtr, outPtr + outSize));
        geosInstance!.GEOSFree(outPtr);
    }
    M._free(sizePtr);
    return out;
}

/**
 * Load + initialize geos-wasm once. Call before any GEOS helper.
 * Idempotent and safe to call concurrently.
 *
 * Uses a runtime dynamic import hidden behind `new Function` so that Jest's
 * CJS transform cannot rewrite it to `require()`. geos-wasm is ESM-only and
 * relies on `import.meta.url`, which is invalid in CJS.
 */
export function initGeosWasm(): Promise<void> {
    if (geosInstance) return Promise.resolve();
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const dynamicImport = new Function(
            "specifier",
            "return import(specifier)",
        ) as (specifier: string) => Promise<{
            default: (config?: unknown) => Promise<GeosInstance>;
        }>;

        const mod = await dynamicImport("geos-wasm");
        const initGeosJs = mod.default ?? mod;
        geosInstance = await initGeosJs();
    })();

    return initPromise;
}

/**
 * GEOS version string of the wasm build (e.g. "3.13.0-CAPI-1.19.0"), or
 * "unknown" if the version call fails to marshal.
 */
export function geosWasmVersion(): string {
    ensureGeos();
    try {
        return geosInstance!.GEOSversion() || "unknown";
    } catch {
        return "unknown";
    }
}

/**
 * Buffer a little-endian WKB geometry by `distance` (input units) with
 * `quadrantSegments` arc fidelity, returning WKB or `null` on failure.
 */
export function bufferWKB(
    wkb: Uint8Array,
    distance: number,
    quadrantSegments: number,
): Uint8Array | null {
    ensureGeos();

    const geom = parseAndValidate(wkb);
    if (!geom) return null;

    const params = geosInstance!.GEOSBufferParams_create();
    geosInstance!.GEOSBufferParams_setQuadrantSegments(
        params,
        quadrantSegments,
    );
    geosInstance!.GEOSBufferParams_setEndCapStyle(params, GEOSBUF_CAP_ROUND);
    geosInstance!.GEOSBufferParams_setJoinStyle(params, GEOSBUF_JOIN_ROUND);
    const buffered = geosInstance!.GEOSBufferWithParams(geom, params, distance);
    geosInstance!.GEOSBufferParams_destroy(params);
    geosInstance!.GEOSGeom_destroy(geom);
    if (!buffered) return null;

    const out = geomToWKB(buffered);
    geosInstance!.GEOSGeom_destroy(buffered);
    return out;
}

/**
 * Unary union a little-endian WKB geometry, returning WKB or `null` on
 * failure.
 *
 * **Known divergence from native (geos_ops.cpp):** the native side applies
 * a `to_polygonal()` filter that strips non-polygonal sub-geometries from
 * GeometryCollection results before WKB serialization (audit item 11). This
 * wasm helper does **not** replicate that step — it serializes the raw GEOS
 * result. The two paths agree on pure-polygonal outputs (the common case);
 * they only diverge on mixed-type GeometryCollections, which the host parity
 * gate currently skips (see the `skip` annotations in the golden fixtures).
 * Closing this gap would require binding `GEOSGeomTypeId`, `GEOSGetNumGeometries`,
 * `GEOSGetGeometryN`, and `GEOSGeom_createCollection` in the wasm `GeosInstance`
 * interface. Tracked as a follow-up.
 */
export function unaryUnionWKB(wkb: Uint8Array): Uint8Array | null {
    ensureGeos();

    const geom = parseAndValidate(wkb);
    if (!geom) return null;

    const unioned = geosInstance!.GEOSUnaryUnion(geom);
    geosInstance!.GEOSGeom_destroy(geom);
    if (!unioned) return null;

    const out = geomToWKB(unioned);
    geosInstance!.GEOSGeom_destroy(unioned);
    return out;
}

const binary =
    (geosFn: "GEOSDifference" | "GEOSUnion" | "GEOSIntersection") =>
    (a: Uint8Array, b: Uint8Array): Uint8Array | null => {
        ensureGeos();

        const ga = parseAndValidate(a);
        const gb = parseAndValidate(b);
        if (!ga || !gb) {
            if (ga) geosInstance!.GEOSGeom_destroy(ga);
            if (gb) geosInstance!.GEOSGeom_destroy(gb);
            return null;
        }

        const result = geosInstance![geosFn](ga, gb);
        geosInstance!.GEOSGeom_destroy(ga);
        geosInstance!.GEOSGeom_destroy(gb);
        if (!result) return null;

        const out = geomToWKB(result);
        geosInstance!.GEOSGeom_destroy(result);
        return out;
    };

export const differenceWKB = binary("GEOSDifference");
export const unionWKB = binary("GEOSUnion");
export const intersectionWKB = binary("GEOSIntersection");

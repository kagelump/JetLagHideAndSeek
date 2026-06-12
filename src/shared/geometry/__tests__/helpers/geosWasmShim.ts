/**
 * Test-only re-export of the Node GEOS-wasm helper.
 *
 * The real engine lives in `src/shared/geometry/geosWasmNode.ts` and is shared
 * with the packs pipeline. This file exists so the GEOS test suites can keep
 * importing from their existing helper path.
 *
 * The GEOS suites run under Jest with `--experimental-vm-modules` so the plain
 * ESM import of `geos-wasm` in the underlying module resolves correctly.
 */

export {
    initGeosWasm,
    geosWasmVersion,
    bufferWKB,
    unaryUnionWKB,
    differenceWKB,
    unionWKB,
    intersectionWKB,
} from "../../geosWasmNode";

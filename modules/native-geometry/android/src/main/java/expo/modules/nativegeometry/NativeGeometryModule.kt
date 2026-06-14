package expo.modules.nativegeometry

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Production Expo Module — a thin delegator over [GeosBridge], which owns the
 * GEOS JNI layer. Keeping the GEOS logic in [GeosBridge] lets the instrumented
 * (`androidTest`) suite exercise the real binary without the RN bridge.
 */
class NativeGeometryModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("NativeGeometry")

        Function("geosVersion") {
            GeosBridge.version()
        }

        // -- ABI version handshake (G5 follow-up) ------------------------------
        Function("nativeAbiVersion") { GeosBridge.NATIVE_ABI_VERSION }

        Function("bufferWKB") { wkb: ByteArray, distance: Double, quadrantSegments: Int ->
            GeosBridge.buffer(wkb, distance, quadrantSegments)
        }

        // -- Overlay ops: binary --------------------------------------------
        Function("differenceWKB") { wkbA: ByteArray, wkbB: ByteArray ->
            GeosBridge.difference(wkbA, wkbB)
        }

        Function("unionWKB") { wkbA: ByteArray, wkbB: ByteArray ->
            GeosBridge.union(wkbA, wkbB)
        }

        Function("intersectionWKB") { wkbA: ByteArray, wkbB: ByteArray ->
            GeosBridge.intersection(wkbA, wkbB)
        }

        // -- Overlay op: unary union ----------------------------------------
        Function("unaryUnionWKB") { wkb: ByteArray ->
            GeosBridge.unaryUnion(wkb)
        }
    }
}

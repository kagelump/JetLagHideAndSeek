package expo.modules.nativegeometry

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * G2 production Expo Module — GEOS-backed bufferWKB replacing the G1 smoke test.
 */
class NativeGeometryModule : Module() {

    companion object {
        init {
            System.loadLibrary("native-geometry-jni")
        }
    }

    override fun definition() = ModuleDefinition {
        Name("NativeGeometry")

        Function("geosVersion") {
            nativeGeosVersion()
        }

        // -- ABI version handshake (G5 follow-up) ------------------------------
        Function("nativeAbiVersion") { 2 }

        Function("bufferWKB") { wkb: ByteArray, distance: Double, quadrantSegments: Int ->
            nativeBufferWKB(wkb, distance, quadrantSegments)
        }

        // -- Overlay ops: binary --------------------------------------------
        Function("differenceWKB") { wkbA: ByteArray, wkbB: ByteArray ->
            nativeDifferenceWKB(wkbA, wkbB)
        }

        Function("unionWKB") { wkbA: ByteArray, wkbB: ByteArray ->
            nativeUnionWKB(wkbA, wkbB)
        }

        Function("intersectionWKB") { wkbA: ByteArray, wkbB: ByteArray ->
            nativeIntersectionWKB(wkbA, wkbB)
        }

        // -- Overlay op: unary union ----------------------------------------
        Function("unaryUnionWKB") { wkb: ByteArray ->
            nativeUnaryUnionWKB(wkb)
        }
    }

    // -- JNI declarations ---------------------------------------------------

    private external fun nativeGeosVersion(): String
    private external fun nativeBufferWKB(
        wkb: ByteArray,
        distance: Double,
        quadrantSegments: Int
    ): ByteArray?

    // -- Overlay ops --------------------------------------------------------
    private external fun nativeDifferenceWKB(
        wkbA: ByteArray,
        wkbB: ByteArray
    ): ByteArray?

    private external fun nativeUnionWKB(
        wkbA: ByteArray,
        wkbB: ByteArray
    ): ByteArray?

    private external fun nativeIntersectionWKB(
        wkbA: ByteArray,
        wkbB: ByteArray
    ): ByteArray?

    private external fun nativeUnaryUnionWKB(
        wkb: ByteArray
    ): ByteArray?
}

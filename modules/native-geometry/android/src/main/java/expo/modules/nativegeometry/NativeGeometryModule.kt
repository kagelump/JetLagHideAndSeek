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

        Function("bufferWKB") { wkb: ByteArray, distance: Double, quadrantSegments: Int ->
            nativeBufferWKB(wkb, distance, quadrantSegments)
        }
    }

    // -- JNI declarations ---------------------------------------------------

    private external fun nativeGeosVersion(): String
    private external fun nativeBufferWKB(
        wkb: ByteArray,
        distance: Double,
        quadrantSegments: Int
    ): ByteArray?
}

package expo.modules.nativegeometry

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * G1 smoke-test Expo Module — minimal GEOS integration to prove linking
 * and execution on Android before G2 builds the full backend.
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

        Function("smokeTest") { wkb: ByteArray ->
            nativeSmokeTest(wkb)
        }
    }

    // -- JNI declarations ---------------------------------------------------

    private external fun nativeGeosVersion(): String
    private external fun nativeSmokeTest(wkb: ByteArray): ByteArray?
}

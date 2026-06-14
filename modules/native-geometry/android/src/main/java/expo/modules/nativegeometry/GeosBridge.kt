package expo.modules.nativegeometry

/**
 * GeosBridge — thin, RN-bridge-free wrapper over the GEOS JNI layer.
 *
 * Android counterpart to `ios/GeosCore.swift`. It owns `System.loadLibrary`
 * and the `external fun native*` declarations, plus a small public surface
 * (`version`, `buffer`, `difference`, `union`, `intersection`, `unaryUnion`)
 * so the GEOS ops can be invoked from instrumented (`androidTest`) JUnit
 * **without** the Expo module / React Native bridge. `NativeGeometryModule`
 * delegates every `Function()` to this object.
 *
 * Important: the JNI exports in `native-geometry-jni.cpp` are bound by name to
 * THIS class — `Java_expo_modules_nativegeometry_GeosBridge_native*`. The
 * `external fun` declarations must therefore live here, not on
 * `NativeGeometryModule`; moving them changes the expected symbol name and
 * would surface as `UnsatisfiedLinkError` at first call.
 *
 * The heavy lifting (WKB parse, validate/MakeValid recovery, the GEOS op, WKB
 * write, and all handle ownership) is in the C++ layer — this object is a
 * one-line passthrough per op.
 */
object GeosBridge {
    init {
        System.loadLibrary("native-geometry-jni")
    }

    /** ABI handshake constant; mirrors `nativeAbiVersion` exposed by the module. */
    const val NATIVE_ABI_VERSION: Int = 2

    fun version(): String = nativeGeosVersion()

    fun buffer(wkb: ByteArray, distance: Double, quadrantSegments: Int): ByteArray? =
        nativeBufferWKB(wkb, distance, quadrantSegments)

    fun difference(wkbA: ByteArray, wkbB: ByteArray): ByteArray? =
        nativeDifferenceWKB(wkbA, wkbB)

    fun union(wkbA: ByteArray, wkbB: ByteArray): ByteArray? =
        nativeUnionWKB(wkbA, wkbB)

    fun intersection(wkbA: ByteArray, wkbB: ByteArray): ByteArray? =
        nativeIntersectionWKB(wkbA, wkbB)

    fun unaryUnion(wkb: ByteArray): ByteArray? =
        nativeUnaryUnionWKB(wkb)

    // -- JNI declarations --------------------------------------------------
    // Symbols: Java_expo_modules_nativegeometry_GeosBridge_native*

    private external fun nativeGeosVersion(): String

    private external fun nativeBufferWKB(
        wkb: ByteArray,
        distance: Double,
        quadrantSegments: Int
    ): ByteArray?

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

// native-geometry-jni.cpp — JNI marshalling shim over the shared GEOS op core.
//
// The parse → validate → MakeValid → op → write → free pipeline lives once in
// geos_ops.cpp (compiled into this .so alongside this file — see
// android/CMakeLists.txt). This file does nothing but marshal jbyteArray ⇄
// the core's `GeosWkbBuffer` and forward to the matching geos_ops_* function.
//
// The JNI exports are bound by name to the Kotlin `GeosBridge` object
// (Java_expo_modules_nativegeometry_GeosBridge_native*). GeosBridge owns
// System.loadLibrary + the `external fun` declarations; NativeGeometryModule
// delegates to it. If those declarations move to another class, these symbol
// names must change to match or the first call throws UnsatisfiedLinkError.

#include <jni.h>
#include <android/log.h>

#include <mutex>

#include "geos_ops.h"

#define TAG "NativeGeometry-JNI"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// ─── Marshalling helpers ────────────────────────────────────────────────────

// Copy a core result buffer into a fresh Java byte[] and free the C buffer.
// Returns nullptr for the empty/null result (matching the prior contract).
static jbyteArray toByteArray(JNIEnv* env, GeosWkbBuffer buffer) {
    if (!buffer.data || buffer.size == 0) {
        geos_ops_free(buffer);
        return nullptr;
    }

    jbyteArray result = env->NewByteArray(static_cast<jsize>(buffer.size));
    if (result) {
        env->SetByteArrayRegion(result, 0, static_cast<jsize>(buffer.size),
            reinterpret_cast<const jbyte*>(buffer.data));
    } else {
        LOGE("toByteArray: failed to allocate output byte array");
    }
    geos_ops_free(buffer);
    return result;
}

// Forward a binary overlay op (difference / union / intersection) to the core.
static jbyteArray runBinary(JNIEnv* env, jbyteArray wkbA, jbyteArray wkbB,
    GeosWkbBuffer (*op)(const unsigned char*, size_t, const unsigned char*, size_t)) {

    jsize lenA = env->GetArrayLength(wkbA);
    jsize lenB = env->GetArrayLength(wkbB);
    if (lenA == 0 || lenB == 0) return nullptr;

    jbyte* bytesA = env->GetByteArrayElements(wkbA, nullptr);
    jbyte* bytesB = env->GetByteArrayElements(wkbB, nullptr);
    if (!bytesA || !bytesB) {
        if (bytesA) env->ReleaseByteArrayElements(wkbA, bytesA, JNI_ABORT);
        if (bytesB) env->ReleaseByteArrayElements(wkbB, bytesB, JNI_ABORT);
        return nullptr;
    }

    GeosWkbBuffer out = op(
        reinterpret_cast<const unsigned char*>(bytesA), static_cast<size_t>(lenA),
        reinterpret_cast<const unsigned char*>(bytesB), static_cast<size_t>(lenB));

    env->ReleaseByteArrayElements(wkbA, bytesA, JNI_ABORT);
    env->ReleaseByteArrayElements(wkbB, bytesB, JNI_ABORT);
    return toByteArray(env, out);
}

// ─── JNI exports ───────────────────────────────────────────────────────────

extern "C" {

JNIEXPORT jstring JNICALL
Java_expo_modules_nativegeometry_GeosBridge_nativeGeosVersion(
    JNIEnv* env, jobject /* thiz */) {

    static std::once_flag logFlag;
    std::call_once(logFlag, []() {
        geos_ops_set_log([](const char* msg) {
            __android_log_print(ANDROID_LOG_DEBUG, TAG, "%s", msg ? msg : "(null)");
        });
    });

    const char* version = geos_ops_version();
    return env->NewStringUTF(version ? version : "unknown");
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nativegeometry_GeosBridge_nativeBufferWKB(
    JNIEnv* env, jobject /* thiz */, jbyteArray wkb,
    jdouble distance, jint quadrantSegments) {

    jsize len = env->GetArrayLength(wkb);
    if (len == 0) return nullptr;

    jbyte* bytes = env->GetByteArrayElements(wkb, nullptr);
    if (!bytes) return nullptr;

    GeosWkbBuffer out = geos_ops_buffer(
        reinterpret_cast<const unsigned char*>(bytes), static_cast<size_t>(len),
        distance, static_cast<int>(quadrantSegments));

    env->ReleaseByteArrayElements(wkb, bytes, JNI_ABORT);
    return toByteArray(env, out);
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nativegeometry_GeosBridge_nativeDifferenceWKB(
    JNIEnv* env, jobject /* thiz */, jbyteArray wkbA, jbyteArray wkbB) {
    return runBinary(env, wkbA, wkbB, geos_ops_difference);
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nativegeometry_GeosBridge_nativeUnionWKB(
    JNIEnv* env, jobject /* thiz */, jbyteArray wkbA, jbyteArray wkbB) {
    return runBinary(env, wkbA, wkbB, geos_ops_union);
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nativegeometry_GeosBridge_nativeIntersectionWKB(
    JNIEnv* env, jobject /* thiz */, jbyteArray wkbA, jbyteArray wkbB) {
    return runBinary(env, wkbA, wkbB, geos_ops_intersection);
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nativegeometry_GeosBridge_nativeUnaryUnionWKB(
    JNIEnv* env, jobject /* thiz */, jbyteArray wkb) {

    jsize len = env->GetArrayLength(wkb);
    if (len == 0) return nullptr;

    jbyte* bytes = env->GetByteArrayElements(wkb, nullptr);
    if (!bytes) return nullptr;

    GeosWkbBuffer out = geos_ops_unary_union(
        reinterpret_cast<const unsigned char*>(bytes), static_cast<size_t>(len));

    env->ReleaseByteArrayElements(wkb, bytes, JNI_ABORT);
    return toByteArray(env, out);
}

}  // extern "C"

// native-geometry-jni.cpp — JNI bridge to the GEOS C API.
//
// G1 smoke test: exposes geosVersion() and smokeTest() so the Expo Module
// can prove GEOS is linked and functional on Android.

#include <jni.h>
#include <android/log.h>
#include <string>
#include <cstring>

// GEOS C API — header shipped alongside the pre-built .a.
#include "geos_c.h"

#define TAG "NativeGeometry-JNI"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// ─── Context management ────────────────────────────────────────────────────

static GEOSContextHandle_t getOrCreateContext() {
    static GEOSContextHandle_t ctx = nullptr;
    if (ctx) return ctx;

    ctx = GEOS_init_r();

    // Install notice/error handlers that log to Android logcat.
    GEOSContext_setNoticeMessageHandler_r(ctx,
        [](const char* msg, void*) {
            LOGD("GEOS notice: %s", msg ? msg : "(null)");
        }, nullptr);

    GEOSContext_setErrorMessageHandler_r(ctx,
        [](const char* msg, void*) {
            LOGE("GEOS error: %s", msg ? msg : "(null)");
        }, nullptr);

    return ctx;
}

// ─── JNI exports ───────────────────────────────────────────────────────────

extern "C" {

JNIEXPORT jstring JNICALL
Java_expo_modules_nativegeometry_NativeGeometryModule_nativeGeosVersion(
    JNIEnv* env, jobject /* thiz */) {

    const char* version = GEOSversion();
    if (!version) {
        return env->NewStringUTF("unknown");
    }
    return env->NewStringUTF(version);
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_nativegeometry_NativeGeometryModule_nativeSmokeTest(
    JNIEnv* env, jobject /* thiz */, jbyteArray wkb) {

    auto* ctx = getOrCreateContext();

    // --- Read input WKB ----------------------------------------------------
    jsize wkbLen = env->GetArrayLength(wkb);
    if (wkbLen == 0) {
        LOGE("smokeTest: empty WKB input");
        return nullptr;
    }

    jbyte* wkbBytes = env->GetByteArrayElements(wkb, nullptr);
    if (!wkbBytes) {
        LOGE("smokeTest: failed to get WKB bytes");
        return nullptr;
    }

    auto* inGeom = GEOSGeomFromWKB_buf_r(ctx,
        reinterpret_cast<const unsigned char*>(wkbBytes),
        static_cast<size_t>(wkbLen));
    env->ReleaseByteArrayElements(wkb, wkbBytes, JNI_ABORT);

    if (!inGeom) {
        LOGE("smokeTest: failed to parse WKB");
        return nullptr;
    }

    // --- Validate / fix ----------------------------------------------------
    char isValid = 0;
    GEOSisValid_r(ctx, inGeom, &isValid);
    if (!isValid) {
        LOGD("smokeTest: geometry invalid — attempting MakeValid");
        auto* fixed = GEOSMakeValid_r(ctx, inGeom);
        GEOSGeom_destroy_r(ctx, inGeom);
        if (!fixed) {
            LOGE("smokeTest: MakeValid failed");
            return nullptr;
        }
        inGeom = fixed;
    }

    // --- Buffer ------------------------------------------------------------
    auto* params = GEOSBufferParams_create_r(ctx);
    if (!params) {
        GEOSGeom_destroy_r(ctx, inGeom);
        LOGE("smokeTest: failed to create buffer params");
        return nullptr;
    }
    GEOSBufferParams_setQuadrantSegments_r(ctx, params, 8);

    auto* buffered = GEOSBufferWithParams_r(ctx, inGeom, params, 0.01);
    GEOSBufferParams_destroy_r(ctx, params);
    GEOSGeom_destroy_r(ctx, inGeom);

    if (!buffered) {
        LOGE("smokeTest: buffer operation failed");
        return nullptr;
    }

    // --- Write output WKB --------------------------------------------------
    size_t wkbOutSize = 0;
    auto* wkbOut = GEOSGeomToWKB_buf_r(ctx, buffered, &wkbOutSize);
    GEOSGeom_destroy_r(ctx, buffered);

    if (!wkbOut || wkbOutSize == 0) {
        LOGE("smokeTest: failed to write output WKB");
        return nullptr;
    }

    jbyteArray result = env->NewByteArray(static_cast<jsize>(wkbOutSize));
    env->SetByteArrayRegion(result, 0, static_cast<jsize>(wkbOutSize),
        reinterpret_cast<const jbyte*>(wkbOut));
    GEOSFree_r(ctx, wkbOut);

    LOGD("smokeTest: success, output WKB size=%zu", wkbOutSize);
    return result;
}

} // extern "C"
